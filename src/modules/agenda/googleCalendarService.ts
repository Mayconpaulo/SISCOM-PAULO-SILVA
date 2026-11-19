import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  GoogleAuthProvider,
  User,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  AGENDA_CATEGORY_MAP,
  AgendaEvent,
  DEFAULT_INSTITUTIONAL_CALENDAR_EMAIL,
  GoogleCalendarListItem,
  GoogleCalendarRemoteEvent,
  GoogleContactSuggestion,
  GoogleEventAttachment,
  GoogleEventAttendee,
  GoogleEventReminder,
  GoogleEventTransparency,
  GoogleEventVisibility,
  parseAttachmentsJson,
  parseAttendeesJson,
  parseRemindersJson,
} from './agendaTypes';

/**
 * Isolated OAuth app for Google Calendar, Contacts, and Drive integration.
 * Runs alongside (never replacing) SISCOM's primary Firebase Auth session
 * so military users signed in with @siscom.app credentials remain signed in.
 */
const GOOGLE_CALENDAR_OAUTH_CONFIG = {
  projectId: 'gen-lang-client-0187607531',
  appId: '1:209099306810:web:9618e2a652e7877d560203',
  apiKey: 'AIzaSyBUO0BLFYradXpJJbtH2gwpYM3Gxb0xTzk',
  authDomain: 'gen-lang-client-0187607531.firebaseapp.com',
  storageBucket: 'gen-lang-client-0187607531.firebasestorage.app',
  messagingSenderId: '209099306810',
};

const CALENDAR_APP_NAME = 'siscom-google-calendar';

// Strict least-privilege scopes: Calendar + Contacts autocomplete + Drive app-created attachments (ZERO Gmail)
export const GOOGLE_WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/contacts.other.readonly',
  'https://www.googleapis.com/auth/drive.file',
] as const;

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const PEOPLE_API_BASE = 'https://people.googleapis.com/v1';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

export interface GoogleCalendarSession {
  connected: boolean;
  email: string | null;
  displayName: string | null;
}

let calendarApp: FirebaseApp | null = null;
let calendarAuth: Auth | null = null;
let isSigningIn = false;

// Strictly in-memory OAuth token cache (NEVER persisted to localStorage/sessionStorage)
let cachedAccessToken: string | null = null;
let cachedUserEmail: string | null = null;
let cachedUserName: string | null = null;

type SessionListener = (session: GoogleCalendarSession) => void;
const listeners = new Set<SessionListener>();
let authWatcherInitialized = false;

function getCalendarAuth(): Auth {
  if (!calendarApp) {
    const existing = getApps().find((a) => a.name === CALENDAR_APP_NAME);
    calendarApp = existing ?? initializeApp(GOOGLE_CALENDAR_OAUTH_CONFIG, CALENDAR_APP_NAME);
  }
  if (!calendarAuth) {
    calendarAuth = getAuth(calendarApp);
  }
  if (!authWatcherInitialized) {
    authWatcherInitialized = true;
    onAuthStateChanged(calendarAuth, (user: User | null) => {
      if (!user) {
        cachedAccessToken = null;
        cachedUserEmail = null;
        cachedUserName = null;
        notifyListeners();
      } else if (!cachedAccessToken && !isSigningIn) {
        cachedAccessToken = null;
        cachedUserEmail = user.email;
        cachedUserName = user.displayName;
        notifyListeners();
      }
    });
  }
  return calendarAuth;
}

function notifyListeners() {
  const snapshot = getGoogleCalendarSession();
  listeners.forEach((cb) => cb(snapshot));
}

export function getGoogleCalendarSession(): GoogleCalendarSession {
  return {
    connected: Boolean(cachedAccessToken),
    email: cachedUserEmail,
    displayName: cachedUserName,
  };
}

export function subscribeGoogleCalendarSession(listener: SessionListener): () => void {
  getCalendarAuth();
  listeners.add(listener);
  listener(getGoogleCalendarSession());
  return () => {
    listeners.delete(listener);
  };
}

export const GOOGLE_CALENDAR_FIREBASE_PROJECT_ID = GOOGLE_CALENDAR_OAUTH_CONFIG.projectId;

export class CalendarUnauthorizedDomainError extends Error {
  readonly domain: string;
  readonly consoleUrl: string;

