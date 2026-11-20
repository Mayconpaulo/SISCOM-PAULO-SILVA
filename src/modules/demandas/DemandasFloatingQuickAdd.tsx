import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bell,
  Calendar,
  Check,
  Clock,
  ExternalLink,
  ListTodo,
  Plus,
  Send,
  X,
} from 'lucide-react';
import { SISCOM_EASE } from '../../shared/motion';
import { SiscomSpinner } from '../../shared/ui';
import { useDemandas } from './DemandasContext';
import {
  DemandaPriority,
  REMIND_BEFORE_OPTIONS,
  addDaysToDateKey,
  formatDateKeyLocal,
  formatDemandaCountdown,
  getDemandaUrgency,
  getNextMondayDateKey,
} from './demandaTypes';

export const DemandasFloatingQuickAdd: React.FC = () => {
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
  const [remindBeforeDays, setRemindBeforeDays] = useState<number>(3);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedFeedback, setSavedFeedback] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (quickAddOpen) {
      setErrorMsg(null);
      setDueDate((prev) => prev || formatDateKeyLocal(new Date()));
      const timer = window.setTimeout(() => {
        inputRef.current?.focus();
      }, 60);
      return () => window.clearTimeout(timer);
    }
  }, [quickAddOpen]);

  // Close on Escape
  useEffect(() => {
    if (!quickAddOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setQuickAddOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [quickAddOpen, setQuickAddOpen]);

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

    setSaving(true);
    setErrorMsg(null);
    try {
      await addDemanda({
        title: clean,
        dueDate: dueDate || todayKey,
        dueTime,
        priority,
        remindBeforeDays,
      });
      setTitle('');
      setDueTime('');
      setPriority('media');
      setSavedFeedback(true);
      window.setTimeout(() => setSavedFeedback(false), 1800);
      inputRef.current?.focus();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar demanda.');
    } finally {
      setSaving(false);
    }
  };

  const previewTop = pendingDemandas.slice(0, 3);

  return (
    <div className="no-print fixed bottom-4 right-4 sm:bottom-5 sm:right-5 z-40 flex flex-col items-end">
      {/* Quick-Add Popover */}
      <AnimatePresence>
        {quickAddOpen && (
          <motion.div
            ref={popoverRef}
            role="dialog"
            aria-label="Anotar demanda rápida"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.18, ease: SISCOM_EASE }}
            className="mb-3 w-[calc(100vw-2rem)] sm:w-[368px] rounded-[14px] border border-[#C29B56]/35 bg-[#0F1513]/98 backdrop-blur-md shadow-[0_22px_60px_rgba(0,0,0,0.72)] overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/[0.08] bg-[#121A17]">
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

              {/* Reminder anticipation + priority */}
              <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                <label className="relative flex items-center">
                  <Bell className="w-3.5 h-3.5 text-[#DFBC75] absolute left-2.5 pointer-events-none" />
                  <select
                    aria-label="Notificar antes do prazo"
                    value={remindBeforeDays}
                    onChange={(e) => setRemindBeforeDays(Number(e.target.value))}
                    className="siscom-input !min-h-[36px] !pl-8 !pr-2 text-[11px] cursor-pointer"
                  >
                    {REMIND_BEFORE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        Avisar: {opt.shortLabel}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  onClick={() => setPriority((p) => (p === 'alta' ? 'media' : 'alta'))}
                  className={`min-h-[36px] px-2.5 rounded-[8px] text-[11px] font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                    priority === 'alta'
                      ? 'bg-amber-500/18 border-amber-400/50 text-amber-200'
                      : 'bg-[#0B100E] border-white/[0.08] text-[#98A89F] hover:text-[#E4EAE6]'
                  }`}
                >
                  {priority === 'alta' ? 'Prioridade alta' : 'Normal'}
                </button>
              </div>

              {/* Submit button */}
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <span className="text-[11px] text-[#8FA197] truncate">
                  {savedFeedback ? (
                    <span className="text-[#83B499] font-medium">Demanda salva!</span>
                  ) : (
                    'Avisos automáticos até o prazo'
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
              <div className="border-t border-white/[0.07] bg-[#0B100E]/90 px-3.5 py-2.5 space-y-1.5">
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

      {/* Floating Quick-Add Circle Button */}
      <button
        type="button"
        onClick={() => setQuickAddOpen(!quickAddOpen)}
        aria-label={quickAddOpen ? 'Fechar anotação rápida de demandas' : 'Nova demanda rápida'}
        title="Anotar demanda rápida"
        className={`relative w-13 h-13 sm:w-14 sm:h-14 rounded-full flex items-center justify-center border transition-all duration-200 cursor-pointer shadow-[0_10px_28px_rgba(0,0,0,0.58)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D8B46E]/70 ${
          quickAddOpen
            ? 'bg-[#17211C] border-[#D8B46E]/70 text-[#F4E6C4]'
            : 'bg-gradient-to-br from-[#2D5A43] via-[#1C382A] to-[#13251C] border-[#C29B56]/60 hover:border-[#E5C17B] text-[#F4E6C4] hover:scale-[1.04] active:scale-[0.97]'
        }`}
      >
        {quickAddOpen ? (
          <X className="w-5 h-5 sm:w-6 sm:h-6" />
        ) : (
          <Plus className="w-6 h-6 text-[#F4E6C4]" />
        )}

        {!quickAddOpen && urgentCount > 0 && (
          <span
            aria-label={`${urgentCount} demanda(s) urgente(s)`}
            className="absolute -top-1 -right-1 min-w-[21px] h-[21px] px-1 rounded-full bg-[#C29B56] text-[#0B0E0D] text-[11px] font-bold font-mono tabular-nums flex items-center justify-center border-2 border-[#0B0E0D]"
          >
            {urgentCount > 9 ? '9+' : urgentCount}
          </span>
        )}
      </button>
    </div>
  );
};
