import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  BrowserNotificationPermission,
  clearMilestonesForDemanda,
  dispatchSystemNotification,
  getBrowserNotificationPermission,
  hasMilestoneBeenNotified,
  markMilestoneNotified,
  requestBrowserNotificationPermission,
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
  computePendingReminderAlert,
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
  notificationPermission: BrowserNotificationPermission;
  enableBrowserNotifications: () => Promise<BrowserNotificationPermission>;
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

const MAX_VISIBLE_TOASTS = 3;

export const DemandasProvider: React.FC<DemandasProviderProps> = ({ userId, children }) => {
  const [demandas, setDemandas] = useState<DemandaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeAlerts, setActiveAlerts] = useState<DemandaReminderAlert[]>([]);
  const [notificationPermission, setNotificationPermission] =
    useState<BrowserNotificationPermission>(() => getBrowserNotificationPermission());
  const [panelOpen, setPanelOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [editingDemanda, setEditingDemanda] = useState<DemandaItem | null>(null);

  // Keep a ref to latest demandas for the interval reminder scanner
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

  const scanAndDispatchReminders = useCallback(() => {
    const now = new Date();
    const list = demandasRef.current;
    const newlyTriggered: DemandaReminderAlert[] = [];

    for (const item of list) {
      const alert = computePendingReminderAlert(item, now);
      if (!alert) continue;
      if (hasMilestoneBeenNotified(alert.milestoneKey)) continue;

      markMilestoneNotified(alert.milestoneKey);
      newlyTriggered.push(alert);

      // Dispatch browser/PWA system notification when permitted
      void dispatchSystemNotification(
        `SISCOM · ${alert.headline}`,
        `${item.title} — ${alert.detail}`,
        alert.milestoneKey
      );
    }

    if (newlyTriggered.length > 0) {
      setActiveAlerts((prev) => {
        const existingKeys = new Set(prev.map((a) => a.milestoneKey));
        const merged = [
          ...newlyTriggered.filter((a) => !existingKeys.has(a.milestoneKey)),
          ...prev,
        ];
        return merged.slice(0, MAX_VISIBLE_TOASTS);
      });
    }
  }, []);

  // Run reminder scan when demandas load/change, every 45s, and when tab returns to focus
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

  // Auto-prune alerts whose demanda was completed or deleted
  useEffect(() => {
    const pendingIds = new Set(
      demandas.filter((d) => d.status === 'pendente').map((d) => d.id)
    );
    setActiveAlerts((prev) => prev.filter((a) => pendingIds.has(a.demanda.id)));
  }, [demandas]);

  const dismissAlert = useCallback((milestoneKey: string) => {
    setActiveAlerts((prev) => prev.filter((a) => a.milestoneKey !== milestoneKey));
  }, []);

  const enableBrowserNotifications = useCallback(async () => {
    const perm = await requestBrowserNotificationPermission();
    setNotificationPermission(perm);
    return perm;
  }, []);

  const addDemanda = useCallback(
    async (input: CreateDemandaInput) => {
      return createDemanda(userId, input);
    },
    [userId]
  );

  const editDemanda = useCallback(
    async (demandaId: string, patch: UpdateDemandaPatch) => {
      if (patch.dueDate !== undefined || patch.dueTime !== undefined || patch.remindBeforeDays !== undefined) {
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
      setActiveAlerts((prev) => prev.filter((a) => a.demanda.id !== item.id));
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

  const value = useMemo<DemandasContextValue>(
    () => ({
      demandas,
      ...derived,
      loading,
      error,
      activeAlerts,
      dismissAlert,
      notificationPermission,
      enableBrowserNotifications,
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
      notificationPermission,
      enableBrowserNotifications,
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
