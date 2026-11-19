import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import {
  Bell,
  BellRing,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cloud,
  CloudOff,
  ExternalLink,
  History,
  Link2,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Trash2,
  Unlink,
} from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import {
  SiscomAlert,
  SiscomSegmentedTabs,
  SiscomSpinner,
} from '../../shared/ui';
import {
  AgendaEventModal,
  CategoryDotLabel,
  EventFormValues,
  GoogleActionConfirmModal,
  GoogleRemoteEventModal,
  PendingGoogleConfirmation,
  ResponsibleInline,
} from './AgendaEventModal';
import {
  createAgendaEvent,
  deleteAgendaEvent,
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
  GoogleCalendarListItem,
  GoogleCalendarRemoteEvent,
  UnifiedCalendarEntry,
  formatLocalDateKey,
  formatTimeShort,
  parseEventDate,
} from './agendaTypes';
import {
  GoogleCalendarSession,
  connectGoogleCalendar,
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  disconnectGoogleCalendarSession,
  fetchGoogleCalendarEvents,
  listGoogleCalendars,
  subscribeGoogleCalendarSession,
  updateGoogleCalendarEvent,
} from './googleCalendarService';

type AgendaViewMode = 'month' | 'week' | 'day' | 'history';

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

function entryOverlapsDay(entry: UnifiedCalendarEntry, day: Date): boolean {
  const dStart = startOfDay(day).getTime();
  const dEnd = endOfDay(day).getTime();
  return entry.startDate.getTime() <= dEnd && entry.endDate.getTime() >= dStart;
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

  // View & Navigation state
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

  // Google Calendar runtime state (token strictly in-memory via googleCalendarService)
  const [googleSession, setGoogleSession] = useState<GoogleCalendarSession>({
    connected: false,
    email: null,
    displayName: null,
  });
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendarListItem[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('');
  const [googleRemoteEvents, setGoogleRemoteEvents] = useState<GoogleCalendarRemoteEvent[]>([]);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [loadingGoogleEvents, setLoadingGoogleEvents] = useState(false);

  // Modals & Alerts
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<AgendaEvent | null>(null);
  const [savingEvent, setSavingEvent] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingGoogleConfirmation | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [selectedRemoteEvent, setSelectedRemoteEvent] =
    useState<GoogleCalendarRemoteEvent | null>(null);
  const [importingRemote, setImportingRemote] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
        // Keep audit non-blocking
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

  // Subscribe to in-memory Google Calendar OAuth session
  useEffect(() => {
    return subscribeGoogleCalendarSession((session) => {
      setGoogleSession(session);
      if (!session.connected) {
        setGoogleCalendars([]);
        setGoogleRemoteEvents([]);
      }
    });
  }, []);

  // Currently selected Google Calendar metadata
  const selectedCalendar = useMemo(() => {
    if (!selectedCalendarId) return null;
    return googleCalendars.find((c) => c.id === selectedCalendarId) || null;
  }, [googleCalendars, selectedCalendarId]);

  const secondaryCalendars = useMemo(
    () => googleCalendars.filter((c) => !c.primary),
    [googleCalendars]
  );
  const primaryCalendar = useMemo(
    () => googleCalendars.find((c) => c.primary) || null,
    [googleCalendars]
  );

  // Visible time window for Google Calendar remote event queries
  const visibleRange = useMemo(() => {
    const start = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - 1, 1);
    const end = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 2, 0, 23, 59, 59);
    return { timeMin: start.toISOString(), timeMax: end.toISOString() };
  }, [anchorDate]);

  const loadRemoteEventsForCalendar = useCallback(
    async (calendar: GoogleCalendarListItem) => {
      setLoadingGoogleEvents(true);
      try {
        const list = await fetchGoogleCalendarEvents(
          calendar.id,
          calendar.summary,
          visibleRange.timeMin,
          visibleRange.timeMax
        );
        setGoogleRemoteEvents(list);
      } catch (err) {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Não foi possível consultar eventos do Google Calendar.'
        );
      } finally {
        setLoadingGoogleEvents(false);
      }
    },
    [visibleRange.timeMax, visibleRange.timeMin]
  );

  // Refresh remote Google Calendar events when calendar or month range changes
  useEffect(() => {
    if (!googleSession.connected || !selectedCalendar) {
      setGoogleRemoteEvents([]);
      return;
    }
    void loadRemoteEventsForCalendar(selectedCalendar);
  }, [googleSession.connected, selectedCalendar, loadRemoteEventsForCalendar]);

  const handleConnectGoogle = async () => {
    if (!account) return;
    setConnectingGoogle(true);
    setErrorMsg(null);
    setNotice(null);
    try {
      const session = await connectGoogleCalendar();
      const calendars = await listGoogleCalendars();
      setGoogleCalendars(calendars);

      // Prefer saved secondary calendar -> else first writable secondary calendar -> else none forced
      const savedId = savedGoogleConfig?.selectedCalendarId;
      const savedMatch = savedId ? calendars.find((c) => c.id === savedId) : undefined;
      const firstSecondary = calendars.find(
        (c) => !c.primary && (c.accessRole === 'owner' || c.accessRole === 'writer')
      );
      const fallbackSecondary = calendars.find((c) => !c.primary);
      const chosen = savedMatch || firstSecondary || fallbackSecondary || calendars[0] || null;

      if (chosen) {
        setSelectedCalendarId(chosen.id);
        if (!savedMatch && !chosen.primary) {
          await saveSelectedGoogleCalendarConfig({
            calendarId: chosen.id,
            calendarSummary: chosen.summary,
            actor: account,
          });
        }
      }

      void recordAgendaAudit({
        actor: account,
        action: 'google_connect',
        summary: `Integração Google Calendar conectada (${session.email || 'conta Google'}).`,
      });

      if (calendars.every((c) => c.primary)) {
        setNotice(
          'Conta Google conectada. Dica: crie um calendário secundário no Google Calendar (ex: "COMSOC") e clique em Atualizar para separar da sua agenda pessoal.'
        );
      } else {
        setNotice(
          `Google Calendar conectado (${session.email || 'conta institucional'}). Confira o calendário secundário selecionado.`
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao conectar Google Calendar.');
    } finally {
      setConnectingGoogle(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    if (!account) return;
    await disconnectGoogleCalendarSession();
    setSelectedCalendarId('');
    setGoogleCalendars([]);
    setGoogleRemoteEvents([]);
    setNotice('Google Calendar desconectado com segurança nesta sessão.');
    void recordAgendaAudit({
      actor: account,
      action: 'google_disconnect',
      summary: 'Sessão do Google Calendar desconectada.',
    });
  };

  const handleSelectCalendar = async (nextId: string) => {
    setSelectedCalendarId(nextId);
    const cal = googleCalendars.find((c) => c.id === nextId);
    if (cal && account) {
      try {
        await saveSelectedGoogleCalendarConfig({
          calendarId: cal.id,
          calendarSummary: cal.summary,
          actor: account,
        });
      } catch {
        // Non-fatal preference save
      }
    }
  };

  const handleRefreshGoogle = async () => {
    if (!googleSession.connected) return;
    setErrorMsg(null);
    setLoadingGoogleEvents(true);
    try {
      const calendars = await listGoogleCalendars();
      setGoogleCalendars(calendars);
      const active =
        calendars.find((c) => c.id === selectedCalendarId) ||
        calendars.find((c) => !c.primary) ||
        calendars[0] ||
        null;
      if (active) {
        setSelectedCalendarId(active.id);
        await loadRemoteEventsForCalendar(active);
      }
      setNotice('Calendários e eventos do Google Calendar atualizados.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Falha ao atualizar Google Calendar.');
    } finally {
      setLoadingGoogleEvents(false);
    }
  };

  // Deduplicate Google remote events against internal SISCOM events
  const unifiedEntries = useMemo<UnifiedCalendarEntry[]>(() => {
    const siscomById = new Set(events.map((e) => e.id));
    const syncedGoogleIds = new Set(
      events.filter((e) => e.googleEventId).map((e) => e.googleEventId)
    );

    const siscomEntries: UnifiedCalendarEntry[] = events
      .filter((ev) => {
        if (categoryFilter !== 'all' && ev.category !== categoryFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.trim().toLowerCase();
          const haystack = `${ev.title} ${ev.location} ${ev.responsibles} ${ev.description}`.toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .map((ev) => ({
        origin: 'siscom',
        event: ev,
        startDate: parseEventDate(ev.startAt, ev.allDay, false),
        endDate: parseEventDate(ev.endAt, ev.allDay, true),
      }));

    const remoteEntries: UnifiedCalendarEntry[] =
      categoryFilter !== 'all'
        ? []
        : googleRemoteEvents
            .filter((rem) => {
              if (syncedGoogleIds.has(rem.id)) return false;
              if (rem.siscomEventId && siscomById.has(rem.siscomEventId)) return false;
              if (searchQuery.trim()) {
                const q = searchQuery.trim().toLowerCase();
                const haystack = `${rem.summary} ${rem.location} ${rem.description}`.toLowerCase();
                if (!haystack.includes(q)) return false;
              }
              return true;
            })
            .map((rem) => ({
              origin: 'google_only',
              remote: rem,
              startDate: parseEventDate(rem.startAt, rem.allDay, false),
              endDate: parseEventDate(rem.endAt, rem.allDay, true),
            }));

    return [...siscomEntries, ...remoteEntries].sort(
      (a, b) => a.startDate.getTime() - b.startDate.getTime()
    );
  }, [events, googleRemoteEvents, categoryFilter, searchQuery]);

  // Active Reminders: scheduled events starting soon within their configured reminder window
  const activeReminders = useMemo(() => {
    const now = Date.now();
    return events
      .filter((ev) => {
        if (ev.status !== 'agendado' || ev.reminderMinutes <= 0) return false;
        const startMs = parseEventDate(ev.startAt, ev.allDay, false).getTime();
        const windowMs = ev.reminderMinutes * 60_000;
        return startMs >= now - 15 * 60_000 && startMs - now <= windowMs;
      })
      .sort(
        (a, b) =>
          parseEventDate(a.startAt, a.allDay, false).getTime() -
          parseEventDate(b.startAt, b.allDay, false).getTime()
      );
  }, [events]);

  // Trigger optional browser notifications once per active reminder
  useEffect(() => {
    if (notifPermission !== 'granted' || typeof window === 'undefined' || !('Notification' in window)) {
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

  // History list: completed, cancelled, or past events
  const historyEvents = useMemo(() => {
    const now = Date.now();
    return events
      .filter((ev) => {
        const endMs = parseEventDate(ev.endAt, ev.allDay, true).getTime();
        const isPastOrClosed = ev.status !== 'agendado' || endMs < now;
        if (!isPastOrClosed) return false;
        if (categoryFilter !== 'all' && ev.category !== categoryFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.trim().toLowerCase();
          const hay = `${ev.title} ${ev.location} ${ev.responsibles} ${ev.description}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          parseEventDate(b.startAt, b.allDay, false).getTime() -
          parseEventDate(a.startAt, a.allDay, false).getTime()
      );
  }, [events, categoryFilter, searchQuery]);

  // Open Create/Edit modal
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

  // Submit Create or Edit (enforces explicit confirmation modal before mutating Google Calendar!)
  const handleFormSubmit = async (values: EventFormValues) => {
    if (!account) return;
    setModalError(null);
    setErrorMsg(null);
    const { startAt, endAt } = formValuesToIsoRange(values);

    const canSyncNow =
      values.syncWithGoogle &&
      googleSession.connected &&
      Boolean(selectedCalendar) &&
      (selectedCalendar?.accessRole === 'owner' || selectedCalendar?.accessRole === 'writer');

    // Case 1: Editing an existing event
    if (editingEvent) {
      const targetCalendarId =
        editingEvent.googleCalendarId || selectedCalendar?.id || '';
      const targetCalendarSummary =
        editingEvent.googleCalendarSummary || selectedCalendar?.summary || 'Google Calendar';

      const willMutateGoogle =
        canSyncNow && Boolean(editingEvent.googleEventId && targetCalendarId);
      const willPushNewToGoogle =
        canSyncNow && !editingEvent.googleEventId && Boolean(selectedCalendar);

      const executeSave = async (syncGoogle: boolean) => {
        setSavingEvent(true);
        try {
          const baseUpdates = {
            title: values.title,
            category: values.category,
            status: values.status,
            startAt,
            endAt,
            allDay: values.allDay,
            location: values.location,
            responsibles: values.responsibles,
            description: values.description,
            reminderMinutes: values.reminderMinutes,
          };

          await updateAgendaEvent(
            editingEvent.id,
            baseUpdates,
            account,
            `Atividade atualizada: "${values.title.trim()}"`
          );

          const mergedEvent: AgendaEvent = {
            ...editingEvent,
            ...baseUpdates,
          };

          if (syncGoogle && editingEvent.googleEventId && targetCalendarId) {
            const updatedRemote = await updateGoogleCalendarEvent(
              targetCalendarId,
              editingEvent.googleEventId,
              mergedEvent
            );
            await updateAgendaEvent(editingEvent.id, {
              googleEventId: updatedRemote.googleEventId,
              googleHtmlLink: updatedRemote.htmlLink,
              syncStatus: 'synced',
              lastSyncedAt: new Date().toISOString(),
            }, account);
            void recordAgendaAudit({
              actor: account,
              action: 'sync_update',
              eventId: editingEvent.id,
              summary: `Evento atualizado no Google Calendar ("${targetCalendarSummary}"): "${values.title.trim()}"`,
            });
            setNotice(`Atividade salva e atualizada no Google Calendar ("${targetCalendarSummary}").`);
          } else if (syncGoogle && selectedCalendar) {
            const createdRemote = await createGoogleCalendarEvent(
              selectedCalendar.id,
              mergedEvent
            );
            await updateAgendaEvent(editingEvent.id, {
              googleEventId: createdRemote.googleEventId,
              googleCalendarId: selectedCalendar.id,
              googleCalendarSummary: selectedCalendar.summary,
              googleHtmlLink: createdRemote.htmlLink,
              syncStatus: 'synced',
              lastSyncedAt: new Date().toISOString(),
            }, account);
            void recordAgendaAudit({
              actor: account,
              action: 'sync_push',
              eventId: editingEvent.id,
              summary: `Atividade sincronizada no Google Calendar ("${selectedCalendar.summary}"): "${values.title.trim()}"`,
            });
            setNotice(`Atividade salva e sincronizada no calendário "${selectedCalendar.summary}".`);
          } else {
            setNotice('Alterações salvas na Agenda interna do SISCOM.');
          }

          if (selectedCalendar && googleSession.connected) {
            void loadRemoteEventsForCalendar(selectedCalendar);
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

      // MANDATORY confirmation before mutating Google Calendar
      if (willMutateGoogle || willPushNewToGoogle) {
        setPendingConfirm({
          type: willMutateGoogle ? 'update_google' : 'push_google',
          eventTitle: values.title.trim(),
          calendarSummary: willMutateGoogle
            ? targetCalendarSummary
            : selectedCalendar?.summary || 'Google Calendar',
          isSynced: willMutateGoogle,
          onConfirm: async () => {
            setConfirmBusy(true);
            try {
              await executeSave(true);
              setPendingConfirm(null);
            } finally {
              setConfirmBusy(false);
            }
          },
        });
        return;
      }

      await executeSave(false);
      return;
    }

    // Case 2: Creating a new event
    const executeCreate = async (syncGoogle: boolean) => {
      setSavingEvent(true);
      try {
        const created = await createAgendaEvent(
          {
            title: values.title,
            category: values.category,
            status: values.status,
            startAt,
            endAt,
            allDay: values.allDay,
            location: values.location,
            responsibles: values.responsibles,
            description: values.description,
            reminderMinutes: values.reminderMinutes,
            syncStatus: 'internal',
          },
          account
        );

        if (syncGoogle && selectedCalendar) {
          try {
            const remote = await createGoogleCalendarEvent(selectedCalendar.id, created);
            await updateAgendaEvent(created.id, {
              googleEventId: remote.googleEventId,
              googleCalendarId: selectedCalendar.id,
              googleCalendarSummary: selectedCalendar.summary,
              googleHtmlLink: remote.htmlLink,
              syncStatus: 'synced',
              lastSyncedAt: new Date().toISOString(),
            }, account);
            void recordAgendaAudit({
              actor: account,
              action: 'sync_push',
              eventId: created.id,
              summary: `Nova atividade enviada ao Google Calendar ("${selectedCalendar.summary}"): "${created.title}"`,
            });
            setNotice(`Atividade cadastrada e sincronizada com "${selectedCalendar.summary}".`);
            void loadRemoteEventsForCalendar(selectedCalendar);
          } catch (googleErr) {
            await updateAgendaEvent(created.id, { syncStatus: 'error' }, account);
            setErrorMsg(
              `Atividade salva no SISCOM, mas houve erro ao enviar ao Google Calendar: ${
                googleErr instanceof Error ? googleErr.message : 'erro desconhecido'
              }`
            );
          }
        } else {
          setNotice('Atividade cadastrada na Agenda interna da COMSOC.');
        }

        setSelectedDay(parseEventDate(startAt, values.allDay, false));
        setModalOpen(false);
      } catch (err) {
        setModalError(err instanceof Error ? err.message : 'Erro ao cadastrar atividade.');
      } finally {
        setSavingEvent(false);
      }
    };

    if (canSyncNow && selectedCalendar) {
      setPendingConfirm({
        type: 'push_google',
        eventTitle: values.title.trim(),
        calendarSummary: selectedCalendar.summary,
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

  // Manual push or update to Google Calendar for an existing event (with MANDATORY confirmation modal)
  const handleRequestSyncEvent = (ev: AgendaEvent) => {
    if (!account) return;
    if (!googleSession.connected || !selectedCalendar) {
      setErrorMsg('Conecte o Google Calendar e selecione o calendário secundário antes de sincronizar.');
      return;
    }
    if (selectedCalendar.accessRole !== 'owner' && selectedCalendar.accessRole !== 'writer') {
      setErrorMsg('O calendário selecionado é somente leitura. Escolha um calendário com permissão de escrita.');
      return;
    }

    const isAlreadySynced = Boolean(ev.googleEventId && ev.googleCalendarId);
    const targetCalendarId = isAlreadySynced ? ev.googleCalendarId : selectedCalendar.id;
    const targetCalendarSummary = isAlreadySynced
      ? ev.googleCalendarSummary || selectedCalendar.summary
      : selectedCalendar.summary;

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
            await updateAgendaEvent(ev.id, {
              googleEventId: res.googleEventId,
              googleHtmlLink: res.htmlLink,
              syncStatus: 'synced',
              lastSyncedAt: new Date().toISOString(),
            }, account);
            void recordAgendaAudit({
              actor: account,
              action: 'sync_update',
              eventId: ev.id,
              summary: `Atualização sincronizada no Google Calendar ("${targetCalendarSummary}"): "${ev.title}"`,
            });
            setNotice(`"${ev.title}" atualizado no Google Calendar ("${targetCalendarSummary}").`);
          } else {
            const res = await createGoogleCalendarEvent(targetCalendarId, ev);
            await updateAgendaEvent(ev.id, {
              googleEventId: res.googleEventId,
              googleCalendarId: targetCalendarId,
              googleCalendarSummary: targetCalendarSummary,
              googleHtmlLink: res.htmlLink,
              syncStatus: 'synced',
              lastSyncedAt: new Date().toISOString(),
            }, account);
            void recordAgendaAudit({
              actor: account,
              action: 'sync_push',
              eventId: ev.id,
              summary: `Atividade sincronizada no Google Calendar ("${targetCalendarSummary}"): "${ev.title}"`,
            });
            setNotice(`"${ev.title}" sincronizado no calendário "${targetCalendarSummary}".`);
          }
          if (selectedCalendar) {
            void loadRemoteEventsForCalendar(selectedCalendar);
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

  // Request deletion (ALWAYS shows explicit confirmation modal!)
  const handleRequestDeleteEvent = (ev: AgendaEvent) => {
    if (!account) return;
    const isSynced = Boolean(ev.googleEventId && ev.googleCalendarId);

    setPendingConfirm({
      type: 'delete_event',
      eventTitle: ev.title,
      calendarSummary: ev.googleCalendarSummary || 'Google Calendar',
      isSynced,
      onConfirm: async (alsoDeleteInGoogle: boolean) => {
        setConfirmBusy(true);
        setErrorMsg(null);
        try {
          if (isSynced && alsoDeleteInGoogle) {
            if (!googleSession.connected) {
              throw new Error(
                'Conecte o Google Calendar para remover o evento também na nuvem, ou desmarque a opção para excluir somente no SISCOM.'
              );
            }
            await deleteGoogleCalendarEvent(ev.googleCalendarId, ev.googleEventId);
            void recordAgendaAudit({
              actor: account,
              action: 'sync_delete',
              eventId: ev.id,
              summary: `Evento removido também no Google Calendar ("${ev.googleCalendarSummary || 'Google Calendar'}"): "${ev.title}"`,
            });
          }

          await deleteAgendaEvent(ev, account);
          setNotice(
            isSynced && alsoDeleteInGoogle
              ? `Atividade "${ev.title}" removida do SISCOM e do Google Calendar.`
              : `Atividade "${ev.title}" removida da Agenda interna do SISCOM.`
          );
          if (selectedCalendar && googleSession.connected) {
            void loadRemoteEventsForCalendar(selectedCalendar);
          }
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

  // Import Google-only event into SISCOM without duplicating in Google Calendar
  const handleImportRemoteToSiscom = async (remote: GoogleCalendarRemoteEvent) => {
    if (!account) return;
    setImportingRemote(true);
    setErrorMsg(null);
    try {
      await createAgendaEvent(
        {
          title: remote.summary,
          category: 'outros',
          status: 'agendado',
          startAt: remote.startAt,
          endAt: remote.endAt,
          allDay: remote.allDay,
          location: remote.location,
          responsibles: '',
          description: remote.description,
          reminderMinutes: 60,
          googleEventId: remote.id,
          googleCalendarId: remote.calendarId,
          googleCalendarSummary: remote.calendarSummary,
          googleHtmlLink: remote.htmlLink,
          syncStatus: 'synced',
          lastSyncedAt: new Date().toISOString(),
        },
        account
      );
      setSelectedRemoteEvent(null);
      setNotice(
        `Evento "${remote.summary}" importado e vinculado ao SISCOM sem duplicação no Google Calendar.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Falha ao importar evento.');
    } finally {
      setImportingRemote(false);
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

  const selectedDayEntries = useMemo(
    () => unifiedEntries.filter((entry) => entryOverlapsDay(entry, selectedDay)),
    [unifiedEntries, selectedDay]
  );

  // Reusable Event Card for Daily View & Month Side Panel
  const renderEntryCard = (entry: UnifiedCalendarEntry, compact = false) => {
    if (entry.origin === 'google_only') {
      const { remote } = entry;
      return (
        <div
          key={`g-${remote.id}`}
          className="rounded-xl border border-[#93B7D8]/28 border-l-[3px] border-l-[#7AA3C8] bg-[#101820]/75 p-3.5 space-y-2 transition-colors hover:border-[#93B7D8]/50"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#93B7D8]/35 bg-[#253B52]/40 text-[10px] font-mono uppercase tracking-wider text-[#CDE0F2]">
                  <Cloud className="w-3 h-3" />
                  Google Calendar
                </span>
                <span className="text-[11px] font-mono text-[#98A89F]">
                  {remote.allDay
                    ? 'Dia inteiro'
                    : `${formatTimeShort(entry.startDate)} – ${formatTimeShort(entry.endDate)}`}
                </span>
              </div>
              <h4 className="font-display text-sm font-semibold text-[#E4EAE6] leading-snug">
                {remote.summary}
              </h4>
            </div>
            <button
              type="button"
              onClick={() => setSelectedRemoteEvent(remote)}
              className="siscom-btn siscom-btn-secondary !min-h-[34px] !px-2.5 text-[11px] shrink-0"
            >
              Detalhes
            </button>
          </div>
          {remote.location && (
            <div className="flex items-center gap-1.5 text-[11px] text-[#98A89F]">
              <MapPin className="w-3 h-3 text-[#7AA3C8] shrink-0" />
              <span className="truncate">{remote.location}</span>
            </div>
          )}
        </div>
      );
    }

    const { event } = entry;
    const catMeta = AGENDA_CATEGORY_MAP[event.category] || AGENDA_CATEGORY_MAP.outros;
    const isCompleted = event.status === 'realizado';
    const isCancelled = event.status === 'cancelado';

    return (
      <article
        key={event.id}
        className={`rounded-xl border border-white/10 border-l-[3px] ${catMeta.borderClass} bg-[#121815] p-3.5 sm:p-4 space-y-2.5 transition-colors hover:border-white/18 ${
          isCancelled ? 'opacity-65' : ''
        }`}
      >
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <CategoryDotLabel category={event.category} />

              {event.syncStatus === 'synced' ? (
                <span
                  title={`Sincronizado com ${event.googleCalendarSummary || 'Google Calendar'}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#C29B56]/35 bg-[#221D12] text-[10px] font-mono text-[#E5C17B]"
                >
                  <Cloud className="w-3 h-3" />
                  Sincronizado
                </span>
              ) : event.syncStatus === 'error' ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-red-400/35 bg-red-950/50 text-[10px] font-mono text-red-200">
                  <CloudOff className="w-3 h-3" />
                  Erro de sync
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-white/12 bg-white/[0.03] text-[10px] font-mono text-[#98A89F]">
                  Interno
                </span>
              )}

              {event.status !== 'agendado' && (
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider ${
                    isCompleted
                      ? 'bg-[#2D5A43]/30 text-[#A7D3BA] border border-[#83B499]/30'
                      : 'bg-red-950/40 text-red-200 border border-red-400/25'
                  }`}
                >
                  {AGENDA_STATUS_LABELS[event.status]}
                </span>
              )}
            </div>

            <h4
              className={`font-display text-sm sm:text-[15px] font-semibold leading-snug ${
                isCancelled ? 'line-through text-[#98A89F]' : 'text-[#F4E6C4]'
              }`}
            >
              {event.title}
            </h4>
          </div>

          <div className="text-right shrink-0">
            <span className="inline-flex items-center gap-1 text-xs font-mono text-[#C8A461]">
              <Clock className="w-3.5 h-3.5" />
              {event.allDay
                ? 'Dia inteiro'
                : `${formatTimeShort(entry.startDate)} – ${formatTimeShort(entry.endDate)}`}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#98A89F]">
          {event.location && (
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <MapPin className="w-3.5 h-3.5 text-[#C8A461] shrink-0" />
              <span className="truncate">{event.location}</span>
            </span>
          )}
          <ResponsibleInline text={event.responsibles} />
          {event.reminderMinutes > 0 && event.status === 'agendado' && (
            <span className="inline-flex items-center gap-1 text-[11px] text-[#98A89F]">
              <Bell className="w-3 h-3 text-[#C8A461]" />
              {event.reminderMinutes >= 1440
                ? `${Math.round(event.reminderMinutes / 1440)}d antes`
                : event.reminderMinutes >= 60
                  ? `${Math.round(event.reminderMinutes / 60)}h antes`
                  : `${event.reminderMinutes}min antes`}
            </span>
          )}
        </div>

        {!compact && event.description && (
          <p className="text-xs text-[#C6D4CC] whitespace-pre-wrap leading-relaxed border-t border-white/6 pt-2">
            {event.description}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/6">
          <span className="text-[10px] font-mono text-[#697870]">
            Por {event.createdByName}
          </span>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleToggleCompleted(event)}
              title={isCompleted ? 'Reabrir atividade' : 'Marcar como realizada'}
              className="siscom-btn siscom-btn-secondary !min-h-[34px] !px-2.5 text-[11px]"
            >
              {isCompleted ? (
                <RotateCcw className="w-3.5 h-3.5 text-[#C8A461]" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 text-[#83B499]" />
              )}
              <span>{isCompleted ? 'Reabrir' : 'Concluir'}</span>
            </button>

            {googleSession.connected && (
              <button
                type="button"
                onClick={() => handleRequestSyncEvent(event)}
                title={
                  event.syncStatus === 'synced'
                    ? 'Reenviar atualização ao Google Calendar'
                    : 'Enviar para o Google Calendar'
                }
                className="siscom-btn siscom-btn-gold !min-h-[34px] !px-2.5 text-[11px]"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{event.syncStatus === 'synced' ? 'Atualizar Google' : 'Sincronizar'}</span>
              </button>
            )}

            {event.googleHtmlLink && (
              <a
                href={event.googleHtmlLink}
                target="_blank"
                rel="noreferrer"
                title="Abrir evento no Google Calendar"
                className="siscom-btn siscom-btn-secondary !min-h-[34px] !px-2 text-[11px]"
              >
                <ExternalLink className="w-3.5 h-3.5 text-[#C8A461]" />
              </a>
            )}

            <button
              type="button"
              onClick={() => openEditModal(event)}
              title="Editar atividade"
              aria-label={`Editar ${event.title}`}
              className="siscom-btn siscom-btn-secondary !min-h-[34px] !px-2.5 text-[11px]"
            >
              <Pencil className="w-3.5 h-3.5" />
              {!compact && <span>Editar</span>}
            </button>

            <button
              type="button"
              onClick={() => handleRequestDeleteEvent(event)}
              title="Excluir atividade"
              aria-label={`Excluir ${event.title}`}
              className="siscom-btn siscom-btn-danger !min-h-[34px] !px-2.5 text-[11px]"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </article>
    );
  };

  return (
    <main className="flex-1 max-w-[1320px] w-full mx-auto p-4 sm:p-6 space-y-5">
      {/* Feedback Banners */}
      <AnimatePresence>
        {(notice || errorMsg) && (
          <SiscomAlert
            tone={errorMsg ? 'error' : 'success'}
            onDismiss={() => {
              setNotice(null);
              setErrorMsg(null);
            }}
          >
            {errorMsg || notice}
          </SiscomAlert>
        )}
      </AnimatePresence>

      {/* Active Reminders Strip */}
      {activeReminders.length > 0 && (
        <section className="rounded-xl border border-[#C29B56]/35 bg-[#1B1810]/90 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <BellRing className="w-4 h-4 text-[#E5C17B] shrink-0 mt-0.5" />
            <div className="space-y-0.5 text-xs">
              <p className="font-semibold text-[#F4E6C4]">
                {activeReminders.length === 1
                  ? 'Lembrete ativo da COMSOC'
                  : `${activeReminders.length} lembretes ativos da COMSOC`}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[#C6D4CC]">
                {activeReminders.slice(0, 3).map((ev) => {
                  const st = parseEventDate(ev.startAt, ev.allDay, false);
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => {
                        setSelectedDay(startOfDay(st));
                        setAnchorDate(startOfDay(st));
                        setViewMode('day');
                      }}
                      className="underline decoration-[#C29B56]/50 hover:text-[#F4E6C4] text-left cursor-pointer"
                    >
                      {ev.title} ({ev.allDay ? 'Hoje' : formatTimeShort(st)})
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {notifPermission === 'default' && (
            <button
              type="button"
              onClick={() => void handleEnableBrowserNotifications()}
              className="siscom-btn siscom-btn-gold !min-h-[34px] !px-3 text-[11px]"
            >
              <Bell className="w-3.5 h-3.5" />
              <span>Ativar alertas no navegador</span>
            </button>
          )}
        </section>
      )}

      {/* Top Control Panel: Views + Primary CTA + Google Calendar Bar */}
      <section className="metal-surface rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <SiscomSegmentedTabs
              layoutId="agenda-view-tabs"
              options={VIEW_OPTIONS}
              value={viewMode}
              onChange={setViewMode}
              ariaLabel="Visualização da Agenda"
              className="w-full sm:w-auto sm:min-w-[340px]"
            />

            {viewMode !== 'history' && (
              <div className="flex items-center justify-between sm:justify-start gap-1.5">
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
                <h2 className="font-display text-sm sm:text-base font-semibold text-[#F4E6C4] pl-2 truncate">
                  {viewMode === 'day'
                    ? formatFullDayTitle(selectedDay)
                    : formatMonthTitle(anchorDate)}
                </h2>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openCreateModal(selectedDay)}
              className="siscom-btn siscom-btn-primary text-xs w-full sm:w-auto"
            >
              <Plus className="w-4 h-4" />
              <span>Nova atividade</span>
            </button>
          </div>
        </div>

        {/* Filters + Search Row */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_260px] gap-3 pt-1 border-t border-white/8">
          <div className="relative">
            <Search className="w-4 h-4 text-[#697870] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por título, local, responsável ou descrição..."
              className="siscom-input !pl-9 !min-h-[38px] text-xs"
            />
          </div>

          <select
            aria-label="Filtrar por categoria"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'all' | AgendaCategory)}
            className="siscom-input !min-h-[38px] text-xs"
          >
            <option value="all">Todas as categorias da COMSOC</option>
            {AGENDA_CATEGORIES.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.label}
              </option>
            ))}
          </select>
        </div>

        {/* Google Calendar Integration Bar */}
        <div className="rounded-xl border border-[#C29B56]/20 bg-[#0D1210] p-3.5 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#151D19] border border-white/10 flex items-center justify-center shrink-0">
                <CalendarIcon className="w-4 h-4 text-[#E5C17B]" />
              </div>
              <div className="space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xs font-semibold text-[#F4E6C4]">
                    Integração Google Calendar
                  </h3>
                  {googleSession.connected ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#83B499]/35 bg-[#2D5A43]/25 text-[10px] font-mono text-[#A7D3BA]">
                      <Link2 className="w-3 h-3" />
                      Conectado ({googleSession.email || 'Google'})
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-white/10 bg-white/[0.03] text-[10px] font-mono text-[#98A89F]">
                      Não conectado
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[#98A89F]">
                  {googleSession.connected
                    ? 'Sincronize atividades com o calendário secundário dedicado da COMSOC sem interferir na agenda pessoal.'
                    : 'Acesso exclusivo à Google Calendar API (sem permissão de Gmail). Conecte para escolher o calendário secundário da COMSOC.'}
                </p>
              </div>
            </div>

            {!googleSession.connected ? (
              <button
                type="button"
                disabled={connectingGoogle}
                onClick={() => void handleConnectGoogle()}
                className="inline-flex items-center justify-center gap-2.5 min-h-[40px] px-4 rounded-lg bg-white text-[#1F1F1F] hover:bg-[#F3F4F6] border border-white/20 text-xs font-semibold transition-colors shadow-sm cursor-pointer disabled:opacity-60 shrink-0"
              >
                {connectingGoogle ? (
                  <SiscomSpinner className="w-4 h-4" tone="olive" />
                ) : (
                  <GoogleGIcon className="w-4 h-4 shrink-0" />
                )}
                <span>
                  {connectingGoogle ? 'Conectando...' : 'Conectar Google Calendar'}
                </span>
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={loadingGoogleEvents}
                  onClick={() => void handleRefreshGoogle()}
                  className="siscom-btn siscom-btn-secondary !min-h-[36px] !px-3 text-xs"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 text-[#C8A461] ${
                      loadingGoogleEvents ? 'animate-spin' : ''
                    }`}
                  />
                  <span>Atualizar</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleDisconnectGoogle()}
                  className="siscom-btn siscom-btn-secondary !min-h-[36px] !px-3 text-xs text-red-200 hover:border-red-400/35"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  <span>Desconectar</span>
                </button>
              </div>
            )}
          </div>

          {/* Secondary Calendar Selector when connected */}
          {googleSession.connected && (
            <div className="pt-2.5 border-t border-white/8 flex flex-col sm:flex-row sm:items-center gap-3">
              <label
                htmlFor="google-cal-select"
                className="text-[11px] font-medium text-[#C6D4CC] shrink-0"
              >
                Calendário de destino:
              </label>
              <select
                id="google-cal-select"
                value={selectedCalendarId}
                onChange={(e) => void handleSelectCalendar(e.target.value)}
                className="siscom-input !min-h-[36px] text-xs max-w-md"
              >
                {secondaryCalendars.length > 0 && (
                  <optgroup label="Calendários secundários (Recomendado para a COMSOC)">
                    {secondaryCalendars.map((cal) => (
                      <option key={cal.id} value={cal.id}>
                        {cal.summary}
                        {cal.accessRole === 'reader' ? ' (somente leitura)' : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
                {primaryCalendar && (
                  <optgroup label="Calendário principal (Pessoal — evitar)">
                    <option value={primaryCalendar.id}>
                      {primaryCalendar.summary} (Principal / Pessoal)
                    </option>
                  </optgroup>
                )}
              </select>

              {selectedCalendar?.primary && (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-[#F0D69A]">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-[#E5C17B]" />
                  <span>
                    Atenção: este é o calendário pessoal principal. Prefira selecionar um calendário
                    secundário da COMSOC.
                  </span>
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Loading Indicator */}
      {loadingEvents ? (
        <div className="metal-surface rounded-xl p-10 flex items-center justify-center gap-2.5 text-xs text-[#98A89F]">
          <SiscomSpinner className="w-4 h-4" tone="gold" />
          <span>Carregando Agenda da Comunicação Social...</span>
        </div>
      ) : (
        <>
          {/* ── MONTHLY VIEW ─────────────────────────────────────────────── */}
          {viewMode === 'month' && (
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_370px] gap-5 items-start">
              <section className="metal-surface rounded-xl overflow-hidden">
                <div className="grid grid-cols-7 border-b border-white/8 bg-[#0E1311]">
                  {WEEKDAYS_PT.map((wd) => (
                    <div
                      key={wd}
                      className="py-2.5 text-center text-[11px] font-mono uppercase tracking-wider text-[#98A89F]"
                    >
                      {wd}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 divide-x divide-y divide-white/[0.06]">
                  {monthDays.map((day) => {
                    const key = formatLocalDateKey(day);
                    const inMonth = day.getMonth() === anchorDate.getMonth();
                    const isToday = key === todayKey;
                    const isSelected = key === selectedDayKey;
                    const dayEntries = unifiedEntries.filter((e) => entryOverlapsDay(e, day));

                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedDay(day)}
                        className={`min-h-[76px] sm:min-h-[106px] p-1.5 sm:p-2 text-left flex flex-col gap-1 transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-[#2D5A43]/22 ring-1 ring-inset ring-[#C29B56]/55'
                            : inMonth
                              ? 'bg-[#101513] hover:bg-white/[0.03]'
                              : 'bg-[#0B0E0D]/70 text-[#697870] hover:bg-white/[0.02]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-mono ${
                              isToday
                                ? 'bg-[#C29B56] text-[#0B0E0D] font-bold'
                                : inMonth
                                  ? 'text-[#E4EAE6]'
                                  : 'text-[#697870]'
                            }`}
                          >
                            {day.getDate()}
                          </span>
                          {dayEntries.length > 0 && (
                            <span className="sm:hidden text-[10px] font-mono text-[#E5C17B]">
                              {dayEntries.length}
                            </span>
                          )}
                        </div>

                        {/* Mobile compact dots */}
                        {dayEntries.length > 0 && (
                          <div className="flex sm:hidden flex-wrap gap-1 pt-0.5">
                            {dayEntries.slice(0, 4).map((ent, idx) => {
                              const dot =
                                ent.origin === 'google_only'
                                  ? 'bg-[#7AA3C8]'
                                  : AGENDA_CATEGORY_MAP[ent.event.category]?.dotClass ||
                                    'bg-[#98A89F]';
                              return (
                                <span
                                  key={idx}
                                  className={`w-1.5 h-1.5 rounded-full ${dot}`}
                                />
                              );
                            })}
                          </div>
                        )}

                        {/* Desktop/tablet event chips */}
                        <div className="hidden sm:flex flex-col gap-1 w-full min-w-0">
                          {dayEntries.slice(0, 3).map((ent) => {
                            if (ent.origin === 'google_only') {
                              return (
                                <span
                                  key={`g-${ent.remote.id}`}
                                  className="px-1.5 py-0.5 rounded bg-[#253B52]/45 border border-[#93B7D8]/30 text-[10px] text-[#CDE0F2] truncate block"
                                >
                                  G · {ent.remote.summary}
                                </span>
                              );
                            }
                            const meta =
                              AGENDA_CATEGORY_MAP[ent.event.category] ||
                              AGENDA_CATEGORY_MAP.outros;
                            return (
                              <span
                                key={ent.event.id}
                                className={`px-1.5 py-0.5 rounded border text-[10px] truncate flex items-center gap-1 ${meta.chipClass} ${
                                  ent.event.status === 'cancelado' ? 'line-through opacity-60' : ''
                                }`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dotClass}`}
                                />
                                <span className="truncate">
                                  {!ent.event.allDay ? `${formatTimeShort(ent.startDate)} ` : ''}
                                  {ent.event.title}
                                </span>
                              </span>
                            );
                          })}
                          {dayEntries.length > 3 && (
                            <span className="text-[10px] font-mono text-[#98A89F] pl-1">
                              +{dayEntries.length - 3} mais
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Selected Day Detail Drawer/Panel */}
              <aside className="metal-surface rounded-xl p-4 sm:p-5 space-y-4">
                <div className="flex items-start justify-between gap-2 pb-3 border-b border-white/8">
                  <div>
                    <p className="text-[11px] font-mono uppercase tracking-wider text-[#C8A461]">
                      Atividades do dia
                    </p>
                    <h3 className="font-display text-sm font-semibold text-[#F4E6C4] mt-0.5">
                      {formatFullDayTitle(selectedDay)}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => openCreateModal(selectedDay)}
                    className="siscom-btn siscom-btn-gold !min-h-[34px] !px-2.5 text-[11px] shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Agendar</span>
                  </button>
                </div>

                {selectedDayEntries.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/10 p-6 text-center space-y-2">
                    <p className="text-xs text-[#98A89F]">
                      Nenhuma atividade cadastrada para esta data.
                    </p>
                    <button
                      type="button"
                      onClick={() => openCreateModal(selectedDay)}
                      className="siscom-btn siscom-btn-secondary !min-h-[34px] text-xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Cadastrar neste dia</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedDayEntries.map((ent) => renderEntryCard(ent, true))}
                  </div>
                )}
              </aside>
            </div>
          )}

          {/* ── WEEKLY VIEW ──────────────────────────────────────────────── */}
          {viewMode === 'week' && (
            <section className="grid grid-cols-1 md:grid-cols-7 gap-3">
              {weekDays.map((day) => {
                const key = formatLocalDateKey(day);
                const isToday = key === todayKey;
                const dayEntries = unifiedEntries.filter((e) => entryOverlapsDay(e, day));

                return (
                  <div
                    key={key}
                    className={`metal-surface rounded-xl p-3 flex flex-col gap-2.5 min-h-[220px] ${
                      isToday ? 'border-[#C29B56]/45' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between pb-2 border-b border-white/8">
                      <div>
                        <span className="block text-[10px] font-mono uppercase tracking-wider text-[#98A89F]">
                          {WEEKDAYS_PT[day.getDay()]}
                        </span>
                        <span
                          className={`font-display text-base font-semibold ${
                            isToday ? 'text-[#E5C17B]' : 'text-[#E4EAE6]'
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
                        aria-label={`Nova atividade em ${day.toLocaleDateString('pt-BR')}`}
                        className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-[#2D5A43]/35 text-[#98A89F] hover:text-[#F4E6C4] inline-flex items-center justify-center transition-colors cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {dayEntries.length === 0 ? (
                      <p className="text-[11px] text-[#697870] italic py-2">Sem atividades</p>
                    ) : (
                      <div className="space-y-2">
                        {dayEntries.map((ent) => {
                          if (ent.origin === 'google_only') {
                            return (
                              <button
                                key={`g-${ent.remote.id}`}
                                type="button"
                                onClick={() => setSelectedRemoteEvent(ent.remote)}
                                className="w-full text-left rounded-lg border border-[#93B7D8]/30 bg-[#182736]/60 p-2 space-y-1 hover:border-[#93B7D8]/55 transition-colors cursor-pointer"
                              >
                                <span className="block text-[10px] font-mono text-[#93B7D8]">
                                  {ent.remote.allDay
                                    ? 'Dia inteiro · Google'
                                    : `${formatTimeShort(ent.startDate)} · Google`}
                                </span>
                                <span className="block text-xs font-medium text-[#E4EAE6] line-clamp-2">
                                  {ent.remote.summary}
                                </span>
                              </button>
                            );
                          }
                          const meta =
                            AGENDA_CATEGORY_MAP[ent.event.category] ||
                            AGENDA_CATEGORY_MAP.outros;
                          return (
                            <button
                              key={ent.event.id}
                              type="button"
                              onClick={() => {
                                setSelectedDay(day);
                                setAnchorDate(day);
                                setViewMode('day');
                              }}
                              className={`w-full text-left rounded-lg border border-white/10 border-l-[3px] ${meta.borderClass} bg-[#131A17] p-2 space-y-1 hover:border-white/25 transition-colors cursor-pointer`}
                            >
                              <div className="flex items-center justify-between gap-1 text-[10px] font-mono text-[#C8A461]">
                                <span>
                                  {ent.event.allDay
                                    ? 'Dia inteiro'
                                    : formatTimeShort(ent.startDate)}
                                </span>
                                {ent.event.syncStatus === 'synced' && (
                                  <Cloud className="w-3 h-3 text-[#E5C17B]" />
                                )}
                              </div>
                              <span
                                className={`block text-xs font-medium leading-snug line-clamp-2 ${
                                  ent.event.status === 'cancelado'
                                    ? 'line-through text-[#697870]'
                                    : 'text-[#E4EAE6]'
                                }`}
                              >
                                {ent.event.title}
                              </span>
                              <span className="block text-[10px] text-[#98A89F] truncate">
                                {meta.shortLabel}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          {/* ── DAILY VIEW ───────────────────────────────────────────────── */}
          {viewMode === 'day' && (
            <section className="metal-surface rounded-xl p-4 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/8">
                <div>
                  <span className="text-[11px] font-mono uppercase tracking-wider text-[#C8A461]">
                    Programação do dia
                  </span>
                  <h3 className="font-display text-base sm:text-lg font-semibold text-[#F4E6C4]">
                    {formatFullDayTitle(selectedDay)}
                  </h3>
                </div>
                <span className="text-xs font-mono text-[#98A89F]">
                  {selectedDayEntries.length}{' '}
                  {selectedDayEntries.length === 1 ? 'atividade' : 'atividades'}
                </span>
              </div>

              {selectedDayEntries.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 p-10 text-center space-y-3">
                  <p className="text-sm text-[#98A89F]">
                    Nenhuma atividade prevista para este dia.
                  </p>
                  <button
                    type="button"
                    onClick={() => openCreateModal(selectedDay)}
                    className="siscom-btn siscom-btn-primary text-xs"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Cadastrar atividade neste dia</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedDayEntries.map((ent) => renderEntryCard(ent, false))}
                </div>
              )}
            </section>
          )}

          {/* ── HISTORY & AUDIT VIEW ─────────────────────────────────────── */}
          {viewMode === 'history' && (
            <section className="metal-surface rounded-xl p-4 sm:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-white/8">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-[#E5C17B]" />
                  <h3 className="font-display text-sm sm:text-base font-semibold text-[#F4E6C4]">
                    Histórico das Atividades Realizadas e Auditoria
                  </h3>
                </div>

                <SiscomSegmentedTabs
                  layoutId="agenda-history-subtabs"
                  size="sm"
                  options={[
                    { value: 'events', label: `Atividades (${historyEvents.length})` },
                    { value: 'audit', label: `Auditoria (${auditLogs.length})` },
                  ]}
                  value={historySubTab}
                  onChange={setHistorySubTab}
                  className="w-full sm:w-auto sm:min-w-[260px]"
                />
              </div>

              {historySubTab === 'events' ? (
                historyEvents.length === 0 ? (
                  <p className="text-xs text-[#98A89F] py-8 text-center">
                    Ainda não há atividades realizadas ou encerradas registradas no histórico.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {historyEvents.map((ev) =>
                      renderEntryCard(
                        {
                          origin: 'siscom',
                          event: ev,
                          startDate: parseEventDate(ev.startAt, ev.allDay, false),
                          endDate: parseEventDate(ev.endAt, ev.allDay, true),
                        },
                        false
                      )
                    )}
                  </div>
                )
              ) : auditLogs.length === 0 ? (
                <p className="text-xs text-[#98A89F] py-8 text-center">
                  Nenhum registro de auditoria disponível ainda.
                </p>
              ) : (
                <div className="divide-y divide-white/6">
                  {auditLogs.map((log) => (
                    <div
                      key={log.id}
                      className="py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs"
                    >
                      <div className="space-y-0.5">
                        <p className="text-[#E4EAE6]">{log.summary}</p>
                        <p className="text-[11px] font-mono text-[#98A89F]">
                          {log.actorName} · {log.action}
                        </p>
                      </div>
                      <span className="text-[11px] font-mono text-[#697870] shrink-0">
                        {log.createdAt?.toDate
                          ? log.createdAt.toDate().toLocaleString('pt-BR')
                          : 'Agora'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {/* Event Form Modal */}
      <AgendaEventModal
        open={modalOpen}
        editingEvent={editingEvent}
        defaultDate={selectedDay}
        googleConnected={googleSession.connected}
        selectedCalendar={selectedCalendar}
        saving={savingEvent}
        errorMsg={modalError}
        onClose={() => {
          setModalOpen(false);
          setEditingEvent(null);
        }}
        onSubmit={(vals) => void handleFormSubmit(vals)}
      />

      {/* Mandatory Explicit Confirmation Modal for Google Calendar Mutations & Deletions */}
      <GoogleActionConfirmModal
        pending={pendingConfirm}
        busy={confirmBusy}
        onCancel={() => setPendingConfirm(null)}
      />

      {/* Google-Only Remote Event Details & Optional Import Modal */}
      <GoogleRemoteEventModal
        remote={selectedRemoteEvent}
        importing={importingRemote}
        onClose={() => setSelectedRemoteEvent(null)}
        onImportToSiscom={handleImportRemoteToSiscom}
      />
    </main>
  );
}
