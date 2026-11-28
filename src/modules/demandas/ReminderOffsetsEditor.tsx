import React from 'react';
import { Bell, Plus, X } from 'lucide-react';
import {
  MAX_REMINDER_OFFSETS,
  MAX_REMINDER_OFFSET_MINUTES,
  NEXT_REMINDER_SUGGESTION_ORDER,
} from './demandaTypes';

type OffsetUnit = 'on_time' | 'minutes' | 'hours' | 'days' | 'weeks';

function decomposeOffset(offsetMinutes: number): { value: number; unit: OffsetUnit } {
  const safe = Math.max(0, Math.round(offsetMinutes));
  if (safe === 0) return { value: 0, unit: 'on_time' };
  if (safe % 10080 === 0) return { value: safe / 10080, unit: 'weeks' };
  if (safe % 1440 === 0) return { value: safe / 1440, unit: 'days' };
  if (safe % 60 === 0) return { value: safe / 60, unit: 'hours' };
  return { value: safe, unit: 'minutes' };
}

function composeOffset(value: number, unit: OffsetUnit): number {
  if (unit === 'on_time') return 0;
  const cleanVal = Math.max(1, Math.round(Number.isFinite(value) ? value : 1));
  const multiplier =
    unit === 'weeks' ? 10080 : unit === 'days' ? 1440 : unit === 'hours' ? 60 : 1;
  return Math.min(MAX_REMINDER_OFFSET_MINUTES, cleanVal * multiplier);
}

function maxForUnit(unit: OffsetUnit): number {
  if (unit === 'weeks') return 4;
  if (unit === 'days') return 30;
  if (unit === 'hours') return 720;
  return MAX_REMINDER_OFFSET_MINUTES;
}

interface ReminderOffsetsEditorProps {
  offsets: number[];
  onChange: (next: number[]) => void;
  compact?: boolean;
}

export const ReminderOffsetsEditor: React.FC<ReminderOffsetsEditorProps> = ({
  offsets,
  onChange,
  compact = false,
}) => {
  const handleAdd = () => {
    if (offsets.length >= MAX_REMINDER_OFFSETS) return;
    const existing = new Set(offsets);
    const nextSuggestion =
      NEXT_REMINDER_SUGGESTION_ORDER.find((candidate) => !existing.has(candidate)) ??
      Math.min(MAX_REMINDER_OFFSET_MINUTES, (offsets[0] ?? 1440) + 1440);
    onChange([...offsets, nextSuggestion]);
  };

  const handleUpdateRow = (index: number, nextValue: number, nextUnit: OffsetUnit) => {
    const nextOffset = composeOffset(nextValue, nextUnit);
    const updated = offsets.map((val, idx) => (idx === index ? nextOffset : val));
    onChange(updated);
  };

  const handleRemoveRow = (index: number) => {
    onChange(offsets.filter((_, idx) => idx !== index));
  };

  const rowHeightClass = compact ? '!min-h-[34px] text-[11px]' : '!min-h-[38px] text-xs';

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {offsets.map((offsetMin, index) => {
          const { value, unit } = decomposeOffset(offsetMin);
          const isOnTime = unit === 'on_time';

          return (
            <div key={`${index}-${unit}`} className="flex items-center gap-1.5">
              <Bell
                className={`${compact ? 'w-3.5 h-3.5' : 'w-3.5 h-3.5'} text-[#DFBC75] shrink-0`}
                aria-hidden="true"
              />

              {!isOnTime && (
                <input
                  type="number"
                  min={1}
                  max={maxForUnit(unit)}
                  value={value}
                  aria-label="Quantidade de tempo antes"
                  onChange={(e) => {
                    const parsed = Number(e.target.value);
                    if (Number.isNaN(parsed)) return;
                    handleUpdateRow(index, Math.max(1, parsed), unit);
                  }}
                  className={`siscom-input ${rowHeightClass} !w-[62px] !px-2 text-center tabular-nums shrink-0`}
                />
              )}

              <select
                aria-label="Unidade do aviso"
                value={unit}
                onChange={(e) => {
                  const newUnit = e.target.value as OffsetUnit;
                  const fallbackVal = isOnTime ? 1 : Math.min(value, maxForUnit(newUnit));
                  handleUpdateRow(index, fallbackVal, newUnit);
                }}
                className={`siscom-input ${rowHeightClass} !px-2.5 flex-1 min-w-0 cursor-pointer`}
              >
                <option value="on_time">No horário</option>
                <option value="minutes">{value === 1 ? 'minuto antes' : 'minutos antes'}</option>
                <option value="hours">{value === 1 ? 'hora antes' : 'horas antes'}</option>
                <option value="days">{value === 1 ? 'dia antes' : 'dias antes'}</option>
                <option value="weeks">{value === 1 ? 'semana antes' : 'semanas antes'}</option>
              </select>

              <button
                type="button"
                onClick={() => handleRemoveRow(index)}
                aria-label="Remover notificação"
                title="Remover"
                className={`${
                  compact ? 'w-7 h-7' : 'w-8 h-8'
                } rounded-[8px] flex items-center justify-center text-[#8FA197] hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer shrink-0`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {offsets.length < MAX_REMINDER_OFFSETS && (
        <button
          type="button"
          onClick={handleAdd}
          className={`inline-flex items-center gap-1.5 rounded-[8px] border border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.07] hover:border-[#C9A961]/40 text-[#DFBC75] transition-colors cursor-pointer ${
            compact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
          }`}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Adicionar notificação</span>
        </button>
      )}
    </div>
  );
};
