import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  Check,
  Clock,
  Download,
  ExternalLink,
  MapPin,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react';
import { SiscomAlert, SiscomModal, SiscomSpinner } from '../../shared/ui';
import {
  AGENDA_CATEGORIES,
  AGENDA_CATEGORY_MAP,
  AGENDA_STATUS_LABELS,
  AgendaCategory,
  AgendaEvent,
  AgendaStatus,
  GoogleCalendarListItem,
  GoogleCalendarRemoteEvent,
  REMINDER_OPTIONS,
  formatLocalDateKey,
  formatTimeShort,
  parseEventDate,
} from './agendaTypes';

export interface EventFormValues {
  title: string;
  category: AgendaCategory;
  status: AgendaStatus;
  allDay: boolean;
  startDate: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endDate: string; // YYYY-MM-DD
  endTime: string; // HH:mm
  location: string;
  responsibles: string;
  description: string;
  reminderMinutes: number;
  syncWithGoogle: boolean;
}

interface AgendaEventModalProps {
  open: boolean;
  editingEvent: AgendaEvent | null;
  defaultDate: Date;
  googleConnected: boolean;
  selectedCalendar: GoogleCalendarListItem | null;
  saving: boolean;
  errorMsg: string | null;
  onClose: () => void;
  onSubmit: (values: EventFormValues) => void;
}

function buildInitialValues(
  editingEvent: AgendaEvent | null,
  defaultDate: Date,
  googleConnected: boolean,
  selectedCalendar: GoogleCalendarListItem | null
): EventFormValues {
  const canWriteGoogle =
    googleConnected &&
    Boolean(selectedCalendar) &&
    (selectedCalendar?.accessRole === 'owner' || selectedCalendar?.accessRole === 'writer');

  if (!editingEvent) {
    const dayKey = formatLocalDateKey(defaultDate);
    return {
      title: '',
      category: 'solenidade',
      status: 'agendado',
      allDay: false,
      startDate: dayKey,
      startTime: '09:00',
      endDate: dayKey,
      endTime: '10:30',
      location: '',
      responsibles: '',
      description: '',
      reminderMinutes: 60,
      syncWithGoogle: Boolean(canWriteGoogle && selectedCalendar && !selectedCalendar.primary),
    };
  }

  const start = parseEventDate(editingEvent.startAt, editingEvent.allDay, false);
  const end = parseEventDate(editingEvent.endAt, editingEvent.allDay, true);

  return {
    title: editingEvent.title,
    category: editingEvent.category,
    status: editingEvent.status,
    allDay: editingEvent.allDay,
    startDate: editingEvent.allDay
      ? editingEvent.startAt.slice(0, 10)
      : formatLocalDateKey(start),
    startTime: editingEvent.allDay ? '09:00' : formatTimeShort(start),
    endDate: editingEvent.allDay
      ? editingEvent.endAt.slice(0, 10)
      : formatLocalDateKey(end),
    endTime: editingEvent.allDay ? '10:00' : formatTimeShort(end),
    location: editingEvent.location,
    responsibles: editingEvent.responsibles,
    description: editingEvent.description,
    reminderMinutes: editingEvent.reminderMinutes,
    syncWithGoogle: editingEvent.syncStatus === 'synced',
  };
}

