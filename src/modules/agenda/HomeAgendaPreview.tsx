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
  compact?: boolean;
  spacious?: boolean;
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
  compact = false,
  spacious = false,
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
      transition={{ duration: 0.22, delay: 0.08, ease: SISCOM_EASE }}
      className={`w-full rounded-2xl transition-colors ${
        spacious
          ? 'siscom-home-panel px-6 py-5'
          : compact
            ? 'siscom-home-panel px-4 sm:px-5 py-4'
            : 'metal-surface border border-[#C29B56]/22 px-4 sm:px-5 py-4'
      } flex flex-col justify-between ${className}`}
    >
      <div className={`flex items-center justify-between gap-2 border-b border-white/[0.08] ${spacious ? 'pb-3.5' : 'pb-3'}`}>
        <div className="flex items-baseline gap-2 min-w-0">
          <h2 className={`font-display font-semibold text-[#EEF3F0] tracking-[-0.01em] whitespace-nowrap ${spacious ? 'text-[17px]' : 'text-[13px]'}`}>
            {headerTitle}
          </h2>
          {preview.mode === 'today' && (
            <span className={`font-mono text-[#9AA8A0] tabular-nums whitespace-nowrap ${spacious ? 'text-xs' : 'text-[11px]'}`}>
              <span aria-hidden="true">· </span>
              {preview.todayLabel}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenAgenda}
          className={`group inline-flex items-center gap-1.5 px-2.5 -mr-1 font-medium text-[#E7C580] hover:text-[#FAF0D7] hover:bg-white/[0.05] transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A961]/60 rounded-lg ${
            spacious ? 'min-h-[40px] text-sm' : 'min-h-[32px] text-xs'
          }`}
        >
          <span>Acessar agenda</span>
          <ArrowRight
            className={`${spacious ? 'w-4 h-4' : 'w-3.5 h-3.5'} transition-transform duration-150 group-hover:translate-x-0.5`}
            aria-hidden="true"
          />
        </button>
      </div>

      <div className={spacious ? 'pt-3.5 flex-1 flex flex-col justify-center' : 'pt-2.5'}>
        {loading ? (
          <div className="space-y-2 py-0.5" aria-busy="true" aria-label="Carregando prévia da agenda">
            <div className="h-4 w-3/4 rounded-md bg-white/[0.06] animate-pulse" />
            <div className="h-3.5 w-1/2 rounded-md bg-white/[0.04] animate-pulse" />
          </div>
        ) : hasError ? (
          <p className={spacious ? 'text-sm text-[#B8B3A6]' : 'text-xs text-[#B8B3A6]'}>
            Não foi possível carregar a prévia da agenda.
          </p>
        ) : preview.mode === 'empty' ? (
          <p className={spacious ? 'text-sm text-[#B8B3A6]' : 'text-xs text-[#B8B3A6]'}>
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

              if (spacious) {
                return (
                  <li key={event.id} className="py-2.5 first:pt-1 last:pb-0 space-y-1.5">
                    <p className="text-[16px] font-semibold text-[#F1F5F2] leading-snug line-clamp-2">
                      {event.title}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
                      <span className="font-mono tabular-nums text-[#E7C580] font-medium whitespace-nowrap">
                        {dateTimeLabel}
                      </span>
                      {detailParts.length > 0 && (
                        <>
                          <span aria-hidden="true" className="text-[#7E7A70]">
                            ·
                          </span>
                          <span className="text-[#C4CFC8] truncate">
                            {detailParts.join(' · ')}
                          </span>
                        </>
                      )}
                    </div>
                  </li>
                );
              }

              if (compact) {
                return (
                  <li key={event.id} className="py-1.5 first:pt-0.5 last:pb-0 space-y-1">
                    <p className="text-[13px] font-medium text-[#E8E4D8] leading-snug line-clamp-2">
                      {event.title}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
                      <span className="font-mono tabular-nums text-[#DFBC75] whitespace-nowrap">
                        {dateTimeLabel}
                      </span>
                      {detailParts.length > 0 && (
                        <>
                          <span aria-hidden="true" className="text-[#7E7A70]">
                            ·
                          </span>
                          <span className="text-[#B8B3A6] truncate">
                            {detailParts.join(' · ')}
                          </span>
                        </>
                      )}
                    </div>
                  </li>
                );
              }

              return (
                <li
                  key={event.id}
                  className="py-2 first:pt-0.5 last:pb-0.5 flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5 sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[#E8E4D8] truncate">
                      {event.title}
                    </p>
                    {detailParts.length > 0 && (
                      <p className="text-xs text-[#B8B3A6] truncate mt-0.5">
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
          <p className={`${spacious ? 'text-xs pt-2 mt-2' : 'text-[11px] pt-1.5 mt-1.5'} text-[#B8B3A6] tabular-nums border-t border-white/[0.06]`}>
            +{preview.extraCount}{' '}
            {preview.extraCount === 1 ? 'atividade hoje' : 'atividades hoje'}
          </p>
        )}
      </div>
    </motion.section>
  );
};
