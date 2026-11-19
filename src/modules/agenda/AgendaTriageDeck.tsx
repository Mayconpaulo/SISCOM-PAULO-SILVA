import React, { useEffect, useState } from 'react';
import {
  AnimatePresence,
  PanInfo,
  motion,
  useMotionValue,
  useTransform,
} from 'motion/react';
import {
  Calendar as CalendarIcon,
  Check,
  Clock,
  FileText,
  Layers,
  MapPin,
  Users,
  Video,
  X,
} from 'lucide-react';
import { SiscomModal, SiscomSpinner } from '../../shared/ui';
import {
  AGENDA_CATEGORIES,
  AgendaCategory,
  AgendaEvent,
  formatTimeShort,
  parseAttachmentsJson,
  parseAttendeesJson,
  parseEventDate,
} from './agendaTypes';

interface AgendaTriageDeckProps {
  open: boolean;
  pendingEvents: AgendaEvent[];
  busyId: string | null;
  onClose: () => void;
  onClassify: (
    event: AgendaEvent,
    decision: 'comsoc' | 'general',
    category: AgendaCategory
  ) => Promise<void>;
}

const SWIPE_THRESHOLD = 110;

interface SwipeCardProps {
  event: AgendaEvent;
  selectedCategory: AgendaCategory;
  onCategoryChange: (cat: AgendaCategory) => void;
  busy: boolean;
  onSwipe: (decision: 'comsoc' | 'general') => void;
}

