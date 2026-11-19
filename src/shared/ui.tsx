import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import {
  MICRO_TRANSITION,
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
      className={`inline-block shrink-0 rounded-full border-2 animate-spin ${toneClass} ${className}`}
    />
  );
};

/* ── Semantic Alert Banner (icon + color + smooth entrance/exit) ─────────── */

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
    success: 'bg-[#2D5A43]/18 border-[#83B499]/30 text-[#C9E2D4]',
    error: 'bg-[#2B1416]/85 border-red-400/30 text-red-200',
    warning: 'bg-[#221D12]/90 border-[#C29B56]/35 text-[#F0D69A]',
    info: 'bg-[#141B18] border-white/12 text-[#C6D4CC]',
  };

  const Icon =
    tone === 'success'
      ? CheckCircle2
      : tone === 'error' || tone === 'warning'
        ? AlertCircle
        : Info;

  const iconColor =
    tone === 'success'
      ? 'text-[#83B499]'
      : tone === 'error'
        ? 'text-red-300'
        : tone === 'warning'
          ? 'text-[#E5C17B]'
          : 'text-[#98A89F]';

  return (
    <motion.div
      role={tone === 'error' ? 'alert' : 'status'}
      variants={noticeVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className={`rounded-lg border px-3.5 py-2.5 text-xs leading-relaxed flex items-start gap-2.5 ${styles[tone]} ${className}`}
    >
      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconColor}`} aria-hidden="true" />
      <div className="flex-1 min-w-0">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Fechar aviso"
          className="p-0.5 rounded text-current/70 hover:text-current transition-colors shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </motion.div>
  );
};

/* ── Accessible Animated Modal ───────────────────────────────────────────── */

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
          className={`no-print fixed inset-0 ${zIndexClass} flex items-center justify-center bg-[#060908]/80 backdrop-blur-md p-4 overflow-y-auto`}
        >
          <motion.div
            variants={modalPanelVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className={`metal-elevated w-full ${maxWidthClass} rounded-2xl p-5 sm:p-6 border border-[#C29B56]/25 shadow-2xl space-y-4 my-auto`}
          >
            {title && (
              <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/8">
                <h2
                  id={titleId}
                  className="font-display text-base font-semibold text-[#F4E6C4] tracking-tight"
                >
                  {title}
                </h2>
                {dismissible && onClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Fechar"
                    className="min-h-[38px] min-w-[38px] inline-flex items-center justify-center rounded-lg text-[#98A89F] hover:text-[#E4EAE6] hover:bg-white/6 transition-colors"
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

/* ── Segmented Tab Control with Smooth Sliding Indicator ─────────────────── */

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
      className={`siscom-tab-track grid gap-1 ${className}`}
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
            className={`relative ${minH} px-3 rounded-[7px] font-medium transition-colors whitespace-nowrap select-none cursor-pointer ${
              active ? 'text-white' : 'text-[#98A89F] hover:text-[#E4EAE6]'
            }`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={MICRO_TRANSITION}
                className="absolute inset-0 rounded-[7px] bg-[#2D5A43] shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_2px_8px_-2px_rgba(0,0,0,0.5)]"
              />
            )}
            <span className="relative z-10">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
