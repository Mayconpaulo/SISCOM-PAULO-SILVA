import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BellRing, CalendarPlus, Check, X } from 'lucide-react';
import { SISCOM_EASE } from '../../shared/motion';
import { useDemandas } from './DemandasContext';

export const DemandasNotificationToasts: React.FC = () => {
  const { activeAlerts, dismissAlert, toggleComplete, postponeOneDay } = useDemandas();

  if (activeAlerts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="no-print fixed top-16 right-3 sm:right-5 z-[48] w-[calc(100vw-1.5rem)] max-w-[360px] flex flex-col gap-2.5 pointer-events-none"
    >
      <AnimatePresence initial={false}>
        {activeAlerts.map((alert) => {
          const accentText =
            alert.severity === 'overdue'
              ? 'text-red-300'
              : alert.severity === 'today'
              ? 'text-[#E5C17B]'
              : 'text-[#83B499]';
          const borderTone =
            alert.severity === 'overdue'
              ? 'border-red-400/35'
              : alert.severity === 'today'
              ? 'border-[#C29B56]/45'
              : 'border-[#83B499]/35';

          return (
            <motion.div
              key={alert.milestoneKey}
              initial={{ opacity: 0, x: 24, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.96 }}
              transition={{ duration: 0.2, ease: SISCOM_EASE }}
              className={`pointer-events-auto rounded-[12px] border ${borderTone} bg-[#0F1513]/96 backdrop-blur-md shadow-[0_14px_38px_rgba(0,0,0,0.62)] p-3.5 space-y-2.5`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0">
                  <BellRing className={`w-4 h-4 mt-0.5 shrink-0 ${accentText}`} />
                  <div className="min-w-0 space-y-0.5">
                    <p className={`text-[11px] font-semibold uppercase tracking-wider ${accentText}`}>
                      {alert.headline}
                    </p>
                    <p className="text-sm font-medium text-[#F4E6C4] leading-snug break-words">
                      {alert.demanda.title}
                    </p>
                    <p className="text-xs text-[#98A89F] tabular-nums">{alert.detail}</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => dismissAlert(alert.milestoneKey)}
                  aria-label="Dispensar aviso"
                  className="w-7 h-7 rounded-[7px] flex items-center justify-center text-[#8FA197] hover:text-[#E4EAE6] hover:bg-white/[0.06] shrink-0 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1 border-t border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => void postponeOneDay(alert.demanda)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[7px] text-[11px] font-medium text-[#C6D4CC] bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] transition-colors cursor-pointer"
                >
                  <CalendarPlus className="w-3.5 h-3.5 text-[#DFBC75]" />
                  <span>+1 dia</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    dismissAlert(alert.milestoneKey);
                    void toggleComplete(alert.demanda);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[7px] text-[11px] font-medium text-[#D6EEE0] bg-[#2D5A43]/60 hover:bg-[#2D5A43]/85 border border-[#83B499]/40 transition-colors cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Concluir</span>
                </button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
