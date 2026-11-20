import type { Timestamp } from 'firebase/firestore';

export type AgendaCategory =
  | 'solenidade'
  | 'formatura'
  | 'visita'
  | 'fotografia'
  | 'audiovisual'
  | 'reuniao'
  | 'data_comemorativa'
  | 'outros';

export type AgendaStatus = 'agendado' | 'realizado' | 'cancelado';

export type AgendaSyncStatus = 'internal' | 'synced' | 'error';

export type ComsocScope = 'comsoc' | 'general' | 'pending';

export type GoogleEventVisibility = 'default' | 'public' | 'private';

export type GoogleEventTransparency = 'opaque' | 'transparent';

export type GoogleSendUpdates = 'all' | 'none';

export type AgendaAuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'sync_push'
  | 'sync_update'
  | 'sync_delete'
  | 'google_connect'
  | 'google_disconnect';

export const DEFAULT_INSTITUTIONAL_CALENDAR_EMAIL = 'comsoc1bimeces@gmail.com';

export interface AgendaCategoryMeta {
  id: AgendaCategory;
  label: string;
  shortLabel: string;
  dotClass: string;
  chipClass: string;
  borderClass: string;
}

export const AGENDA_CATEGORIES: readonly AgendaCategoryMeta[] = [
  {
    id: 'solenidade',
    label: 'Solenidades militares',
    shortLabel: 'Solenidade',
    dotClass: 'bg-[#E5C17B]',
    chipClass: 'bg-[#C29B56]/18 text-[#F4E6C4] border-[#C29B56]/40',
    borderClass: 'border-l-[#C8A461]',
  },
  {
    id: 'formatura',
    label: 'Formaturas',
    shortLabel: 'Formatura',
    dotClass: 'bg-[#83B499]',
    chipClass: 'bg-[#2D5A43]/28 text-[#C9E2D4] border-[#83B499]/35',
    borderClass: 'border-l-[#5E9978]',
  },
  {
    id: 'visita',
    label: 'Visitas institucionais',
    shortLabel: 'Visita',
    dotClass: 'bg-[#93B7D8]',
    chipClass: 'bg-[#253B52]/35 text-[#CDE0F2] border-[#93B7D8]/35',
    borderClass: 'border-l-[#7AA3C8]',
  },
  {
    id: 'fotografia',
    label: 'Coberturas fotográficas',
    shortLabel: 'Fotografia',
    dotClass: 'bg-[#C9A47B]',
    chipClass: 'bg-[#5A3F25]/35 text-[#F0DBC2] border-[#C9A47B]/35',
    borderClass: 'border-l-[#C49666]',
  },
  {
    id: 'audiovisual',
    label: 'Produção audiovisual',
    shortLabel: 'Audiovisual',
    dotClass: 'bg-[#B39DDB]',
    chipClass: 'bg-[#3C2E57]/35 text-[#E0D4F7] border-[#B39DDB]/35',
    borderClass: 'border-l-[#9E86CC]',
  },
  {
    id: 'reuniao',
    label: 'Reuniões',
    shortLabel: 'Reunião',
    dotClass: 'bg-[#80CBC4]',
    chipClass: 'bg-[#1D4A46]/35 text-[#C7ECE8] border-[#80CBC4]/35',
    borderClass: 'border-l-[#5AAEA6]',
  },
  {
    id: 'data_comemorativa',
    label: 'Datas comemorativas',
    shortLabel: 'Comemorativa',
    dotClass: 'bg-[#E6A38A]',
    chipClass: 'bg-[#5C2D20]/35 text-[#F7D7CA] border-[#E6A38A]/35',
    borderClass: 'border-l-[#D4886E]',
  },
  {
    id: 'outros',
    label: 'Outras atividades da Comunicação Social',
    shortLabel: 'Outros',
    dotClass: 'bg-[#98A89F]',
    chipClass: 'bg-white/8 text-[#C6D4CC] border-white/18',
    borderClass: 'border-l-[#7D8F85]',
  },
];

export const AGENDA_CATEGORY_MAP: Record<AgendaCategory, AgendaCategoryMeta> =
  AGENDA_CATEGORIES.reduce(
    (acc, item) => {
      acc[item.id] = item;
      return acc;
    },
    {} as Record<AgendaCategory, AgendaCategoryMeta>
  );

