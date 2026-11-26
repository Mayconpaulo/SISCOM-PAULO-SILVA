import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  SPRING_SNAPPY,
  modalBackdropVariants,
  modalPanelVariants,
  noticeVariants,
} from './motion';

/* ── Loading Spinner ─────────────────────────────────────────────────────── */

export interface SiscomSpinnerProps {
  className?: string;
  tone?: 'light' | 'gold' | 'olive';
}

export const SiscomSpinner: React.FC<SiscomSpinnerProps> = ({
  className = 'w-4 h-4',
  tone = 'light',
}) => {
  const toneClass =
    tone === 'gold'
      ? 'border-[#C29B56]/30 border-t-[#E5C17B]'
      : tone === 'olive'
        ? 'border-[#83B499]/30 border-t-[#83B499]'
        : 'border-white/25 border-t-white';

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block shrink-0 rounded-full border-2 animate-spin',
        toneClass,
        className
      )}
    />
  );
};

/* ── Semantic Alert Banner (icon + color + spring entrance/exit) ─────────── */

export interface SiscomAlertProps {
  tone?: 'success' | 'error' | 'warning' | 'info';
  children: React.ReactNode;
  className?: string;
  onDismiss?: () => void;
}

export const SiscomAlert: React.FC<SiscomAlertProps> = ({
  tone = 'info',
  children,
  className = '',
  onDismiss,
}) => {
  const styles: Record<NonNullable<SiscomAlertProps['tone']>, string> = {
    success: 'bg-[#173626]/65 backdrop-blur-xl border-[#83B499]/32 text-[#D5F0E0]',
    error: 'bg-[#2C1216]/75 backdrop-blur-xl border-red-400/35 text-red-200',
    warning: 'bg-[#282012]/75 backdrop-blur-xl border-[#C9A961]/40 text-[#F4DDA6]',
    info: 'bg-[#0F1814]/68 backdrop-blur-xl border-white/[0.14] text-[#DBE5DF]',
  };

  const Icon =
    tone === 'success'
      ? CheckCircle2
      : tone === 'error' || tone === 'warning'
        ? AlertCircle
        : Info;

  const iconColor =
    tone === 'success'
      ? 'text-[#8AC0A3]'
      : tone === 'error'
        ? 'text-red-300'
        : tone === 'warning'
          ? 'text-[#E7C580]'
          : 'text-[#98A9A0]';

  return (
    <motion.div
      role={tone === 'error' ? 'alert' : 'status'}
      variants={noticeVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className={cn(
        'rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed flex items-start gap-2.5 shadow-[inset_0_1px_0_rgba(255,250,236,0.12)]',
        styles[tone],
        className
      )}
    >
      <Icon className={cn('w-4 h-4 shrink-0 mt-0.5', iconColor)} aria-hidden="true" />
      <div className="flex-1 min-w-0">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Fechar aviso"
          className="p-1 -m-0.5 rounded-md text-current/70 hover:text-current hover:bg-white/[0.08] transition-colors shrink-0 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </motion.div>
  );
};

/* ── Accessible Spring-Animated Dialog Modal ─────────────────────────────── */

export interface SiscomModalProps {
  open: boolean;
  onClose?: () => void;
  title?: string;
  labelledBy?: string;
  maxWidthClass?: string;
  dismissible?: boolean;
  zIndexClass?: string;
  children: React.ReactNode;
}

export const SiscomModal: React.FC<SiscomModalProps> = ({
  open,
  onClose,
  title,
  labelledBy,
  maxWidthClass = 'max-w-md',
  dismissible = true,
  zIndexClass = 'z-50',
  children,
}) => {
  useEffect(() => {
    if (!open || !dismissible || !onClose) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, dismissible, onClose]);

  const titleId = labelledBy || (title ? 'siscom-modal-title' : undefined);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          variants={modalBackdropVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          onClick={
            dismissible && onClose
              ? (e) => {
                  if (e.target === e.currentTarget) onClose();
                }
              : undefined
          }
          className={cn(
            'no-print fixed inset-0 flex items-center justify-center bg-[#040706]/70 backdrop-blur-xl p-4 overflow-y-auto',
            zIndexClass
          )}
        >
          <motion.div
            variants={modalPanelVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className={cn(
              'metal-elevated w-full rounded-2xl p-5 sm:p-6 space-y-4 my-auto',
              maxWidthClass
            )}
          >
            {title && (
              <div className="flex items-center justify-between gap-3 pb-3.5 border-b border-white/[0.09]">
                <h2
                  id={titleId}
                  className="font-display text-base font-semibold text-[#F6EAD0] tracking-tight"
                >
                  {title}
                </h2>
                {dismissible && onClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Fechar"
                    className="min-h-[40px] min-w-[40px] sm:min-h-[36px] sm:min-w-[36px] inline-flex items-center justify-center rounded-xl text-[#98A9A0] hover:text-[#EDF2EE] hover:bg-white/[0.08] transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/* ── Segmented Tab Control with Motion.dev Spring Sliding Indicator ──────── */

export interface SegmentedTabOption<T extends string> {
  value: T;
  label: string;
}

export interface SiscomSegmentedTabsProps<T extends string> {
  layoutId: string;
  options: readonly SegmentedTabOption<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
  className?: string;
  size?: 'sm' | 'md';
}

export function SiscomSegmentedTabs<T extends string>({
  layoutId,
  options,
  value,
  onChange,
  ariaLabel,
  className = '',
  size = 'md',
}: SiscomSegmentedTabsProps<T>) {
  const minH = size === 'sm' ? 'min-h-[34px] text-[11px]' : 'min-h-[42px] text-xs sm:text-sm';

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('siscom-tab-track grid gap-1', className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative px-3 rounded-[9px] font-medium transition-colors whitespace-nowrap select-none cursor-pointer',
              minH,
              active ? 'text-[#FAF3E3]' : 'text-[#A6B3AC] hover:text-[#EDF2EE]'
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={SPRING_SNAPPY}
                className="absolute inset-0 rounded-[9px] bg-gradient-to-b from-[#3E7C5C]/90 to-[#27523C]/95 border border-[#9CD0B4]/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_6px_14px_-6px_rgba(0,0,0,0.65)]"
              />
            )}
            <span className="relative z-10">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
