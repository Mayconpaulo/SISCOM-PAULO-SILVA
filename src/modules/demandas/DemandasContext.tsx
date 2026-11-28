import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../core/auth/AuthContext';
import {
  BackgroundPushStatus,
  BrowserNotificationPermission,
  clearMilestonesForDemanda,
  dispatchSystemNotification,
  getBrowserNotificationPermission,
  getSeenBellMap,
  hasMilestoneBeenNotified,
  markBellKeysSeen,
  markMilestoneNotified,
  requestBrowserNotificationPermission,
  sendTestDemandaNotification,
  syncBackgroundPushAndDemandas,
  syncDemandasToServiceWorker,
} from './demandaNotifications';
import {
  createDemanda,
  deleteDemanda,
  postponeDemanda,
  subscribeUserDemandas,
  toggleDemandaStatus,
  updateDemanda,
} from './demandaStore';
import {
  CreateDemandaInput,
  DemandaItem,
  DemandaReminderAlert,
  UpdateDemandaPatch,
  computePendingReminderAlerts,
  getCalendarDaysUntil,
  isDemandaOverdue,
} from './demandaTypes';

interface DemandasContextValue {
  demandas: DemandaItem[];
  pendingDemandas: DemandaItem[];
  completedDemandas: DemandaItem[];
  loading: boolean;
  error: string | null;
  overdueCount: number;
  todayCount: number;
  upcomingCount: number;
  urgentCount: number;
  activeAlerts: DemandaReminderAlert[];
  dismissAlert: (milestoneKey: string) => void;
  hasNotificationDot: boolean;
  notificationDotTone: 'overdue' | 'today' | 'upcoming' | null;
  markNotificationsSeen: () => void;
  notificationPermission: BrowserNotificationPermission;
  backgroundPushStatus: BackgroundPushStatus;
  enableBrowserNotifications: () => Promise<BrowserNotificationPermission>;
  sendTestNotification: () => Promise<boolean>;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  quickAddOpen: boolean;
  setQuickAddOpen: (open: boolean) => void;
  editingDemanda: DemandaItem | null;
  setEditingDemanda: (item: DemandaItem | null) => void;
  addDemanda: (input: CreateDemandaInput) => Promise<string>;
  editDemanda: (demandaId: string, patch: UpdateDemandaPatch) => Promise<void>;
  toggleComplete: (item: DemandaItem) => Promise<void>;
  postponeOneDay: (item: DemandaItem) => Promise<void>;
  removeDemanda: (demandaId: string) => Promise<void>;
}

const DemandasContext = createContext<DemandasContextValue | null>(null);

interface DemandasProviderProps {
  userId: string;
  children: React.ReactNode;
}