const SwipeCard: React.FC<SwipeCardProps> = ({
  event,
  selectedCategory,
  onCategoryChange,
  busy,
  onSwipe,
}) => {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 0, 220], [-10, 0, 10]);
  const rightStampOpacity = useTransform(x, [30, 120], [0, 1]);
  const leftStampOpacity = useTransform(x, [-120, -30], [1, 0]);

  const start = parseEventDate(event.startAt, event.allDay, false);
  const end = parseEventDate(event.endAt, event.allDay, true);
  const attendees = parseAttendeesJson(event.attendeesJson);
  const attachments = parseAttachmentsJson(event.attachmentsJson);

  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (busy) return;
    if (info.offset.x > SWIPE_THRESHOLD) {
      onSwipe('comsoc');
    } else if (info.offset.x < -SWIPE_THRESHOLD) {
      onSwipe('general');
    }
  };

  return (
    <motion.div
      style={{ x, rotate }}
      drag={busy ? false : 'x'}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.85}
      onDragEnd={handleDragEnd}
      initial={{ opacity: 0, scale: 0.94, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      className="relative w-full rounded-2xl border border-[#C29B56]/35 bg-gradient-to-b from-[#17211C] to-[#0F1412] p-5 shadow-2xl select-none cursor-grab active:cursor-grabbing space-y-4"
    >
      {/* Dynamic Swipe Stamps */}
      <motion.div
        style={{ opacity: rightStampOpacity }}
        className="pointer-events-none absolute top-4 right-4 z-20 rounded-lg border-2 border-[#83B499] bg-[#13291E]/90 px-3 py-1 text-xs font-display font-bold uppercase tracking-wider text-[#A7D3BA] rotate-6"
      >
        É da COMSOC ✓
      </motion.div>

      <motion.div
        style={{ opacity: leftStampOpacity }}
        className="pointer-events-none absolute top-4 left-4 z-20 rounded-lg border-2 border-red-400/80 bg-[#2B1416]/90 px-3 py-1 text-xs font-display font-bold uppercase tracking-wider text-red-200 -rotate-6"
      >
        Não é COMSOC ✕
      </motion.div>

      {/* Card Header */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-[11px] font-mono uppercase tracking-wider text-[#C8A461]">
          <span className="inline-flex items-center gap-1.5">
            <CalendarIcon className="w-3.5 h-3.5" />
            Nova atividade no Google Calendar
          </span>
        </div>

        <h3 className="font-display text-lg font-semibold text-[#F4E6C4] leading-snug">
          {event.title}
        </h3>
      </div>

      {/* Metadata */}
      <div className="rounded-xl border border-white/8 bg-[#0C100F]/90 p-3.5 space-y-2 text-xs text-[#C6D4CC]">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-[#E5C17B] shrink-0" />
          <span>
            {start.toLocaleDateString('pt-BR', {
              weekday: 'short',
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
            {' · '}
            {event.allDay
              ? 'Dia inteiro'
              : `${formatTimeShort(start)} às ${formatTimeShort(end)}`}
          </span>
        </div>

        {event.location && (
          <div className="flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 text-[#83B499] shrink-0" />
            <span className="truncate">{event.location}</span>
          </div>
        )}

        {event.meetLink && (
          <div className="flex items-center gap-2 text-[#93B7D8]">
            <Video className="w-3.5 h-3.5 shrink-0" />
            <span>Possui sala do Google Meet</span>
          </div>
        )}

        {attendees.length > 0 && (
          <div className="flex items-start gap-2">
            <Users className="w-3.5 h-3.5 text-[#C8A461] shrink-0 mt-0.5" />
            <span className="line-clamp-2 text-[#98A89F]">
              {attendees.length} convidado{attendees.length === 1 ? '' : 's'}:{' '}
              {attendees
                .slice(0, 4)
                .map((a) => a.displayName || a.email)
                .join(', ')}
              {attendees.length > 4 ? ` +${attendees.length - 4}` : ''}
            </span>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="flex items-center gap-2 text-[#C9A47B]">
            <FileText className="w-3.5 h-3.5 shrink-0" />
            <span>
              {attachments.length} anexo{attachments.length === 1 ? '' : 's'} vinculado
              {attachments.length === 1 ? '' : 's'}
            </span>
          </div>
        )}

        {event.description && (
          <p className="pt-2 border-t border-white/8 text-[11px] text-[#98A89F] line-clamp-4 whitespace-pre-wrap leading-relaxed">
            {event.description}
          </p>
        )}
      </div>

      {/* Category quick selector for when approving to COMSOC */}
      <div
        className="space-y-1.5"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <label
          htmlFor={`triage-cat-${event.id}`}
          className="siscom-field-label !text-[11px]"
        >
          Se for da COMSOC, classificar em qual categoria?
        </label>
        <select
          id={`triage-cat-${event.id}`}
          value={selectedCategory}
          onChange={(e) => onCategoryChange(e.target.value as AgendaCategory)}
          className="siscom-input !min-h-[38px] text-xs"
        >
          {AGENDA_CATEGORIES.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.label}
            </option>
          ))}
        </select>
      </div>

      <p className="text-center text-[11px] text-[#697870]">
        Arraste para a <strong>direita</strong> (COMSOC) ou <strong>esquerda</strong> (não é COMSOC), ou use os botões abaixo.
      </p>
    </motion.div>
  );
};

export const AgendaTriageDeck: React.FC<AgendaTriageDeckProps> = ({
  open,
  pendingEvents,
  busyId,
  onClose,
  onClassify,
}) => {
  const current = pendingEvents[0] || null;
  const nextUp = pendingEvents[1] || null;
  const [selectedCategory, setSelectedCategory] = useState<AgendaCategory>('solenidade');

  useEffect(() => {
    if (current) {
      setSelectedCategory(current.category === 'outros' ? 'solenidade' : current.category);
    }
  }, [current?.id]);

  if (!open || !current) return null;

  const isBusy = busyId === current.id;

  const triggerDecision = (decision: 'comsoc' | 'general') => {
    if (isBusy) return;
    void onClassify(current, decision, selectedCategory);
  };

  return (
    <SiscomModal
      open={open && Boolean(current)}
      onClose={isBusy ? undefined : onClose}
      dismissible={!isBusy}
      title="Triagem de novas atividades"
      maxWidthClass="max-w-lg"
      zIndexClass="z-[55]"
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between text-xs text-[#98A89F]">
          <span className="inline-flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-[#E5C17B]" />
            <span>
              {pendingEvents.length}{' '}
              {pendingEvents.length === 1 ? 'atividade pendente' : 'atividades pendentes'}
            </span>
          </span>
          <span className="text-[11px] font-mono text-[#697870]">
            COMSOC vs. Geral
          </span>
        </div>

        {/* Stacked Card Stage */}
        <div className="relative pt-2 pb-1">
          {nextUp && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-3 top-0 bottom-2 rounded-2xl border border-white/10 bg-[#121815]/75 scale-[0.96] translate-y-2 opacity-60"
            />
          )}

          <AnimatePresence mode="wait">
            <SwipeCard
              key={current.id}
              event={current}
              selectedCategory={selectedCategory}
              onCategoryChange={setSelectedCategory}
              busy={isBusy}
              onSwipe={triggerDecision}
            />
          </AnimatePresence>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => triggerDecision('general')}
            className="siscom-btn siscom-btn-danger !min-h-[46px] text-xs sm:text-sm"
          >
            {isBusy ? <SiscomSpinner className="w-4 h-4" /> : <X className="w-4 h-4" />}
            <span>Não é da COMSOC</span>
          </button>

          <button
            type="button"
            disabled={isBusy}
            onClick={() => triggerDecision('comsoc')}
            className="siscom-btn siscom-btn-primary !min-h-[46px] text-xs sm:text-sm"
          >
            {isBusy ? <SiscomSpinner className="w-4 h-4" /> : <Check className="w-4 h-4" />}
            <span>É da COMSOC</span>
          </button>
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-white/8 text-[11px] text-[#98A89F]">
          <span>Eventos marcados como “Não é da COMSOC” continuam no Calendário Geral.</span>
          <button
            type="button"
            disabled={isBusy}
            onClick={onClose}
            className="text-[#E5C17B] hover:underline shrink-0 ml-3 cursor-pointer"
          >
            Decidir depois
          </button>
        </div>
      </div>
    </SiscomModal>
  );
};
