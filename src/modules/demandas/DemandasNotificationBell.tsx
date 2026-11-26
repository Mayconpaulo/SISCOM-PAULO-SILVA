import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Bell,
  BellOff,
  BellRing,
  CalendarClock,
  Check,
  Clock,
  ListTodo,
  Send,
} from 'lucide-react';
import { useDemandas } from './DemandasContext';
import { SPRING_GENTLE } from '../../shared/motion';

export const DemandasNotificationBell: React.FC = () => {
  const {
    activeAlerts,
    hasNotificationDot,
    notificationDotTone,
    markNotificationsSeen,
    notificationPermission,
    backgroundPushStatus,
    enableBrowserNotifications,
    sendTestNotification,
    toggleComplete,
    postponeOneDay,
    setPanelOpen,
  } = useDemandas();

  const [open, setOpen] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleToggleOpen = () => {
    const next = !open;
    setOpen(next);
    setFeedback(null);
    if (next && activeAlerts.length > 0) {
      markNotificationsSeen();
    }
  };

  const handleEnablePush = async () => {
    setEnabling(true);
    setFeedback(null);
    try {
      const perm = await enableBrowserNotifications();
      if (perm === 'granted') {
        setFeedback('Notificações em segundo plano ativadas.');
      } else if (perm === 'denied') {
        setFeedback('Permissão bloqueada no navegador. Libere nas configurações do site.');
      } else if (perm === 'unsupported') {
        setFeedback('Este navegador não suporta notificações do sistema.');
      }
    } finally {
      setEnabling(false);
    }
  };

  const handleSendTest = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      const ok = await sendTestNotification();
      setFeedback(
        ok
          ? 'Notificação de teste enviada ao dispositivo.'
          : 'Não foi possível enviar o teste agora.'
      );
    } finally {
      setTesting(false);
    }
  };

  const dotClass =
    notificationDotTone === 'overdue'
      ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.85)]'
      : 'bg-[#E5C17B] shadow-[0_0_8px_rgba(229,193,123,0.85)]';

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={handleToggleOpen}
        title="Notificações"
        aria-label="Notificações"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative siscom-btn siscom-btn-secondary !min-h-[40px] sm:!min-h-[38px] !w-[40px] sm:!w-[38px] !px-0 text-[#CFDAD3] hover:text-[#F4E6C4] shrink-0"
      >
        <Bell className="w-4 h-4 text-[#E5C17B]" aria-hidden="true" />
        {hasNotificationDot && (
          <span
            aria-label="Há notificações pendentes"
            className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ring-2 ring-[#0A110D] ${dotClass}`}
          />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Central de Notificações"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 5, scale: 0.97 }}
            transition={SPRING_GENTLE}
            className="siscom-liquid-panel fixed sm:absolute right-3 sm:right-0 top-[62px] sm:top-auto sm:mt-2 w-[calc(100vw-1.5rem)] sm:w-[360px] max-w-[360px] rounded-2xl overflow-hidden z-50"
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-white/[0.09] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Bell className="w-4 h-4 text-[#DFBC75] shrink-0" aria-hidden="true" />
                <span className="font-display text-sm font-semibold text-[#F1F5F2] truncate">
                  Notificações
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setPanelOpen(true);
                }}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#DFBC75] hover:text-[#F4E6C4] transition-colors cursor-pointer shrink-0"
              >
                <ListTodo className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Abrir Demandas</span>
              </button>
            </div>

            {/* Alerts List */}
            <div className="max-h-[300px] overflow-y-auto divide-y divide-white/[0.07]">
              {activeAlerts.length === 0 ? (
                <div className="px-4 py-7 text-center">
                  <p className="text-xs font-medium text-[#CFDAD3]">
                    Nenhuma notificação pendente
                  </p>
                </div>
              ) : (
                activeAlerts.map((alert) => {
                  const isOverdue = alert.severity === 'overdue';
                  const isToday = alert.severity === 'today';

                  return (
                    <div key={alert.milestoneKey} className="px-4 py-3 space-y-2">
                      <div className="flex items-start gap-2.5">
                        <div
                          className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                            isOverdue
                              ? 'bg-red-500/15 text-red-400 border border-red-400/25'
                              : isToday
                                ? 'bg-[#C9A961]/18 text-[#E5C17B] border border-[#C9A961]/30'
                                : 'bg-[#2D5A43]/25 text-[#9FD0B4] border border-[#3B7356]/35'
                          }`}
                        >
                          {isOverdue ? (
                            <AlertTriangle className="w-3.5 h-3.5" />
                          ) : (
                            <Clock className="w-3.5 h-3.5" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p
                            className={`text-[11px] font-semibold uppercase tracking-wide ${
                              isOverdue
                                ? 'text-red-300'
                                : isToday
                                  ? 'text-[#E5C17B]'
                                  : 'text-[#9FD0B4]'
                            }`}
                          >
                            {alert.headline}
                          </p>
                          <p className="text-xs font-medium text-[#EEF2EF] leading-snug mt-0.5 break-words">
                            {alert.demanda.title}
                          </p>
                          <p className="text-[11px] text-[#95A49B] mt-0.5">{alert.detail}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 pl-8">
                        <button
                          type="button"
                          onClick={() => void toggleComplete(alert.demanda)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#2D5A43]/35 hover:bg-[#2D5A43]/55 border border-[#4E8C6B]/35 text-[11px] font-medium text-[#D7F0E1] transition-colors cursor-pointer"
                        >
                          <Check className="w-3 h-3" />
                          <span>Concluir</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void postponeOneDay(alert.demanda)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.1] text-[11px] font-medium text-[#CFDAD3] transition-colors cursor-pointer"
                        >
                          <CalendarClock className="w-3 h-3 text-[#C9A961]" />
                          <span>+1 dia</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Background Push Status Footer */}
            <div className="px-4 py-2.5 border-t border-white/[0.09] bg-black/20 space-y-2">
              {notificationPermission === 'granted' ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-[#A8D5BA] min-w-0">
                    <BellRing className="w-3.5 h-3.5 shrink-0 text-[#C9A961]" aria-hidden="true" />
                    <span className="truncate">
                      {backgroundPushStatus === 'active'
                        ? 'Alertas em segundo plano ativos'
                        : 'Alertas do dispositivo ativos'}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={testing}
                    onClick={() => void handleSendTest()}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] text-[11px] text-[#E4EAE6] transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                  >
                    <Send className="w-3 h-3 text-[#DFBC75]" />
                    <span>{testing ? 'Enviando...' : 'Testar'}</span>
                  </button>
                </div>
              ) : notificationPermission === 'denied' ? (
                <div className="flex items-center gap-1.5 text-[11px] text-[#B89D9D]">
                  <BellOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Notificações bloqueadas nas permissões do navegador.</span>
                </div>
              ) : notificationPermission === 'unsupported' ? (
                <div className="flex items-center gap-1.5 text-[11px] text-[#95A49B]">
                  <BellOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Notificações do sistema indisponíveis neste navegador.</span>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={enabling}
                  onClick={() => void handleEnablePush()}
                  className="w-full siscom-btn siscom-btn-gold !min-h-[34px] text-xs justify-center"
                >
                  <BellRing className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {enabling ? 'Ativando...' : 'Ativar alertas'}
                  </span>
                </button>
              )}

              {feedback && (
                <p className="text-[11px] text-[#D8B467] leading-snug">{feedback}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
