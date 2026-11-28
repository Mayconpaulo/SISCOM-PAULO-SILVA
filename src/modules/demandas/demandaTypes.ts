import type { Timestamp } from 'firebase/firestore';

export type DemandaPriority = 'baixa' | 'media' | 'alta';
export type DemandaStatus = 'pendente' | 'concluida';
export type DemandaUrgency = 'atrasada' | 'hoje' | 'amanha' | 'breve' | 'futura' | 'concluida';

export const MAX_REMINDER_OFFSETS = 10;
export const MAX_REMINDER_OFFSET_MINUTES = 43_200; // 30 dias

export interface DemandaItem {
  id: string;
  ownerUid: string;
  title: string;
  notes: string;
  dueDate: string; // YYYY-MM-DD
  dueTime: string; // HH:mm or ''
  priority: DemandaPriority;
  status: DemandaStatus;
  remindBeforeDays: number; // 0..30 (preserved for backward compatibility)
  reminderOffsetsMinutes?: number[]; // Multiple Google Calendar-style reminders in minutes before due
  completedAt: string; // ISO string or ''
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface CreateDemandaInput {
  title: string;
  notes?: string;
  dueDate: string;
  dueTime?: string;
  priority?: DemandaPriority;
  remindBeforeDays?: number;
  reminderOffsetsMinutes?: number[];
}

export interface UpdateDemandaPatch {
  title?: string;
  notes?: string;
  dueDate?: string;
  dueTime?: string;
  priority?: DemandaPriority;
  status?: DemandaStatus;
  remindBeforeDays?: number;
  reminderOffsetsMinutes?: number[];
  completedAt?: string;
}

export const DEMANDA_PRIORITY_LABELS: Record<DemandaPriority, string> = {
  baixa: 'Baixa',
  media: 'Normal',
  alta: 'Alta',
};

export const REMIND_BEFORE_OPTIONS: readonly { value: number; label: string; shortLabel: string }[] = [
  { value: 0, label: 'Apenas no dia do prazo', shortLabel: 'No dia' },
  { value: 1, label: '1 dia antes até o prazo', shortLabel: '1 dia antes' },
  { value: 3, label: '3 dias antes até o prazo', shortLabel: '3 dias antes' },
  { value: 5, label: '5 dias antes até o prazo', shortLabel: '5 dias antes' },
  { value: 7, label: '7 dias antes até o prazo', shortLabel: '7 dias antes' },
  { value: 14, label: '14 dias antes até o prazo', shortLabel: '14 dias antes' },
];

export const DEFAULT_REMINDER_OFFSETS_MINUTES: readonly number[] = [1440]; // 1 dia antes

export const NEXT_REMINDER_SUGGESTION_ORDER: readonly number[] = [
  1440,  // 1 dia
  2880,  // 2 dias
  4320,  // 3 dias
  60,    // 1 hora
  10080, // 1 semana
  120,   // 2 horas
  30,    // 30 min
  7200,  // 5 dias
  15,    // 15 min
  0,     // No horário
];

export function sanitizeReminderOffsets(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const unique = new Set<number>();
  for (const val of raw) {
    if (typeof val === 'number' && Number.isFinite(val)) {
      const clamped = Math.max(0, Math.min(MAX_REMINDER_OFFSET_MINUTES, Math.round(val)));
      unique.add(clamped);
      if (unique.size >= MAX_REMINDER_OFFSETS) break;
    }
  }
  return Array.from(unique).sort((a, b) => b - a);
}

export function deriveRemindBeforeDaysFromOffsets(offsets: number[]): number {
  if (offsets.length === 0) return 0;
  const maxMin = Math.max(...offsets);
  return Math.max(0, Math.min(30, Math.ceil(maxMin / 1440)));
}

export function getInitialOffsetsForEdit(
  item: Pick<DemandaItem, 'remindBeforeDays' | 'reminderOffsetsMinutes'>
): number[] {
  if (Array.isArray(item.reminderOffsetsMinutes)) {
    return sanitizeReminderOffsets(item.reminderOffsetsMinutes);
  }
  if (typeof item.remindBeforeDays === 'number' && item.remindBeforeDays > 0) {
    return [Math.min(30, item.remindBeforeDays) * 1440];
  }
  return [0];
}

export function formatReminderOffsetLabel(offsetMinutes: number): string {
  const safe = Math.max(0, Math.round(offsetMinutes));
  if (safe === 0) return 'No horário';
  if (safe % 10080 === 0) {
    const weeks = safe / 10080;
    return weeks === 1 ? '1 semana antes' : `${weeks} semanas antes`;
  }
  if (safe % 1440 === 0) {
    const days = safe / 1440;
    return days === 1 ? '1 dia antes' : `${days} dias antes`;
  }
  if (safe % 60 === 0) {
    const hours = safe / 60;
    return hours === 1 ? '1 hora antes' : `${hours} horas antes`;
  }
  return safe === 1 ? '1 min antes' : `${safe} min antes`;
}

export function formatReminderOffsetShort(offsetMinutes: number): string {
  const safe = Math.max(0, Math.round(offsetMinutes));
  if (safe === 0) return 'no horário';
  if (safe % 10080 === 0) return `${safe / 10080}sem`;
  if (safe % 1440 === 0) return `${safe / 1440}d`;
  if (safe % 60 === 0) return `${safe / 60}h`;
  return `${safe}min`;
}

export function formatDateKeyLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysToDateKey(base: Date, days: number): string {
  const copy = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
  return formatDateKeyLocal(copy);
}

export function getNextMondayDateKey(base = new Date()): string {
  const day = base.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? 1 : 8 - day;
  return addDaysToDateKey(base, diff);
}

export function parseDueDateParts(
  dueDate: string,
  dueTime?: string
): { dateOnly: Date; exactDateTime: Date; hasTime: boolean } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  const now = new Date();
  const y = match ? Number(match[1]) : now.getFullYear();
  const m = match ? Number(match[2]) - 1 : now.getMonth();
  const d = match ? Number(match[3]) : now.getDate();

