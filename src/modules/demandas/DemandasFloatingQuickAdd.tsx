import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BadgeCheck,
  Bell,
  Calendar,
  CalendarPlus,
  Check,
  Clock,
  ExternalLink,
  ListTodo,
  Plus,
  Send,
  X,
} from 'lucide-react';
import type { ActiveScreen } from '../registry';
import { SISCOM_EASE, SPRING_EXPRESSIVE, SPRING_SNAPPY } from '../../shared/motion';
import { SiscomSpinner } from '../../shared/ui';
import { useTabletPortrait } from '../../shared/useTabletPortrait';
import { useDemandas } from './DemandasContext';
import { ReminderOffsetsEditor } from './ReminderOffsetsEditor';
import {
  DEFAULT_REMINDER_OFFSETS_MINUTES,
  DemandaPriority,
  addDaysToDateKey,
  deriveRemindBeforeDaysFromOffsets,
  formatDateKeyLocal,
  formatDemandaCountdown,
  getDemandaUrgency,
  getNextMondayDateKey,
  sanitizeReminderOffsets,
} from './demandaTypes';

interface DemandasFloatingQuickAddProps {
  activeScreen?: ActiveScreen;
  canAccessAgenda?: boolean;
  canAccessCrachas?: boolean;
  onNavigate?: (screen: ActiveScreen) => void;
}

