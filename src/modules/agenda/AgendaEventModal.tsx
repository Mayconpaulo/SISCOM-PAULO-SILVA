import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Bell,
  Calendar as CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link2,
  MapPin,
  Paperclip,
  Plus,
  RefreshCw,
  Repeat,
  Shield,
  Trash2,
  Upload,
  UserPlus,
  Users,
  Video,
  X,
} from 'lucide-react';
import { SiscomAlert, SiscomModal, SiscomSpinner } from '../../shared/ui';
import {
  AGENDA_CATEGORIES,
  AGENDA_CATEGORY_MAP,
  AGENDA_STATUS_LABELS,
  AgendaCategory,
  AgendaEvent,
  AgendaStatus,
  ComsocScope,
  GOOGLE_EVENT_COLORS,
  GoogleContactSuggestion,
  GoogleEventAttachment,
  GoogleEventAttendee,
  GoogleEventReminder,
  GoogleEventTransparency,
  GoogleEventVisibility,
  GoogleSendUpdates,
  RECURRENCE_OPTIONS,
  REMINDER_OPTIONS,
  formatLocalDateKey,
  formatTimeShort,
  getEffectiveComsocScope,
  parseAttachmentsJson,
  parseAttendeesJson,
  parseEventDate,
  parseRemindersJson,
} from './agendaTypes';
import { uploadFileToGoogleDriveForEvent } from './googleCalendarService';

export interface EventFormValues {
  title: string;
  comsocScope: 'comsoc' | 'general';
  category: AgendaCategory;
  status: AgendaStatus;
  colorId: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  recurrenceRule: string;
  location: string;
  createMeet: boolean;
  meetLink: string;
  responsibles: string;
  attendees: GoogleEventAttendee[];
  guestsCanModify: boolean;
  guestsCanInviteOthers: boolean;
  guestsCanSeeOtherGuests: boolean;
  sendUpdates: GoogleSendUpdates;
  description: string;
  attachments: GoogleEventAttachment[];
  reminders: GoogleEventReminder[];
  transparency: GoogleEventTransparency;
  visibility: GoogleEventVisibility;
  syncWithGoogle: boolean;
}

interface AgendaEventModalProps {
  open: boolean;
  editingEvent: AgendaEvent | null;
  defaultDate: Date;
  defaultComsocScope: 'comsoc' | 'general';
  googleConnected: boolean;
  linkedCalendarLabel: string;
  contactSuggestions: GoogleContactSuggestion[];
  locationSuggestions: string[];
  saving: boolean;
  errorMsg: string | null;
  onClose: () => void;
  onSubmit: (values: EventFormValues) => void;
}

interface WizardCardDef {
  id: number;
  short: string;
  title: string;
  subtitle: string;
}

const WIZARD_CARDS: readonly WizardCardDef[] = [
  {
    id: 0,
    short: '1. Essencial',
    title: 'Identificação e Cor',
    subtitle: 'Título, classificação COMSOC, categoria e cor no Google Calendar.',
  },
  {
    id: 1,
    short: '2. Data',
    title: 'Data, Horário e Repetição',
    subtitle: 'Defina início, término, dia inteiro e regras de recorrência.',
  },
  {
    id: 2,
    short: '3. Local/Meet',
    title: 'Localização e Google Meet',
    subtitle: 'Endereço integrado ao Google Maps e sala de videoconferência.',
  },
  {
    id: 3,
    short: '4. Pessoas',
    title: 'Pessoas, Convidados e Equipe',
    subtitle: 'Digite para buscar contatos da conta Google e configure permissões.',
  },
  {
    id: 4,
    short: '5. Anexos',
    title: 'Anexos, Imagens e Descrição',
    subtitle: 'Envie imagens/arquivos para o Google Drive e detalhe a pauta.',
  },
  {
    id: 5,
    short: '6. Avisos',
    title: 'Notificações e Visibilidade',
    subtitle: 'Múltiplos lembretes, disponibilidade (ocupado/livre) e privacidade.',
  },
];

