import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { SISCOM_EASE } from '../../shared/motion';
import { subscribeAgendaEvents } from './agendaStore';
import {
  AGENDA_CATEGORY_MAP,
  type AgendaEvent,
  formatTimeShort,
  getEffectiveComsocScope,
  parseEventDate,
} from './agendaTypes';

interface HomeAgendaPreviewProps {
  onOpenAgenda: () => void;
  className?: string;
}

interface ParsedPreviewEvent {
  event: AgendaEvent;
  start: Date;
  end: Date;
}

const MAX_TODAY_PREVIEW_ITEMS = 3;

function formatShortDayMonth(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

function formatRelativeUpcomingDate(date: Date, now: Date): string {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate()
  ) {
    return 'Amanhã';
  }

  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' })
    .format(date)
    .replace(/\.$/, '');
  const capitalizedWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `${capitalizedWeekday}, ${formatShortDayMonth(date)}`;
}

export const HomeAgendaPreview: React.FC<HomeAgendaPreviewProps> = ({
  onOpenAgenda,
  className = 'max-w-[368px] md:max-w-[548px]',
}) => {
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [dayTick, setDayTick] = useState(() => formatShortDayMonth(new Date()));

  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentKey = formatShortDayMonth(new Date());
      setDayTick((prev) => (prev === currentKey ? prev : currentKey));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setLoading(true);
    setHasError(false);

    const unsubscribe = subscribeAgendaEvents(
      (list) => {
        setEvents(list);
        setLoading(false);
        setHasError(false);
      },
      () => {
        setHasError(true);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const preview = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const activeComsoc: ParsedPreviewEvent[] = events
      .filter((ev) => ev.status !== 'cancelado' && getEffectiveComsocScope(ev) === 'comsoc')
      .map((event) => ({
        event,
        start: parseEventDate(event.startAt, event.allDay, false),
        end: parseEventDate(event.endAt, event.allDay, true),
      }));

    const todayEvents = activeComsoc
      .filter(({ start, end }) => start <= todayEnd && end >= todayStart)
      .sort((a, b) => {
        if (a.event.allDay !== b.event.allDay) {
          return a.event.allDay ? -1 : 1;
        }
        const diff = a.start.getTime() - b.start.getTime();
        if (diff !== 0) return diff;
        return a.event.title.localeCompare(b.event.title, 'pt-BR');
      });

    if (todayEvents.length > 0) {
      return {
        mode: 'today' as const,
        todayLabel: dayTick,
        todayStart,
        items: todayEvents.slice(0, MAX_TODAY_PREVIEW_ITEMS),
        extraCount: Math.max(0, todayEvents.length - MAX_TODAY_PREVIEW_ITEMS),
        now,
      };
    }

    const upcoming = activeComsoc
      .filter(({ start }) => start > todayEnd)
      .sort((a, b) => {
        const diff = a.start.getTime() - b.start.getTime();
        if (diff !== 0) return diff;
        return a.event.title.localeCompare(b.event.title, 'pt-BR');
      });

    if (upcoming.length > 0) {
      return {
        mode: 'upcoming' as const,
        todayLabel: dayTick,
        todayStart,
        items: [upcoming[0]],
        extraCount: 0,
        now,
      };
    }

    return {
      mode: 'empty' as const,
      todayLabel: dayTick,
      todayStart,
      items: [] as ParsedPreviewEvent[],
      extraCount: 0,
      now,
    };
  }, [events, dayTick]);

  const headerTitle =
    preview.mode === 'today'
      ? 'Agenda de hoje'
      : preview.mode === 'upcoming'
      ? 'Próximo evento'
      : 'Agenda';

  return (
    <motion.section
      aria-label="Prévia da agenda"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: 0.06, ease: SISCOM_EASE }}
      className={`w-full metal-surface rounded-[14px] border border-[#C29B56]/22 px-4 py-3.5 flex flex-col justify-between ${className}`}
    >
      <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-white/[0.07]">
        <div className="flex items-baseline gap-2 min-w-0">
          <h2 className="text-xs sm:text-[13px] font-semibold text-[#E8EEEB] tracking-wide whitespace-nowrap">
            {headerTitle}
          </h2>
          {preview.mode === 'today' && (
            <span className="text-xs text-[#8FA197] tabular-nums whitespace-nowrap">
              <span aria-hidden="true">· </span>
              {preview.todayLabel}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenAgenda}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-xs font-medium text-[#F2DCAB] bg-[#C29B56]/12 hover:bg-[#C29B56]/22 border border-[#C29B56]/30 hover:border-[#D4B06A]/55 transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C29B56]/60"
        >
          <span>Acessar agenda</span>
          <ArrowRight className="w-3.5 h-3.5 text-[#D8B46E]" aria-hidden="true" />
        </button>
      </div>

      <div className="pt-2.5">
        {loading ? (
          <div className="space-y-2 py-0.5" aria-busy="true" aria-label="Carregando prévia da agenda">
            <div className="h-4 w-3/4 rounded bg-white/[0.06]" />
            <div className="h-3.5 w-1/2 rounded bg-white/[0.04]" />
          </div>
        ) : hasError ? (
          <p className="text-xs text-[#98A89F]">
            Não foi possível carregar a prévia da agenda.
          </p>
        ) : preview.mode === 'empty' ? (
          <p className="text-xs sm:text-[13px] text-[#98A89F]">
            Nenhuma atividade prevista nos próximos dias.
          </p>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {preview.items.map(({ event, start }) => {
              const categoryMeta = AGENDA_CATEGORY_MAP[event.category];
              const timeLabel = event.allDay
                ? 'Dia inteiro'
                : preview.mode === 'today' && start < preview.todayStart
                ? 'Em andamento'
                : formatTimeShort(start);
              const dateTimeLabel =
                preview.mode === 'upcoming'
                  ? `${formatRelativeUpcomingDate(start, preview.now)} · ${timeLabel}`
                  : timeLabel;

              const detailParts: string[] = [];
              if (categoryMeta?.shortLabel) {
                detailParts.push(categoryMeta.shortLabel);
              }
              if (event.location?.trim()) {
                detailParts.push(event.location.trim());
              }

              return (
                <li
                  key={event.id}
                  className="py-2 first:pt-0.5 last:pb-0.5 flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5 sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[#E9EFEA] truncate">
                      {event.title}
                    </p>
                    {detailParts.length > 0 && (
                      <p className="text-xs text-[#8FA197] truncate mt-0.5">
                        {detailParts.join(' · ')}
                      </p>
                    )}
                  </div>

                  <span className="text-xs font-mono tabular-nums text-[#DFBC75] whitespace-nowrap shrink-0">
                    {dateTimeLabel}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {!loading && !hasError && preview.extraCount > 0 && (
          <p className="text-xs text-[#8FA197] tabular-nums pt-2 mt-1.5 border-t border-white/[0.06]">
            +{preview.extraCount}{' '}
            {preview.extraCount === 1 ? 'atividade hoje' : 'atividades hoje'}
          </p>
        )}
      </div>
    </motion.section>
  );
};
