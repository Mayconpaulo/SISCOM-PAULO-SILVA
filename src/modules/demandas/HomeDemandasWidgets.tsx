import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Bell,
  BellOff,
  CalendarPlus,
  Check,
  Clock,
  Plus,
} from 'lucide-react';
import { SISCOM_EASE, SPRING_SNAPPY } from '../../shared/motion';
import { useDemandas } from './DemandasContext';
import {
  formatDemandaCountdown,
  formatShortDueDate,
  getCalendarDaysUntil,
  getDemandaUrgency,
} from './demandaTypes';

type WidgetLayoutMode = 'completo' | 'lista' | 'foco';

const LAYOUT_STORAGE_KEY = 'siscom_demandas_widget_mode_v1';

function readInitialMode(): WidgetLayoutMode {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw === 'completo' || raw === 'lista' || raw === 'foco') {
      return raw;
    }
  } catch {
    // Ignore storage errors
  }
  return 'completo';
}

interface HomeDemandasWidgetsProps {
  className?: string;
  compact?: boolean;
  spacious?: boolean;
}

export const HomeDemandasWidgets: React.FC<HomeDemandasWidgetsProps> = ({
  className = 'max-w-[368px] md:max-w-[548px]',
  compact = false,
  spacious = false,
}) => {
  const {
    demandas,
    pendingDemandas,
    completedDemandas,
    loading,
    error,
    overdueCount,
    todayCount,
    upcomingCount,
    notificationPermission,
    enableBrowserNotifications,
    setPanelOpen,
    setQuickAddOpen,
    setEditingDemanda,
    toggleComplete,
    postponeOneDay,
  } = useDemandas();

  const [mode, setMode] = useState<WidgetLayoutMode>(() => readInitialMode());

  const handleModeChange = (next: WidgetLayoutMode) => {
    setMode(next);
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, next);
    } catch {
      // Ignore storage errors
    }
  };

  const nextCritical = pendingDemandas[0] || null;
  const visibleItems = pendingDemandas.slice(0, spacious ? 4 : 3);
  const extraPending = Math.max(0, pendingDemandas.length - visibleItems.length);

  const completionRatio = useMemo(() => {
    const total = demandas.length;
    if (total === 0) return 0;
    return Math.round((completedDemandas.length / total) * 100);
  }, [demandas.length, completedDemandas.length]);

  const summaryParts = useMemo(() => {
    const parts: { text: string; toneClass: string }[] = [];
    if (overdueCount > 0) {
      parts.push({
        text: `${overdueCount} ${overdueCount === 1 ? 'atrasada' : 'atrasadas'}`,
        toneClass: 'text-red-300',
      });
    }
    if (todayCount > 0) {
      parts.push({
        text: `${todayCount} hoje`,
        toneClass: 'text-[#DFBC75]',
      });
    }
    if (upcomingCount > 0) {
      parts.push({
        text: `${upcomingCount} ${upcomingCount === 1 ? 'próxima' : 'próximas'}`,
        toneClass: 'text-[#B8B3A6]',
      });
    }
    return parts;
  }, [overdueCount, todayCount, upcomingCount]);

  const focusHeadline = useMemo(() => {
    if (!nextCritical) return null;
    const urgency = getDemandaUrgency(nextCritical);
    const days = getCalendarDaysUntil(nextCritical.dueDate);
    if (urgency === 'atrasada') {
      const abs = Math.abs(days);
      return {
        big: abs === 0 ? 'ATRASADA' : `-${abs}d`,
        sub: formatDemandaCountdown(nextCritical),
        tone: 'text-red-300',
      };
    }
    if (days === 0) {
      return {
        big: nextCritical.dueTime || 'HOJE',
        sub: nextCritical.dueTime ? 'Hoje no prazo' : 'Vence hoje',
        tone: 'text-[#E5C17B]',
      };
    }
    if (days === 1) {
      return {
        big: 'AMANHÃ',
        sub: nextCritical.dueTime
          ? `Amanhã · ${nextCritical.dueTime}`
          : formatShortDueDate(nextCritical.dueDate),
        tone: 'text-[#E5C17B]',
      };
    }
    return {
      big: `${days}d`,
      sub: nextCritical.dueTime
        ? `${formatShortDueDate(nextCritical.dueDate)} · ${nextCritical.dueTime}`
        : `Em ${days} dias · ${formatShortDueDate(nextCritical.dueDate)}`,
      tone: 'text-[#83B499]',
    };
  }, [nextCritical]);

  return (
    <motion.section
      aria-label="Widgets de demandas"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: 0.1, ease: SISCOM_EASE }}
      className={`w-full rounded-2xl transition-colors ${
        spacious
          ? 'siscom-home-panel px-6 py-5'
          : compact
            ? 'siscom-home-panel px-4 sm:px-5 py-4'
            : 'metal-surface border border-[#C29B56]/22 px-4 sm:px-5 py-4'
      } flex flex-col justify-between ${spacious ? 'gap-4' : 'gap-3'} ${className}`}
    >
      <div>
        {/* Header */}
        <div className={`flex items-center justify-between gap-2 border-b border-white/[0.08] ${spacious ? 'pb-3.5' : 'pb-3'}`}>
          <div className="flex items-baseline gap-2 min-w-0">
            <h2 className={`font-display font-semibold text-[#EEF3F0] tracking-[-0.01em] whitespace-nowrap ${spacious ? 'text-[17px]' : 'text-[13px]'}`}>
              Demandas
            </h2>
            {!loading && summaryParts.length > 0 && (!compact || spacious) && (
              <span className={`${spacious ? 'text-xs' : 'text-xs'} tabular-nums flex items-center gap-1.5 flex-wrap`}>
                {summaryParts.map((part) => (
                  <React.Fragment key={part.text}>
                    <span aria-hidden="true" className="text-[#56665E]">
                      ·
                    </span>
                    <span className={part.toneClass}>{part.text}</span>
                  </React.Fragment>
                ))}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setQuickAddOpen(true)}
              title="Nova demanda rápida"
              className={`inline-flex items-center gap-1.5 rounded-lg font-medium text-[#A6DBC0] hover:text-[#E2F6EB] bg-[#2D5A43]/30 hover:bg-[#2D5A43]/52 border border-[#4E8C6B]/28 transition-colors cursor-pointer whitespace-nowrap ${
                spacious ? 'min-h-[38px] px-3.5 text-xs' : 'min-h-[30px] px-2.5 text-[11px]'
              }`}
            >
              <Plus className={spacious ? 'w-3.5 h-3.5' : 'w-3 h-3'} aria-hidden="true" />
              <span>Nova</span>
            </button>

            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              className={`group inline-flex items-center gap-1.5 -mr-1 rounded-lg font-medium text-[#E7C580] hover:text-[#FAF0D7] hover:bg-white/[0.05] transition-colors cursor-pointer whitespace-nowrap ${
                spacious ? 'min-h-[38px] px-2.5 text-sm' : 'min-h-[30px] px-2 text-xs'
              }`}
            >
              <span>Gerenciar</span>
              <ArrowRight
                className={`${spacious ? 'w-4 h-4' : 'w-3.5 h-3.5'} transition-transform duration-150 group-hover:translate-x-0.5`}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>

        {/* Compact summary line when in rail mode */}
        {compact && !spacious && !loading && summaryParts.length > 0 && (
          <div className="pt-2.5 text-[11px] font-mono tabular-nums flex items-center gap-1.5 flex-wrap">
            {summaryParts.map((part, idx) => (
              <React.Fragment key={part.text}>
                {idx > 0 && (
                  <span aria-hidden="true" className="text-[#56665E]">
                    ·
                  </span>
                )}
                <span className={part.toneClass}>{part.text}</span>
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Mode Switcher + Notification Toggle */}
        <div className={`flex items-center justify-between gap-2 ${spacious ? 'pt-3.5 pb-2.5 text-xs' : 'pt-2.5 pb-1.5 text-[11px]'}`}>
          <div className="inline-flex items-center rounded-[10px] bg-[#070B09]/85 border border-white/[0.08] p-0.5">
            {(
              [
                { id: 'completo', label: 'Completo' },
                { id: 'lista', label: 'Lista' },
                { id: 'foco', label: 'Foco' },
              ] as const
            ).map((tab) => {
              const active = mode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleModeChange(tab.id)}
                  className={`relative rounded-[7px] font-medium transition-colors cursor-pointer ${
                    spacious ? 'px-3.5 py-1.5 text-xs' : 'px-2.5 py-1 text-[11px]'
                  } ${
                    active ? 'text-[#FAF3E3]' : 'text-[#A6B3AC] hover:text-[#EDF2EE]'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="home-demandas-mode"
                      transition={SPRING_SNAPPY}
                      className="absolute inset-0 rounded-[7px] bg-[#1F342A] border border-[#8AC0A3]/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]"
                    />
                  )}
                  <span className="relative z-10">{tab.label}</span>
                </button>
              );
            })}
          </div>

          {notificationPermission === 'default' ? (
            <button
              type="button"
              onClick={() => void enableBrowserNotifications()}
              className={`inline-flex items-center gap-1.5 font-medium text-[#E5C17B] hover:text-[#F4E6C4] transition-colors cursor-pointer ${
                spacious ? 'text-xs' : 'text-[11px]'
              }`}
            >
              <Bell className={spacious ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
              <span>Ativar avisos</span>
            </button>
          ) : notificationPermission === 'granted' ? (
            <span className={`inline-flex items-center gap-1.5 text-[#83B499] ${spacious ? 'text-xs' : 'text-[11px]'}`}>
              <Bell className={spacious ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
              <span>Avisos ativos</span>
            </span>
          ) : (
            <span className={`inline-flex items-center gap-1.5 text-[#B8B3A6] ${spacious ? 'text-xs' : 'text-[11px]'}`}>
              <BellOff className={spacious ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
              <span>No app</span>
            </span>
          )}
        </div>

        {/* Checklist Content */}
        {mode !== 'foco' && (
          <div className="pt-0.5">
            {loading ? (
              <div className="space-y-2 py-1" aria-busy="true">
                <div className="h-4 w-3/4 rounded bg-white/[0.06]" />
                <div className="h-3.5 w-1/2 rounded bg-white/[0.04]" />
              </div>
            ) : error ? (
              <p className={`${spacious ? 'text-sm' : 'text-xs'} text-[#B8B3A6] py-1`}>{error}</p>
            ) : visibleItems.length === 0 ? (
              <p className={`${spacious ? 'text-sm' : 'text-xs'} text-[#B8B3A6] py-2`}>
                Nenhuma demanda pendente.
              </p>
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {visibleItems.map((item) => {
                  const urgency = getDemandaUrgency(item);
                  const countdownTone =
                    urgency === 'atrasada'
                      ? 'text-red-300'
                      : urgency === 'hoje' || urgency === 'amanha'
                      ? 'text-[#DFBC75]'
                      : 'text-[#B8B3A6]';

                  return (
                    <li
                      key={item.id}
                      className={`${spacious ? 'py-2.5 gap-3' : 'py-1.5 gap-2'} first:pt-1 last:pb-0.5 flex items-center`}
                    >
                      <button
                        type="button"
                        onClick={() => void toggleComplete(item)}
                        aria-label={`Concluir demanda ${item.title}`}
                        className={`${spacious ? 'w-5 h-5' : 'w-4 h-4'} rounded-full border border-[#C29B56]/45 hover:border-[#83B499] hover:bg-[#2D5A43]/35 flex items-center justify-center shrink-0 transition-colors cursor-pointer`}
                      >
                        <Check className={`${spacious ? 'w-3 h-3' : 'w-2.5 h-2.5'} text-transparent hover:text-[#83B499]`} />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setEditingDemanda(item);
                          setPanelOpen(true);
                        }}
                        className="min-w-0 flex-1 text-left group cursor-pointer"
                      >
                        <p className={`${spacious ? 'text-[15px]' : 'text-xs'} font-medium text-[#E9EFEA] group-hover:text-[#F4E6C4] truncate transition-colors`}>
                          {item.title}
                        </p>
                      </button>

                      <span
                        className={`${spacious ? 'text-xs' : 'text-[11px]'} font-mono tabular-nums whitespace-nowrap shrink-0 ${countdownTone}`}
                      >
                        {formatDemandaCountdown(item)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {!loading && !error && extraPending > 0 && (
              <button
                type="button"
                onClick={() => setPanelOpen(true)}
                className={`w-full text-left ${spacious ? 'text-xs pt-2 mt-1.5' : 'text-[11px] pt-1.5 mt-1'} text-[#DFBC75] hover:text-[#F4E6C4] tabular-nums border-t border-white/[0.06] cursor-pointer`}
              >
                +{extraPending}{' '}
                {extraPending === 1 ? 'demanda pendente' : 'demandas pendentes'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Clean Hairline-Separated Summary Footer (Nearest Deadline + Progress) */}
      {mode !== 'lista' && !loading && (
        <div className={`${spacious ? 'pt-3.5 gap-5' : 'pt-2.5 gap-3 sm:gap-4'} border-t border-white/[0.08] grid grid-cols-1 sm:grid-cols-2`}>
          {/* Nearest Deadline */}
          <div className="flex flex-col justify-between gap-1.5 min-w-0">
            <div className={`flex flex-wrap items-center justify-between gap-1 ${spacious ? 'text-xs' : 'text-[11px]'} text-[#9AA8A0]`}>
              <span className="inline-flex items-center gap-1.5 font-medium text-[#D8E0DB]">
                <Clock className={`${spacious ? 'w-3.5 h-3.5' : 'w-3 h-3'} text-[#C9A961] shrink-0`} />
                <span>Prazo mais próximo</span>
              </span>
              {focusHeadline && (
                <span className={`font-mono font-semibold tabular-nums ${focusHeadline.tone}`}>
                  {focusHeadline.big}
                </span>
              )}
            </div>

            {nextCritical && focusHeadline ? (
              <div className="flex items-center justify-between gap-2">
                <p className={`${spacious ? 'text-sm' : 'text-xs'} font-medium text-[#F4E6C4] truncate flex-1`}>
                  {nextCritical.title}
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void toggleComplete(nextCritical)}
                    title="Concluir demanda"
                    className="text-[#9DD1B3] hover:text-[#D6EEE0] cursor-pointer p-1"
                  >
                    <Check className={spacious ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void postponeOneDay(nextCritical)}
                    title="Adiar 1 dia"
                    className="text-[#DFBC75] hover:text-[#F4E6C4] cursor-pointer p-1"
                  >
                    <CalendarPlus className={spacious ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
                  </button>
                </div>
              </div>
            ) : (
              <p className={`${spacious ? 'text-xs' : 'text-[11px]'} text-[#9AA8A0] leading-snug`}>
                Em dia.
              </p>
            )}
          </div>

          {/* Progress */}
          <div className="flex flex-col justify-between gap-2 min-w-0 sm:border-l sm:border-white/[0.07] sm:pl-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className={`${spacious ? 'text-xs' : 'text-[11px]'} font-medium text-[#D8E0DB]`}>Andamento</span>
              <span className={`${spacious ? 'text-sm' : 'text-xs'} font-mono font-semibold tabular-nums text-[#F4E6C4]`}>
                {completionRatio}%
              </span>
            </div>

            <div className="space-y-1.5">
              <div className={`${spacious ? 'h-1.5' : 'h-1'} w-full rounded-full bg-white/[0.09] overflow-hidden`}>
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#2D5A43] to-[#C9A961] transition-all duration-300"
                  style={{ width: `${completionRatio}%` }}
                />
              </div>
              <p className={`${spacious ? 'text-xs' : 'text-[11px]'} text-[#9AA8A0] tabular-nums leading-snug`}>
                {completedDemandas.length}/{demandas.length}{' '}
                {demandas.length === 1 ? 'concluída' : 'concluídas'} · {pendingDemandas.length}{' '}
                {pendingDemandas.length === 1 ? 'aberta' : 'abertas'}
              </p>
            </div>
          </div>
        </div>
      )}
    </motion.section>
  );
};
