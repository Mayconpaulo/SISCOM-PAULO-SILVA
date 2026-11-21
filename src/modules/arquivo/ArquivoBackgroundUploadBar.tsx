import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ArrowUpRight, CheckCircle2, CloudUpload } from 'lucide-react';
import type { ActiveScreen } from '../registry';
import { useArquivoUpload } from './ArquivoUploadContext';
import { SISCOM_EASE } from '../../shared/motion';

interface ArquivoBackgroundUploadBarProps {
  activeScreen: ActiveScreen;
  onOpenArquivo: () => void;
}

/**
 * Unobtrusive Liquid Glass floating indicator shown when uploads are running (or have errors/duplicates)
 * while the user navigates to another SISCOM screen. Positioned on bottom-left so it never overlaps
 * the bottom-right Demandas FAB.
 */
export function ArquivoBackgroundUploadBar({
  activeScreen,
  onOpenArquivo,
}: ArquivoBackgroundUploadBarProps) {
  const {
    activeCount,
    queuedCount,
    errorCount,
    duplicateCount,
    overallProgress,
  } = useArquivoUpload();

  const inProgress = activeCount + queuedCount;
  const needsAttention = errorCount + duplicateCount;
  const shouldShow = activeScreen !== 'arquivo' && (inProgress > 0 || needsAttention > 0);

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96 }}
          transition={{ duration: 0.2, ease: SISCOM_EASE }}
          className="no-print fixed bottom-4 left-4 z-40 max-w-[300px] sm:max-w-[330px]"
        >
          <button
            type="button"
            onClick={onOpenArquivo}
            className="w-full text-left metal-surface rounded-xl px-3.5 py-2.5 border border-[#C9A961]/35 hover:border-[#C9A961]/65 shadow-[0_12px_32px_rgba(0,0,0,0.6)] transition-colors cursor-pointer space-y-2"
          >
            <div className="flex items-center justify-between gap-2.5">
              <div className="flex items-center gap-2 min-w-0">
                {inProgress > 0 ? (
                  <CloudUpload className="w-4 h-4 text-[#E5C17B] shrink-0 animate-pulse" />
                ) : needsAttention > 0 ? (
                  <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#F4E6C4] truncate">
                    {inProgress > 0
                      ? `Enviando ${inProgress} arquivo${inProgress === 1 ? '' : 's'}...`
                      : `${needsAttention} envio${needsAttention === 1 ? '' : 's'} pendente${needsAttention === 1 ? '' : 's'}`}
                  </div>
                  <div className="text-[11px] text-[#98A89F] truncate">
                    Arquivo Institucional · {inProgress > 0 ? `${overallProgress}%` : 'Ver fila'}
                  </div>
                </div>
              </div>
              <ArrowUpRight className="w-3.5 h-3.5 text-[#E5C17B] shrink-0" />
            </div>

            {inProgress > 0 && (
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#2D5A43] to-[#DFBC75] transition-all duration-300"
                  style={{ width: `${Math.max(4, overallProgress)}%` }}
                />
              </div>
            )}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