export const DemandasProvider: React.FC<DemandasProviderProps> = ({ userId, children }) => {
  const { firebaseUser } = useAuth();
  const [demandas, setDemandas] = useState<DemandaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeAlerts, setActiveAlerts] = useState<DemandaReminderAlert[]>([]);
  const [seenTick, setSeenTick] = useState(0);
  const [notificationPermission, setNotificationPermission] =
    useState<BrowserNotificationPermission>(() => getBrowserNotificationPermission());
  const [backgroundPushStatus, setBackgroundPushStatus] = useState<BackgroundPushStatus>(() => {
    const perm = getBrowserNotificationPermission();
    if (perm === 'unsupported') return 'unsupported';
    return perm === 'granted' ? 'sw-only' : 'inactive';
  });
  const [panelOpen, setPanelOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [editingDemanda, setEditingDemanda] = useState<DemandaItem | null>(null);

  const demandasRef = useRef<DemandaItem[]>(demandas);
  demandasRef.current = demandas;

  useEffect(() => {
    setLoading(true);
    setError(null);
    const unsub = subscribeUserDemandas(
      userId,
      (list) => {
        setDemandas(list);
        setLoading(false);
        setError(null);
      },
      () => {
        setError('Não foi possível sincronizar suas demandas.');
        setLoading(false);
      }
    );
    return () => unsub();
  }, [userId]);

  // Open Demandas panel automatically when launched from an OS background notification click
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('openDemandas') === '1') {
        setPanelOpen(true);
        url.searchParams.delete('openDemandas');
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      }
    } catch {
      // ignore URL parsing errors
    }

    if (!('serviceWorker' in navigator)) return;
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'SISCOM_OPEN_DEMANDAS') {
        setPanelOpen(true);
      }
    };
    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    };
  }, []);

  // Recompute active reminder alerts quietly (no pop-ups!) and send OS notifications once per milestone
  const scanAndDispatchReminders = useCallback(() => {
    const now = new Date();
    const list = demandasRef.current;
    const currentAlerts: DemandaReminderAlert[] = [];

    for (const item of list) {
      const alerts = computePendingReminderAlerts(item, now);
      if (alerts.length === 0) continue;

      // Show a single consolidated entry per demanda in the bell dropdown
      currentAlerts.push(alerts[0]);

      for (const alert of alerts) {
        if (!hasMilestoneBeenNotified(alert.milestoneKey)) {
          markMilestoneNotified(alert.milestoneKey);
          void dispatchSystemNotification(
            alert.notificationTitle,
            alert.notificationBody,
            alert.milestoneKey
          );
        }
      }
    }

    setActiveAlerts(currentAlerts);
  }, []);

  useEffect(() => {
    if (loading) return;
    scanAndDispatchReminders();
  }, [loading, demandas, scanAndDispatchReminders]);

  useEffect(() => {
    const interval = window.setInterval(scanAndDispatchReminders, 45_000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setNotificationPermission(getBrowserNotificationPermission());
        scanAndDispatchReminders();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [scanAndDispatchReminders]);

  // Keep Service Worker IndexedDB & Web Push backend synchronized for closed-app delivery
  useEffect(() => {
    if (loading) return;
    void syncDemandasToServiceWorker(userId, demandas);

    if (notificationPermission !== 'granted' || !firebaseUser) {
      setBackgroundPushStatus(
        notificationPermission === 'unsupported' ? 'unsupported' : 'inactive'
      );
      return;
    }

    let cancelled = false;
    void firebaseUser
      .getIdToken()
      .then((idToken) =>
        syncBackgroundPushAndDemandas({
          idToken,
          userId,
          demandas,
        })
      )
      .then((status) => {
        if (!cancelled) {
          setBackgroundPushStatus(status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBackgroundPushStatus('sw-only');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loading, userId, demandas, notificationPermission, firebaseUser]);

  const dismissAlert = useCallback((milestoneKey: string) => {
    markBellKeysSeen([milestoneKey]);
    setSeenTick((t) => t + 1);
  }, []);

  const markNotificationsSeen = useCallback(() => {
    markBellKeysSeen(activeAlerts.map((a) => a.milestoneKey));
    setSeenTick((t) => t + 1);
  }, [activeAlerts]);

  const enableBrowserNotifications = useCallback(async () => {
    const perm = await requestBrowserNotificationPermission();
    setNotificationPermission(perm);
    if (perm === 'granted' && firebaseUser) {
      try {
        const idToken = await firebaseUser.getIdToken();
        const status = await syncBackgroundPushAndDemandas({
          idToken,
          userId,
          demandas: demandasRef.current,
        });
        setBackgroundPushStatus(status);
      } catch {
        setBackgroundPushStatus('sw-only');
      }
    } else if (perm === 'unsupported') {
      setBackgroundPushStatus('unsupported');
    } else {
      setBackgroundPushStatus('inactive');
    }
    return perm;
  }, [firebaseUser, userId]);

  const sendTestNotification = useCallback(async () => {
    let idToken: string | null = null;
    if (firebaseUser) {
      try {
        idToken = await firebaseUser.getIdToken();
      } catch {
        idToken = null;
      }
    }
    const sampleDemanda = demandasRef.current.find((d) => d.status === 'pendente') ?? null;
    return sendTestDemandaNotification(idToken, sampleDemanda);
  }, [firebaseUser]);

  const addDemanda = useCallback(
    async (input: CreateDemandaInput) => {
      return createDemanda(userId, input);
    },
    [userId]
  );

  const editDemanda = useCallback(
    async (demandaId: string, patch: UpdateDemandaPatch) => {
      if (
        patch.dueDate !== undefined ||
        patch.dueTime !== undefined ||
        patch.remindBeforeDays !== undefined ||
        patch.reminderOffsetsMinutes !== undefined
      ) {
        clearMilestonesForDemanda(demandaId);
      }
      await updateDemanda(userId, demandaId, patch);
    },
    [userId]
  );

  const toggleComplete = useCallback(
    async (item: DemandaItem) => {
      if (item.status === 'concluida') {
        clearMilestonesForDemanda(item.id);
      }
      await toggleDemandaStatus(userId, item);
    },
    [userId]
  );

  const postponeOneDay = useCallback(
    async (item: DemandaItem) => {
      clearMilestonesForDemanda(item.id);
      await postponeDemanda(userId, item, 1);
    },
    [userId]
  );

  const removeDemanda = useCallback(
    async (demandaId: string) => {
      clearMilestonesForDemanda(demandaId);
      await deleteDemanda(userId, demandaId);
    },
    [userId]
  );

  const derived = useMemo(() => {
    const now = new Date();
    const pending = demandas.filter((d) => d.status === 'pendente');
    const completed = demandas.filter((d) => d.status === 'concluida');
    let overdueCount = 0;
    let todayCount = 0;
    let upcomingCount = 0;

    for (const item of pending) {
      if (isDemandaOverdue(item, now)) {
        overdueCount += 1;
      } else if (getCalendarDaysUntil(item.dueDate, now) === 0) {
        todayCount += 1;
      } else {
        upcomingCount += 1;
      }
    }

    return {
      pendingDemandas: pending,
      completedDemandas: completed,
      overdueCount,
      todayCount,
      upcomingCount,
      urgentCount: overdueCount + todayCount,
    };
  }, [demandas]);

  // Determine whether the discreet notification dot ("bolinha") should appear on the bell
  const { hasNotificationDot, notificationDotTone } = useMemo(() => {
    // Depend on seenTick so acknowledging clears the dot immediately
    void seenTick;
    const seenMap = getSeenBellMap();
    const unseenAlerts = activeAlerts.filter((a) => !seenMap[a.milestoneKey]);

    if (unseenAlerts.some((a) => a.severity === 'overdue')) {
      return { hasNotificationDot: true, notificationDotTone: 'overdue' as const };
    }
    if (unseenAlerts.some((a) => a.severity === 'today')) {
      return { hasNotificationDot: true, notificationDotTone: 'today' as const };
    }
    if (unseenAlerts.length > 0) {
      return { hasNotificationDot: true, notificationDotTone: 'upcoming' as const };
    }
    return { hasNotificationDot: false, notificationDotTone: null };
  }, [activeAlerts, seenTick]);

  const value = useMemo<DemandasContextValue>(
    () => ({
      demandas,
      ...derived,
      loading,
      error,
      activeAlerts,
      dismissAlert,
      hasNotificationDot,
      notificationDotTone,
      markNotificationsSeen,
      notificationPermission,
      backgroundPushStatus,
      enableBrowserNotifications,
      sendTestNotification,
      panelOpen,
      setPanelOpen,
      quickAddOpen,
      setQuickAddOpen,
      editingDemanda,
      setEditingDemanda,
      addDemanda,
      editDemanda,
      toggleComplete,
      postponeOneDay,
      removeDemanda,
    }),
    [
      demandas,
      derived,
      loading,
      error,
      activeAlerts,
      dismissAlert,
      hasNotificationDot,
      notificationDotTone,
      markNotificationsSeen,
      notificationPermission,
      backgroundPushStatus,
      enableBrowserNotifications,
      sendTestNotification,
      panelOpen,
      quickAddOpen,
      editingDemanda,
      addDemanda,
      editDemanda,
      toggleComplete,
      postponeOneDay,
      removeDemanda,
    ]
  );

  return <DemandasContext.Provider value={value}>{children}</DemandasContext.Provider>;
};

export function useDemandas(): DemandasContextValue {
  const ctx = useContext(DemandasContext);
  if (!ctx) {
    throw new Error('useDemandas deve ser usado dentro de DemandasProvider');
  }
  return ctx;
}