  constructor(domain: string) {
    const consoleUrl = `https://console.firebase.google.com/project/${GOOGLE_CALENDAR_FIREBASE_PROJECT_ID}/authentication/settings`;
    super(
      `O domínio "${domain}" ainda não está autorizado para o login do Google no projeto "${GOOGLE_CALENDAR_FIREBASE_PROJECT_ID}". Adicione esse domínio em Authentication → Settings → Domínios autorizados.`
    );
    this.name = 'CalendarUnauthorizedDomainError';
    this.domain = domain;
    this.consoleUrl = consoleUrl;
  }
}

export async function connectGoogleCalendar(
  loginHintEmail = DEFAULT_INSTITUTIONAL_CALENDAR_EMAIL
): Promise<GoogleCalendarSession> {
  const authInstance = getCalendarAuth();
  const provider = new GoogleAuthProvider();
  GOOGLE_WORKSPACE_SCOPES.forEach((scope) => provider.addScope(scope));
  provider.setCustomParameters({
    prompt: 'select_account',
    ...(loginHintEmail ? { login_hint: loginHintEmail } : {}),
  });

  try {
    isSigningIn = true;
    const result = await signInWithPopup(authInstance, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error(
        'Não foi possível obter o token de acesso do Google. Tente autorizar novamente.'
      );
    }

    cachedAccessToken = credential.accessToken;
    cachedUserEmail = result.user.email || null;
    cachedUserName = result.user.displayName || null;
    notifyListeners();
    return getGoogleCalendarSession();
  } catch (error) {
    const code = (error as { code?: string })?.code || '';
    if (code === 'auth/unauthorized-domain') {
      const currentHost =
        typeof window !== 'undefined' ? window.location.hostname : 'domínio atual';
      throw new CalendarUnauthorizedDomainError(currentHost);
    }
    if (code === 'auth/popup-closed-by-user') {
      throw new Error('Janela de autorização do Google fechada antes da conclusão.');
    }
    if (code === 'auth/popup-blocked') {
      throw new Error(
        'O navegador bloqueou o pop-up do Google. Permita pop-ups para este site e tente novamente.'
      );
    }
    throw error instanceof Error
      ? error
      : new Error('Falha ao conectar com o Google.');
  } finally {
    isSigningIn = false;
  }
}

export async function disconnectGoogleCalendarSession(): Promise<void> {
  cachedAccessToken = null;
  cachedUserEmail = null;
  cachedUserName = null;
  try {
    if (calendarAuth) {
      await signOut(calendarAuth);
    }
  } catch {
    // Non-fatal cleanup
  }
  notifyListeners();
}

function requireAccessToken(): string {
  if (!cachedAccessToken) {
    throw new Error(
      'Sessão Google não ativa neste navegador. O administrador precisa clicar em "Sincronizar com Google".'
    );
  }
  return cachedAccessToken;
}

async function googleApiFetch<T>(
  fullUrl: string,
  options: RequestInit = {}
): Promise<T> {
  const token = requireAccessToken();
  const response = await fetch(fullUrl, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {}),
    },
  });

  if (response.status === 401) {
    cachedAccessToken = null;
    notifyListeners();
    throw new Error(
      'A sessão Google expirou. Clique em "Sincronizar com Google" para renovar.'
    );
  }

  if (response.status === 403) {
    let detail = '';
    try {
      const errJson = (await response.json()) as { error?: { message?: string } };
      detail = errJson?.error?.message || '';
    } catch {
      // Ignore parse error
    }
    throw new Error(
      detail
        ? `Permissão insuficiente na API do Google: ${detail}`
        : 'Permissão insuficiente para esta operação no Google.'
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    let errText = `Erro ${response.status} na API do Google.`;
    try {
      const errJson = (await response.json()) as { error?: { message?: string } };
      if (errJson?.error?.message) {
        errText = `Google: ${errJson.error.message}`;
      }
    } catch {
      // Ignore
    }
    throw new Error(errText);
  }

  return (await response.json()) as T;
}

interface RawCalendarListResponse {
  items?: Array<{
    id?: string;
    summary?: string;
    summaryOverride?: string;
    description?: string;
    primary?: boolean;
    accessRole?: string;
    backgroundColor?: string;
  }>;
}

