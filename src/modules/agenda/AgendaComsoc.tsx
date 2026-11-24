import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellRing,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Cloud,
  CloudOff,
  CloudUpload,
  Copy,
  ExternalLink,
  FileText,
  History,
  Layers,
  Link2,
  Lock,
  MapPin,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Repeat,
  RotateCcw,
  Search,
  Settings2,
  ShieldAlert,
  Trash2,
  Unlink,
  Users,
  Video,
} from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import {
  SiscomAlert,
  SiscomSegmentedTabs,
  SiscomSpinner,
} from '../../shared/ui';
import { WorkspaceSplitLayout } from '../../shared/WorkspaceSplitLayout';
import {
  AgendaEventModal,
  CategoryDotLabel,
  EventFormValues,
  GoogleActionConfirmModal,
  PendingGoogleConfirmation,
  ResponsibleInline,
  ScopeBadge,
} from './AgendaEventModal';
import { AgendaTriageDeck } from './AgendaTriageDeck';
import {
  AgendaEventInput,
  createAgendaEvent,
  deleteAgendaEvent,
  mirrorGoogleEventsToFirestore,
  recordAgendaAudit,
  saveSelectedGoogleCalendarConfig,
  subscribeAgendaAudit,
  subscribeAgendaEvents,
  subscribeAgendaGoogleConfig,
  updateAgendaEvent,
} from './agendaStore';
import {
  AGENDA_CATEGORIES,
  AGENDA_CATEGORY_MAP,
  AGENDA_STATUS_LABELS,
  AgendaAuditLog,
  AgendaCategory,
  AgendaEvent,
  AgendaIntegrationConfig,
  DEFAULT_INSTITUTIONAL_CALENDAR_EMAIL,
  GoogleCalendarListItem,
  GoogleContactSuggestion,
  formatLocalDateKey,
  formatTimeShort,
  getEffectiveComsocScope,
  getGoogleColorHex,
  isTodayOrFutureEvent,
  parseAttachmentsJson,
  parseAttendeesJson,
  parseContactsCacheJson,
  parseEventDate,
  parseRemindersJson,
} from './agendaTypes';
import {
  CalendarUnauthorizedDomainError,
  GOOGLE_CALENDAR_FIREBASE_PROJECT_ID,
  GoogleCalendarSession,
  connectGoogleCalendar,
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  disconnectGoogleCalendarSession,
  fetchGoogleCalendarEvents,
  fetchGoogleContacts,
  listGoogleCalendars,
  subscribeGoogleCalendarSession,
  updateGoogleCalendarEvent,
} from './googleCalendarService';

type AgendaViewMode = 'month' | 'week' | 'day' | 'history';
type CalendarScopeView = 'comsoc' | 'general';

const VIEW_OPTIONS: readonly { value: AgendaViewMode; label: string }[] = [
  { value: 'month', label: 'Mensal' },
  { value: 'week', label: 'Semanal' },
  { value: 'day', label: 'Diária' },
  { value: 'history', label: 'Histórico' },
];

const WEEKDAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function buildMonthGridDays(anchor: Date): Date[] {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const startGrid = startOfWeek(firstOfMonth);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(startGrid);
    d.setDate(startGrid.getDate() + i);
    days.push(d);
  }
  return days;
}