  const dateOnly = new Date(y, m, d, 0, 0, 0, 0);
  const timeMatch = dueTime ? /^(\d{2}):(\d{2})$/.exec(dueTime.trim()) : null;
  if (timeMatch) {
    const hh = Math.min(23, Math.max(0, Number(timeMatch[1])));
    const mm = Math.min(59, Math.max(0, Number(timeMatch[2])));
    return {
      dateOnly,
      exactDateTime: new Date(y, m, d, hh, mm, 0, 0),
      hasTime: true,
    };
  }
  return {
    dateOnly,
    exactDateTime: new Date(y, m, d, 23, 59, 59, 999),
    hasTime: false,
  };
}

export function getCalendarDaysUntil(dueDate: string, now = new Date()): number {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const { dateOnly } = parseDueDateParts(dueDate);
  const diffMs = dateOnly.getTime() - todayStart.getTime();
  return Math.round(diffMs / 86_400_000);
}

export function formatShortDueDate(dueDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  if (!match) return dueDate;
  return `${match[3]}/${match[2]}`;
}

export function formatFullDateBr(dueDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  if (!match) return dueDate;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatNotificationTimeSuffix(dueTime?: string): string {
  const timeMatch = dueTime ? /^(\d{2}):(\d{2})$/.exec(dueTime.trim()) : null;
  if (!timeMatch) return '';
  const [, hh, mm] = timeMatch;
  return mm === '00' ? `, às ${hh}h` : `, às ${hh}h${mm}`;
}

export function formatNotificationCountdown(daysLeft: number): string {
  if (daysLeft > 1) return `Faltam ${daysLeft} dias`;
  if (daysLeft === 1) return 'Falta 1 dia';
  if (daysLeft === 0) return 'É hoje';
  const abs = Math.abs(daysLeft);
  return abs === 1 ? 'Atrasada há 1 dia' : `Atrasada há ${abs} dias`;
}

export function formatDemandaNotificationPayload(
  item: Pick<DemandaItem, 'title' | 'dueDate' | 'dueTime'>,
  now = new Date()
): { title: string; body: string; countdown: string } {
  const daysLeft = getCalendarDaysUntil(item.dueDate, now);
  const countdown = formatNotificationCountdown(daysLeft);
  const dateBr = formatFullDateBr(item.dueDate);
  const timeSuffix = formatNotificationTimeSuffix(item.dueTime);
  return {
    title: item.title.trim() || 'Demanda',
    body: `Prazo: ${countdown} – ${dateBr}${timeSuffix}`,
    countdown,
  };
}

export function formatFullDueDate(dueDate: string): string {
  const { dateOnly } = parseDueDateParts(dueDate);
  return dateOnly.toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
}

export function isDemandaOverdue(item: DemandaItem, now = new Date()): boolean {
  if (item.status === 'concluida') return false;
  const days = getCalendarDaysUntil(item.dueDate, now);
  if (days < 0) return true;
  if (days > 0) return false;
  const { exactDateTime, hasTime } = parseDueDateParts(item.dueDate, item.dueTime);
  return hasTime && exactDateTime.getTime() < now.getTime();
}

export function getDemandaUrgency(item: DemandaItem, now = new Date()): DemandaUrgency {
  if (item.status === 'concluida') return 'concluida';
  if (isDemandaOverdue(item, now)) return 'atrasada';
  const days = getCalendarDaysUntil(item.dueDate, now);
  if (days === 0) return 'hoje';
  if (days === 1) return 'amanha';
  if (days <= 3) return 'breve';
  return 'futura';
}

export function formatDemandaCountdown(item: DemandaItem, now = new Date()): string {
  if (item.status === 'concluida') {
    return `Concluída · ${formatShortDueDate(item.dueDate)}`;
  }

  const days = getCalendarDaysUntil(item.dueDate, now);
  const { exactDateTime, hasTime } = parseDueDateParts(item.dueDate, item.dueTime);

  if (days < 0) {
    const abs = Math.abs(days);
    return abs === 1 ? 'Atrasada há 1 dia' : `Atrasada há ${abs} dias`;
  }

  if (days === 0) {
    if (hasTime) {
      const minsDiff = Math.round((exactDateTime.getTime() - now.getTime()) / 60_000);
      if (minsDiff < 0) {
        return `Atrasada · ${item.dueTime}`;
      }
      if (minsDiff === 0) {
        return 'Agora';
      }
      if (minsDiff < 60) {
        return `Hoje · em ${minsDiff} min`;
      }
      return `Hoje · ${item.dueTime}`;
    }
    return 'Hoje';
  }

  if (days === 1) {
    return hasTime ? `Amanhã · ${item.dueTime}` : 'Amanhã';
  }

  if (days <= 7) {
    return hasTime
      ? `Em ${days} dias · ${item.dueTime}`
      : `Em ${days} dias · ${formatShortDueDate(item.dueDate)}`;
  }

  return hasTime
    ? `${formatShortDueDate(item.dueDate)} · ${item.dueTime}`
    : formatShortDueDate(item.dueDate);
}

const PRIORITY_WEIGHT: Record<DemandaPriority, number> = {
  alta: 0,
  media: 1,
  baixa: 2,
};

export function sortDemandasForDisplay(items: DemandaItem[]): DemandaItem[] {
  return [...items].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === 'pendente' ? -1 : 1;
    }

    if (a.status === 'pendente') {
      const aTime = parseDueDateParts(a.dueDate, a.dueTime).exactDateTime.getTime();
      const bTime = parseDueDateParts(b.dueDate, b.dueTime).exactDateTime.getTime();
      if (aTime !== bTime) return aTime - bTime;

      const pDiff = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
      if (pDiff !== 0) return pDiff;

      return a.title.localeCompare(b.title, 'pt-BR');
    }

    // Completed: most recently completed first
    return (b.completedAt || '').localeCompare(a.completedAt || '');
  });
}