function buildInitialValues(
  editingEvent: AgendaEvent | null,
  defaultDate: Date,
  defaultComsocScope: 'comsoc' | 'general',
  googleConnected: boolean
): EventFormValues {
  if (!editingEvent) {
    const dayKey = formatLocalDateKey(defaultDate);
    return {
      title: '',
      comsocScope: defaultComsocScope,
      category: 'solenidade',
      status: 'agendado',
      colorId: '',
      allDay: false,
      startDate: dayKey,
      startTime: '09:00',
      endDate: dayKey,
      endTime: '10:30',
      recurrenceRule: '',
      location: '',
      createMeet: false,
      meetLink: '',
      responsibles: '',
      attendees: [],
      guestsCanModify: false,
      guestsCanInviteOthers: true,
      guestsCanSeeOtherGuests: true,
      sendUpdates: 'all',
      description: '',
      attachments: [],
      reminders: [{ method: 'popup', minutes: 30 }],
      transparency: 'opaque',
      visibility: 'default',
      syncWithGoogle: true,
    };
  }

  const start = parseEventDate(editingEvent.startAt, editingEvent.allDay, false);
  const end = parseEventDate(editingEvent.endAt, editingEvent.allDay, true);
  const scope = getEffectiveComsocScope(editingEvent);

  return {
    title: editingEvent.title,
    comsocScope: scope === 'general' ? 'general' : 'comsoc',
    category: editingEvent.category,
    status: editingEvent.status,
    colorId: editingEvent.colorId || '',
    allDay: editingEvent.allDay,
    startDate: editingEvent.allDay
      ? editingEvent.startAt.slice(0, 10)
      : formatLocalDateKey(start),
    startTime: editingEvent.allDay ? '09:00' : formatTimeShort(start),
    endDate: editingEvent.allDay
      ? editingEvent.endAt.slice(0, 10)
      : formatLocalDateKey(end),
    endTime: editingEvent.allDay ? '10:00' : formatTimeShort(end),
    recurrenceRule: editingEvent.recurrenceRule || '',
    location: editingEvent.location,
    createMeet: Boolean(editingEvent.createMeet || editingEvent.meetLink),
    meetLink: editingEvent.meetLink || '',
    responsibles: editingEvent.responsibles,
    attendees: parseAttendeesJson(editingEvent.attendeesJson),
    guestsCanModify: Boolean(editingEvent.guestsCanModify),
    guestsCanInviteOthers: editingEvent.guestsCanInviteOthers !== false,
    guestsCanSeeOtherGuests: editingEvent.guestsCanSeeOtherGuests !== false,
    sendUpdates: editingEvent.sendUpdates === 'all' ? 'all' : 'none',
    description: editingEvent.description,
    attachments: parseAttachmentsJson(editingEvent.attachmentsJson),
    reminders: parseRemindersJson(editingEvent.remindersJson, editingEvent.reminderMinutes),
    transparency: editingEvent.transparency === 'transparent' ? 'transparent' : 'opaque',
    visibility:
      editingEvent.visibility === 'public' || editingEvent.visibility === 'private'
        ? editingEvent.visibility
        : 'default',
    syncWithGoogle:
      editingEvent.syncStatus === 'synced' ||
      Boolean(editingEvent.pendingGoogleSync) ||
      googleConnected,
  };
}

