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
import { SISCOM_EASE } from '../../shared/motion';
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
}

export const HomeDemandasWidgets: React.FC<HomeDemandasWidgetsProps> = ({
  className = 'max-w-[368px] md:max-w-[548px]',
  compact = false,
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
  const visibleItems = pendingDemandas.slice(0, 3);
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
      className={`w-full rounded-[16px] transition-colors ${
        compact
          ? 'siscom-liquid-panel hover:border-[#E0BE74]/32 px-4 py-3.5'
          : 'metal-surface border border-[#C29B56]/22 px-4 py-3.5'
      } flex flex-col justify-between gap-2.5 ${className}`}
    >
      <div>
        {/* Header */}
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/[0.08]">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <h2 className="text-xs font-semibold text-[#E8E4D8] tracking-wide whitespace-nowrap">
              Demandas
            </h2>
            {!loading && summaryParts.length > 0 && !compact && (
              <span className="text-xs tabular-nums flex items-center gap-1.5 flex-wrap">
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

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setQuickAddOpen(true)}
              title="Nova demanda rápida"
              className={`inline-flex items-center gap-1 rounded-[7px] font-medium text-[#D6EEE0] bg-[#2D5A43]/38 hover:bg-[#2D5A43]/62 border border-[#83B499]/30 transition-colors cursor-pointer ${
                compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'
              }`}
            >
              <Plus className="w-3 h-3" aria-hidden="true" />
              <span>Nova</span>
            </button>

            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              className={`inline-flex items-center gap-1 rounded-[7px] font-medium text-[#EBD4A2] bg-[#C29B56]/10 hover:bg-[#C29B56]/20 border border-[#C29B56]/26 hover:border-[#D4B06A]/50 transition-colors cursor-pointer ${
                compact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
              }`}
            >
              <span>Gerenciar</span>
              <ArrowRight className="w-3 h-3 text-[#D8B46E]" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Compact summary line when in rail mode */}
        {compact && !loading && summaryParts.length > 0 && (
          <div className="pt-2 text-[11px] tabular-nums flex items-center gap-1.5 flex-wrap">
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
        <div className="flex items-center justify-between gap-2 pt-2 pb-1.5 text-[11px]">
          <div className="inline-flex items-center rounded-[7px] bg-[#080C0A] border border-white/[0.07] p-0.5">
            {(
              [
                { id: 'completo', label: 'Completo' },
                { id: 'lista', label: 'Lista' },
                { id: 'foco', label: 'Foco' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleModeChange(tab.id)}
                className={`px-2 py-0.5 rounded-[5px] text-[11px] font-medium transition-colors cursor-pointer ${
                  mode === tab.id
                    ? 'bg-[#1B2922] text-[#F4E6C4]'
                    : 'text-[#B8B3A6] hover:text-[#E8E4D8]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {notificationPermission === 'default' ? (
            <button
              type="button"
              onClick={() => void enableBrowserNotifications()}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#E5C17B] hover:text-[#F4E6C4] transition-colors cursor-pointer"
            >
              <Bell className="w-3 h-3" />
              <span>Ativar avisos</span>
            </button>
          ) : notificationPermission === 'granted' ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-[#83B499]">
              <Bell className="w-3 h-3" />
              <span>Avisos ativos</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] text-[#B8B3A6]">
              <BellOff className="w-3 h-3" />
              <span>No app</span>
            </span>
          )}
        </div>

        {/* Checklist Content */}
        {mode !== 'foco' && (
          <div className="pt-0.5">
            {loading ? (
              <div className="space-y-2 py-1" aria-busy="true">
                <div className="h-3.5 w-3/4 rounded bg-white/[0.06]" />
                <div className="h-3 w-1/2 rounded bg-white/[0.04]" />
              </div>
            ) : error ? (
              <p className="text-xs text-[#B8B3A6] py-1">{error}</p>
            ) : visibleItems.length === 0 ? (
              <p className="text-xs text-[#B8B3A6] py-1">
                Nenhuma demanda pendente. Use o botão “+” para anotar rápido.
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
                      className="py-1.5 first:pt-0.5 last:pb-0.5 flex items-center gap-2"
                    >
                      <button
                        type="button"
                        onClick={() => void toggleComplete(item)}
                        aria-label={`Concluir demanda ${item.title}`}
                        className="w-4 h-4 rounded-full border border-[#C29B56]/45 hover:border-[#83B499] hover:bg-[#2D5A43]/35 flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                      >
                        <Check className="w-2.5 h-2.5 text-transparent hover:text-[#83B499]" />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setEditingDemanda(item);
                          setPanelOpen(true);
                        }}
                        className="min-w-0 flex-1 text-left group cursor-pointer"
                      >
                        <p className="text-xs font-medium text-[#E9EFEA] group-hover:text-[#F4E6C4] truncate transition-colors">
                          {item.title}
                        </p>
                      </button>

                      <span
                        className={`text-[11px] font-mono tabular-nums whitespace-nowrap shrink-0 ${countdownTone}`}
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
                className="w-full text-left text-[11px] text-[#DFBC75] hover:text-[#F4E6C4] tabular-nums pt-1.5 mt-1 border-t border-white/[0.06] cursor-pointer"
              >
                +{extraPending}{' '}
                {extraPending === 1 ? 'demanda pendente' : 'demandas pendentes'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Compact Integrated Mini-Widgets Footer (Nearest Deadline + Progress) */}
      {mode !== 'lista' && !loading && (
        <div
          className={`pt-2 border-t border-white/[0.08] ${
            compact
              ? 'grid grid-cols-2 lg:grid-cols-1 gap-2'
              : 'grid grid-cols-1 sm:grid-cols-2 gap-2'
          }`}
        >
          {/* Mini-Widget 1: Nearest Deadline */}
          <div className="rounded-[10px] bg-black/30 border border-white/[0.09] px-2.5 lg:px-3 py-2 flex flex-col justify-between gap-1">
            <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-[#B8B3A6]">
              <span className="inline-flex items-center gap-1 font-medium text-[#E8E4D8]">
                <Clock className="w-3 h-3 text-[#C9A961] shrink-0" />
                <span>Prazo mais próximo</span>
              </span>
              {focusHeadline && (
                <span className={`font-mono font-semibold tabular-nums ${focusHeadline.tone}`}>
                  {focusHeadline.big}
                </span>
              )}
            </div>

            {nextCritical && focusHeadline ? (
              <div className="flex items-center justify-between gap-1.5">
                <p className="text-xs font-medium text-[#F4E6C4] truncate flex-1">
                  {nextCritical.title}
                </p>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => void toggleComplete(nextCritical)}
                    title="Concluir demanda"
                    className="text-[#9DD1B3] hover:text-[#D6EEE0] cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void postponeOneDay(nextCritical)}
                    title="Adiar 1 dia"
                    className="text-[#DFBC75] hover:text-[#F4E6C4] cursor-pointer"
                  >
                    <CalendarPlus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-[#B8B3A6] leading-snug">
                Tudo em dia por enquanto.
              </p>
            )}
          </div>

          {/* Mini-Widget 2: Progress */}
          <div className="rounded-[10px] bg-black/30 border border-white/[0.09] px-2.5 lg:px-3 py-2 flex flex-col justify-between gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-medium text-[#E8E4D8]">Andamento</span>
              <span className="text-xs font-mono font-semibold tabular-nums text-[#F4E6C4]">
                {completionRatio}%
              </span>
            </div>

            <div className="space-y-1">
              <div className="h-1.5 w-full rounded-full bg-white/[0.09] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#2D5A43] to-[#C9A961] transition-all duration-300"
                  style={{ width: `${completionRatio}%` }}
                />
              </div>
              <p className="text-[11px] text-[#B8B3A6] tabular-nums leading-snug">
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
