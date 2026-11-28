import React from 'react';
import { ChevronDown } from 'lucide-react';

export const TabletRibbonRow: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => (
  <div
    className={`flex flex-wrap items-center gap-x-2.5 gap-y-2.5 w-full select-none ${className}`}
  >
    {children}
  </div>
);

export const TabletRibbonGroup: React.FC<{
  children: React.ReactNode;
  className?: string;
  label?: string;
}> = ({ children, className = '', label }) => (
  <div className={`flex flex-wrap items-center gap-2 ${className}`}>
    {label && (
      <span className="text-[11px] font-medium text-[#98A89F] tracking-wide mr-0.5 select-none">
        {label}
      </span>
    )}
    {children}
  </div>
);

export const TabletRibbonDivider: React.FC = () => (
  <span
    aria-hidden="true"
    className="w-px h-7 bg-white/[0.14] mx-0.5 shrink-0"
  />
);

export type TabletRibbonButtonVariant =
  | 'default'
  | 'primary'
  | 'gold'
  | 'active'
  | 'danger';

export interface TabletRibbonButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: TabletRibbonButtonVariant;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  chevron?: boolean;
  open?: boolean;
}

const VARIANT_CLASSES: Record<TabletRibbonButtonVariant, string> = {
  default:
    'bg-white/[0.065] hover:bg-white/[0.12] text-[#E8EEEA] border-white/[0.13]',
  primary:
    'bg-gradient-to-b from-[#3A7456]/92 to-[#27523C]/95 hover:from-[#438562] hover:to-[#2E6047] text-white border-[#8AC0A3]/38',
  gold:
    'bg-gradient-to-b from-[#C9A961]/24 to-[#201A10]/80 hover:from-[#D8B870]/32 text-[#F3D797] border-[#C9A961]/46',
  active:
    'bg-[#2D5A43]/88 text-white border-[#8AC0A3]/65 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]',
  danger:
    'bg-red-950/55 hover:bg-red-900/65 text-red-200 border-red-400/35',
};

export const TabletRibbonButton: React.FC<TabletRibbonButtonProps> = ({
  variant = 'default',
  icon,
  badge,
  chevron = false,
  open = false,
  children,
  className = '',
  type = 'button',
  ...rest
}) => {
  const effectiveVariant: TabletRibbonButtonVariant = open
    ? 'active'
    : variant;

  return (
    <button
      type={type}
      className={`min-h-[44px] px-3.5 py-2 rounded-xl border inline-flex items-center justify-center gap-2 text-[13px] font-medium whitespace-nowrap shrink-0 cursor-pointer transition-all active:scale-[0.97] disabled:opacity-45 disabled:cursor-not-allowed ${VARIANT_CLASSES[effectiveVariant]} ${className}`}
      {...rest}
    >
      {icon && <span className="shrink-0 flex items-center">{icon}</span>}
      {children && <span>{children}</span>}
      {badge !== undefined && badge !== null && badge !== '' && (
        <span
          className={`px-1.5 py-0.5 rounded-md text-[11px] font-mono leading-none ${
            effectiveVariant === 'active' || effectiveVariant === 'primary'
              ? 'bg-black/28 text-[#F4E6C4]'
              : 'bg-white/[0.1] text-[#D8B870]'
          }`}
        >
          {badge}
        </span>
      )}
      {chevron && (
        <ChevronDown
          className={`w-4 h-4 shrink-0 opacity-80 transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
          aria-hidden="true"
        />
      )}
    </button>
  );
};

export interface TabletRibbonIconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export const TabletRibbonIconButton: React.FC<TabletRibbonIconButtonProps> = ({
  active = false,
  className = '',
  type = 'button',
  children,
  ...rest
}) => (
  <button
    type={type}
    className={`w-11 h-11 rounded-xl border inline-flex items-center justify-center shrink-0 cursor-pointer transition-all active:scale-[0.95] disabled:opacity-40 ${
      active
        ? 'bg-[#2D5A43]/88 border-[#8AC0A3]/65 text-white'
        : 'bg-white/[0.065] hover:bg-white/[0.12] border-white/[0.13] text-[#DCE5DF]'
    } ${className}`}
    {...rest}
  >
    {children}
  </button>
);

export interface TabletRibbonSegmentOption<T extends string> {
  value: T;
  label: string;
  badge?: React.ReactNode;
  icon?: React.ReactNode;
}

export function TabletRibbonSegment<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly TabletRibbonSegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex items-center p-1 rounded-xl bg-black/44 border border-white/[0.12] gap-1 shrink-0"
    >
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(opt.value)}
            className={`min-h-[36px] px-3 rounded-lg inline-flex items-center justify-center gap-1.5 text-[13px] font-medium whitespace-nowrap cursor-pointer transition-all ${
              isActive
                ? 'bg-[#2D5A43] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]'
                : 'text-[#A2B1A8] hover:text-[#EEF3F0]'
            }`}
          >
            {opt.icon && <span className="shrink-0 flex items-center">{opt.icon}</span>}
            <span>{opt.label}</span>
            {opt.badge !== undefined && (
              <span
                className={`px-1.5 py-0.5 rounded text-[11px] font-mono leading-none ${
                  isActive
                    ? 'bg-black/28 text-[#F4E6C4]'
                    : 'bg-white/[0.08] text-[#98A89F]'
                }`}
              >
                {opt.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