export async function listGoogleCalendars(): Promise<GoogleCalendarListItem[]> {
  const data = await googleApiFetch<RawCalendarListResponse>(
    `${CALENDAR_API_BASE}/users/me/calendarList?minAccessRole=reader`
  );

  const items = (data.items || [])
    .filter((item) => Boolean(item.id && (item.summaryOverride || item.summary)))
    .map((item) => ({
      id: item.id as string,
      summary: (item.summaryOverride || item.summary || 'Calendário sem nome').trim(),
      description: item.description?.trim() || '',
      primary: Boolean(item.primary),
      accessRole: (item.accessRole as GoogleCalendarListItem['accessRole']) || 'reader',
      backgroundColor: item.backgroundColor,
    }));

  // Prioritize the institutional account calendar (comsoc1bimeces@gmail.com) or primary calendar of that account
  return items.sort((a, b) => {
    const aIsInst = a.id.toLowerCase() === DEFAULT_INSTITUTIONAL_CALENDAR_EMAIL;
    const bIsInst = b.id.toLowerCase() === DEFAULT_INSTITUTIONAL_CALENDAR_EMAIL;
    if (aIsInst !== bIsInst) return aIsInst ? -1 : 1;
    if (a.primary !== b.primary) return a.primary ? -1 : 1;
    return a.summary.localeCompare(b.summary, 'pt-BR');
  });
}

interface RawGoogleEventItem {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  colorId?: string;
  recurrence?: string[];
  visibility?: string;
  transparency?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
  attendees?: Array<{
    email?: string;
    displayName?: string;
    optional?: boolean;
    responseStatus?: string;
  }>;
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  attachments?: Array<{
    title?: string;
    fileUrl?: string;
    mimeType?: string;
    fileId?: string;
    iconLink?: string;
  }>;
  reminders?: {
    useDefault?: boolean;
    overrides?: Array<{ method?: string; minutes?: number }>;
  };
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  extendedProperties?: {
    private?: Record<string, string>;
  };
}

interface RawEventsListResponse {
  items?: RawGoogleEventItem[];
}

function addDaysToIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function extractMeetLink(item: RawGoogleEventItem): string {
  if (item.hangoutLink) return item.hangoutLink;
  const videoEntry = item.conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === 'video' && e.uri
  );
  return videoEntry?.uri || '';
}

export async function fetchGoogleCalendarEvents(
  calendarId: string,
  calendarSummary: string,
  timeMinIso: string,
  timeMaxIso: string
): Promise<GoogleCalendarRemoteEvent[]> {
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMin: timeMinIso,
    timeMax: timeMaxIso,
    maxResults: '250',
  });

  const data = await googleApiFetch<RawEventsListResponse>(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
  );

  return (data.items || [])
    .filter((item) => item.id && item.status !== 'cancelled')
    .map((item) => {
      const isAllDay = Boolean(item.start?.date && !item.start?.dateTime);
      const startAt = isAllDay
        ? (item.start?.date as string)
        : item.start?.dateTime || new Date().toISOString();

      let endAt: string;
      if (isAllDay && item.end?.date) {
        const inclusiveEnd = addDaysToIsoDate(item.end.date, -1);
        endAt = inclusiveEnd >= startAt ? inclusiveEnd : startAt;
      } else {
        endAt = item.end?.dateTime || startAt;
      }

      const attendees: GoogleEventAttendee[] = (item.attendees || [])
        .filter((a) => a.email)
        .map((a) => ({
          email: (a.email as string).toLowerCase(),
          displayName: a.displayName,
          optional: Boolean(a.optional),
          responseStatus: a.responseStatus,
        }));

      const attachments: GoogleEventAttachment[] = (item.attachments || [])
        .filter((att) => att.fileUrl)
        .map((att) => ({
          title: att.title || 'Anexo',
          fileUrl: att.fileUrl as string,
          mimeType: att.mimeType,
          fileId: att.fileId,
          iconLink: att.iconLink,
        }));

      const reminders: GoogleEventReminder[] = (item.reminders?.overrides || [])
        .filter(
          (r) => (r.method === 'popup' || r.method === 'email') && typeof r.minutes === 'number'
        )
        .map((r) => ({
          method: r.method as 'popup' | 'email',
          minutes: r.minutes as number,
        }));

      const visibility: GoogleEventVisibility =
        item.visibility === 'public' || item.visibility === 'private'
          ? item.visibility
          : 'default';

      const transparency: GoogleEventTransparency =
        item.transparency === 'transparent' ? 'transparent' : 'opaque';

      return {
        id: item.id as string,
        calendarId,
        calendarSummary,
        summary: item.summary?.trim() || '(Sem título)',
        description: item.description?.trim() || '',
        location: item.location?.trim() || '',
        startAt,
        endAt,
        allDay: isAllDay,
        htmlLink: item.htmlLink || '',
        siscomEventId: item.extendedProperties?.private?.siscomEventId,
        colorId: item.colorId || '',
        recurrenceRule: item.recurrence?.[0] || '',
        visibility,
        transparency,
        meetLink: extractMeetLink(item),
        attendees,
        guestsCanModify: Boolean(item.guestsCanModify),
        guestsCanInviteOthers: item.guestsCanInviteOthers !== false,
        guestsCanSeeOtherGuests: item.guestsCanSeeOtherGuests !== false,
        attachments,
        reminders,
      };
    });
}

