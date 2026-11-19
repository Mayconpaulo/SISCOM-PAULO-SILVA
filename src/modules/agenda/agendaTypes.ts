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

export type AgendaAuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'sync_push'
  | 'sync_update'
  | 'sync_delete'
  | 'google_connect'
  | 'google_disconnect';

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

export const REMINDER_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 0, label: 'Sem lembrete' },
  { value: 15, label: '15 minutos antes' },
  { value: 30, label: '30 minutos antes' },
  { value: 60, label: '1 hora antes' },
  { value: 120, label: '2 horas antes' },
  { value: 1440, label: '1 dia antes' },
  { value: 2880, label: '2 dias antes' },
];

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
}

export type UnifiedCalendarEntry =
  | {
      origin: 'siscom';
      event: AgendaEvent;
      startDate: Date;
      endDate: Date;
    }
  | {
      origin: 'google_only';
      remote: GoogleCalendarRemoteEvent;
      startDate: Date;
      endDate: Date;
    };

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
