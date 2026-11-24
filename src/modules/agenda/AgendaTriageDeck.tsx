import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AnimatePresence,
  PanInfo,
  animate,
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

const SWIPE_OFFSET_THRESHOLD = 80;
const SWIPE_VELOCITY_THRESHOLD = 420;

interface SwipeCardProps {
  event: AgendaEvent;
  selectedCategory: AgendaCategory;
  onCategoryChange: (cat: AgendaCategory) => void;
  busy: boolean;
  externalTrigger: 'comsoc' | 'general' | null;
  onSwipeCommit: (decision: 'comsoc' | 'general') => void;
  onDragProgressChange: (progress: number) => void;
}

const SwipeCard: React.FC<SwipeCardProps> = ({
  event,
  selectedCategory,
  onCategoryChange,
  busy,
  externalTrigger,
  onSwipeCommit,
  onDragProgressChange,
}) => {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-260, 0, 260], [-14, 0, 14]);
  const cardOpacity = useTransform(x, [-380, -240, 0, 240, 380], [0, 0.92, 1, 0.92, 0]);
  const rightStampOpacity = useTransform(x, [24, 95], [0, 1]);
  const leftStampOpacity = useTransform(x, [-95, -24], [1, 0]);
  const rightTintOpacity = useTransform(x, [15, 160], [0, 0.24]);
  const leftTintOpacity = useTransform(x, [-160, -15], [0.24, 0]);

  const committedRef = useRef(false);

  const start = parseEventDate(event.startAt, event.allDay, false);
  const end = parseEventDate(event.endAt, event.allDay, true);
  const attendees = parseAttendeesJson(event.attendeesJson);
  const attachments = parseAttachmentsJson(event.attachmentsJson);

  useEffect(() => {
    const unsubscribe = x.on('change', (latest) => {
      onDragProgressChange(Math.min(1, Math.abs(latest) / 140));
    });
    return () => {
      unsubscribe();
      onDragProgressChange(0);
    };
  }, [x, onDragProgressChange]);

  const flyOutAndCommit = useCallback(
    async (decision: 'comsoc' | 'general') => {
      if (committedRef.current || busy) return;
      committedRef.current = true;
      const targetX = decision === 'comsoc' ? 460 : -460;
      await animate(x, targetX, {
        type: 'tween',
        duration: 0.22,
        ease: [0.22, 1, 0.36, 1],
      }).finished;
      onSwipeCommit(decision);
    },
    [busy, onSwipeCommit, x]
  );

  // When user clicks bottom buttons or presses Left/Right arrow keys, animate the same Tinder fly-out
  useEffect(() => {
    if (externalTrigger && !committedRef.current) {
      void flyOutAndCommit(externalTrigger);
    }
  }, [externalTrigger, flyOutAndCommit]);

  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (busy || committedRef.current) return;
    const isRight =
      info.offset.x > SWIPE_OFFSET_THRESHOLD ||
      (info.velocity.x > SWIPE_VELOCITY_THRESHOLD && info.offset.x > 24);
    const isLeft =
      info.offset.x < -SWIPE_OFFSET_THRESHOLD ||
      (info.velocity.x < -SWIPE_VELOCITY_THRESHOLD && info.offset.x < -24);

    if (isRight) {
      void flyOutAndCommit('comsoc');
    } else if (isLeft) {
      void flyOutAndCommit('general');
    } else {
      void animate(x, 0, {
        type: 'spring',
        stiffness: 420,
        damping: 30,
      });
    }
  };

  return (
    <motion.div
      style={{ x, rotate, opacity: cardOpacity, touchAction: 'pan-y' }}
      drag={busy ? false : 'x'}
      dragElastic={0.95}
      dragMomentum={false}
      onDragEnd={handleDragEnd}
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.14 } }}
      transition={{ type: 'spring', stiffness: 360, damping: 28 }}
      className="relative w-full metal-elevated rounded-2xl p-5 select-none cursor-grab active:cursor-grabbing space-y-4 overflow-hidden touch-pan-y"
    >
      {/* Dynamic directional tint washes while dragging */}
      <motion.div
        aria-hidden="true"
        style={{ opacity: rightTintOpacity }}
        className="pointer-events-none absolute inset-0 bg-[#2D5A43]"
      />
      <motion.div
        aria-hidden="true"
        style={{ opacity: leftTintOpacity }}
        className="pointer-events-none absolute inset-0 bg-red-900"
      />

      {/* Dynamic Swipe Stamps */}
      <motion.div
        style={{ opacity: rightStampOpacity }}
        className="pointer-events-none absolute top-4 right-4 z-20 rounded-lg border-2 border-[#83B499] bg-[#13291E]/95 px-3 py-1 text-xs font-display font-bold uppercase tracking-wider text-[#A7D3BA] rotate-6 shadow-lg"
      >
        É da COMSOC
      </motion.div>

      <motion.div
        style={{ opacity: leftStampOpacity }}
        className="pointer-events-none absolute top-4 left-4 z-20 rounded-lg border-2 border-red-400/85 bg-[#2B1416]/95 px-3 py-1 text-xs font-display font-bold uppercase tracking-wider text-red-200 -rotate-6 shadow-lg"
      >
        Não é COMSOC
      </motion.div>

      {/* Card Header */}
      <div className="relative z-10 space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-[11px] font-mono uppercase tracking-wider text-[#C8A461]">
          <span className="inline-flex items-center gap-1.5">
            <CalendarIcon className="w-3.5 h-3.5" />
            Atividade futura · Google Calendar
          </span>
        </div>

        <h3 className="font-display text-lg font-semibold text-[#F4E6C4] leading-snug">
          {event.title}
        </h3>
      </div>

      {/* Metadata */}
      <div className="relative z-10 rounded-xl siscom-liquid-subcard p-3.5 space-y-2 text-xs text-[#D5DFD9]">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-[#E5C17B] shrink-0" />
          <span className="tabular-nums">
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
        className="relative z-10 space-y-1.5"
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <label
          htmlFor={`triage-cat-${event.id}`}
          className="siscom-field-label !text-[11px]"
        >
          Categoria
        </label>
        <select
          id={`triage-cat-${event.id}`}
          value={selectedCategory}
          onChange={(e) => onCategoryChange(e.target.value as AgendaCategory)}
          className="siscom-input !min-h-[40px] text-xs cursor-pointer"
        >
          {AGENDA_CATEGORIES.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.label}
            </option>
          ))}
        </select>
      </div>
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
  const [externalTrigger, setExternalTrigger] = useState<'comsoc' | 'general' | null>(null);
  const [dragProgress, setDragProgress] = useState(0);

  useEffect(() => {
    if (current) {
      setSelectedCategory(current.category === 'outros' ? 'solenidade' : current.category);
      setExternalTrigger(null);
      setDragProgress(0);
    }
  }, [current?.id]);

  const isBusy = Boolean(current && busyId === current.id);

  const handleCommit = useCallback(
    (decision: 'comsoc' | 'general') => {
      if (!current || isBusy) return;
      void onClassify(current, decision, selectedCategory);
    },
    [current, isBusy, onClassify, selectedCategory]
  );

  const triggerDecision = useCallback(
    (decision: 'comsoc' | 'general') => {
      if (!current || isBusy || externalTrigger) return;
      setExternalTrigger(decision);
    },
    [current, isBusy, externalTrigger]
  );

  // Keyboard shortcuts (Left/Right arrows) for desktop rapid triage
  useEffect(() => {
    if (!open || !current) return;
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        triggerDecision('comsoc');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        triggerDecision('general');
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, current, triggerDecision]);

  if (!open || !current) return null;

  return (
    <SiscomModal
      open={open && Boolean(current)}
      onClose={isBusy ? undefined : onClose}
      dismissible={!isBusy}
      title="Triagem de atividades"
      maxWidthClass="max-w-lg"
      zIndexClass="z-[55]"
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between text-xs text-[#98A89F]">
          <span className="inline-flex items-center gap-1.5 tabular-nums">
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
        <div className="relative pt-2 pb-1 overflow-x-clip">
          {nextUp && (
            <div
              aria-hidden="true"
              style={{
                transform: `scale(${0.95 + dragProgress * 0.04}) translateY(${8 - dragProgress * 6}px)`,
                opacity: 0.48 + dragProgress * 0.35,
              }}
              className="pointer-events-none absolute inset-x-3 top-2 bottom-1 rounded-2xl border border-white/10 bg-[#121815]/85 p-5 transition-none flex flex-col justify-between"
            >
              <div className="space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#8FA197]">
                  Próxima na fila
                </span>
                <p className="font-display text-base font-semibold text-[#C6D4CC]/75 truncate">
                  {nextUp.title}
                </p>
              </div>
            </div>
          )}

          <AnimatePresence mode="wait">
            <SwipeCard
              key={current.id}
              event={current}
              selectedCategory={selectedCategory}
              onCategoryChange={setSelectedCategory}
              busy={isBusy}
              externalTrigger={externalTrigger}
              onSwipeCommit={handleCommit}
              onDragProgressChange={setDragProgress}
            />
          </AnimatePresence>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            disabled={isBusy || Boolean(externalTrigger)}
            onClick={() => triggerDecision('general')}
            className="siscom-btn siscom-btn-danger !min-h-[46px] text-xs sm:text-sm"
          >
            {isBusy ? <SiscomSpinner className="w-4 h-4" /> : <X className="w-4 h-4" />}
            <span>Não é da COMSOC</span>
          </button>

          <button
            type="button"
            disabled={isBusy || Boolean(externalTrigger)}
            onClick={() => triggerDecision('comsoc')}
            className="siscom-btn siscom-btn-primary !min-h-[46px] text-xs sm:text-sm"
          >
            {isBusy ? <SiscomSpinner className="w-4 h-4" /> : <Check className="w-4 h-4" />}
            <span>É da COMSOC</span>
          </button>
        </div>

        <div className="flex items-center justify-end pt-1 border-t border-white/8 text-[11px] text-[#98A89F]">
          <button
            type="button"
            disabled={isBusy}
            onClick={onClose}
            className="text-[#E5C17B] hover:underline shrink-0 cursor-pointer"
          >
            Decidir depois
          </button>
        </div>
      </div>
    </SiscomModal>
  );
};