function buildWeekDays(anchor: Date): Date[] {
  const start = startOfWeek(anchor);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

function eventOverlapsDay(ev: AgendaEvent, day: Date): boolean {
  const dStart = startOfDay(day).getTime();
  const dEnd = endOfDay(day).getTime();
  const evStart = parseEventDate(ev.startAt, ev.allDay, false).getTime();
  const evEnd = parseEventDate(ev.endAt, ev.allDay, true).getTime();
  return evStart <= dEnd && evEnd >= dStart;
}

function formatMonthTitle(date: Date): string {
  const raw = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function formatFullDayTitle(date: Date): string {
  const raw = date.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function formatSyncTimestamp(iso?: string): string {
  if (!iso) return 'Ainda não sincronizado';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return 'Sincronizado';
  return dt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formValuesToIsoRange(values: EventFormValues): { startAt: string; endAt: string } {
  if (values.allDay) {
    return {
      startAt: values.startDate,
      endAt: values.endDate,
    };
  }
  return {
    startAt: new Date(`${values.startDate}T${values.startTime}:00`).toISOString(),
    endAt: new Date(`${values.endDate}T${values.endTime}:00`).toISOString(),
  };
}

function formValuesToEventInput(values: EventFormValues): AgendaEventInput {
  const { startAt, endAt } = formValuesToIsoRange(values);
  const primaryReminder = values.reminders[0]?.minutes ?? 0;

  return {
    title: values.title,
    comsocScope: values.comsocScope,
    category: values.category,
    status: values.status,
    colorId: values.colorId,
    startAt,
    endAt,
    allDay: values.allDay,
    recurrenceRule: values.recurrenceRule,
    location: values.location,
    createMeet: values.createMeet,
    meetLink: values.meetLink,
    responsibles: values.responsibles,
    attendeesJson: JSON.stringify(values.attendees),
    guestsCanModify: values.guestsCanModify,
    guestsCanInviteOthers: values.guestsCanInviteOthers,
    guestsCanSeeOtherGuests: values.guestsCanSeeOtherGuests,
    sendUpdates: values.sendUpdates,
    description: values.description,
    attachmentsJson: JSON.stringify(values.attachments),
    remindersJson: JSON.stringify(values.reminders),
    reminderMinutes: primaryReminder,
    transparency: values.transparency,
    visibility: values.visibility,
  };
}

function GoogleGIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export function AgendaComsoc() {
  const { account } = useAuth();
  const isAdmin = account?.role === 'admin';

  // View & Navigation state
  const [calendarScope, setCalendarScope] = useState<CalendarScopeView>('comsoc');
  const [viewMode, setViewMode] = useState<AgendaViewMode>('month');
  const [anchorDate, setAnchorDate] = useState<Date>(() => startOfDay(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date>(() => startOfDay(new Date()));
  const [categoryFilter, setCategoryFilter] = useState<'all' | AgendaCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [historySubTab, setHistorySubTab] = useState<'events' | 'audit'>('events');

  // Firestore real-time state
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [auditLogs, setAuditLogs] = useState<AgendaAuditLog[]>([]);
  const [savedGoogleConfig, setSavedGoogleConfig] = useState<AgendaIntegrationConfig | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(true);

  // Admin Google runtime state (in-memory OAuth token only)
  const [googleSession, setGoogleSession] = useState<GoogleCalendarSession>({
    connected: false,
    email: null,
    displayName: null,
  });
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendarListItem[]>([]);
  const [syncingGoogle, setSyncingGoogle] = useState(false);
  const [showAdminCalPicker, setShowAdminCalPicker] = useState(false);

  // Triage Deck (Tinder-style) state
  const [triageOpen, setTriageOpen] = useState(false);
  const [triageBusyId, setTriageBusyId] = useState<string | null>(null);
  const hasAutoOpenedTriageRef = useRef(false);

  // Modals & Alerts
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<AgendaEvent | null>(null);
  const [savingEvent, setSavingEvent] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingGoogleConfirmation | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedDomain, setCopiedDomain] = useState(false);
  const [unauthorizedDomainHelp, setUnauthorizedDomainHelp] = useState<{
    domain: string;
    consoleUrl: string;
  } | null>(null);

  // Browser notification state
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(
    () => {
      if (typeof window === 'undefined' || !('Notification' in window)) {
        return 'unsupported';
      }
      return Notification.permission;
    }
  );
  const notifiedIdsRef = useRef<Set<string>>(new Set());

  // Open new event modal directly when triggered by the mobile Speed Dial shortcut
  useEffect(() => {
    const triggerNewEvent = () => {
      setEditingEvent(null);
      setModalError(null);
      setModalOpen(true);
    };

    try {
      if (sessionStorage.getItem('siscom_agenda_open_new') === '1') {
        sessionStorage.removeItem('siscom_agenda_open_new');
        triggerNewEvent();
      }
    } catch {
      // Ignore storage errors
    }

    window.addEventListener('siscom:open-new-agenda-event', triggerNewEvent);
    return () => {
      window.removeEventListener('siscom:open-new-agenda-event', triggerNewEvent);
    };
  }, []);

  // Subscribe to Firestore collections
  useEffect(() => {
    if (!account) return;
    setLoadingEvents(true);
    const unsubEvents = subscribeAgendaEvents(
      (list) => {
        setEvents(list);
        setLoadingEvents(false);
      },
      (err) => {
        setErrorMsg(`Erro ao carregar atividades: ${err.message}`);
        setLoadingEvents(false);
      }
    );
    const unsubAudit = subscribeAgendaAudit(
      (list) => setAuditLogs(list),
      () => {
        // Non-blocking
      }
    );
    const unsubConfig = subscribeAgendaGoogleConfig(
      (cfg) => setSavedGoogleConfig(cfg),
      () => {
        // Non-blocking
      }
    );
    return () => {
      unsubEvents();
      unsubAudit();
      unsubConfig();
    };
  }, [account]);

  // Subscribe to in-memory Google OAuth session
  useEffect(() => {
    return subscribeGoogleCalendarSession((session) => {
      setGoogleSession(session);
      if (!session.connected) {
        setGoogleCalendars([]);
      }
    });
  }, []);

  // Locked institutional calendar metadata (available to ALL profiles from Firestore)
  const lockedAccountEmail =
    savedGoogleConfig?.lockedAccountEmail || DEFAULT_INSTITUTIONAL_CALENDAR_EMAIL;
  const linkedCalendarId =
    savedGoogleConfig?.selectedCalendarId || DEFAULT_INSTITUTIONAL_CALENDAR_EMAIL;
  const linkedCalendarSummary =
    savedGoogleConfig?.selectedCalendarSummary || DEFAULT_INSTITUTIONAL_CALENDAR_EMAIL;

  // Derived scope counts & pending lists (Triage only shows today or future activities)
  const pendingTriageEvents = useMemo(() => {
    const now = new Date();
    return events
      .filter(
        (ev) =>
          getEffectiveComsocScope(ev) === 'pending' &&
          ev.status !== 'cancelado' &&
          isTodayOrFutureEvent(ev, now)
      )
      .sort((a, b) => {
        const startA = parseEventDate(a.startAt, a.allDay, false).getTime();
        const startB = parseEventDate(b.startAt, b.allDay, false).getTime();
        return startA - startB;
      });
  }, [events]);

  const comsocEventsCount = useMemo(
    () => events.filter((ev) => getEffectiveComsocScope(ev) === 'comsoc').length,
    [events]
  );

  const pendingPushEvents = useMemo(
    () => events.filter((ev) => Boolean(ev.pendingGoogleSync)),
    [events]
  );

  // Automatically open Tinder-style Triage Deck once when entering Agenda with pending items
  useEffect(() => {
    if (!loadingEvents && !hasAutoOpenedTriageRef.current && pendingTriageEvents.length > 0) {
      hasAutoOpenedTriageRef.current = true;
      setTriageOpen(true);
    }
  }, [loadingEvents, pendingTriageEvents.length]);

  // Close Triage Deck automatically once queue is emptied
  useEffect(() => {
    if (triageOpen && pendingTriageEvents.length === 0) {
      setTriageOpen(false);
    }
  }, [triageOpen, pendingTriageEvents.length]);

  // Shared Google Contacts autocomplete suggestions (from Firestore cache + past attendees)
  const contactSuggestions = useMemo<GoogleContactSuggestion[]>(() => {
    const byEmail = new Map<string, GoogleContactSuggestion>();
    parseContactsCacheJson(savedGoogleConfig?.contactsCacheJson).forEach((c) => {
      byEmail.set(c.email.toLowerCase(), c);
    });
    events.forEach((ev) => {
      parseAttendeesJson(ev.attendeesJson).forEach((att) => {
        const key = att.email.toLowerCase();
        if (!byEmail.has(key)) {
          byEmail.set(key, {
            email: key,
            displayName: att.displayName || key,
          });
        }
      });
    });
    return Array.from(byEmail.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName, 'pt-BR')
    );
  }, [savedGoogleConfig?.contactsCacheJson, events]);

  // Location autocomplete suggestions from existing events
  const locationSuggestions = useMemo<string[]>(() => {
    const seen = new Map<string, string>();
    events.forEach((ev) => {
      const clean = ev.location.trim();
      if (!clean) return;
      const key = clean.toLowerCase();
      if (!seen.has(key)) seen.set(key, clean);
    });
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [events]);

  // Helper: fetch Google events + contacts and mirror everything into Firestore
  const performInstitutionalMirror = useCallback(
    async (
      targetCalendarId: string,
      targetCalendarSummary: string,
      accountEmail: string
    ) => {
      if (!account) return;
      const now = new Date();
      const timeMin = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
      const timeMax = new Date(now.getFullYear(), now.getMonth() + 6, 0, 23, 59, 59).toISOString();

      const [remoteEvents, contactsResult] = await Promise.all([
        fetchGoogleCalendarEvents(targetCalendarId, targetCalendarSummary, timeMin, timeMax),
        fetchGoogleContacts().catch(() => [] as GoogleContactSuggestion[]),
      ]);

      const { createdPending, updatedMirrored } = await mirrorGoogleEventsToFirestore({
        remoteEvents,
        existingEvents: events,
        actor: account,
      });

      await saveSelectedGoogleCalendarConfig({
        calendarId: targetCalendarId,
        calendarSummary: targetCalendarSummary,
        lockedAccountEmail: accountEmail,
        lastSyncAt: new Date().toISOString(),
        contactsCache: contactsResult.length > 0 ? contactsResult : undefined,
        existingContactsCacheJson: savedGoogleConfig?.contactsCacheJson,
        actor: account,
      });

      const summaryParts: string[] = [];
      if (createdPending > 0) {
        summaryParts.push(
          `${createdPending} nova(s) atividade(s) adicionada(s) à triagem`
        );
      }
      if (updatedMirrored > 0) {
        summaryParts.push(`${updatedMirrored} evento(s) atualizado(s)`);
      }
      if (contactsResult.length > 0) {
        summaryParts.push(`${contactsResult.length} contato(s) sincronizado(s)`);
      }

      setNotice(
        summaryParts.length > 0
          ? `Sincronização concluída (${targetCalendarSummary}): ${summaryParts.join(' · ')}.`
          : `Agenda sincronizada com "${targetCalendarSummary}". Nenhuma novidade pendente.`
      );

      if (createdPending > 0) {
        setTriageOpen(true);
      }
    },
    [account, events, savedGoogleConfig?.contactsCacheJson]
  );

  // Admin-only: Connect & Sync institutional Google Calendar (comsoc1bimeces@gmail.com)
  const handleAdminSyncGoogle = async () => {
    if (!account || !isAdmin) return;
    setSyncingGoogle(true);
    setErrorMsg(null);
    setNotice(null);
    setUnauthorizedDomainHelp(null);
    try {
      let activeEmail = googleSession.email || lockedAccountEmail;
      if (!googleSession.connected) {
        const session = await connectGoogleCalendar(lockedAccountEmail);
        activeEmail = session.email || lockedAccountEmail;
        void recordAgendaAudit({
          actor: account,
          action: 'google_connect',
          summary: `Administrador conectou conta institucional Google (${activeEmail}).`,
        });
      }

      const calendars = await listGoogleCalendars();
      setGoogleCalendars(calendars);

      // Prefer saved calendar -> else institutional email calendar -> else primary -> else first
      const savedId = savedGoogleConfig?.selectedCalendarId;
      const savedMatch = savedId ? calendars.find((c) => c.id === savedId) : undefined;
      const instMatch = calendars.find(
        (c) => c.id.toLowerCase() === lockedAccountEmail.toLowerCase()
      );
      const primaryMatch = calendars.find((c) => c.primary);
      const chosen = savedMatch || instMatch || primaryMatch || calendars[0];

      if (!chosen) {
        throw new Error('Nenhum calendário foi encontrado na conta Google conectada.');
      }

      await performInstitutionalMirror(chosen.id, chosen.summary, activeEmail);

      // If non-admin users (or offline edits) queued events, immediately prompt admin to send them to Google!
      if (pendingPushEvents.length > 0) {
        openPushQueueConfirmation(chosen.id, chosen.summary);
      }
    } catch (err) {
      if (err instanceof CalendarUnauthorizedDomainError) {
        setUnauthorizedDomainHelp({
          domain: err.domain,
          consoleUrl: err.consoleUrl,
        });
      }
      setErrorMsg(
        err instanceof Error ? err.message : 'Erro ao sincronizar com o Google Calendar.'
      );
    } finally {
      setSyncingGoogle(false);
    }
  };

  // Admin-only: Switch linked institutional calendar
  const handleAdminSwitchCalendar = async (nextCalId: string) => {
    if (!account || !isAdmin) return;
    const chosen = googleCalendars.find((c) => c.id === nextCalId);
    if (!chosen) return;
    setSyncingGoogle(true);
    setErrorMsg(null);
    try {
      await performInstitutionalMirror(
        chosen.id,
        chosen.summary,
        googleSession.email || lockedAccountEmail
      );
      setShowAdminCalPicker(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Falha ao trocar calendário vinculado.');
    } finally {
      setSyncingGoogle(false);
    }
  };

  // Admin-only: Disconnect current browser Google session
  const handleAdminDisconnectGoogle = async () => {
    if (!account || !isAdmin) return;
    await disconnectGoogleCalendarSession();
    setGoogleCalendars([]);
    setShowAdminCalPicker(false);
    setNotice(
      'Sessão Google desconectada neste navegador. Os eventos já sincronizados continuam disponíveis para toda a equipe.'
    );
    void recordAgendaAudit({
      actor: account,
      action: 'google_disconnect',
      summary: 'Administrador encerrou a sessão Google Calendar neste navegador.',
    });
  };

  // Admin-only: Push queued events created/edited while offline from Google (with MANDATORY confirmation modal)
  const openPushQueueConfirmation = (targetCalendarId: string, targetCalendarSummary: string) => {
    if (!account || !isAdmin || pendingPushEvents.length === 0) return;

    setPendingConfirm({
      type: 'push_queue',
      eventTitle:
        pendingPushEvents.length === 1
          ? pendingPushEvents[0].title
          : `${pendingPushEvents.length} atividades criadas/editadas no SISCOM`,
      calendarSummary: targetCalendarSummary,
      isSynced: false,
      queueCount: pendingPushEvents.length,
      onConfirm: async () => {
        setConfirmBusy(true);
        setErrorMsg(null);
        let pushed = 0;
        let failed = 0;
        try {
          for (const ev of pendingPushEvents) {
            try {
              const targetCal = ev.googleCalendarId || targetCalendarId;
              const targetSummary = ev.googleCalendarSummary || targetCalendarSummary;
              if (ev.googleEventId && ev.googleCalendarId) {
                const res = await updateGoogleCalendarEvent(targetCal, ev.googleEventId, ev);
                await updateAgendaEvent(
                  ev.id,
                  {
                    googleEventId: res.googleEventId,
                    googleHtmlLink: res.htmlLink,
                    meetLink: res.meetLink || ev.meetLink || '',
                    syncStatus: 'synced',
                    pendingGoogleSync: false,
                    lastSyncedAt: new Date().toISOString(),
                  },
                  account
                );
              } else {
                const res = await createGoogleCalendarEvent(targetCal, ev);
                await updateAgendaEvent(
                  ev.id,
                  {
                    googleEventId: res.googleEventId,
                    googleCalendarId: targetCal,
                    googleCalendarSummary: targetSummary,
                    googleHtmlLink: res.htmlLink,
                    meetLink: res.meetLink || ev.meetLink || '',
                    syncStatus: 'synced',
                    pendingGoogleSync: false,
                    lastSyncedAt: new Date().toISOString(),
                  },
                  account
                );
              }
              pushed += 1;
            } catch {
              failed += 1;
              await updateAgendaEvent(ev.id, { syncStatus: 'error' }, account);
            }
          }
          if (pushed > 0) {
            void recordAgendaAudit({
              actor: account,
              action: 'sync_push',
              summary: `Fila sincronizada com Google Calendar ("${targetCalendarSummary}"): ${pushed} enviada(s)${failed > 0 ? `, ${failed} com erro` : ''}.`,
            });
          }
          setNotice(
            failed > 0
              ? `${pushed} atividade(s) enviada(s) ao Google Calendar; ${failed} falhou(aram).`
              : `${pushed} atividade(s) pendente(s) enviada(s) com sucesso para "${targetCalendarSummary}".`
          );
          setPendingConfirm(null);
        } finally {
          setConfirmBusy(false);
        }
      },
    });
  };

  const handleAdminRequestPushQueue = () => {
    if (!googleSession.connected) {
      setErrorMsg('Clique primeiro em "Sincronizar com Google" para autenticar esta sessão.');
      return;
    }
    openPushQueueConfirmation(linkedCalendarId, linkedCalendarSummary);
  };

  // Triage classification (Swipe Right = COMSOC, Swipe Left = General)
  const handleClassifyTriage = async (
    ev: AgendaEvent,
    decision: 'comsoc' | 'general',
    category: AgendaCategory
  ) => {
    if (!account) return;
    setTriageBusyId(ev.id);
    setErrorMsg(null);
    try {
      await updateAgendaEvent(
        ev.id,
        {
          comsocScope: decision,
          category: decision === 'comsoc' ? category : ev.category,
        },
        account,
        decision === 'comsoc'
          ? `Triagem: "${ev.title}" aprovada para o Calendário COMSOC (${AGENDA_CATEGORY_MAP[category]?.shortLabel || category}).`
          : `Triagem: "${ev.title}" mantida apenas no Calendário Geral.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao classificar atividade.');
    } finally {
      setTriageBusyId(null);
    }
  };

  // 1-Click scope toggle directly from any card
  const handleToggleEventScope = async (ev: AgendaEvent) => {
    if (!account) return;
    const current = getEffectiveComsocScope(ev);
    const nextScope: 'comsoc' | 'general' = current === 'comsoc' ? 'general' : 'comsoc';
    try {
      await updateAgendaEvent(
        ev.id,
        { comsocScope: nextScope },
        account,
        nextScope === 'comsoc'
          ? `"${ev.title}" movida para o Calendário COMSOC.`
          : `"${ev.title}" movida para o Calendário Geral.`
      );
      setNotice(
        nextScope === 'comsoc'
          ? `"${ev.title}" agora aparece no Calendário COMSOC e no Geral.`
          : `"${ev.title}" foi ocultada do Calendário COMSOC (continua no Calendário Geral).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao alterar classificação.');
    }
  };

  // Filtered events according to active scope (Calendário COMSOC vs Calendário Geral), category & search
  const visibleEvents = useMemo(() => {
    return events
      .filter((ev) => {
        const scope = getEffectiveComsocScope(ev);
        if (calendarScope === 'comsoc' && scope !== 'comsoc') return false;
        if (categoryFilter !== 'all' && ev.category !== categoryFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.trim().toLowerCase();
          const attendeesText = parseAttendeesJson(ev.attendeesJson)
            .map((a) => `${a.displayName || ''} ${a.email}`)
            .join(' ');
          const hay = `${ev.title} ${ev.location} ${ev.responsibles} ${ev.description} ${attendeesText}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          parseEventDate(a.startAt, a.allDay, false).getTime() -
          parseEventDate(b.startAt, b.allDay, false).getTime()
      );
  }, [events, calendarScope, categoryFilter, searchQuery]);

  // Active Reminders (respecting COMSOC calendar focus when in COMSOC mode)
  const activeReminders = useMemo(() => {
    const now = Date.now();
    return visibleEvents
      .filter((ev) => {
        if (ev.status !== 'agendado') return false;
        const reminders = parseRemindersJson(ev.remindersJson, ev.reminderMinutes);
        const maxMinutes = reminders.reduce((acc, r) => Math.max(acc, r.minutes), 0);
        if (maxMinutes <= 0) return false;
        const startMs = parseEventDate(ev.startAt, ev.allDay, false).getTime();
        return startMs >= now - 15 * 60_000 && startMs - now <= maxMinutes * 60_000;
      })
      .sort(
        (a, b) =>
          parseEventDate(a.startAt, a.allDay, false).getTime() -
          parseEventDate(b.startAt, b.allDay, false).getTime()
      );
  }, [visibleEvents]);

  // Browser notification trigger
  useEffect(() => {
    if (
      notifPermission !== 'granted' ||
      typeof window === 'undefined' ||
      !('Notification' in window)
    ) {
      return;
    }
    activeReminders.forEach((ev) => {
      if (notifiedIdsRef.current.has(ev.id)) return;
      notifiedIdsRef.current.add(ev.id);
      const start = parseEventDate(ev.startAt, ev.allDay, false);
      const timeText = ev.allDay ? 'Dia inteiro' : formatTimeShort(start);
      try {
        new Notification(`COMSOC · ${ev.title}`, {
          body: `${start.toLocaleDateString('pt-BR')} às ${timeText}${ev.location ? ` · ${ev.location}` : ''}`,
          icon: '/assets/logo_arma_comunicacoes.png',
        });
      } catch {
        // Ignore notification errors in restricted iframes
      }
    });
  }, [activeReminders, notifPermission]);

  const handleEnableBrowserNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const result = await Notification.requestPermission();
      setNotifPermission(result);
    } catch {
      // Ignore
    }
  };

  // History list (completed, cancelled, or past events within the selected scope)
  const historyEvents = useMemo(() => {
    const now = Date.now();
    return visibleEvents
      .filter((ev) => {
        const endMs = parseEventDate(ev.endAt, ev.allDay, true).getTime();
        return ev.status !== 'agendado' || endMs < now;
      })
      .sort(
        (a, b) =>
          parseEventDate(b.startAt, b.allDay, false).getTime() -
          parseEventDate(a.startAt, a.allDay, false).getTime()
      );
  }, [visibleEvents]);

  // Modal helpers
  const openCreateModal = (dateForEvent?: Date) => {
    if (dateForEvent) {
      setSelectedDay(startOfDay(dateForEvent));
    }
    setEditingEvent(null);
    setModalError(null);
    setModalOpen(true);
  };

  const openEditModal = (ev: AgendaEvent) => {
    setEditingEvent(ev);
    setModalError(null);
    setModalOpen(true);
  };

  // Submit 6-Card Create/Edit Form (ALWAYS requires explicit confirmation before mutating Google Calendar!)
  const handleFormSubmit = async (values: EventFormValues) => {
    if (!account) return;
    setModalError(null);
    setErrorMsg(null);

    const baseInput = formValuesToEventInput(values);
    const canSyncNow = values.syncWithGoogle && googleSession.connected && Boolean(linkedCalendarId);
    const shouldQueueForGoogle = values.syncWithGoogle && !googleSession.connected;

    // Case 1: Editing an existing event
    if (editingEvent) {
      const targetCalendarId = editingEvent.googleCalendarId || linkedCalendarId;
      const targetCalendarSummary = editingEvent.googleCalendarSummary || linkedCalendarSummary;
      const willUpdateRemote = canSyncNow && Boolean(editingEvent.googleEventId && targetCalendarId);
      const willPushRemote = canSyncNow && !editingEvent.googleEventId && Boolean(targetCalendarId);

      const executeUpdate = async (syncGoogleNow: boolean) => {
        setSavingEvent(true);
        try {
          const updates: Partial<AgendaEventInput> = {
            ...baseInput,
            pendingGoogleSync: syncGoogleNow ? false : shouldQueueForGoogle,
          };

          await updateAgendaEvent(
            editingEvent.id,
            updates,
            account,
            `Atividade atualizada: "${values.title.trim()}"`
          );

          const mergedEvent: AgendaEvent = {
            ...editingEvent,
            ...updates,
          };

          if (syncGoogleNow && editingEvent.googleEventId && targetCalendarId) {
            const res = await updateGoogleCalendarEvent(
              targetCalendarId,
              editingEvent.googleEventId,
              mergedEvent
            );
            await updateAgendaEvent(
              editingEvent.id,
              {
                googleEventId: res.googleEventId,
                googleHtmlLink: res.htmlLink,
                meetLink: res.meetLink || mergedEvent.meetLink || '',
                syncStatus: 'synced',
                pendingGoogleSync: false,
                lastSyncedAt: new Date().toISOString(),
              },
              account
            );
            void recordAgendaAudit({
              actor: account,
              action: 'sync_update',
              eventId: editingEvent.id,
              summary: `Evento atualizado no Google Calendar ("${targetCalendarSummary}"): "${values.title.trim()}"`,
            });
            setNotice(`Atividade salva e atualizada no Google Calendar ("${targetCalendarSummary}").`);
          } else if (syncGoogleNow && targetCalendarId) {
            const res = await createGoogleCalendarEvent(targetCalendarId, mergedEvent);
            await updateAgendaEvent(
              editingEvent.id,
              {
                googleEventId: res.googleEventId,
                googleCalendarId: targetCalendarId,
                googleCalendarSummary: targetCalendarSummary,
                googleHtmlLink: res.htmlLink,
                meetLink: res.meetLink || mergedEvent.meetLink || '',
                syncStatus: 'synced',
                pendingGoogleSync: false,
                lastSyncedAt: new Date().toISOString(),
              },
              account
            );
            void recordAgendaAudit({
              actor: account,
              action: 'sync_push',
              eventId: editingEvent.id,
              summary: `Atividade enviada ao Google Calendar ("${targetCalendarSummary}"): "${values.title.trim()}"`,
            });
            setNotice(`Atividade salva e enviada para "${targetCalendarSummary}".`);
          } else if (shouldQueueForGoogle) {
            setNotice(
              'Alterações salvas no SISCOM e colocadas na fila para envio ao Google Calendar na próxima sincronização.'
            );
          } else {
            setNotice('Alterações salvas na Agenda do SISCOM.');
          }

          setModalOpen(false);
          setEditingEvent(null);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Erro ao salvar alterações.';
          setModalError(msg);
          setErrorMsg(msg);
        } finally {
          setSavingEvent(false);
        }
      };

      if (willUpdateRemote || willPushRemote) {
        setPendingConfirm({
          type: willUpdateRemote ? 'update_google' : 'push_google',
          eventTitle: values.title.trim(),
          calendarSummary: targetCalendarSummary,
          isSynced: willUpdateRemote,
          onConfirm: async () => {
            setConfirmBusy(true);
            try {
              await executeUpdate(true);
              setPendingConfirm(null);
            } finally {
              setConfirmBusy(false);
            }
          },
        });
        return;
      }

      await executeUpdate(false);
      return;
    }

    // Case 2: Creating a new event
    const executeCreate = async (syncGoogleNow: boolean) => {
      setSavingEvent(true);
      try {
        const created = await createAgendaEvent(
          {
            ...baseInput,
            syncStatus: 'internal',
            pendingGoogleSync: syncGoogleNow ? false : shouldQueueForGoogle,
          },
          account
        );

        if (syncGoogleNow && linkedCalendarId) {
          try {
            const remote = await createGoogleCalendarEvent(linkedCalendarId, created);
            await updateAgendaEvent(
              created.id,
              {
                googleEventId: remote.googleEventId,
                googleCalendarId: linkedCalendarId,
                googleCalendarSummary: linkedCalendarSummary,
                googleHtmlLink: remote.htmlLink,
                meetLink: remote.meetLink || created.meetLink || '',
                syncStatus: 'synced',
                pendingGoogleSync: false,
                lastSyncedAt: new Date().toISOString(),
              },
              account
            );
            void recordAgendaAudit({
              actor: account,
              action: 'sync_push',
              eventId: created.id,
              summary: `Nova atividade enviada ao Google Calendar ("${linkedCalendarSummary}"): "${created.title}"`,
            });
            setNotice(
              `Atividade cadastrada e sincronizada diretamente com "${linkedCalendarSummary}".`
            );
          } catch (googleErr) {
            await updateAgendaEvent(
              created.id,
              { syncStatus: 'error', pendingGoogleSync: true },
              account
            );
            setErrorMsg(
              `Atividade salva no SISCOM, mas houve erro ao enviar ao Google Calendar: ${
                googleErr instanceof Error ? googleErr.message : 'erro desconhecido'
              }`
            );
          }
        } else if (shouldQueueForGoogle) {
          setNotice(
            'Atividade cadastrada no SISCOM e marcada na fila de envio ao Google Calendar.'
          );
        } else {
          setNotice('Atividade cadastrada na Agenda do SISCOM.');
        }

        setSelectedDay(parseEventDate(baseInput.startAt, values.allDay, false));
        setModalOpen(false);
      } catch (err) {
        setModalError(err instanceof Error ? err.message : 'Erro ao cadastrar atividade.');
      } finally {
        setSavingEvent(false);
      }
    };

    if (canSyncNow) {
      setPendingConfirm({
        type: 'push_google',
        eventTitle: values.title.trim(),
        calendarSummary: linkedCalendarSummary,
        isSynced: false,
        onConfirm: async () => {
          setConfirmBusy(true);
          try {
            await executeCreate(true);
            setPendingConfirm(null);
          } finally {
            setConfirmBusy(false);
          }
        },
      });
      return;
    }

    await executeCreate(false);
  };

  // Manual push/update to Google Calendar (Admin with active session + MANDATORY confirmation)
  const handleRequestSyncEvent = (ev: AgendaEvent) => {
    if (!account) return;
    if (!googleSession.connected) {
      setErrorMsg(
        isAdmin
          ? 'Clique em "Sincronizar com Google" no topo antes de enviar esta atividade.'
          : 'A atividade será enviada ao Google Calendar na próxima sincronização feita pelo administrador.'
      );
      return;
    }

    const isAlreadySynced = Boolean(ev.googleEventId && ev.googleCalendarId);
    const targetCalendarId = isAlreadySynced ? ev.googleCalendarId : linkedCalendarId;
    const targetCalendarSummary = isAlreadySynced
      ? ev.googleCalendarSummary || linkedCalendarSummary
      : linkedCalendarSummary;

    setPendingConfirm({
      type: isAlreadySynced ? 'update_google' : 'push_google',
      eventTitle: ev.title,
      calendarSummary: targetCalendarSummary,
      isSynced: isAlreadySynced,
      onConfirm: async () => {
        setConfirmBusy(true);
        setErrorMsg(null);
        try {
          if (isAlreadySynced) {
            const res = await updateGoogleCalendarEvent(targetCalendarId, ev.googleEventId, ev);
            await updateAgendaEvent(
              ev.id,
              {
                googleEventId: res.googleEventId,
                googleHtmlLink: res.htmlLink,
                meetLink: res.meetLink || ev.meetLink || '',
                syncStatus: 'synced',
                pendingGoogleSync: false,
                lastSyncedAt: new Date().toISOString(),
              },
              account
            );
            void recordAgendaAudit({
              actor: account,
              action: 'sync_update',
              eventId: ev.id,
              summary: `Atualização sincronizada no Google Calendar ("${targetCalendarSummary}"): "${ev.title}"`,
            });
            setNotice(`"${ev.title}" atualizado no Google Calendar ("${targetCalendarSummary}").`);
          } else {
            const res = await createGoogleCalendarEvent(targetCalendarId, ev);
            await updateAgendaEvent(
              ev.id,
              {
                googleEventId: res.googleEventId,
                googleCalendarId: targetCalendarId,
                googleCalendarSummary: targetCalendarSummary,
                googleHtmlLink: res.htmlLink,
                meetLink: res.meetLink || ev.meetLink || '',
                syncStatus: 'synced',
                pendingGoogleSync: false,
                lastSyncedAt: new Date().toISOString(),
              },
              account
            );
            void recordAgendaAudit({
              actor: account,
              action: 'sync_push',
              eventId: ev.id,
              summary: `Atividade sincronizada no Google Calendar ("${targetCalendarSummary}"): "${ev.title}"`,
            });
            setNotice(`"${ev.title}" sincronizado no calendário "${targetCalendarSummary}".`);
          }
          setPendingConfirm(null);
        } catch (err) {
          setErrorMsg(
            err instanceof Error ? err.message : 'Falha ao sincronizar com o Google Calendar.'
          );
          setPendingConfirm(null);
        } finally {
          setConfirmBusy(false);
        }
      },
    });
  };

  // Deletion (ALWAYS requires explicit confirmation modal!)
  const handleRequestDeleteEvent = (ev: AgendaEvent) => {
    if (!account) return;
    const isSynced = Boolean(ev.googleEventId && ev.googleCalendarId);

    setPendingConfirm({
      type: 'delete_event',
      eventTitle: ev.title,
      calendarSummary: ev.googleCalendarSummary || linkedCalendarSummary,
      isSynced,
      onConfirm: async (alsoDeleteInGoogle: boolean) => {
        setConfirmBusy(true);
        setErrorMsg(null);
        try {
          if (isSynced && alsoDeleteInGoogle) {
            if (!googleSession.connected) {
              throw new Error(
                'Sessão Google não ativa neste navegador. Desmarque a opção para excluir somente no SISCOM ou sincronize com o Google antes.'
              );
            }
            await deleteGoogleCalendarEvent(ev.googleCalendarId, ev.googleEventId);
            void recordAgendaAudit({
              actor: account,
              action: 'sync_delete',
              eventId: ev.id,
              summary: `Evento removido também no Google Calendar ("${ev.googleCalendarSummary || linkedCalendarSummary}"): "${ev.title}"`,
            });
          }

          await deleteAgendaEvent(ev, account);
          setNotice(
            isSynced && alsoDeleteInGoogle
              ? `Atividade "${ev.title}" removida do SISCOM e do Google Calendar.`
              : `Atividade "${ev.title}" removida da Agenda do SISCOM.`
          );
          setPendingConfirm(null);
        } catch (err) {
          setErrorMsg(err instanceof Error ? err.message : 'Erro ao excluir atividade.');
          setPendingConfirm(null);
        } finally {
          setConfirmBusy(false);
        }
      },
    });
  };

  const handleToggleCompleted = async (ev: AgendaEvent) => {
    if (!account) return;
    const nextStatus = ev.status === 'realizado' ? 'agendado' : 'realizado';
    try {
      await updateAgendaEvent(
        ev.id,
        { status: nextStatus },
        account,
        nextStatus === 'realizado'
          ? `Atividade concluída: "${ev.title}"`
          : `Atividade reaberta: "${ev.title}"`
      );
      setNotice(
        nextStatus === 'realizado'
          ? `"${ev.title}" marcada como realizada e registrada no Histórico.`
          : `"${ev.title}" reaberta como agendada.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao atualizar situação.');
    }
  };

  // Date navigation
  const handleNavigateDate = (direction: -1 | 1) => {
    if (viewMode === 'month') {
      const next = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + direction, 1);
      setAnchorDate(next);
      setSelectedDay(next);
    } else if (viewMode === 'week') {
      const next = new Date(anchorDate);
      next.setDate(anchorDate.getDate() + direction * 7);
      setAnchorDate(next);
      setSelectedDay(next);
    } else {
      const next = new Date(anchorDate);
      next.setDate(anchorDate.getDate() + direction);
      setAnchorDate(next);
      setSelectedDay(next);
    }
  };

  const handleGoToday = () => {
    const today = startOfDay(new Date());
    setAnchorDate(today);
    setSelectedDay(today);
  };

  const monthDays = useMemo(() => buildMonthGridDays(anchorDate), [anchorDate]);
  const weekDays = useMemo(() => buildWeekDays(anchorDate), [anchorDate]);
  const todayKey = formatLocalDateKey(new Date());
  const selectedDayKey = formatLocalDateKey(selectedDay);

  const selectedDayEvents = useMemo(
    () => visibleEvents.filter((ev) => eventOverlapsDay(ev, selectedDay)),
    [visibleEvents, selectedDay]
  );

  // Rich Event Card renderer
  const renderEventCard = (ev: AgendaEvent, compact = false) => {
    const catMeta = AGENDA_CATEGORY_MAP[ev.category] || AGENDA_CATEGORY_MAP.outros;
    const isCompleted = ev.status === 'realizado';
    const isCancelled = ev.status === 'cancelado';
    const scope = getEffectiveComsocScope(ev);
    const start = parseEventDate(ev.startAt, ev.allDay, false);
    const end = parseEventDate(ev.endAt, ev.allDay, true);
    const attendees = parseAttendeesJson(ev.attendeesJson);
    const attachments = parseAttachmentsJson(ev.attachmentsJson);
    const reminders = parseRemindersJson(ev.remindersJson, ev.reminderMinutes);
    const googleColorHex = getGoogleColorHex(ev.colorId);

    return (
      <article
        key={ev.id}
        className={`rounded-xl border border-white/[0.12] border-l-[3px] ${catMeta.borderClass} bg-[#0E1612]/52 backdrop-blur-md p-3.5 sm:p-4 space-y-2.5 transition-colors hover:border-white/22 shadow-[inset_0_1px_0_rgba(255,250,236,0.12)] ${
          isCancelled ? 'opacity-65' : ''
        }`}
        style={googleColorHex ? { borderLeftColor: googleColorHex } : undefined}
      >
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <ScopeBadge scope={scope} />
              <CategoryDotLabel category={ev.category} />

              {ev.pendingGoogleSync ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#E5C17B]/40 bg-[#2A2210] text-[10px] font-mono text-[#F4E6C4]">
                  <CloudUpload className="w-3 h-3" />
                  Aguardando envio
                </span>
              ) : ev.syncStatus === 'synced' ? (
                <span
                  title={`Sincronizado com ${ev.googleCalendarSummary || linkedCalendarSummary}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#C29B56]/35 bg-[#221D12] text-[10px] font-mono text-[#E5C17B]"
                >
                  <Cloud className="w-3 h-3" />
                  Sincronizado
                </span>
              ) : ev.syncStatus === 'error' ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-red-400/35 bg-red-950/50 text-[10px] font-mono text-red-200">
                  <CloudOff className="w-3 h-3" />
                  Erro de sync
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-white/12 bg-white/[0.03] text-[10px] font-mono text-[#98A89F]">
                  Interno
                </span>
              )}

              {ev.recurrenceRule && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.03] text-[10px] font-mono text-[#C6D4CC]">
                  <Repeat className="w-2.5 h-2.5 text-[#E5C17B]" />
                  Recorrente
                </span>
              )}

              {ev.status !== 'agendado' && (
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider ${
                    isCompleted
                      ? 'bg-[#2D5A43]/30 text-[#A7D3BA] border border-[#83B499]/30'
                      : 'bg-red-950/40 text-red-200 border border-red-400/25'
                  }`}
                >
                  {AGENDA_STATUS_LABELS[ev.status]}
                </span>
              )}
            </div>

            <h4
              className={`font-display text-sm sm:text-[15px] font-semibold leading-snug ${
                isCancelled ? 'line-through text-[#98A89F]' : 'text-[#F4E6C4]'
              }`}
            >
              {ev.title}
            </h4>
          </div>

          <div className="text-right shrink-0">
            <span className="inline-flex items-center gap-1 text-xs font-mono text-[#C8A461]">
              <Clock className="w-3.5 h-3.5" />
              {ev.allDay
                ? 'Dia inteiro'
                : `${formatTimeShort(start)} – ${formatTimeShort(end)}`}
            </span>
          </div>
        </div>

        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[#98A89F]">
          {ev.location && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.location)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 min-w-0 hover:text-[#E5C17B] transition-colors"
              title="Abrir endereço no Google Maps"
            >
              <MapPin className="w-3.5 h-3.5 text-[#C8A461] shrink-0" />
              <span className="truncate">{ev.location}</span>
            </a>
          )}

          <ResponsibleInline text={ev.responsibles} />

          {attendees.length > 0 && (
            <span
              title={attendees.map((a) => a.displayName || a.email).join(', ')}
              className="inline-flex items-center gap-1 text-[11px] text-[#C6D4CC]"
            >
              <Users className="w-3 h-3 text-[#E5C17B]" />
              {attendees.length} convidado{attendees.length === 1 ? '' : 's'}
            </span>
          )}

          {reminders.length > 0 && ev.status === 'agendado' && (
            <span className="inline-flex items-center gap-1 text-[11px] text-[#98A89F]">
              <Bell className="w-3 h-3 text-[#C8A461]" />
              {reminders.length === 1
                ? reminders[0].minutes >= 1440
                  ? `${Math.round(reminders[0].minutes / 1440)}d antes`
                  : reminders[0].minutes >= 60
                    ? `${Math.round(reminders[0].minutes / 60)}h antes`
                    : `${reminders[0].minutes}min antes`
                : `${reminders.length} avisos`}
            </span>
          )}

          {ev.meetLink && (
            <a
              href={ev.meetLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-[#93B7D8] hover:underline"
            >
              <Video className="w-3.5 h-3.5" />
              <span>Abrir Meet</span>
            </a>
          )}
        </div>

        {/* Attachments chips */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {attachments.map((att, idx) => (
              <a
                key={`${att.fileUrl}-${idx}`}
                href={att.fileUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0B100E] px-2.5 py-1 text-[11px] text-[#C6D4CC] hover:border-[#C29B56]/45 hover:text-[#F4E6C4] transition-colors max-w-[230px]"
              >
                <Paperclip className="w-3 h-3 text-[#C8A461] shrink-0" />
                <span className="truncate">{att.title}</span>
              </a>
            ))}
          </div>
        )}

        {!compact && ev.description && (
          <p className="text-xs text-[#C6D4CC] whitespace-pre-wrap leading-relaxed border-t border-white/6 pt-2">
            {ev.description}
          </p>
        )}

        {/* Action footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/6">
          <span className="text-[10px] font-mono text-[#697870]">
            Por {ev.createdByName}
          </span>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleToggleEventScope(ev)}
              title={
                scope === 'comsoc'
                  ? 'Ocultar do Calendário COMSOC (manter no Geral)'
                  : 'Incluir no Calendário COMSOC'
              }
              className="siscom-btn siscom-btn-secondary !min-h-[32px] !px-2.5 text-[11px]"
            >
              <Layers className="w-3.5 h-3.5 text-[#E5C17B]" />
              <span>{scope === 'comsoc' ? 'Só Geral' : 'P/ COMSOC'}</span>
            </button>

            <button
              type="button"
              onClick={() => void handleToggleCompleted(ev)}
              title={isCompleted ? 'Reabrir atividade' : 'Marcar como realizada'}
              className="siscom-btn siscom-btn-secondary !min-h-[32px] !px-2.5 text-[11px]"
            >
              {isCompleted ? (
                <>
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reabrir</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#83B499]" />
                  <span>Concluir</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => openEditModal(ev)}
              className="siscom-btn siscom-btn-secondary !min-h-[32px] !px-2.5 text-[11px]"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>Editar</span>
            </button>

            {isAdmin && googleSession.connected && (
              <button
                type="button"
                onClick={() => handleRequestSyncEvent(ev)}
                title={
                  ev.syncStatus === 'synced'
                    ? 'Reenviar atualização ao Google Calendar'
                    : 'Enviar ao Google Calendar'
                }
                className="siscom-btn siscom-btn-gold !min-h-[32px] !px-2.5 text-[11px]"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{ev.syncStatus === 'synced' ? 'Atualizar' : 'Sync'}</span>
              </button>
            )}

            {ev.googleHtmlLink && (
              <a
                href={ev.googleHtmlLink}
                target="_blank"
                rel="noreferrer"
                title="Abrir no Google Calendar"
                className="siscom-btn siscom-btn-secondary !min-h-[32px] !px-2.5 text-[11px]"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            <button
              type="button"
              onClick={() => handleRequestDeleteEvent(ev)}
              title="Excluir atividade"
              className="siscom-btn siscom-btn-danger !min-h-[32px] !px-2.5 text-[11px]"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </article>
    );
  };

  const selectedDayPanel = (
    <div className="siscom-card p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 border-b border-white/8 pb-3">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-wider text-[#C8A461]">
            {calendarScope === 'comsoc' ? 'Calendário COMSOC' : 'Calendário Geral'} · Dia
          </p>
          <h3 className="font-display text-sm sm:text-base font-semibold text-[#F4E6C4] mt-0.5">
            {formatFullDayTitle(selectedDay)}
          </h3>
        </div>
        <button
          type="button"
          onClick={() => openCreateModal(selectedDay)}
          className="siscom-btn siscom-btn-gold !min-h-[34px] !px-2.5 text-xs shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Agendar</span>
        </button>
      </div>

      {selectedDayEvents.length === 0 ? (
        <div className="py-8 text-center space-y-2.5">
          <CalendarIcon className="w-7 h-7 text-[#697870] mx-auto opacity-70" />
          <p className="text-xs text-[#98A89F]">
            Nenhuma atividade em{' '}
            {calendarScope === 'comsoc' ? 'Calendário COMSOC' : 'Calendário Geral'} neste dia.
          </p>
          <button
            type="button"
            onClick={() => openCreateModal(selectedDay)}
            className="siscom-btn siscom-btn-secondary !min-h-[36px] text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Cadastrar atividade neste dia</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {selectedDayEvents.map((ev) => renderEventCard(ev, true))}
        </div>
      )}
    </div>
  );

  return (
    <>
      <WorkspaceSplitLayout
        sidebarWidthClass="lg:w-[375px] xl:w-[405px]"
        sidebar={
          <div className="space-y-4">
            {/* Dual Calendar Switch (COMSOC vs Geral) + Actions */}
            <div className="siscom-card p-3.5 space-y-3">
              <div className="grid grid-cols-2 rounded-xl border border-white/[0.12] bg-black/32 backdrop-blur-md p-1 gap-1">
                <button
                  type="button"
                  onClick={() => setCalendarScope('comsoc')}
                  className={`min-h-[38px] px-2.5 py-1.5 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    calendarScope === 'comsoc'
                      ? 'bg-[#2D5A43] text-white shadow-sm'
                      : 'text-[#98A89F] hover:text-[#E4EAE6]'
                  }`}
                >
                  <CalendarIcon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">COMSOC</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                      calendarScope === 'comsoc'
                        ? 'bg-black/25 text-[#F4E6C4]'
                        : 'bg-white/8 text-[#98A89F]'
                    }`}
                  >
                    {comsocEventsCount}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setCalendarScope('general')}
                  className={`min-h-[38px] px-2.5 py-1.5 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    calendarScope === 'general'
                      ? 'bg-[#2D5A43] text-white shadow-sm'
                      : 'text-[#98A89F] hover:text-[#E4EAE6]'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Geral</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                      calendarScope === 'general'
                        ? 'bg-black/25 text-[#F4E6C4]'
                        : 'bg-white/8 text-[#98A89F]'
                    }`}
                  >
                    {events.length}
                  </span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => openCreateModal(selectedDay)}
                  className="siscom-btn siscom-btn-primary flex-1 !min-h-[38px] text-xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>Nova atividade</span>
                </button>
                {pendingTriageEvents.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setTriageOpen(true)}
                    className="siscom-btn siscom-btn-gold !min-h-[38px] !px-3 text-xs shrink-0"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Triagem ({pendingTriageEvents.length})</span>
                  </button>
                )}
              </div>
            </div>

            {/* Search & Category Filters */}
            <div className="siscom-card p-3.5 space-y-2.5">
              <div className="relative">
                <Search className="w-4 h-4 text-[#697870] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar título, local, convidado..."
                  className="siscom-input !pl-10 !min-h-[40px] text-xs"
                />
              </div>

              <select
                aria-label="Filtrar por categoria"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as 'all' | AgendaCategory)}
                className="siscom-input !min-h-[40px] text-xs"
              >
                <option value="all">Todas as categorias da COMSOC</option>
                {AGENDA_CATEGORIES.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Institutional Google Calendar Strip */}
            <div className="rounded-xl siscom-liquid-subcard !border-[#C9A961]/28 p-3.5 space-y-3">
              {isAdmin ? (
                <>
                  <div className="space-y-2.5">
                    <div className="flex items-start gap-2.5">
                      <div className="w-8 h-8 rounded-lg border border-[#C29B56]/35 bg-[#1B1810] flex items-center justify-center text-[#E5C17B] shrink-0">
                        <CalendarIcon className="w-4 h-4" />
                      </div>
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <h3 className="font-display text-xs font-semibold text-[#F4E6C4]">
                            Calendário Institucional
                          </h3>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                              googleSession.connected
                                ? 'bg-[#2D5A43]/30 text-[#A7D3BA] border-[#83B499]/35'
                                : 'bg-[#1D1B14] text-[#E5C17B] border-[#C29B56]/30'
                            }`}
                          >
                            {googleSession.connected ? 'Google ativo' : 'Espelhado'}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#98A89F] leading-snug">
                          <strong className="text-[#E4EAE6]">{linkedCalendarSummary}</strong>
                          {' · '}
                          <span className="font-mono text-[#C6D4CC]">
                            {formatSyncTimestamp(savedGoogleConfig?.lastSyncAt)}
                          </span>
                          {contactSuggestions.length > 0 && (
                            <span> · {contactSuggestions.length} contato(s)</span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={syncingGoogle}
                        onClick={() => void handleAdminSyncGoogle()}
                        className="flex-1 inline-flex items-center justify-center gap-2 min-h-[36px] px-3 rounded-lg bg-white text-[#1F1F1F] hover:bg-[#F3F4F6] font-medium text-xs transition-colors cursor-pointer disabled:opacity-60"
                      >
                        {syncingGoogle ? (
                          <SiscomSpinner className="w-3.5 h-3.5" tone="olive" />
                        ) : (
                          <GoogleGIcon className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {syncingGoogle
                            ? 'Sincronizando...'
                            : googleSession.connected
                              ? 'Sincronizar agora'
                              : 'Sincronizar com Google'}
                        </span>
                      </button>

                      {pendingPushEvents.length > 0 && googleSession.connected && (
                        <button
                          type="button"
                          onClick={handleAdminRequestPushQueue}
                          className="siscom-btn siscom-btn-gold !min-h-[36px] !px-2.5 text-xs"
                        >
                          <CloudUpload className="w-3.5 h-3.5" />
                          <span>Fila ({pendingPushEvents.length})</span>
                        </button>
                      )}

                      {googleSession.connected && googleCalendars.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setShowAdminCalPicker((v) => !v)}
                          className="siscom-btn siscom-btn-secondary !min-h-[36px] !px-2.5 text-xs"
                          title="Alterar calendário associado (somente Administrador)"
                        >
                          <Settings2 className="w-3.5 h-3.5" />
                          {showAdminCalPicker ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}

                      {googleSession.connected && (
                        <button
                          type="button"
                          onClick={() => void handleAdminDisconnectGoogle()}
                          title="Encerrar sessão Google neste navegador"
                          className="siscom-btn siscom-btn-secondary !min-h-[36px] !px-2.5 text-xs"
                        >
                          <Unlink className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {pendingPushEvents.length > 0 && !googleSession.connected && (
                    <p className="text-[11px] text-[#E5C17B] border-t border-white/8 pt-2">
                      <strong>{pendingPushEvents.length} atividade(s)</strong> aguardando envio ao Google Calendar.
                    </p>
                  )}

                  {/* Admin-only collapsible calendar switcher */}
                  {showAdminCalPicker && googleSession.connected && googleCalendars.length > 0 && (
                    <div className="pt-2.5 border-t border-white/8 space-y-1.5">
                      <label
                        htmlFor="admin-cal-select"
                        className="block text-[10px] font-mono uppercase tracking-wider text-[#C8A461]"
                      >
                        Alterar calendário associado:
                      </label>
                      <select
                        id="admin-cal-select"
                        value={linkedCalendarId}
                        disabled={syncingGoogle}
                        onChange={(e) => void handleAdminSwitchCalendar(e.target.value)}
                        className="siscom-input !min-h-[36px] text-xs w-full"
                      >
                        {googleCalendars.map((cal) => (
                          <option key={cal.id} value={cal.id}>
                            {cal.summary} {cal.primary ? '(Principal da conta)' : '(Secundário)'}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              ) : (
                /* Non-admin view: zero Google login buttons, zero calendar switcher — already pre-associated! */
                <div className="space-y-2 text-xs">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span className="w-7 h-7 rounded-lg border border-[#83B499]/30 bg-[#2D5A43]/25 flex items-center justify-center text-[#A7D3BA] shrink-0">
                      <Lock className="w-3.5 h-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-[#F4E6C4] truncate">
                        {linkedCalendarSummary}
                      </p>
                      <p className="text-[11px] text-[#98A89F]">
                        Sync {formatSyncTimestamp(savedGoogleConfig?.lastSyncAt)} · Gerenciado pelo Admin
                      </p>
                    </div>
                  </div>

                  {pendingPushEvents.length > 0 && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#C29B56]/30 bg-[#221D12] text-[11px] text-[#E5C17B]">
                      <CloudUpload className="w-3.5 h-3.5" />
                      {pendingPushEvents.length} aguardando envio ao Google
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Desktop Selected Day Details Panel (anchored inside fixed left sidebar when in Month view) */}
            {viewMode === 'month' && !loadingEvents && (
              <div className="hidden lg:block">{selectedDayPanel}</div>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          {/* Feedback Alerts */}
          {notice && (
            <SiscomAlert tone="success" onDismiss={() => setNotice(null)}>
              {notice}
            </SiscomAlert>
          )}
          {errorMsg && (
            <SiscomAlert
              tone="error"
              onDismiss={() => {
                setErrorMsg(null);
                setUnauthorizedDomainHelp(null);
              }}
            >
              <div className="space-y-2">
                <p>{errorMsg}</p>
                {unauthorizedDomainHelp && (
                  <div className="rounded-lg border border-red-400/25 bg-[#120A0A]/80 p-3 space-y-2 text-xs text-[#E4EAE6]">
                    <p className="font-semibold text-[#F4E6C4]">
                      Como liberar este domínio em 30 segundos:
                    </p>
                    <ol className="list-decimal list-inside space-y-1 text-[#C6D4CC]">
                      <li>
                        Copie o domínio exato abaixo:{' '}
                        <code className="px-1.5 py-0.5 rounded bg-black/50 text-[#E5C17B] font-mono text-[11px] break-all">
                          {unauthorizedDomainHelp.domain}
                        </code>
                      </li>
                      <li>
                        Abra <strong>Firebase Authentication → Settings → Domínios autorizados</strong>{' '}
                        do projeto <strong>{GOOGLE_CALENDAR_FIREBASE_PROJECT_ID}</strong> e clique em{' '}
                        <strong>Adicionar domínio</strong>.
                      </li>
                      <li>Volte aqui e clique novamente em “Sincronizar com Google”.</li>
                    </ol>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(unauthorizedDomainHelp.domain);
                          setCopiedDomain(true);
                          setTimeout(() => setCopiedDomain(false), 2500);
                        }}
                        className="siscom-btn siscom-btn-secondary !min-h-[32px] !px-2.5 text-[11px]"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>{copiedDomain ? 'Domínio copiado!' : 'Copiar domínio'}</span>
                      </button>
                      <a
                        href={unauthorizedDomainHelp.consoleUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="siscom-btn siscom-btn-gold !min-h-[32px] !px-2.5 text-[11px]"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Abrir Domínios Autorizados</span>
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </SiscomAlert>
          )}

          {/* Active Reminders Strip */}
          {activeReminders.length > 0 && (
            <div className="rounded-xl border border-[#C29B56]/40 bg-gradient-to-r from-[#221D12] via-[#1A1A14] to-[#121815] p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#C29B56]/20 border border-[#C29B56]/40 flex items-center justify-center text-[#E5C17B] shrink-0">
                  <BellRing className="w-4 h-4" />
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs font-display font-semibold text-[#F4E6C4]">
                    {activeReminders.length === 1
                      ? 'Lembrete ativo da Agenda'
                      : `${activeReminders.length} lembretes ativos`}
                  </p>
                  <p className="text-xs text-[#C6D4CC]">
                    {activeReminders.slice(0, 2).map((ev, idx) => {
                      const dt = parseEventDate(ev.startAt, ev.allDay, false);
                      return (
                        <span key={ev.id}>
                          {idx > 0 ? ' · ' : ''}
                          <strong className="text-[#E5C17B]">{ev.title}</strong> (
                          {ev.allDay ? 'Dia inteiro' : formatTimeShort(dt)})
                        </span>
                      );
                    })}
                    {activeReminders.length > 2 ? ` e +${activeReminders.length - 2}` : ''}
                  </p>
                </div>
              </div>

              {notifPermission === 'default' && (
                <button
                  type="button"
                  onClick={() => void handleEnableBrowserNotifications()}
                  className="siscom-btn siscom-btn-gold !min-h-[36px] text-xs shrink-0"
                >
                  <Bell className="w-3.5 h-3.5" />
                  <span>Ativar alertas do navegador</span>
                </button>
              )}
            </div>
          )}

          {/* View Mode & Date Navigation Header */}
          <section className="siscom-card p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3">
            <SiscomSegmentedTabs
              options={VIEW_OPTIONS}
              value={viewMode}
              onChange={setViewMode}
              layoutId="agenda-view-tabs"
              ariaLabel="Visualização da Agenda"
            />

            {viewMode !== 'history' && (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleNavigateDate(-1)}
                  aria-label="Período anterior"
                  className="siscom-btn siscom-btn-secondary !min-h-[38px] !px-2.5"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleGoToday}
                  className="siscom-btn siscom-btn-secondary !min-h-[38px] !px-3 text-xs"
                >
                  Hoje
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigateDate(1)}
                  aria-label="Próximo período"
                  className="siscom-btn siscom-btn-secondary !min-h-[38px] !px-2.5"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <h2 className="font-display text-sm sm:text-base font-semibold text-[#F4E6C4] pl-1.5">
                  {viewMode === 'day' ? formatFullDayTitle(selectedDay) : formatMonthTitle(anchorDate)}
                </h2>
              </div>
            )}
          </section>

          {/* Main Content Area */}
          {loadingEvents ? (
            <div className="siscom-card p-12 flex flex-col items-center justify-center gap-3">
              <SiscomSpinner className="w-6 h-6" />
              <p className="text-xs text-[#98A89F]">Carregando atividades da Agenda...</p>
            </div>
          ) : viewMode === 'month' ? (
            /* ── MONTHLY VIEW ─────────────────────────────────────────────────── */
            <div className="space-y-4">
              <section className="siscom-card overflow-hidden">
            <div className="grid grid-cols-7 border-b border-white/10 bg-black/28">
              {WEEKDAYS_PT.map((wd) => (
                <div
                  key={wd}
                  className="py-2.5 text-center text-[11px] font-mono uppercase tracking-wider text-[#B8B3A6]"
                >
                  {wd}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 divide-x divide-y divide-white/[0.07]">
              {monthDays.map((day) => {
                const key = formatLocalDateKey(day);
                const isCurrentMonth = day.getMonth() === anchorDate.getMonth();
                const isToday = key === todayKey;
                const isSelected = key === selectedDayKey;
                const dayEvents = visibleEvents.filter((ev) => eventOverlapsDay(ev, day));

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedDay(startOfDay(day))}
                    className={`min-h-[84px] sm:min-h-[108px] p-1.5 sm:p-2 text-left flex flex-col gap-1 transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#213A2D]/58 ring-1 ring-inset ring-[#C9A961]/65'
                        : isCurrentMonth
                          ? 'bg-white/[0.02] hover:bg-white/[0.055]'
                          : 'bg-black/28 opacity-55 hover:opacity-85'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-mono ${
                          isToday
                            ? 'bg-[#C29B56] text-[#0B0F0E] font-bold'
                            : isSelected
                              ? 'text-[#F4E6C4] font-semibold'
                              : 'text-[#C6D4CC]'
                        }`}
                      >
                        {day.getDate()}
                      </span>
                      {dayEvents.length > 0 && (
                        <span className="text-[10px] font-mono text-[#98A89F]">
                          {dayEvents.length}
                        </span>
                      )}
                    </div>

                    <div className="space-y-1 w-full overflow-hidden">
                      {dayEvents.slice(0, 3).map((ev) => {
                        const cat = AGENDA_CATEGORY_MAP[ev.category] || AGENDA_CATEGORY_MAP.outros;
                        const customColor = getGoogleColorHex(ev.colorId);
                        const scope = getEffectiveComsocScope(ev);
                        return (
                          <div
                            key={ev.id}
                            className={`px-1.5 py-0.5 rounded text-[10px] leading-tight truncate flex items-center gap-1 ${
                              scope === 'pending'
                                ? 'bg-[#2B2210] text-[#F4E6C4] border border-[#E5C17B]/40'
                                : scope === 'general'
                                  ? 'bg-[#1A242D] text-[#CDE0F2] border border-[#93B7D8]/25'
                                  : 'bg-[#19231E] text-[#E4EAE6] border border-white/10'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                customColor ? '' : cat.dotClass
                              }`}
                              style={customColor ? { backgroundColor: customColor } : undefined}
                            />
                            <span className="truncate">{ev.title}</span>
                          </div>
                        );
                      })}
                      {dayEvents.length > 3 && (
                        <div className="text-[10px] font-mono text-[#E5C17B] pl-1">
                          +{dayEvents.length - 3} mais
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Mobile Selected Day Panel (renders below calendar on touch screens; desktop uses fixed left sidebar) */}
          <div className="lg:hidden">{selectedDayPanel}</div>
        </div>
      ) : viewMode === 'week' ? (
        /* ── WEEKLY VIEW ──────────────────────────────────────────────────── */
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-2.5">
          {weekDays.map((day) => {
            const key = formatLocalDateKey(day);
            const isToday = key === todayKey;
            const dayEvents = visibleEvents.filter((ev) => eventOverlapsDay(ev, day));

            return (
              <div
                key={key}
                className={`siscom-card p-3 flex flex-col gap-2.5 min-h-[260px] ${
                  isToday ? '!border-[#C29B56]/55' : ''
                }`}
              >
                <div className="flex items-center justify-between border-b border-white/8 pb-2">
                  <div>
                    <span className="block text-[10px] font-mono uppercase tracking-wider text-[#98A89F]">
                      {WEEKDAYS_PT[day.getDay()]}
                    </span>
                    <span
                      className={`font-display text-base font-semibold ${
                        isToday ? 'text-[#E5C17B]' : 'text-[#F4E6C4]'
                      }`}
                    >
                      {String(day.getDate()).padStart(2, '0')}/
                      {String(day.getMonth() + 1).padStart(2, '0')}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => openCreateModal(day)}
                    title="Nova atividade neste dia"
                    className="p-1.5 rounded-lg border border-white/10 text-[#98A89F] hover:text-[#F4E6C4] hover:border-white/25 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {dayEvents.length === 0 ? (
                  <p className="text-[11px] text-[#697870] py-4 text-center">Livre</p>
                ) : (
                  <div className="space-y-2">
                    {dayEvents.map((ev) => {
                      const cat = AGENDA_CATEGORY_MAP[ev.category] || AGENDA_CATEGORY_MAP.outros;
                      const start = parseEventDate(ev.startAt, ev.allDay, false);
                      const customColor = getGoogleColorHex(ev.colorId);
                      const scope = getEffectiveComsocScope(ev);
                      return (
                        <button
                          key={ev.id}
                          type="button"
                          onClick={() => openEditModal(ev)}
                          className={`w-full text-left rounded-lg border border-white/[0.12] border-l-[3px] ${cat.borderClass} bg-black/28 hover:bg-white/[0.06] p-2 space-y-1 hover:border-white/25 cursor-pointer transition-colors`}
                          style={customColor ? { borderLeftColor: customColor } : undefined}
                        >
                          <div className="flex items-center justify-between gap-1 text-[10px] font-mono text-[#C8A461]">
                            <span>{ev.allDay ? 'Dia inteiro' : formatTimeShort(start)}</span>
                            <span className="text-[9px] text-[#98A89F]">
                              {scope === 'comsoc' ? 'COMSOC' : scope === 'pending' ? 'Triagem' : 'Geral'}
                            </span>
                          </div>
                          <p className="text-xs font-medium text-[#F4E6C4] line-clamp-2">
                            {ev.title}
                          </p>
                          {ev.location && (
                            <p className="text-[10px] text-[#98A89F] truncate">{ev.location}</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ) : viewMode === 'day' ? (
        /* ── DAILY VIEW ───────────────────────────────────────────────────── */
        <section className="siscom-card p-4 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 pb-3">
            <div>
              <p className="text-[11px] font-mono uppercase tracking-wider text-[#C8A461]">
                Programação diária ·{' '}
                {calendarScope === 'comsoc' ? 'Calendário COMSOC' : 'Calendário Geral'}
              </p>
              <h3 className="font-display text-lg font-semibold text-[#F4E6C4]">
                {formatFullDayTitle(selectedDay)}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => openCreateModal(selectedDay)}
              className="siscom-btn siscom-btn-primary !min-h-[38px] text-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Nova atividade neste dia</span>
            </button>
          </div>

          {selectedDayEvents.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <CalendarIcon className="w-9 h-9 text-[#697870] mx-auto opacity-70" />
              <p className="text-sm text-[#98A89F]">
                Nenhuma atividade programada para esta data.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {selectedDayEvents.map((ev) => renderEventCard(ev, false))}
            </div>
          )}
        </section>
      ) : (
        /* ── HISTORY & AUDIT VIEW ─────────────────────────────────────────── */
        <section className="siscom-card p-4 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 pb-3">
            <div className="flex items-center gap-2.5">
              <History className="w-5 h-5 text-[#E5C17B]" />
              <h3 className="font-display text-base font-semibold text-[#F4E6C4]">
                Histórico
              </h3>
            </div>

            <SiscomSegmentedTabs
              options={[
                { value: 'events' as const, label: `Atividades (${historyEvents.length})` },
                { value: 'audit' as const, label: `Auditoria (${auditLogs.length})` },
              ]}
              value={historySubTab}
              onChange={setHistorySubTab}
              layoutId="agenda-history-tabs"
              ariaLabel="Sub-abas do histórico"
            />
          </div>

          {historySubTab === 'events' ? (
            historyEvents.length === 0 ? (
              <div className="py-10 text-center text-xs text-[#98A89F]">
                Ainda não há atividades concluídas ou passadas neste calendário.
              </div>
            ) : (
              <div className="space-y-3">
                {historyEvents.map((ev) => renderEventCard(ev, false))}
              </div>
            )
          ) : auditLogs.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#98A89F]">
              Nenhum registro de auditoria disponível ainda.
            </div>
          ) : (
            <div className="divide-y divide-white/[0.07] rounded-xl siscom-liquid-subcard">
              {auditLogs.map((log) => (
                <div
                  key={log.id}
                  className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs"
                >
                  <div className="space-y-0.5">
                    <p className="text-[#E4EAE6]">{log.summary}</p>
                    <p className="text-[11px] text-[#98A89F]">Responsável: {log.actorName}</p>
                  </div>
                  <span className="text-[11px] font-mono text-[#697870] shrink-0">
                    {log.createdAt?.toDate
                      ? log.createdAt.toDate().toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'Agora'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
        </div>
      </WorkspaceSplitLayout>

      {/* Tinder-Style Swipe Triage Deck */}
      <AgendaTriageDeck
        open={triageOpen}
        pendingEvents={pendingTriageEvents}
        busyId={triageBusyId}
        onClose={() => setTriageOpen(false)}
        onClassify={handleClassifyTriage}
      />

      {/* 6-Card Create / Edit Activity Modal */}
      <AgendaEventModal
        open={modalOpen}
        editingEvent={editingEvent}
        defaultDate={selectedDay}
        defaultComsocScope={calendarScope}
        googleConnected={googleSession.connected}
        linkedCalendarLabel={linkedCalendarSummary}
        contactSuggestions={contactSuggestions}
        locationSuggestions={locationSuggestions}
        saving={savingEvent}
        errorMsg={modalError}
        onClose={() => {
          if (!savingEvent) {
            setModalOpen(false);
            setEditingEvent(null);
          }
        }}
        onSubmit={(values) => void handleFormSubmit(values)}
      />

      {/* Mandatory Explicit Confirmation Modal for Google Calendar Mutations & Deletions */}
      <GoogleActionConfirmModal
        pending={pendingConfirm}
        busy={confirmBusy}
        onCancel={() => {
          if (!confirmBusy) setPendingConfirm(null);
        }}
      />
    </>
  );
}