export const AGENDA_STATUS_LABELS: Record<AgendaStatus, string> = {
  agendado: 'Agendado',
  realizado: 'Realizado',
  cancelado: 'Cancelado',
};

export interface GoogleColorOption {
  id: string;
  label: string;
  hex: string;
}

export const GOOGLE_EVENT_COLORS: readonly GoogleColorOption[] = [
  { id: '', label: 'Cor padrão do calendário', hex: '#2D5A43' },
  { id: '1', label: 'Lavanda', hex: '#7986CB' },
  { id: '2', label: 'Sálvia', hex: '#33B679' },
  { id: '3', label: 'Uva', hex: '#8E24AA' },
  { id: '4', label: 'Flamingo', hex: '#E67C73' },
  { id: '5', label: 'Banana', hex: '#F6BF26' },
  { id: '6', label: 'Tangerina', hex: '#F4511E' },
  { id: '7', label: 'Pavão', hex: '#039BE5' },
  { id: '8', label: 'Grafite', hex: '#616161' },
  { id: '9', label: 'Mirtilo', hex: '#3F51B5' },
  { id: '10', label: 'Manjericão', hex: '#0B8043' },
  { id: '11', label: 'Tomate', hex: '#D50000' },
];

export const RECURRENCE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: 'Não se repete' },
  { value: 'RRULE:FREQ=DAILY', label: 'Todos os dias' },
  { value: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', label: 'Todos os dias úteis (seg a sex)' },
  { value: 'RRULE:FREQ=WEEKLY', label: 'Semanalmente' },
  { value: 'RRULE:FREQ=MONTHLY', label: 'Mensalmente' },
  { value: 'RRULE:FREQ=YEARLY', label: 'Anualmente' },
];

export const REMINDER_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 0, label: 'Na hora do evento' },
  { value: 10, label: '10 minutos antes' },
  { value: 15, label: '15 minutos antes' },
  { value: 30, label: '30 minutos antes' },
  { value: 60, label: '1 hora antes' },
  { value: 120, label: '2 horas antes' },
  { value: 1440, label: '1 dia antes' },
  { value: 2880, label: '2 dias antes' },
  { value: 10080, label: '1 semana antes' },
];

export interface GoogleEventAttendee {
  email: string;
  displayName?: string;
  optional?: boolean;
  responseStatus?: string;
}

export interface GoogleEventAttachment {
  title: string;
  fileUrl: string;
  mimeType?: string;
  fileId?: string;
  iconLink?: string;
}

export interface GoogleEventReminder {
  method: 'popup' | 'email';
  minutes: number;
}

export interface GoogleContactSuggestion {
  email: string;
  displayName: string;
  photoUrl?: string;
}

export interface AgendaEvent {
  id: string;
  title: string;
  category: AgendaCategory;
  status: AgendaStatus;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string;
  responsibles: string;
  description: string;
  reminderMinutes: number;
  sectionScope: 'comsoc';
  googleEventId: string;
  googleCalendarId: string;
  googleCalendarSummary: string;
  googleHtmlLink: string;
  syncStatus: AgendaSyncStatus;
  lastSyncedAt: string;
  // Enhanced COMSOC triage & full Google Calendar parity fields (optional for legacy docs)
  comsocScope?: ComsocScope;
  colorId?: string;
  recurrenceRule?: string;
  visibility?: GoogleEventVisibility;
  transparency?: GoogleEventTransparency;
  meetLink?: string;
  createMeet?: boolean;
  attendeesJson?: string;
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  sendUpdates?: GoogleSendUpdates;
  attachmentsJson?: string;
  remindersJson?: string;
  pendingGoogleSync?: boolean;
  createdByUid: string;
  createdByName: string;
  updatedByUid: string;
  updatedByName: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface AgendaAuditLog {
  id: string;
  eventId: string;
  action: AgendaAuditAction;
  summary: string;
  actorUid: string;
  actorName: string;
  sectionScope: 'comsoc';
  createdAt?: Timestamp;
}

export interface AgendaIntegrationConfig {
  id: 'google_calendar';
  selectedCalendarId: string;
  selectedCalendarSummary: string;
  lockedAccountEmail?: string;
  lastSyncAt?: string;
  contactsCacheJson?: string;
  updatedByUid: string;
  updatedByName: string;
  updatedAt?: Timestamp;
}

export interface GoogleCalendarListItem {
  id: string;
  summary: string;
  description?: string;
  primary: boolean;
  accessRole: 'owner' | 'writer' | 'reader' | 'freeBusyReader';
  backgroundColor?: string;
}

export interface GoogleCalendarRemoteEvent {
  id: string;
  calendarId: string;
  calendarSummary: string;
  summary: string;
  description: string;
  location: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  htmlLink: string;
  siscomEventId?: string;
  colorId: string;
  recurrenceRule: string;
  visibility: GoogleEventVisibility;
  transparency: GoogleEventTransparency;
  meetLink: string;
  attendees: GoogleEventAttendee[];
  guestsCanModify: boolean;
  guestsCanInviteOthers: boolean;
  guestsCanSeeOtherGuests: boolean;
  attachments: GoogleEventAttachment[];
  reminders: GoogleEventReminder[];
}

export function getEffectiveComsocScope(ev: AgendaEvent): ComsocScope {
  if (ev.comsocScope === 'comsoc' || ev.comsocScope === 'general' || ev.comsocScope === 'pending') {
    return ev.comsocScope;
  }
  return 'comsoc';
}

export function parseAttendeesJson(raw?: string): GoogleEventAttendee[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.email === 'string' && item.email.includes('@'))
      .map((item) => ({
        email: String(item.email).trim().toLowerCase(),
        displayName: item.displayName ? String(item.displayName).trim() : undefined,
        optional: Boolean(item.optional),
        responseStatus: item.responseStatus ? String(item.responseStatus) : undefined,
      }));
  } catch {
    return [];
  }
}

