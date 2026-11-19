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
  GoogleCalendarListItem,
  GoogleCalendarRemoteEvent,
} from './agendaTypes';

/**
 * Isolated OAuth app for Google Calendar API integration.
 * Runs alongside (never replacing) SISCOM's primary Firebase Auth session
 * so military users signed in with @siscom.app credentials remain signed in
 * while authorizing the institutional COMSOC Google Calendar account.
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

// Strict least-privilege scopes: Calendar ONLY (zero Gmail permissions)
export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const;

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

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
        // After a full page reload Firebase may restore the user but NOT the OAuth access token.
        // Require explicit re-consent click to obtain a fresh in-memory token.
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

export async function connectGoogleCalendar(): Promise<GoogleCalendarSession> {
  const authInstance = getCalendarAuth();
  const provider = new GoogleAuthProvider();
  GOOGLE_CALENDAR_SCOPES.forEach((scope) => provider.addScope(scope));
  provider.setCustomParameters({
    prompt: 'select_account consent',
  });

  try {
    isSigningIn = true;
    const result = await signInWithPopup(authInstance, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error(
        'Não foi possível obter o token de acesso do Google Calendar. Tente autorizar novamente.'
      );
    }

    cachedAccessToken = credential.accessToken;
    cachedUserEmail = result.user.email || null;
    cachedUserName = result.user.displayName || null;
    notifyListeners();
    return getGoogleCalendarSession();
  } catch (error) {
    const code = (error as { code?: string })?.code || '';
    if (code === 'auth/popup-closed-by-user') {
      throw new Error('Janela de autorização do Google Calendar fechada antes da conclusão.');
    }
    if (code === 'auth/popup-blocked') {
      throw new Error(
        'O navegador bloqueou o pop-up do Google. Permita pop-ups para este site e tente novamente.'
      );
    }
    throw error instanceof Error
      ? error
      : new Error('Falha ao conectar com o Google Calendar.');
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
      'Sessão do Google Calendar não conectada ou expirada. Clique em "Conectar Google Calendar".'
    );
  }
  return cachedAccessToken;
}

async function calendarApiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = requireAccessToken();
  const response = await fetch(`${CALENDAR_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (response.status === 401) {
    cachedAccessToken = null;
    notifyListeners();
    throw new Error(
      'A autorização do Google Calendar expirou. Clique em "Conectar Google Calendar" para renovar.'
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
        ? `Permissão insuficiente no Google Calendar: ${detail}`
        : 'Permissão insuficiente neste calendário. Verifique se você possui acesso de escrita no calendário secundário.'
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    let errText = `Erro ${response.status} na API do Google Calendar.`;
    try {
      const errJson = (await response.json()) as { error?: { message?: string } };
      if (errJson?.error?.message) {
        errText = `Google Calendar: ${errJson.error.message}`;
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
  const data = await calendarApiFetch<RawCalendarListResponse>(
    '/users/me/calendarList?minAccessRole=reader'
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

  // Place writable secondary calendars FIRST to guide the user away from their personal primary calendar
  return items.sort((a, b) => {
    if (a.primary !== b.primary) return a.primary ? 1 : -1;
    const aWritable = a.accessRole === 'owner' || a.accessRole === 'writer';
    const bWritable = b.accessRole === 'owner' || b.accessRole === 'writer';
    if (aWritable !== bWritable) return aWritable ? -1 : 1;
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

  const data = await calendarApiFetch<RawEventsListResponse>(
    `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
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
        // Google Calendar all-day end.date is exclusive; subtract 1 day for inclusive UI display
        const inclusiveEnd = addDaysToIsoDate(item.end.date, -1);
        endAt = inclusiveEnd >= startAt ? inclusiveEnd : startAt;
      } else {
        endAt = item.end?.dateTime || startAt;
      }

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
      };
    });
}

function buildGoogleEventPayload(event: AgendaEvent) {
  const categoryLabel = AGENDA_CATEGORY_MAP[event.category]?.label || event.category;
  const localTimeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';

  const descriptionParts: string[] = [];
  if (event.description.trim()) {
    descriptionParts.push(event.description.trim());
  }
  descriptionParts.push(`—\nCategoria COMSOC: ${categoryLabel}`);
  if (event.responsibles.trim()) {
    descriptionParts.push(`Responsáveis: ${event.responsibles.trim()}`);
  }
  descriptionParts.push('Origem: SISCOM — Agenda da Comunicação Social');

  const start = event.allDay
    ? { date: event.startAt.slice(0, 10) }
    : { dateTime: new Date(event.startAt).toISOString(), timeZone: localTimeZone };

  const end = event.allDay
    ? { date: addDaysToIsoDate(event.endAt.slice(0, 10), 1) } // Google exclusive end date
    : { dateTime: new Date(event.endAt).toISOString(), timeZone: localTimeZone };

  return {
    summary: event.title,
    location: event.location || undefined,
    description: descriptionParts.join('\n'),
    start,
    end,
    reminders:
      event.reminderMinutes > 0
        ? {
            useDefault: false,
            overrides: [{ method: 'popup', minutes: event.reminderMinutes }],
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
}

export async function createGoogleCalendarEvent(
  calendarId: string,
  event: AgendaEvent
): Promise<{ googleEventId: string; htmlLink: string }> {
  const payload = buildGoogleEventPayload(event);
  const created = await calendarApiFetch<RawGoogleEventItem>(
    `/calendars/${encodeURIComponent(calendarId)}/events`,
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
  };
}

export async function updateGoogleCalendarEvent(
  calendarId: string,
  googleEventId: string,
  event: AgendaEvent
): Promise<{ googleEventId: string; htmlLink: string }> {
  const payload = buildGoogleEventPayload(event);
  const updated = await calendarApiFetch<RawGoogleEventItem>(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }
  );

  return {
    googleEventId: updated.id || googleEventId,
    htmlLink: updated.htmlLink || event.googleHtmlLink || '',
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

  // 404 or 410 means the event was already deleted on Google Calendar — treat as resolved
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