export const DemandasFloatingQuickAdd: React.FC<DemandasFloatingQuickAddProps> = ({
  activeScreen = 'home',
  canAccessAgenda = false,
  canAccessCrachas = false,
  onNavigate,
}) => {
  const {
    pendingDemandas,
    urgentCount,
    quickAddOpen,
    setQuickAddOpen,
    setPanelOpen,
    addDemanda,
    toggleComplete,
  } = useDemandas();

  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState(() => formatDateKeyLocal(new Date()));
  const [dueTime, setDueTime] = useState('');
  const [priority, setPriority] = useState<DemandaPriority>('media');
  const [reminderOffsets, setReminderOffsets] = useState<number[]>([
    ...DEFAULT_REMINDER_OFFSETS_MINUTES,
  ]);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [speedDialOpen, setSpeedDialOpen] = useState(false);
  const isTabletPortrait = useTabletPortrait();
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false
  );

  const inputRef = useRef<HTMLInputElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const handleChange = () => {
      setIsMobileViewport(mq.matches);
      if (!mq.matches) {
        setSpeedDialOpen(false);
      }
    };
    handleChange();
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (quickAddOpen) {
      setSpeedDialOpen(false);
      setErrorMsg(null);
      setDueDate((prev) => prev || formatDateKeyLocal(new Date()));
      const timer = window.setTimeout(() => {
        inputRef.current?.focus();
      }, 60);
      return () => window.clearTimeout(timer);
    }
  }, [quickAddOpen]);

  // Close Speed Dial on screen navigation
  useEffect(() => {
    setSpeedDialOpen(false);
  }, [activeScreen]);

  // Close on Escape
  useEffect(() => {
    if (!quickAddOpen && !speedDialOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setQuickAddOpen(false);
        setSpeedDialOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [quickAddOpen, speedDialOpen, setQuickAddOpen]);

  const now = new Date();
  const todayKey = formatDateKeyLocal(now);
  const tomorrowKey = addDaysToDateKey(now, 1);
  const plus3Key = addDaysToDateKey(now, 3);
  const nextMonKey = getNextMondayDateKey(now);

  const quickDatePresets = [
    { label: 'Hoje', value: todayKey },
    { label: 'Amanhã', value: tomorrowKey },
    { label: '+3 dias', value: plus3Key },
    { label: 'Próx. seg', value: nextMonKey },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = title.trim();
    if (!clean) {
      setErrorMsg('Escreva o que precisa ser feito.');
      inputRef.current?.focus();
      return;
    }

    const cleanOffsets = sanitizeReminderOffsets(reminderOffsets);
    const derivedDays = deriveRemindBeforeDaysFromOffsets(cleanOffsets);

    setSaving(true);
    setErrorMsg(null);
    try {
      await addDemanda({
        title: clean,
        dueDate: dueDate || todayKey,
        dueTime,
        priority,
        remindBeforeDays: derivedDays,
        reminderOffsetsMinutes: cleanOffsets,
      });
      setTitle('');
      setDueTime('');
      setPriority('media');
      setReminderOffsets([...DEFAULT_REMINDER_OFFSETS_MINUTES]);
      setSavedFeedback(true);
      window.setTimeout(() => setSavedFeedback(false), 1800);
      inputRef.current?.focus();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar demanda.');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenNovaDemanda = () => {
    setSpeedDialOpen(false);
    setQuickAddOpen(true);
  };

  const handleOpenNovoEvento = () => {
    setSpeedDialOpen(false);
    try {
      sessionStorage.setItem('siscom_agenda_open_new', '1');
    } catch {
      // Ignore storage errors
    }
    if (activeScreen === 'agenda') {
      window.dispatchEvent(new CustomEvent('siscom:open-new-agenda-event'));
    } else {
      onNavigate?.('agenda');
    }
  };

  const handleOpenNovoCracha = () => {
    setSpeedDialOpen(false);
    onNavigate?.('crachas');
  };

  const handlePrimaryFabClick = () => {
    if (quickAddOpen) {
      setQuickAddOpen(false);
      return;
    }
    if (isMobileViewport) {
      setSpeedDialOpen((prev) => !prev);
      return;
    }
    setQuickAddOpen(true);
  };

  const speedDialItems = [
    ...(canAccessCrachas && onNavigate
      ? [
          {
            id: 'novo-cracha',
            label: '+ Novo Crachá',
            icon: <BadgeCheck className="w-4 h-4 text-[#C9A961]" aria-hidden="true" />,
            onClick: handleOpenNovoCracha,
          },
        ]
      : []),
    ...(canAccessAgenda && onNavigate
      ? [
          {
            id: 'novo-evento',
            label: '+ Novo Evento',
            icon: <CalendarPlus className="w-4 h-4 text-[#C9A961]" aria-hidden="true" />,
            onClick: handleOpenNovoEvento,
          },
        ]
      : []),
    {
      id: 'nova-demanda',
      label: '+ Nova Demanda',
      icon: <ListTodo className="w-4 h-4 text-[#C9A961]" aria-hidden="true" />,
      onClick: handleOpenNovaDemanda,
    },
  ];

  const previewTop = pendingDemandas.slice(0, 3);
  const isExpanded = quickAddOpen || speedDialOpen;

  return (
    <>
      {/* Subtle tap-to-close backdrop when Mobile Speed Dial is open */}
      <AnimatePresence>
        {speedDialOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setSpeedDialOpen(false)}
            aria-hidden="true"
            className="no-print fixed inset-0 z-30 bg-black/55 backdrop-blur-[2px] md:hidden"
          />
        )}
      </AnimatePresence>

      <div
        className={`no-print fixed right-4 sm:right-5 z-40 flex flex-col items-end ${
          isTabletPortrait && activeScreen !== 'home'
            ? 'bottom-[176px]'
            : 'bottom-4 sm:bottom-5'
        }`}
      >
      {/* Quick-Add Popover */}
      <AnimatePresence>
        {quickAddOpen && (
          <motion.div
            ref={popoverRef}
            role="dialog"
            aria-label="Anotar demanda rápida"
            initial={{ opacity: 0, y: 14, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={SPRING_SNAPPY}
            className="mb-3 w-[calc(100vw-2rem)] sm:w-[372px] metal-elevated rounded-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/[0.1] bg-white/[0.04]">
              <div className="flex items-center gap-2 min-w-0">
                <ListTodo className="w-4 h-4 text-[#DFBC75] shrink-0" />
                <span className="font-display text-sm font-semibold text-[#F4E6C4] truncate">
                  Demanda rápida
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setQuickAddOpen(false);
                    setPanelOpen(true);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[7px] text-[11px] font-medium text-[#E5C17B] hover:bg-[#C29B56]/15 transition-colors cursor-pointer"
                >
                  <span>Painel</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setQuickAddOpen(false)}
                  aria-label="Fechar janela rápida"
                  className="w-7 h-7 rounded-[7px] flex items-center justify-center text-[#98A89F] hover:text-[#E4EAE6] hover:bg-white/[0.06] transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Quick Form */}
            <form onSubmit={handleSubmit} className="p-3.5 space-y-3">
              <div className="space-y-1.5">
                <input
                  ref={inputRef}
                  type="text"
                  maxLength={160}
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="O que precisa fazer?"
                  className="siscom-input !min-h-[42px] text-sm"
                />
                {errorMsg && <p className="text-[11px] text-red-300">{errorMsg}</p>}
              </div>

              {/* Quick date preset buttons */}
              <div className="grid grid-cols-4 gap-1.5">
                {quickDatePresets.map((preset) => {
                  const active = dueDate === preset.value;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setDueDate(preset.value)}
                      className={`min-h-[32px] px-2 rounded-[7px] text-[11px] font-medium border transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#C29B56]/22 border-[#D8B46E]/60 text-[#F4E6C4]'
                          : 'bg-[#0B100E] border-white/[0.08] text-[#98A89F] hover:text-[#E4EAE6] hover:border-white/[0.18]'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              {/* Date + Optional Time */}
              <div className="grid grid-cols-[1fr_112px] gap-2">
                <label className="relative flex items-center">
                  <Calendar className="w-3.5 h-3.5 text-[#8FA197] absolute left-2.5 pointer-events-none" />
                  <input
                    type="date"
                    aria-label="Data limite"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="siscom-input !min-h-[38px] !pl-8 !pr-2 text-xs tabular-nums"
                  />
                </label>

                <label className="relative flex items-center">
                  <Clock className="w-3.5 h-3.5 text-[#8FA197] absolute left-2.5 pointer-events-none" />
                  <input
                    type="time"
                    aria-label="Horário limite opcional"
                    value={dueTime}
                    onChange={(e) => setDueTime(e.target.value)}
                    className="siscom-input !min-h-[38px] !pl-8 !pr-2 text-xs tabular-nums"
                  />
                </label>
              </div>

              {/* Multiple reminders + priority */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#B7C2BC]">
                    <Bell className="w-3.5 h-3.5 text-[#DFBC75]" aria-hidden="true" />
                    <span>Notificações</span>
                  </span>

                  <button
                    type="button"
                    onClick={() => setPriority((p) => (p === 'alta' ? 'media' : 'alta'))}
                    className={`min-h-[30px] px-2.5 rounded-[8px] text-[11px] font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                      priority === 'alta'
                        ? 'bg-amber-500/18 border-amber-400/50 text-amber-200'
                        : 'bg-[#0B100E] border-white/[0.08] text-[#98A89F] hover:text-[#E4EAE6]'
                    }`}
                  >
                    {priority === 'alta' ? 'Prioridade alta' : 'Normal'}
                  </button>
                </div>

                <div className="max-h-[144px] overflow-y-auto pr-0.5">
                  <ReminderOffsetsEditor
                    offsets={reminderOffsets}
                    onChange={setReminderOffsets}
                    compact
                  />
                </div>
              </div>

              {/* Submit button */}
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <span className="text-[11px] text-[#8FA197] truncate">
                  {savedFeedback && (
                    <span className="text-[#83B499] font-medium">Demanda salva!</span>
                  )}
                </span>

                <button
                  type="submit"
                  disabled={saving}
                  className="siscom-btn siscom-btn-primary !min-h-[38px] !px-4 text-xs shrink-0"
                >
                  {saving ? (
                    <SiscomSpinner className="w-3.5 h-3.5" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>Salvar</span>
                </button>
              </div>
            </form>

            {/* Quick glance of top pending demands */}
            {previewTop.length > 0 && (
              <div className="border-t border-white/[0.09] bg-black/28 px-3.5 py-2.5 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-[#8FA197]">
                  <span className="font-medium text-[#C6D4CC]">Próximas pendentes</span>
                  <span className="tabular-nums">{pendingDemandas.length} total</span>
                </div>
                <ul className="divide-y divide-white/[0.05]">
                  {previewTop.map((item) => {
                    const urgency = getDemandaUrgency(item);
                    const countdownColor =
                      urgency === 'atrasada'
                        ? 'text-red-300'
                        : urgency === 'hoje'
                        ? 'text-[#E5C17B]'
                        : 'text-[#8FA197]';

                    return (
                      <li
                        key={item.id}
                        className="py-1.5 flex items-center justify-between gap-2 text-xs"
                      >
                        <button
                          type="button"
                          onClick={() => void toggleComplete(item)}
                          title="Marcar como concluída"
                          className="w-5 h-5 rounded-full border border-[#C29B56]/40 hover:border-[#83B499] hover:bg-[#2D5A43]/30 flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                        >
                          <Check className="w-3 h-3 text-transparent hover:text-[#83B499]" />
                        </button>
                        <span className="flex-1 min-w-0 truncate text-[#E4EAE6]">
                          {item.title}
                        </span>
                        <span className={`text-[11px] font-mono tabular-nums shrink-0 ${countdownColor}`}>
                          {formatDemandaCountdown(item)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Expandable Speed Dial Mini-Shortcuts */}
      <AnimatePresence>
        {speedDialOpen && !quickAddOpen && (
          <motion.div
            role="menu"
            aria-label="Atalhos rápidos"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.16, ease: SISCOM_EASE }}
            className="mb-3 flex flex-col items-end gap-2 md:hidden"
          >
            {speedDialItems.map((item, index) => (
              <motion.button
                key={item.id}
                type="button"
                role="menuitem"
                onClick={item.onClick}
                initial={{ opacity: 0, y: 12, scale: 0.92 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.94 }}
                transition={{
                  ...SPRING_EXPRESSIVE,
                  delay: (speedDialItems.length - 1 - index) * 0.032,
                }}
                className="min-h-[44px] pl-4 pr-2 py-1.5 rounded-full bg-[#0D1511]/95 backdrop-blur-xl border border-[#C9A961]/42 active:border-[#E7C580] active:scale-[0.97] shadow-[inset_0_1px_0_rgba(255,250,236,0.22),0_14px_30px_rgba(0,0,0,0.74)] flex items-center gap-2.5 text-xs font-semibold text-[#EDF2EE] whitespace-nowrap cursor-pointer transition-colors"
              >
                <span>{item.label}</span>
                <span className="w-8 h-8 rounded-full bg-[#182720] border border-[#C9A961]/35 flex items-center justify-center shrink-0">
                  {item.icon}
                </span>
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Quick-Add / Speed Dial Circle Button */}
      <button
        type="button"
        onClick={handlePrimaryFabClick}
        aria-expanded={isExpanded}
        aria-label={
          quickAddOpen
            ? 'Fechar anotação rápida de demandas'
            : speedDialOpen
            ? 'Fechar menu de atalhos rápidos'
            : isMobileViewport
            ? 'Abrir atalhos rápidos'
            : 'Nova demanda rápida'
        }
        title={isMobileViewport ? 'Atalhos rápidos' : 'Anotar demanda rápida'}
        className={`relative w-13 h-13 sm:w-14 sm:h-14 rounded-full flex items-center justify-center border backdrop-blur-xl transition-all duration-200 cursor-pointer shadow-[inset_0_1px_1px_rgba(255,250,236,0.34),0_12px_30px_rgba(0,0,0,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D8B46E]/70 ${
          isExpanded
            ? 'bg-[#131D18]/88 border-[#E0BE74]/75 text-[#F4E6C4]'
            : 'bg-gradient-to-br from-[#2D5A43]/78 via-[#193326]/78 to-[#0E1E16]/84 border-[#E0BE74]/55 hover:border-[#F2D592] text-[#F4E6C4] hover:scale-[1.04] active:scale-[0.97]'
        }`}
      >
        <Plus
          className={`w-6 h-6 text-[#F4E6C4] transition-transform duration-200 ${
            isExpanded ? 'rotate-45' : 'rotate-0'
          }`}
        />

        {!isExpanded && urgentCount > 0 && (
          <span
            aria-label={`${urgentCount} demanda(s) urgente(s)`}
            className="absolute -top-1 -right-1 min-w-[21px] h-[21px] px-1 rounded-full bg-[#C9A961] text-[#0B0E0D] text-[11px] font-bold font-mono tabular-nums flex items-center justify-center border-2 border-[#0B0E0D]"
          >
            {urgentCount > 9 ? '9+' : urgentCount}
          </span>
        )}
      </button>
      </div>
    </>
  );
};