export function parseAttachmentsJson(raw?: string): GoogleEventAttachment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.fileUrl === 'string' && item.fileUrl.trim())
      .map((item) => ({
        title: String(item.title || 'Anexo').trim(),
        fileUrl: String(item.fileUrl).trim(),
        mimeType: item.mimeType ? String(item.mimeType) : undefined,
        fileId: item.fileId ? String(item.fileId) : undefined,
        iconLink: item.iconLink ? String(item.iconLink) : undefined,
      }));
  } catch {
    return [];
  }
}

export function parseRemindersJson(
  raw?: string,
  fallbackMinutes = 60
): GoogleEventReminder[] {
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter(
            (r) =>
              r &&
              (r.method === 'popup' || r.method === 'email') &&
              Number.isFinite(Number(r.minutes))
          )
          .map((r) => ({
            method: r.method as 'popup' | 'email',
            minutes: Math.max(0, Math.min(10080, Math.round(Number(r.minutes)))),
          }));
      }
    } catch {
      // Fallback below
    }
  }
  if (fallbackMinutes > 0) {
    return [{ method: 'popup', minutes: fallbackMinutes }];
  }
  return [];
}

export function parseContactsCacheJson(raw?: string): GoogleContactSuggestion[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c) => c && typeof c.email === 'string' && c.email.includes('@'))
      .map((c) => ({
        email: String(c.email).trim().toLowerCase(),
        displayName: String(c.displayName || c.email).trim(),
        photoUrl: typeof c.photoUrl === 'string' ? c.photoUrl : undefined,
      }));
  } catch {
    return [];
  }
}

export function parseEventDate(value: string, isAllDay: boolean, isEnd = false): Date {
  if (!value) return new Date();
  if (isAllDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    if (isEnd) {
      return new Date(y, m - 1, d, 23, 59, 59);
    }
    return new Date(y, m - 1, d, 0, 0, 0);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

export function formatLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatTimeShort(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${min}`;
}

export function getGoogleColorHex(colorId?: string): string | null {
  if (!colorId) return null;
  const found = GOOGLE_EVENT_COLORS.find((c) => c.id === colorId);
  return found ? found.hex : null;
}

/**
 * Returns true if an event occurs today or in the future (ends at or after 00:00 of today).
 * Past events (that ended strictly before the start of today) return false.
 */
export function isTodayOrFutureEvent(
  event: Pick<AgendaEvent, 'startAt' | 'endAt' | 'allDay'>,
  now = new Date()
): boolean {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const start = parseEventDate(event.startAt, event.allDay, false);
  const end = parseEventDate(event.endAt || event.startAt, event.allDay, true);
  return end.getTime() >= startOfToday.getTime() || start.getTime() >= startOfToday.getTime();
}

