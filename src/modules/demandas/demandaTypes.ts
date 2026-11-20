import type { Timestamp } from 'firebase/firestore';

export type DemandaPriority = 'baixa' | 'media' | 'alta';
export type DemandaStatus = 'pendente' | 'concluida';
export type DemandaUrgency = 'atrasada' | 'hoje' | 'amanha' | 'breve' | 'futura' | 'concluida';

export interface DemandaItem {
  id: string;
  ownerUid: string;
  title: string;
  notes: string;
  dueDate: string; // YYYY-MM-DD
  dueTime: string; // HH:mm or ''
  priority: DemandaPriority;
  status: DemandaStatus;
  remindBeforeDays: number; // 0..30
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
}

export interface UpdateDemandaPatch {
  title?: string;
  notes?: string;
  dueDate?: string;
  dueTime?: string;
  priority?: DemandaPriority;
  status?: DemandaStatus;
  remindBeforeDays?: number;
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
}

/**
 * Evaluates whether a pending demand should trigger a progressive alert right now.
 * Fires progressively starting `remindBeforeDays` ahead, each day closer, on the due day,
 * 2h before & on time (if time is specified), and daily while overdue until completed.
 */
export function computePendingReminderAlert(
  item: DemandaItem,
  now = new Date()
): DemandaReminderAlert | null {
  if (item.status !== 'pendente') return null;

  const todayKey = formatDateKeyLocal(now);
  const daysLeft = getCalendarDaysUntil(item.dueDate, now);
  const { exactDateTime, hasTime } = parseDueDateParts(item.dueDate, item.dueTime);

  if (daysLeft > item.remindBeforeDays) {
    return null;
  }

  if (daysLeft < 0) {
    const abs = Math.abs(daysLeft);
    return {
      demanda: item,
      milestoneKey: `${item.id}::overdue::${todayKey}`,
      severity: 'overdue',
      headline: abs === 1 ? 'Demanda atrasada (1 dia)' : `Demanda atrasada (${abs} dias)`,
      detail: `Prazo era ${formatShortDueDate(item.dueDate)}${hasTime ? ` às ${item.dueTime}` : ''}`,
    };
  }

  if (daysLeft === 0) {
    if (hasTime) {
      const minsLeft = Math.round((exactDateTime.getTime() - now.getTime()) / 60_000);
      if (minsLeft <= 0) {
        return {
          demanda: item,
          milestoneKey: `${item.id}::due-now::${todayKey}::${item.dueTime}`,
          severity: 'overdue',
          headline: 'Prazo atingido',
          detail: `Venceu hoje às ${item.dueTime}`,
        };
      }
      if (minsLeft <= 120) {
        return {
          demanda: item,
          milestoneKey: `${item.id}::due-2h::${todayKey}::${item.dueTime}`,
          severity: 'today',
          headline: minsLeft <= 60 ? `Faltam ${minsLeft} min` : 'Prazo em menos de 2 horas',
          detail: `Vence hoje às ${item.dueTime}`,
        };
      }
      return {
        demanda: item,
        milestoneKey: `${item.id}::due-today::${todayKey}`,
        severity: 'today',
        headline: 'Vence hoje',
        detail: `Prazo hoje às ${item.dueTime}`,
      };
    }

    return {
      demanda: item,
      milestoneKey: `${item.id}::due-today::${todayKey}`,
      severity: 'today',
      headline: 'Vence hoje',
      detail: `Prazo para hoje (${formatShortDueDate(item.dueDate)})`,
    };
  }

  if (daysLeft === 1) {
    return {
      demanda: item,
      milestoneKey: `${item.id}::before-1d::${item.dueDate}`,
      severity: 'upcoming',
      headline: 'Vence amanhã',
      detail: `Prazo amanhã (${formatShortDueDate(item.dueDate)})${hasTime ? ` às ${item.dueTime}` : ''}`,
    };
  }

  return {
    demanda: item,
    milestoneKey: `${item.id}::before-${daysLeft}d::${item.dueDate}`,
    severity: 'upcoming',
    headline: `Faltam ${daysLeft} dias`,
    detail: `Prazo em ${formatShortDueDate(item.dueDate)}${hasTime ? ` às ${item.dueTime}` : ''}`,
  };
}