function buildGoogleEventPayload(event: AgendaEvent, requestNewMeet: boolean) {
  const categoryLabel = AGENDA_CATEGORY_MAP[event.category]?.label || event.category;
  const localTimeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';

  const descriptionParts: string[] = [];
  if (event.description.trim()) {
    descriptionParts.push(event.description.trim());
  }
  if (!event.description.includes('Origem: SISCOM')) {
    descriptionParts.push(`—\nCategoria COMSOC: ${categoryLabel}`);
    if (event.responsibles.trim()) {
      descriptionParts.push(`Responsáveis: ${event.responsibles.trim()}`);
    }
    descriptionParts.push('Origem: SISCOM — Agenda da Comunicação Social');
  }

  const start = event.allDay
    ? { date: event.startAt.slice(0, 10) }
    : { dateTime: new Date(event.startAt).toISOString(), timeZone: localTimeZone };

  const end = event.allDay
    ? { date: addDaysToIsoDate(event.endAt.slice(0, 10), 1) }
    : { dateTime: new Date(event.endAt).toISOString(), timeZone: localTimeZone };

  const attendees = parseAttendeesJson(event.attendeesJson).map((att) => ({
    email: att.email,
    displayName: att.displayName || undefined,
    optional: att.optional || undefined,
  }));

  const attachments = parseAttachmentsJson(event.attachmentsJson).map((att) => ({
    title: att.title,
    fileUrl: att.fileUrl,
    mimeType: att.mimeType || undefined,
  }));

  const remindersList = parseRemindersJson(event.remindersJson, event.reminderMinutes);

  const payload: Record<string, unknown> = {
    summary: event.title,
    location: event.location || undefined,
    description: descriptionParts.join('\n'),
    start,
    end,
    colorId: event.colorId || undefined,
    recurrence: event.recurrenceRule ? [event.recurrenceRule] : undefined,
    visibility: event.visibility && event.visibility !== 'default' ? event.visibility : undefined,
    transparency: event.transparency || 'opaque',
    attendees: attendees.length > 0 ? attendees : undefined,
    guestsCanModify: Boolean(event.guestsCanModify),
    guestsCanInviteOthers: event.guestsCanInviteOthers !== false,
    guestsCanSeeOtherGuests: event.guestsCanSeeOtherGuests !== false,
    attachments: attachments.length > 0 ? attachments : undefined,
    reminders:
      remindersList.length > 0
        ? {
            useDefault: false,
            overrides: remindersList.slice(0, 5),
          }
        : { useDefault: true },
    extendedProperties: {
      private: {
        siscomEventId: event.id,
        siscomSource: 'SISCOM_COMSOC',
        siscomCategory: event.category,
      },
    },
  };

  if (requestNewMeet && !event.meetLink) {
    payload.conferenceData = {
      createRequest: {
        requestId: `siscom-${event.id}-${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  return payload;
}

export async function createGoogleCalendarEvent(
  calendarId: string,
  event: AgendaEvent
): Promise<{ googleEventId: string; htmlLink: string; meetLink: string }> {
  const wantMeet = Boolean(event.createMeet && !event.meetLink);
  const payload = buildGoogleEventPayload(event, wantMeet);
  const params = new URLSearchParams({
    supportsAttachments: 'true',
    conferenceDataVersion: wantMeet ? '1' : '0',
    sendUpdates: event.sendUpdates === 'all' ? 'all' : 'none',
  });

  const created = await googleApiFetch<RawGoogleEventItem>(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );

  if (!created.id) {
    throw new Error('O Google Calendar não retornou o identificador do evento criado.');
  }

  return {
    googleEventId: created.id,
    htmlLink: created.htmlLink || '',
    meetLink: extractMeetLink(created),
  };
}

export async function updateGoogleCalendarEvent(
  calendarId: string,
  googleEventId: string,
  event: AgendaEvent
): Promise<{ googleEventId: string; htmlLink: string; meetLink: string }> {
  const wantMeet = Boolean(event.createMeet && !event.meetLink);
  const payload = buildGoogleEventPayload(event, wantMeet);
  const params = new URLSearchParams({
    supportsAttachments: 'true',
    conferenceDataVersion: wantMeet ? '1' : '0',
    sendUpdates: event.sendUpdates === 'all' ? 'all' : 'none',
  });

  const updated = await googleApiFetch<RawGoogleEventItem>(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}?${params.toString()}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }
  );

  return {
    googleEventId: updated.id || googleEventId,
    htmlLink: updated.htmlLink || event.googleHtmlLink || '',
    meetLink: extractMeetLink(updated) || event.meetLink || '',
  };
}

export async function deleteGoogleCalendarEvent(
  calendarId: string,
  googleEventId: string
): Promise<void> {
  const token = requireAccessToken();
  const response = await fetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (response.status === 204 || response.status === 404 || response.status === 410) {
    return;
  }

  if (response.status === 401) {
    cachedAccessToken = null;
    notifyListeners();
    throw new Error(
      'A autorização do Google Calendar expirou. Reconecte antes de excluir o evento.'
    );
  }

  throw new Error(`Não foi possível remover o evento no Google Calendar (HTTP ${response.status}).`);
}

/* ── Google People API: Autocomplete de Pessoas da Conta ────────────────── */

interface RawPerson {
  names?: Array<{ displayName?: string }>;
  emailAddresses?: Array<{ value?: string }>;
  photos?: Array<{ url?: string }>;
}

interface RawConnectionsResponse {
  connections?: RawPerson[];
}

interface RawOtherContactsResponse {
  otherContacts?: RawPerson[];
}

export async function fetchGoogleContacts(): Promise<GoogleContactSuggestion[]> {
  const byEmail = new Map<string, GoogleContactSuggestion>();

  const ingestPerson = (person: RawPerson) => {
    const name = person.names?.[0]?.displayName?.trim() || '';
    const photo = person.photos?.[0]?.url;
    (person.emailAddresses || []).forEach((em) => {
      const email = em.value?.trim().toLowerCase();
      if (!email || !email.includes('@')) return;
      if (!byEmail.has(email)) {
        byEmail.set(email, {
          email,
          displayName: name || email,
          photoUrl: photo,
        });
      }
    });
  };

  // Query Saved Contacts + Other Contacts (people previously emailed/invited) in parallel
  const [connResult, otherResult] = await Promise.allSettled([
    googleApiFetch<RawConnectionsResponse>(
      `${PEOPLE_API_BASE}/people/me/connections?personFields=names,emailAddresses,photos&pageSize=250`
    ),
    googleApiFetch<RawOtherContactsResponse>(
      `${PEOPLE_API_BASE}/otherContacts?readMask=names,emailAddresses,photos&pageSize=250`
    ),
  ]);

  if (connResult.status === 'fulfilled') {
    (connResult.value.connections || []).forEach(ingestPerson);
  }
  if (otherResult.status === 'fulfilled') {
    (otherResult.value.otherContacts || []).forEach(ingestPerson);
  }

  return Array.from(byEmail.values()).sort((a, b) =>
    a.displayName.localeCompare(b.displayName, 'pt-BR')
  );
}

/* ── Google Drive API: Upload de Anexos e Imagens para o Evento ─────────── */

interface RawDriveFileResponse {
  id?: string;
  name?: string;
  mimeType?: string;
  webViewLink?: string;
  iconLink?: string;
}

export async function uploadFileToGoogleDriveForEvent(
  file: File
): Promise<GoogleEventAttachment> {
  const token = requireAccessToken();

  const metadata = {
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
  };

  const formData = new FormData();
  formData.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  formData.append('file', file);

  const response = await fetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,iconLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    }
  );

  if (response.status === 401) {
    cachedAccessToken = null;
    notifyListeners();
    throw new Error('Sessão Google expirada. Reconecte antes de enviar anexos.');
  }

  if (!response.ok) {
    let errText = `Erro ${response.status} ao enviar anexo para o Google Drive.`;
    try {
      const errJson = (await response.json()) as { error?: { message?: string } };
      if (errJson?.error?.message) errText = `Google Drive: ${errJson.error.message}`;
    } catch {
      // Ignore
    }
    throw new Error(errText);
  }

  const uploaded = (await response.json()) as RawDriveFileResponse;
  if (!uploaded.id || !uploaded.webViewLink) {
    throw new Error('O Google Drive não retornou o link do arquivo enviado.');
  }

  return {
    fileId: uploaded.id,
    title: uploaded.name || file.name,
    fileUrl: uploaded.webViewLink,
    mimeType: uploaded.mimeType || file.type || 'application/octet-stream',
    iconLink: uploaded.iconLink,
  };
}