export interface DemandaReminderAlert {
  demanda: DemandaItem;
  milestoneKey: string;
  severity: 'overdue' | 'today' | 'upcoming';
  headline: string;
  detail: string;
  notificationTitle: string;
  notificationBody: string;
}

/**
 * Evaluates all due notification alerts for a pending demand right now.
 * - Supports multiple Google Calendar-style reminder offsets (`reminderOffsetsMinutes`)
 * - Preserves existing progressive `remindBeforeDays` schedule for legacy demands
 * - Formats notification title & body using the standardized SISCOM pattern
 */
export function computePendingReminderAlerts(
  item: DemandaItem,
  now = new Date()
): DemandaReminderAlert[] {
  if (item.status !== 'pendente') return [];

  const todayKey = formatDateKeyLocal(now);
  const daysLeft = getCalendarDaysUntil(item.dueDate, now);
  const { exactDateTime, hasTime } = parseDueDateParts(item.dueDate, item.dueTime);
  const formatted = formatDemandaNotificationPayload(item, now);

  // Multi-reminder mode (Google Calendar style)
  if (Array.isArray(item.reminderOffsetsMinutes)) {
    const offsets = sanitizeReminderOffsets(item.reminderOffsetsMinutes);
    if (offsets.length === 0) return [];

    if (daysLeft < 0) {
      return [
        {
          demanda: item,
          milestoneKey: `${item.id}::overdue::${todayKey}`,
          severity: 'overdue',
          headline: formatted.countdown,
          detail: formatted.body,
          notificationTitle: formatted.title,
          notificationBody: formatted.body,
        },
      ];
    }

    const alerts: DemandaReminderAlert[] = [];
    const msUntilDue = exactDateTime.getTime() - now.getTime();
    const severity: 'overdue' | 'today' | 'upcoming' =
      daysLeft === 0 ? (hasTime && msUntilDue <= 0 ? 'overdue' : 'today') : 'upcoming';

    for (const offsetMin of offsets) {
      let shouldFire = false;
      if (hasTime) {
        shouldFire = msUntilDue <= offsetMin * 60_000;
      } else if (offsetMin >= 1440) {
        const offsetDays = Math.round(offsetMin / 1440);
        shouldFire = daysLeft <= offsetDays;
      } else {
        shouldFire = daysLeft <= 0;
      }

      if (shouldFire) {
        alerts.push({
          demanda: item,
          milestoneKey: `${item.id}::rem-${offsetMin}::${item.dueDate}::${item.dueTime || 'allday'}`,
          severity,
          headline: formatted.countdown,
          detail: formatted.body,
          notificationTitle: formatted.title,
          notificationBody: formatted.body,
        });
      }
    }

    return alerts;
  }

  // Legacy single-setting progressive schedule (preserved without altering firing times)
  if (daysLeft > item.remindBeforeDays) {
    return [];
  }

  if (daysLeft < 0) {
    return [
      {
        demanda: item,
        milestoneKey: `${item.id}::overdue::${todayKey}`,
        severity: 'overdue',
        headline: formatted.countdown,
        detail: formatted.body,
        notificationTitle: formatted.title,
        notificationBody: formatted.body,
      },
    ];
  }

  if (daysLeft === 0) {
    if (hasTime) {
      const minsLeft = Math.round((exactDateTime.getTime() - now.getTime()) / 60_000);
      if (minsLeft <= 0) {
        return [
          {
            demanda: item,
            milestoneKey: `${item.id}::due-now::${todayKey}::${item.dueTime}`,
            severity: 'overdue',
            headline: formatted.countdown,
            detail: formatted.body,
            notificationTitle: formatted.title,
            notificationBody: formatted.body,
          },
        ];
      }
      if (minsLeft <= 120) {
        return [
          {
            demanda: item,
            milestoneKey: `${item.id}::due-2h::${todayKey}::${item.dueTime}`,
            severity: 'today',
            headline: formatted.countdown,
            detail: formatted.body,
            notificationTitle: formatted.title,
            notificationBody: formatted.body,
          },
        ];
      }
      return [
        {
          demanda: item,
          milestoneKey: `${item.id}::due-today::${todayKey}`,
          severity: 'today',
          headline: formatted.countdown,
          detail: formatted.body,
          notificationTitle: formatted.title,
          notificationBody: formatted.body,
        },
      ];
    }

    return [
      {
        demanda: item,
        milestoneKey: `${item.id}::due-today::${todayKey}`,
        severity: 'today',
        headline: formatted.countdown,
        detail: formatted.body,
        notificationTitle: formatted.title,
        notificationBody: formatted.body,
      },
    ];
  }

  if (daysLeft === 1) {
    return [
      {
        demanda: item,
        milestoneKey: `${item.id}::before-1d::${item.dueDate}`,
        severity: 'upcoming',
        headline: formatted.countdown,
        detail: formatted.body,
        notificationTitle: formatted.title,
        notificationBody: formatted.body,
      },
    ];
  }

  return [
    {
      demanda: item,
      milestoneKey: `${item.id}::before-${daysLeft}d::${item.dueDate}`,
      severity: 'upcoming',
      headline: formatted.countdown,
      detail: formatted.body,
      notificationTitle: formatted.title,
      notificationBody: formatted.body,
    },
  ];
}

export function computePendingReminderAlert(
  item: DemandaItem,
  now = new Date()
): DemandaReminderAlert | null {
  const alerts = computePendingReminderAlerts(item, now);
  return alerts.length > 0 ? alerts[0] : null;
}