export const AgendaEventModal: React.FC<AgendaEventModalProps> = ({
  open,
  editingEvent,
  defaultDate,
  googleConnected,
  selectedCalendar,
  saving,
  errorMsg,
  onClose,
  onSubmit,
}) => {
  const [form, setForm] = useState<EventFormValues>(() =>
    buildInitialValues(editingEvent, defaultDate, googleConnected, selectedCalendar)
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(buildInitialValues(editingEvent, defaultDate, googleConnected, selectedCalendar));
      setValidationError(null);
    }
  }, [open, editingEvent, defaultDate, googleConnected, selectedCalendar]);

  const canWriteGoogle =
    googleConnected &&
    Boolean(selectedCalendar) &&
    (selectedCalendar?.accessRole === 'owner' || selectedCalendar?.accessRole === 'writer');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (!form.title.trim()) {
      setValidationError('Informe o título da atividade.');
      return;
    }

    if (!form.startDate || !form.endDate) {
      setValidationError('Informe as datas de início e término.');
      return;
    }

    if (form.allDay) {
      if (form.endDate < form.startDate) {
        setValidationError('A data de término não pode ser anterior à data de início.');
        return;
      }
    } else {
      const startIso = new Date(`${form.startDate}T${form.startTime}:00`);
      const endIso = new Date(`${form.endDate}T${form.endTime}:00`);
      if (Number.isNaN(startIso.getTime()) || Number.isNaN(endIso.getTime())) {
        setValidationError('Horário informado é inválido.');
        return;
      }
      if (endIso <= startIso) {
        setValidationError('O horário de término deve ser posterior ao início.');
        return;
      }
    }

    onSubmit(form);
  };

  return (
    <SiscomModal
      open={open}
      onClose={saving ? undefined : onClose}
      dismissible={!saving}
      title={editingEvent ? 'Editar atividade da COMSOC' : 'Nova atividade da COMSOC'}
      maxWidthClass="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {(validationError || errorMsg) && (
          <SiscomAlert tone="error" onDismiss={() => setValidationError(null)}>
            {validationError || errorMsg}
          </SiscomAlert>
        )}

        <div className="space-y-1.5">
          <label htmlFor="agenda-title" className="siscom-field-label">
            Título da atividade *
          </label>
          <input
            id="agenda-title"
            type="text"
            required
            maxLength={140}
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            placeholder="Ex: Formatura do Dia do Soldado / Cobertura Fotográfica"
            className="siscom-input"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div className="space-y-1.5">
            <label htmlFor="agenda-category" className="siscom-field-label">
              Categoria
            </label>
            <select
              id="agenda-category"
              value={form.category}
              onChange={(e) =>
                setForm((p) => ({ ...p, category: e.target.value as AgendaCategory }))
              }
              className="siscom-input"
            >
              {AGENDA_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="agenda-status" className="siscom-field-label">
              Situação
            </label>
            <select
              id="agenda-status"
              value={form.status}
              onChange={(e) =>
                setForm((p) => ({ ...p, status: e.target.value as AgendaStatus }))
              }
              className="siscom-input"
            >
              {(['agendado', 'realizado', 'cancelado'] as AgendaStatus[]).map((st) => (
                <option key={st} value={st}>
                  {AGENDA_STATUS_LABELS[st]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <label className="inline-flex items-center gap-2 text-xs text-[#E4EAE6] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.allDay}
              onChange={(e) => setForm((p) => ({ ...p, allDay: e.target.checked }))}
              className="h-4 w-4 accent-[#2D5A43] cursor-pointer"
            />
            <span>Atividade de dia inteiro</span>
          </label>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="agenda-start-date" className="siscom-field-label">
              Data inicial
            </label>
            <input
              id="agenda-start-date"
              type="date"
              required
              value={form.startDate}
              onChange={(e) => {
                const nextStart = e.target.value;
                setForm((p) => ({
                  ...p,
                  startDate: nextStart,
                  endDate: p.endDate < nextStart ? nextStart : p.endDate,
                }));
              }}
              className="siscom-input text-xs"
            />
          </div>

          {!form.allDay && (
            <div className="space-y-1.5">
              <label htmlFor="agenda-start-time" className="siscom-field-label">
                Início
              </label>
              <input
                id="agenda-start-time"
                type="time"
                required
                value={form.startTime}
                onChange={(e) => setForm((p) => ({ ...p, startTime: e.target.value }))}
                className="siscom-input text-xs"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="agenda-end-date" className="siscom-field-label">
              Data final
            </label>
            <input
              id="agenda-end-date"
              type="date"
              required
              value={form.endDate}
              onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
              className="siscom-input text-xs"
            />
          </div>

          {!form.allDay && (
            <div className="space-y-1.5">
              <label htmlFor="agenda-end-time" className="siscom-field-label">
                Término
              </label>
              <input
                id="agenda-end-time"
                type="time"
                required
                value={form.endTime}
                onChange={(e) => setForm((p) => ({ ...p, endTime: e.target.value }))}
                className="siscom-input text-xs"
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div className="space-y-1.5">
            <label htmlFor="agenda-location" className="siscom-field-label">
              Local
            </label>
            <input
              id="agenda-location"
              type="text"
              maxLength={180}
              value={form.location}
              onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
              placeholder="Ex: Pátio de Formaturas / Auditório"
              className="siscom-input"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="agenda-responsibles" className="siscom-field-label">
              Responsáveis
            </label>
            <input
              id="agenda-responsibles"
              type="text"
              maxLength={240}
              value={form.responsibles}
              onChange={(e) => setForm((p) => ({ ...p, responsibles: e.target.value }))}
              placeholder="Ex: 3º Sgt Silva, Cb Oliveira (Foto/Vídeo)"
              className="siscom-input"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="agenda-reminder" className="siscom-field-label">
            Lembrete
          </label>
          <select
            id="agenda-reminder"
            value={form.reminderMinutes}
            onChange={(e) =>
              setForm((p) => ({ ...p, reminderMinutes: Number(e.target.value) }))
            }
            className="siscom-input"
          >
            {REMINDER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="agenda-description" className="siscom-field-label">
            Descrição e orientações da atividade
          </label>
          <textarea
            id="agenda-description"
            rows={3}
            maxLength={2000}
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            placeholder="Detalhes de cobertura, uniforme, equipamentos necessários, pauta ou observações..."
            className="siscom-input !min-h-[84px] resize-y"
          />
        </div>

        {/* Google Calendar Sync Option */}
        <div className="rounded-lg border border-white/10 bg-[#0C100F] p-3.5 space-y-2">
          <label
            className={`inline-flex items-start gap-2.5 text-xs select-none ${
              canWriteGoogle ? 'cursor-pointer text-[#E4EAE6]' : 'cursor-not-allowed text-[#697870]'
            }`}
          >
            <input
              type="checkbox"
              disabled={!canWriteGoogle}
              checked={canWriteGoogle && form.syncWithGoogle}
              onChange={(e) => setForm((p) => ({ ...p, syncWithGoogle: e.target.checked }))}
              className="mt-0.5 h-4 w-4 accent-[#C29B56] cursor-pointer disabled:opacity-40"
            />
            <span className="space-y-0.5">
              <span className="block font-medium">
                {editingEvent?.syncStatus === 'synced'
                  ? 'Atualizar evento vinculado no Google Calendar'
                  : 'Sincronizar esta atividade com o Google Calendar'}
              </span>
              <span className="block text-[11px] text-[#98A89F]">
                {canWriteGoogle && selectedCalendar
                  ? `Destino: "${selectedCalendar.summary}"${
                      selectedCalendar.primary ? ' (Calendário principal — pessoal)' : ' (Calendário secundário)'
                    }.`
                  : 'Conecte sua conta do Google Calendar e selecione o calendário secundário da COMSOC para habilitar a sincronização.'}
              </span>
            </span>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-white/8">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="siscom-btn siscom-btn-secondary text-xs"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="siscom-btn siscom-btn-primary text-xs"
          >
            {saving ? <SiscomSpinner className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
            <span>
              {saving
                ? 'Salvando...'
                : editingEvent
                  ? 'Salvar alterações'
                  : 'Cadastrar atividade'}
            </span>
          </button>
        </div>
      </form>
    </SiscomModal>
  );
};

/* ── Mandatory Explicit Confirmation Modal for Google Calendar Mutations ──── */

export interface PendingGoogleConfirmation {
  type: 'update_google' | 'push_google' | 'delete_event';
  eventTitle: string;
  calendarSummary: string;
  isSynced: boolean;
  onConfirm: (alsoDeleteInGoogle: boolean) => Promise<void>;
}

interface GoogleActionConfirmModalProps {
  pending: PendingGoogleConfirmation | null;
  busy: boolean;
  onCancel: () => void;
}

export const GoogleActionConfirmModal: React.FC<GoogleActionConfirmModalProps> = ({
  pending,
  busy,
  onCancel,
}) => {
  const [alsoDeleteInGoogle, setAlsoDeleteInGoogle] = useState(true);

  useEffect(() => {
    setAlsoDeleteInGoogle(true);
  }, [pending]);

  if (!pending) return null;

  const isDelete = pending.type === 'delete_event';
  const title =
    pending.type === 'delete_event'
      ? 'Confirmar exclusão de atividade'
      : pending.type === 'update_google'
        ? 'Confirmar atualização no Google Calendar'
        : 'Confirmar envio ao Google Calendar';

  return (
    <SiscomModal
      open={Boolean(pending)}
      onClose={busy ? undefined : onCancel}
      dismissible={!busy}
      title={title}
      maxWidthClass="max-w-md"
      zIndexClass="z-[60]"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-[#C29B56]/30 bg-[#1B1810] p-3.5 text-xs text-[#F0D69A]">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#E5C17B]" />
          <div className="space-y-1.5">
            {pending.type === 'update_google' && (
              <p>
                Esta ação vai <strong>alterar o evento correspondente no Google Calendar</strong>{' '}
                no calendário <strong>“{pending.calendarSummary}”</strong>.
              </p>
            )}
            {pending.type === 'push_google' && (
              <p>
                Esta ação vai <strong>criar um evento no Google Calendar</strong> dentro do
                calendário <strong>“{pending.calendarSummary}”</strong>.
              </p>
            )}
            {pending.type === 'delete_event' && (
              <p>
                Tem certeza que deseja excluir permanentemente a atividade{' '}
                <strong>“{pending.eventTitle}”</strong> da Agenda do SISCOM?
              </p>
            )}
            <p className="text-[11px] text-[#C6D4CC]">
              Atividade: <span className="font-medium text-[#F4E6C4]">{pending.eventTitle}</span>
            </p>
          </div>
        </div>

        {isDelete && pending.isSynced && (
          <label className="flex items-start gap-2.5 rounded-lg border border-white/10 bg-[#0C100F] p-3 text-xs text-[#E4EAE6] cursor-pointer">
            <input
              type="checkbox"
              checked={alsoDeleteInGoogle}
              onChange={(e) => setAlsoDeleteInGoogle(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-red-500 cursor-pointer"
            />
            <span>
              Excluir também o evento vinculado no Google Calendar (
              <strong>{pending.calendarSummary}</strong>).
            </span>
          </label>
        )}

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-white/8">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="siscom-btn siscom-btn-secondary text-xs"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void pending.onConfirm(alsoDeleteInGoogle)}
            className={`siscom-btn text-xs ${isDelete ? 'siscom-btn-danger' : 'siscom-btn-gold'}`}
          >
            {busy ? (
              <SiscomSpinner className="w-3.5 h-3.5" tone={isDelete ? 'light' : 'gold'} />
            ) : isDelete ? (
              <Trash2 className="w-3.5 h-3.5" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>
              {busy
                ? 'Processando...'
                : isDelete
                  ? 'Confirmar exclusão'
                  : 'Confirmar sincronização'}
            </span>
          </button>
        </div>
      </div>
    </SiscomModal>
  );
};

/* ── Read-Only Detail & Optional Import Modal for Google-Only Events ──────── */

interface GoogleRemoteEventModalProps {
  remote: GoogleCalendarRemoteEvent | null;
  importing: boolean;
  onClose: () => void;
  onImportToSiscom: (remote: GoogleCalendarRemoteEvent) => Promise<void>;
}

export const GoogleRemoteEventModal: React.FC<GoogleRemoteEventModalProps> = ({
  remote,
  importing,
  onClose,
  onImportToSiscom,
}) => {
  if (!remote) return null;

  const start = parseEventDate(remote.startAt, remote.allDay, false);
  const end = parseEventDate(remote.endAt, remote.allDay, true);

  return (
    <SiscomModal
      open={Boolean(remote)}
      onClose={importing ? undefined : onClose}
      dismissible={!importing}
      title="Evento existente no Google Calendar"
      maxWidthClass="max-w-lg"
    >
      <div className="space-y-4 text-xs">
        <div className="space-y-1">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-[#93B7D8]">
            <CalendarIcon className="w-3.5 h-3.5" />
            Somente Google Calendar · {remote.calendarSummary}
          </span>
          <h3 className="font-display text-base font-semibold text-[#F4E6C4]">
            {remote.summary}
          </h3>
        </div>

        <div className="space-y-2 rounded-lg border border-white/8 bg-[#0C100F] p-3.5 text-[#C6D4CC]">
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-[#C8A461] shrink-0" />
            <span>
              {remote.allDay
                ? `Dia inteiro · ${start.toLocaleDateString('pt-BR')}`
                : `${start.toLocaleDateString('pt-BR')} · ${formatTimeShort(start)} às ${formatTimeShort(end)}`}
            </span>
          </div>
          {remote.location && (
            <div className="flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5 text-[#83B499] shrink-0" />
              <span>{remote.location}</span>
            </div>
          )}
          {remote.description && (
            <p className="pt-2 border-t border-white/8 whitespace-pre-wrap text-[#98A89F] leading-relaxed">
              {remote.description}
            </p>
          )}
        </div>

        <p className="text-[11px] text-[#98A89F] leading-relaxed">
          Este evento existe no calendário secundário do Google e ainda não está cadastrado no
          SISCOM. Você pode importá-lo como atividade vinculada (sem duplicar no Google Calendar).
        </p>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/8">
          {remote.htmlLink ? (
            <a
              href={remote.htmlLink}
              target="_blank"
              rel="noreferrer"
              className="siscom-btn siscom-btn-secondary !min-h-[38px] text-xs"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Abrir no Google</span>
            </a>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={importing}
              onClick={onClose}
              className="siscom-btn siscom-btn-secondary !min-h-[38px] text-xs"
            >
              Fechar
            </button>
            <button
              type="button"
              disabled={importing}
              onClick={() => void onImportToSiscom(remote)}
              className="siscom-btn siscom-btn-primary !min-h-[38px] text-xs"
            >
              {importing ? (
                <SiscomSpinner className="w-3.5 h-3.5" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>Importar p/ SISCOM</span>
            </button>
          </div>
        </div>
      </div>
    </SiscomModal>
  );
};

/* ── Compact Category Badge Helper ────────────────────────────────────────── */

export function CategoryDotLabel({ category }: { category: AgendaCategory }) {
  const meta = AGENDA_CATEGORY_MAP[category] || AGENDA_CATEGORY_MAP.outros;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-medium ${meta.chipClass}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dotClass}`} />
      <span>{meta.shortLabel}</span>
    </span>
  );
}

export function ResponsibleInline({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-[#98A89F]">
      <Users className="w-3 h-3 text-[#83B499] shrink-0" />
      <span className="truncate">{text}</span>
    </span>
  );
}