export const AgendaEventModal: React.FC<AgendaEventModalProps> = ({
  open,
  editingEvent,
  defaultDate,
  defaultComsocScope,
  googleConnected,
  linkedCalendarLabel,
  contactSuggestions,
  locationSuggestions,
  saving,
  errorMsg,
  onClose,
  onSubmit,
}) => {
  const [form, setForm] = useState<EventFormValues>(() =>
    buildInitialValues(editingEvent, defaultDate, defaultComsocScope, googleConnected)
  );
  const [step, setStep] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);

  // People autocomplete input state
  const [guestQuery, setGuestQuery] = useState('');
  const [showGuestDropdown, setShowGuestDropdown] = useState(false);

  // Location suggestions dropdown
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);

  // Attachments upload & manual link state
  const [uploadingDrive, setUploadingDrive] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [manualLinkTitle, setManualLinkTitle] = useState('');
  const [manualLinkUrl, setManualLinkUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setForm(buildInitialValues(editingEvent, defaultDate, defaultComsocScope, googleConnected));
      setStep(0);
      setValidationError(null);
      setGuestQuery('');
      setUploadError(null);
      setManualLinkTitle('');
      setManualLinkUrl('');
    }
  }, [open, editingEvent, defaultDate, defaultComsocScope, googleConnected]);

  const filteredContacts = useMemo(() => {
    const existingEmails = new Set(form.attendees.map((a) => a.email.toLowerCase()));
    const q = guestQuery.trim().toLowerCase();
    return contactSuggestions
      .filter((c) => !existingEmails.has(c.email.toLowerCase()))
      .filter((c) => {
        if (!q) return true;
        return (
          c.displayName.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
        );
      })
      .slice(0, 8);
  }, [contactSuggestions, form.attendees, guestQuery]);

  const filteredLocations = useMemo(() => {
    const q = form.location.trim().toLowerCase();
    return locationSuggestions
      .filter((loc) => (!q ? true : loc.toLowerCase().includes(q)))
      .filter((loc) => loc.toLowerCase() !== q)
      .slice(0, 6);
  }, [locationSuggestions, form.location]);

  const addAttendee = (emailRaw: string, displayName?: string) => {
    const email = emailRaw.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    if (form.attendees.some((a) => a.email.toLowerCase() === email)) {
      setGuestQuery('');
      return;
    }
    setForm((p) => ({
      ...p,
      attendees: [...p.attendees, { email, displayName: displayName || undefined, optional: false }],
    }));
    setGuestQuery('');
    setShowGuestDropdown(false);
  };

  const removeAttendee = (email: string) => {
    setForm((p) => ({
      ...p,
      attendees: p.attendees.filter((a) => a.email !== email),
    }));
  };

  const toggleAttendeeOptional = (email: string) => {
    setForm((p) => ({
      ...p,
      attendees: p.attendees.map((a) =>
        a.email === email ? { ...a, optional: !a.optional } : a
      ),
    }));
  };

  const handleDriveFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploadingDrive(true);
    try {
      const uploaded: GoogleEventAttachment[] = [];
      for (const file of Array.from(files)) {
        const att = await uploadFileToGoogleDriveForEvent(file);
        uploaded.push(att);
      }
      setForm((p) => ({
        ...p,
        attachments: [...p.attachments, ...uploaded],
      }));
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Falha ao enviar arquivo para o Google Drive.'
      );
    } finally {
      setUploadingDrive(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleAddManualLink = () => {
    const url = manualLinkUrl.trim();
    if (!url) return;
    const normalizedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const title = manualLinkTitle.trim() || 'Anexo / Documento';
    setForm((p) => ({
      ...p,
      attachments: [...p.attachments, { title, fileUrl: normalizedUrl }],
    }));
    setManualLinkTitle('');
    setManualLinkUrl('');
  };

  const addReminder = () => {
    if (form.reminders.length >= 5) return;
    setForm((p) => ({
      ...p,
      reminders: [...p.reminders, { method: 'popup', minutes: 15 }],
    }));
  };

  const updateReminder = (index: number, patch: Partial<GoogleEventReminder>) => {
    setForm((p) => ({
      ...p,
      reminders: p.reminders.map((r, idx) => (idx === index ? { ...r, ...patch } : r)),
    }));
  };

  const removeReminder = (index: number) => {
    setForm((p) => ({
      ...p,
      reminders: p.reminders.filter((_, idx) => idx !== index),
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (!form.title.trim()) {
      setStep(0);
      setValidationError('Informe o título da atividade no Card 1.');
      return;
    }

    if (!form.startDate || !form.endDate) {
      setStep(1);
      setValidationError('Informe as datas de início e término no Card 2.');
      return;
    }

    if (form.allDay) {
      if (form.endDate < form.startDate) {
        setStep(1);
        setValidationError('A data de término não pode ser anterior à data de início.');
        return;
      }
    } else {
      const startIso = new Date(`${form.startDate}T${form.startTime}:00`);
      const endIso = new Date(`${form.endDate}T${form.endTime}:00`);
      if (Number.isNaN(startIso.getTime()) || Number.isNaN(endIso.getTime())) {
        setStep(1);
        setValidationError('Horário informado é inválido.');
        return;
      }
      if (endIso <= startIso) {
        setStep(1);
        setValidationError('O horário de término deve ser posterior ao início.');
        return;
      }
    }

    onSubmit(form);
  };

  const currentCard = WIZARD_CARDS[step];

  // Visual filled indicator per card
  const isCardFilled = (idx: number): boolean => {
    switch (idx) {
      case 0:
        return Boolean(form.title.trim());
      case 1:
        return Boolean(form.startDate && form.endDate);
      case 2:
        return Boolean(form.location.trim() || form.createMeet || form.meetLink);
      case 3:
        return Boolean(form.attendees.length > 0 || form.responsibles.trim());
      case 4:
        return Boolean(form.attachments.length > 0 || form.description.trim());
      case 5:
        return form.reminders.length > 0;
      default:
        return false;
    }
  };

  return (
    <SiscomModal
      open={open}
      onClose={saving ? undefined : onClose}
      dismissible={!saving}
      title={editingEvent ? 'Editar atividade — Cards completos' : 'Nova atividade — Cards completos'}
      maxWidthClass="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {(validationError || errorMsg) && (
          <SiscomAlert tone="error" onDismiss={() => setValidationError(null)}>
            {validationError || errorMsg}
          </SiscomAlert>
        )}

        {/* Interactive Card Step Selector */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
          {WIZARD_CARDS.map((card, idx) => {
            const active = idx === step;
            const filled = isCardFilled(idx);
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => setStep(idx)}
                className={`min-h-[38px] px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-all flex items-center justify-center gap-1 cursor-pointer ${
                  active
                    ? 'bg-[#2D5A43]/85 backdrop-blur-md border-[#83B499]/50 text-white shadow-sm'
                    : filled
                      ? 'bg-[#15211B]/55 backdrop-blur-md border-[#C9A961]/34 text-[#F4E6C4] hover:border-[#C9A961]/60'
                      : 'bg-black/30 backdrop-blur-md border-white/12 text-[#B8B3A6] hover:text-[#E8E4D8]'
                }`}
              >
                <span className="truncate">{card.short}</span>
                {filled && !active && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#E5C17B] shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* Active Card Surface */}
        <div className="rounded-2xl siscom-liquid-subcard !border-[#C9A961]/28 p-4 sm:p-5 min-h-[300px] flex flex-col justify-between">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.16 }}
              className="space-y-4"
            >
              <div className="border-b border-white/8 pb-2.5">
                <p className="text-[10px] font-mono uppercase tracking-wider text-[#C8A461]">
                  Card {step + 1} de {WIZARD_CARDS.length}
                </p>
                <h3 className="font-display text-sm sm:text-base font-semibold text-[#F4E6C4]">
                  {currentCard.title}
                </h3>
                <p className="text-[11px] text-[#98A89F]">{currentCard.subtitle}</p>
              </div>

              {/* CARD 1: Identificação, Destino & Cor */}
              {step === 0 && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor="agenda-title" className="siscom-field-label">
                      Título do evento *
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

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <label htmlFor="agenda-scope" className="siscom-field-label">
                        Calendário no SISCOM
                      </label>
                      <select
                        id="agenda-scope"
                        value={form.comsocScope}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            comsocScope: e.target.value as 'comsoc' | 'general',
                          }))
                        }
                        className="siscom-input text-xs"
                      >
                        <option value="comsoc">Calendário COMSOC (+ Geral)</option>
                        <option value="general">Somente Calendário Geral</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="agenda-category" className="siscom-field-label">
                        Categoria COMSOC
                      </label>
                      <select
                        id="agenda-category"
                        value={form.category}
                        onChange={(e) =>
                          setForm((p) => ({ ...p, category: e.target.value as AgendaCategory }))
                        }
                        className="siscom-input text-xs"
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
                        className="siscom-input text-xs"
                      >
                        {(['agendado', 'realizado', 'cancelado'] as AgendaStatus[]).map((st) => (
                          <option key={st} value={st}>
                            {AGENDA_STATUS_LABELS[st]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Google Calendar Color Swatches */}
                  <div className="space-y-2">
                    <span className="siscom-field-label">Cor do evento no Google Calendar</span>
                    <div className="flex flex-wrap items-center gap-2">
                      {GOOGLE_EVENT_COLORS.map((color) => {
                        const selected = form.colorId === color.id;
                        return (
                          <button
                            key={color.id || 'default'}
                            type="button"
                            title={color.label}
                            onClick={() => setForm((p) => ({ ...p, colorId: color.id }))}
                            className={`w-7 h-7 rounded-full flex items-center justify-center transition-transform cursor-pointer ${
                              selected
                                ? 'ring-2 ring-white ring-offset-2 ring-offset-[#0E1311] scale-110'
                                : 'opacity-80 hover:opacity-100 hover:scale-105'
                            }`}
                            style={{ backgroundColor: color.hex }}
                          >
                            {selected && <Check className="w-3.5 h-3.5 text-white drop-shadow" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* CARD 2: Data, Horário e Recorrência */}
              {step === 1 && (
                <div className="space-y-4">
                  <label className="inline-flex items-center gap-2.5 text-xs text-[#E4EAE6] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form.allDay}
                      onChange={(e) => setForm((p) => ({ ...p, allDay: e.target.checked }))}
                      className="h-4 w-4 accent-[#2D5A43] cursor-pointer"
                    />
                    <span>Evento de dia inteiro</span>
                  </label>

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

                  <div className="space-y-1.5">
                    <label htmlFor="agenda-recurrence" className="siscom-field-label inline-flex items-center gap-1.5">
                      <Repeat className="w-3.5 h-3.5 text-[#C8A461]" />
                      <span>Repetição (Recorrência no Google Calendar)</span>
                    </label>
                    <select
                      id="agenda-recurrence"
                      value={form.recurrenceRule}
                      onChange={(e) => setForm((p) => ({ ...p, recurrenceRule: e.target.value }))}
                      className="siscom-input text-xs"
                    >
                      {RECURRENCE_OPTIONS.map((opt) => (
                        <option key={opt.value || 'none'} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* CARD 3: Localização & Google Meet */}
              {step === 2 && (
                <div className="space-y-4">
                  <div className="space-y-1.5 relative">
                    <label htmlFor="agenda-location" className="siscom-field-label inline-flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-[#C8A461]" />
                      <span>Localização (sincronizada com o Google Calendar e Maps)</span>
                    </label>
                    <input
                      id="agenda-location"
                      type="text"
                      maxLength={180}
                      value={form.location}
                      onFocus={() => setShowLocationSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowLocationSuggestions(false), 160)}
                      onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
                      placeholder="Ex: 1º BI Mec (Es) — Pátio de Formaturas / Endereço completo"
                      className="siscom-input"
                    />

                    {showLocationSuggestions && filteredLocations.length > 0 && (
                      <div className="metal-elevated absolute z-30 left-0 right-0 top-full mt-1 rounded-xl overflow-hidden">
                        <p className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-[#98A89F] border-b border-white/8">
                          Locais usados na Agenda
                        </p>
                        {filteredLocations.map((loc) => (
                          <button
                            key={loc}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setForm((p) => ({ ...p, location: loc }));
                              setShowLocationSuggestions(false);
                            }}
                            className="w-full px-3 py-2 text-left text-xs text-[#E4EAE6] hover:bg-[#2D5A43]/30 flex items-center gap-2 cursor-pointer"
                          >
                            <MapPin className="w-3.5 h-3.5 text-[#83B499] shrink-0" />
                            <span className="truncate">{loc}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {form.location.trim() && (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(form.location.trim())}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-[#E5C17B] hover:underline pt-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Conferir endereço no Google Maps</span>
                      </a>
                    )}
                  </div>

                  {/* Google Meet */}
                  <div className="siscom-liquid-subcard rounded-xl p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <Video className="w-4 h-4 text-[#93B7D8] shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-semibold text-[#F4E6C4]">
                            Videoconferência do Google Meet
                          </p>
                          <p className="text-[11px] text-[#98A89F]">
                            Gera automaticamente uma sala oficial do Google Meet ao sincronizar com o Google Calendar.
                          </p>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={form.createMeet}
                        onChange={(e) => setForm((p) => ({ ...p, createMeet: e.target.checked }))}
                        aria-label="Adicionar Google Meet"
                        className="h-4 w-4 accent-[#2D5A43] mt-0.5 cursor-pointer"
                      />
                    </div>

                    {form.meetLink && (
                      <div className="pt-2 border-t border-white/8 flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono text-[#93B7D8] truncate">{form.meetLink}</span>
                        <a
                          href={form.meetLink}
                          target="_blank"
                          rel="noreferrer"
                          className="siscom-btn siscom-btn-secondary !min-h-[30px] !px-2.5 text-[11px] shrink-0"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>Abrir Meet</span>
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* CARD 4: Pessoas & Convidados com Autocomplete Google */}
              {step === 3 && (
                <div className="space-y-4">
                  <div className="space-y-1.5 relative">
                    <label htmlFor="agenda-guest-search" className="siscom-field-label inline-flex items-center gap-1.5">
                      <UserPlus className="w-3.5 h-3.5 text-[#E5C17B]" />
                      <span>Adicionar convidados (sugestões da conta Google)</span>
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="agenda-guest-search"
                        type="text"
                        value={guestQuery}
                        onFocus={() => setShowGuestDropdown(true)}
                        onBlur={() => setTimeout(() => setShowGuestDropdown(false), 180)}
                        onChange={(e) => {
                          setGuestQuery(e.target.value);
                          setShowGuestDropdown(true);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && guestQuery.includes('@')) {
                            e.preventDefault();
                            addAttendee(guestQuery);
                          }
                        }}
                        placeholder="Digite nome ou e-mail para buscar nos contatos do Google..."
                        className="siscom-input text-xs"
                      />
                      <button
                        type="button"
                        disabled={!guestQuery.includes('@')}
                        onClick={() => addAttendee(guestQuery)}
                        className="siscom-btn siscom-btn-gold !min-h-[42px] !px-3 text-xs shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Adicionar</span>
                      </button>
                    </div>

                    {/* Autocomplete dropdown */}
                    {showGuestDropdown && (filteredContacts.length > 0 || guestQuery.includes('@')) && (
                      <div className="metal-elevated absolute z-30 left-0 right-0 top-full mt-1 rounded-xl overflow-hidden max-h-52 overflow-y-auto">
                        {filteredContacts.map((c) => (
                          <button
                            key={c.email}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              addAttendee(c.email, c.displayName);
                            }}
                            className="w-full px-3 py-2 text-left hover:bg-[#2D5A43]/35 flex items-center justify-between gap-2 border-b border-white/[0.04] last:border-0 cursor-pointer"
                          >
                            <div className="min-w-0">
                              <span className="block text-xs font-medium text-[#F4E6C4] truncate">
                                {c.displayName}
                              </span>
                              <span className="block text-[11px] font-mono text-[#98A89F] truncate">
                                {c.email}
                              </span>
                            </div>
                            <Plus className="w-3.5 h-3.5 text-[#83B499] shrink-0" />
                          </button>
                        ))}
                        {guestQuery.includes('@') &&
                          !filteredContacts.some(
                            (c) => c.email.toLowerCase() === guestQuery.trim().toLowerCase()
                          ) && (
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                addAttendee(guestQuery);
                              }}
                              className="w-full px-3 py-2 text-left text-xs text-[#E5C17B] hover:bg-[#2D5A43]/30 flex items-center gap-2 cursor-pointer"
                            >
                              <UserPlus className="w-3.5 h-3.5" />
                              <span>Convidar “{guestQuery.trim()}”</span>
                            </button>
                          )}
                      </div>
                    )}

                    <p className="text-[11px] text-[#697870]">
                      {contactSuggestions.length > 0
                        ? `${contactSuggestions.length} contato(s) sincronizado(s) da conta institucional disponíveis para sugestão.`
                        : 'Assim que o administrador sincronizar com a conta Google, os contatos aparecerão aqui automaticamente.'}
                    </p>
                  </div>

                  {/* Added Attendees Chips */}
                  {form.attendees.length > 0 && (
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {form.attendees.map((att) => (
                        <div
                          key={att.email}
                          className="siscom-liquid-subcard flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <span className="block font-medium text-[#E4EAE6] truncate">
                              {att.displayName || att.email}
                            </span>
                            {att.displayName && att.displayName !== att.email && (
                              <span className="block text-[10px] font-mono text-[#98A89F] truncate">
                                {att.email}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => toggleAttendeeOptional(att.email)}
                              className={`px-2 py-0.5 rounded text-[10px] border cursor-pointer ${
                                att.optional
                                  ? 'border-[#C29B56]/40 bg-[#C29B56]/15 text-[#F0D69A]'
                                  : 'border-white/12 text-[#98A89F]'
                              }`}
                            >
                              {att.optional ? 'Opcional' : 'Obrigatório'}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeAttendee(att.email)}
                              aria-label={`Remover ${att.email}`}
                              className="p-1 text-[#98A89F] hover:text-red-300 cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Guest Permissions (exact parity with Google Calendar) */}
                  <div className="siscom-liquid-subcard grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-xl p-3 text-xs text-[#C6D4CC]">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.guestsCanModify}
                        onChange={(e) =>
                          setForm((p) => ({ ...p, guestsCanModify: e.target.checked }))
                        }
                        className="h-3.5 w-3.5 accent-[#2D5A43]"
                      />
                      <span>Convidados podem editar o evento</span>
                    </label>
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.guestsCanInviteOthers}
                        onChange={(e) =>
                          setForm((p) => ({ ...p, guestsCanInviteOthers: e.target.checked }))
                        }
                        className="h-3.5 w-3.5 accent-[#2D5A43]"
                      />
                      <span>Podem convidar outras pessoas</span>
                    </label>
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.guestsCanSeeOtherGuests}
                        onChange={(e) =>
                          setForm((p) => ({ ...p, guestsCanSeeOtherGuests: e.target.checked }))
                        }
                        className="h-3.5 w-3.5 accent-[#2D5A43]"
                      />
                      <span>Podem ver a lista de convidados</span>
                    </label>
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.sendUpdates === 'all'}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            sendUpdates: e.target.checked ? 'all' : 'none',
                          }))
                        }
                        className="h-3.5 w-3.5 accent-[#C29B56]"
                      />
                      <span>Enviar convite por e-mail</span>
                    </label>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="agenda-responsibles" className="siscom-field-label">
                      Responsáveis internos da COMSOC
                    </label>
                    <input
                      id="agenda-responsibles"
                      type="text"
                      maxLength={240}
                      value={form.responsibles}
                      onChange={(e) => setForm((p) => ({ ...p, responsibles: e.target.value }))}
                      placeholder="Ex: 3º Sgt Silva, Cb Oliveira (Foto/Vídeo)"
                      className="siscom-input text-xs"
                    />
                  </div>
                </div>
              )}

              {/* CARD 5: Anexos, Imagens & Descrição */}
              {step === 4 && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor="agenda-description" className="siscom-field-label">
                      Descrição, pauta e orientações
                    </label>
                    <textarea
                      id="agenda-description"
                      rows={3}
                      maxLength={2000}
                      value={form.description}
                      onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                      placeholder="Detalhes da cobertura, uniforme, equipamentos, horários de chegada..."
                      className="siscom-input !min-h-[82px] text-xs resize-y"
                    />
                  </div>

                  {/* Attachments & Images */}
                  <div className="siscom-liquid-subcard space-y-2.5 rounded-xl p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#F4E6C4] inline-flex items-center gap-1.5">
                        <Paperclip className="w-3.5 h-3.5 text-[#E5C17B]" />
                        Anexos e Imagens (Google Drive + Calendar)
                      </span>

                      <div>
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                          onChange={(e) => void handleDriveFileSelected(e)}
                          className="hidden"
                        />
                        <button
                          type="button"
                          disabled={!googleConnected || uploadingDrive}
                          onClick={() => fileInputRef.current?.click()}
                          className="siscom-btn siscom-btn-gold !min-h-[34px] !px-3 text-[11px]"
                        >
                          {uploadingDrive ? (
                            <SiscomSpinner className="w-3.5 h-3.5" tone="gold" />
                          ) : (
                            <Upload className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {uploadingDrive
                              ? 'Enviando ao Drive...'
                              : 'Enviar imagem / arquivo ao Drive'}
                          </span>
                        </button>
                      </div>
                    </div>

                    {!googleConnected && (
                      <p className="text-[11px] text-[#98A89F]">
                        Para enviar arquivos direto ao Google Drive, a sessão Google do administrador precisa estar ativa. Você ainda pode anexar links do Google Drive abaixo.
                      </p>
                    )}

                    {uploadError && (
                      <SiscomAlert tone="error" onDismiss={() => setUploadError(null)}>
                        {uploadError}
                      </SiscomAlert>
                    )}

                    {/* Manual Drive/Document Link */}
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.4fr_auto] gap-2">
                      <input
                        type="text"
                        value={manualLinkTitle}
                        onChange={(e) => setManualLinkTitle(e.target.value)}
                        placeholder="Nome do anexo"
                        className="siscom-input !min-h-[36px] text-xs"
                      />
                      <input
                        type="url"
                        value={manualLinkUrl}
                        onChange={(e) => setManualLinkUrl(e.target.value)}
                        placeholder="Link do Google Drive ou documento..."
                        className="siscom-input !min-h-[36px] text-xs"
                      />
                      <button
                        type="button"
                        disabled={!manualLinkUrl.trim()}
                        onClick={handleAddManualLink}
                        className="siscom-btn siscom-btn-secondary !min-h-[36px] !px-3 text-xs"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        <span>Anexar link</span>
                      </button>
                    </div>

                    {/* Attachment Cards */}
                    {form.attachments.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        {form.attachments.map((att, idx) => {
                          const isImg = att.mimeType?.startsWith('image/');
                          return (
                            <div
                              key={`${att.fileUrl}-${idx}`}
                              className="flex items-center justify-between gap-2 rounded-lg border border-white/12 bg-white/[0.05] px-2.5 py-2 text-xs"
                            >
                              <a
                                href={att.fileUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-2 min-w-0 text-[#E4EAE6] hover:text-[#F4E6C4]"
                              >
                                {isImg ? (
                                  <ImageIcon className="w-4 h-4 text-[#E5C17B] shrink-0" />
                                ) : (
                                  <FileText className="w-4 h-4 text-[#83B499] shrink-0" />
                                )}
                                <span className="truncate">{att.title}</span>
                              </a>
                              <button
                                type="button"
                                onClick={() =>
                                  setForm((p) => ({
                                    ...p,
                                    attachments: p.attachments.filter((_, i) => i !== idx),
                                  }))
                                }
                                aria-label="Remover anexo"
                                className="p-1 text-[#98A89F] hover:text-red-300 cursor-pointer shrink-0"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* CARD 6: Notificações, Disponibilidade, Visibilidade & Sync */}
              {step === 5 && (
                <div className="space-y-4">
                  {/* Multiple Google Reminders */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="siscom-field-label inline-flex items-center gap-1.5">
                        <Bell className="w-3.5 h-3.5 text-[#E5C17B]" />
                        Notificações / Lembretes (até 5)
                      </span>
                      <button
                        type="button"
                        disabled={form.reminders.length >= 5}
                        onClick={addReminder}
                        className="text-[11px] text-[#E5C17B] hover:underline disabled:opacity-40 cursor-pointer"
                      >
                        + Adicionar notificação
                      </button>
                    </div>

                    {form.reminders.length === 0 ? (
                      <p className="text-[11px] text-[#697870]">
                        Nenhuma notificação personalizada (usará o padrão do Google Calendar).
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {form.reminders.map((rem, idx) => (
                          <div key={idx} className="grid grid-cols-[130px_1fr_auto] gap-2">
                            <select
                              value={rem.method}
                              onChange={(e) =>
                                updateReminder(idx, {
                                  method: e.target.value as 'popup' | 'email',
                                })
                              }
                              className="siscom-input !min-h-[36px] text-xs"
                            >
                              <option value="popup">Notificação</option>
                              <option value="email">E-mail</option>
                            </select>
                            <select
                              value={rem.minutes}
                              onChange={(e) =>
                                updateReminder(idx, { minutes: Number(e.target.value) })
                              }
                              className="siscom-input !min-h-[36px] text-xs"
                            >
                              {REMINDER_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => removeReminder(idx)}
                              aria-label="Remover notificação"
                              className="siscom-btn siscom-btn-secondary !min-h-[36px] !px-2.5 text-xs"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Transparency & Visibility */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label htmlFor="agenda-transparency" className="siscom-field-label">
                        Disponibilidade no Google
                      </label>
                      <select
                        id="agenda-transparency"
                        value={form.transparency}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            transparency: e.target.value as GoogleEventTransparency,
                          }))
                        }
                        className="siscom-input !min-h-[38px] text-xs"
                      >
                        <option value="opaque">Ocupado</option>
                        <option value="transparent">Disponível</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="agenda-visibility" className="siscom-field-label inline-flex items-center gap-1">
                        <Shield className="w-3.5 h-3.5 text-[#83B499]" />
                        <span>Visibilidade</span>
                      </label>
                      <select
                        id="agenda-visibility"
                        value={form.visibility}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            visibility: e.target.value as GoogleEventVisibility,
                          }))
                        }
                        className="siscom-input !min-h-[38px] text-xs"
                      >
                        <option value="default">Visibilidade padrão</option>
                        <option value="public">Público</option>
                        <option value="private">Particular</option>
                      </select>
                    </div>
                  </div>

                  {/* Google Sync Status */}
                  <div className="siscom-liquid-subcard rounded-xl !border-[#C29B56]/30 p-3.5">
                    <label className="inline-flex items-start gap-2.5 text-xs text-[#E4EAE6] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.syncWithGoogle}
                        onChange={(e) =>
                          setForm((p) => ({ ...p, syncWithGoogle: e.target.checked }))
                        }
                        className="mt-0.5 h-4 w-4 accent-[#C29B56] cursor-pointer"
                      />
                      <span className="space-y-0.5">
                        <span className="block font-medium">
                          Sincronizar com o calendário institucional ({linkedCalendarLabel})
                        </span>
                        <span className="block text-[11px] text-[#98A89F]">
                          {googleConnected
                            ? 'Será enviado ao Google Calendar imediatamente após sua confirmação.'
                            : 'Será salvo agora no SISCOM e enviado ao Google Calendar assim que o administrador sincronizar.'}
                        </span>
                      </span>
                    </label>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Card Deck Navigation Footer */}
          <div className="flex items-center justify-between gap-2 pt-4 mt-4 border-t border-white/8">
            <button
              type="button"
              disabled={step === 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="siscom-btn siscom-btn-secondary !min-h-[36px] !px-3 text-xs"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Anterior</span>
            </button>

            <span className="text-[11px] font-mono text-[#98A89F]">
              {step + 1} / {WIZARD_CARDS.length}
            </span>

            {step < WIZARD_CARDS.length - 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(WIZARD_CARDS.length - 1, s + 1))}
                className="siscom-btn siscom-btn-gold !min-h-[36px] !px-3 text-xs"
              >
                <span>Próximo card</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <span className="text-[11px] text-[#83B499] font-medium">Último card ✓</span>
            )}
          </div>
        </div>

        {/* Final Submit Bar (always reachable from any card!) */}
        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
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
  type: 'update_google' | 'push_google' | 'delete_event' | 'push_queue';
  eventTitle: string;
  calendarSummary: string;
  isSynced: boolean;
  queueCount?: number;
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
      : pending.type === 'push_queue'
        ? 'Confirmar envio da fila ao Google Calendar'
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
        <div className="flex items-start gap-3 rounded-lg border border-[#C29B56]/35 bg-[#241E12]/62 backdrop-blur-md p-3.5 text-xs text-[#F0D69A]">
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
            {pending.type === 'push_queue' && (
              <p>
                Esta ação vai enviar/atualizar{' '}
                <strong>{pending.queueCount || 1} atividade(s) pendente(s)</strong> no calendário{' '}
                <strong>“{pending.calendarSummary}”</strong>.
              </p>
            )}
            {pending.type === 'delete_event' && (
              <p>
                Tem certeza que deseja excluir permanentemente a atividade{' '}
                <strong>“{pending.eventTitle}”</strong> da Agenda do SISCOM?
              </p>
            )}
            <p className="text-[11px] text-[#C6D4CC]">
              Referência:{' '}
              <span className="font-medium text-[#F4E6C4]">{pending.eventTitle}</span>
            </p>
          </div>
        </div>

        {isDelete && pending.isSynced && (
          <label className="siscom-liquid-subcard flex items-start gap-2.5 rounded-lg p-3 text-xs text-[#E4EAE6] cursor-pointer">
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

/* ── Compact Badge Helpers ────────────────────────────────────────────────── */

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

export function ScopeBadge({ scope }: { scope: ComsocScope }) {
  if (scope === 'comsoc') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#83B499]/35 bg-[#2D5A43]/25 text-[10px] font-mono text-[#A7D3BA]">
        <CalendarIcon className="w-3 h-3" />
        COMSOC
      </span>
    );
  }
  if (scope === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#E5C17B]/45 bg-[#2B2210] text-[10px] font-mono text-[#F4E6C4]">
        <Clock className="w-3 h-3" />
        Pendente triagem
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-white/12 bg-white/[0.03] text-[10px] font-mono text-[#98A89F]">
      Geral
    </span>
  );
}
