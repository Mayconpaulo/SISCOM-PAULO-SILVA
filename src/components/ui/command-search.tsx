import React, { useEffect, useRef } from 'react';
import { CornerDownLeft, Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface CommandSearchProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}

/**
 * Modern Command Search bar inspired by shadcn/ui Command & 21st.dev glass inputs.
 * Supports keyboard focus via "/" or Ctrl/Cmd+K, and Escape to clear/blur.
 */
export const CommandSearch: React.FC<CommandSearchProps> = ({
  value,
  onChange,
  onSubmit,
  onKeyDown,
  placeholder = 'O que você deseja fazer?',
  ariaLabel = 'Pesquisar funções do SISCOM',
  className,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }

      if (e.key === '/' && !isEditable && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, []);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (value) {
        onChange('');
      } else {
        inputRef.current?.blur();
      }
      return;
    }
    onKeyDown?.(e);
  };

  return (
    <form onSubmit={onSubmit} className={cn('w-full', className)}>
      <div className="siscom-liquid-pill flex items-center gap-2.5 h-12 sm:h-11 px-3.5 rounded-2xl">
        <Search
          className="w-4 h-4 text-[#C9A961]/85 shrink-0 transition-colors"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className="flex-1 min-w-0 bg-transparent text-sm text-[#F1F5F2] placeholder:text-[#84948B] focus:outline-none"
        />

        {value ? (
          <button
            type="button"
            onClick={() => {
              onChange('');
              inputRef.current?.focus();
            }}
            aria-label="Limpar pesquisa"
            className="w-8 h-8 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center text-[#98A9A0] hover:text-[#F1F5F2] hover:bg-white/[0.08] transition-colors cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <kbd
            aria-hidden="true"
            className="hidden md:inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-md bg-white/[0.05] border border-white/[0.1] font-mono text-[11px] text-[#8D9D94] select-none shrink-0"
          >
            /
          </kbd>
        )}

        <button
          type="submit"
          title="Abrir função"
          aria-label="Abrir função correspondente"
          className="w-8 h-8 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center text-[#C2CFC8] hover:text-[#E7C580] hover:bg-white/[0.08] transition-colors cursor-pointer shrink-0"
        >
          <CornerDownLeft className="w-3.5 h-3.5" />
        </button>
      </div>
    </form>
  );
};
