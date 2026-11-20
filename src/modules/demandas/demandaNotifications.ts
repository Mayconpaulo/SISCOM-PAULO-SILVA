const NOTIFIED_STORAGE_KEY = 'siscom_demandas_notified_v1';
const MAX_RECORD_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type BrowserNotificationPermission = NotificationPermission | 'unsupported';

interface NotifiedMap {
  [milestoneKey: string]: number;
}

function readNotifiedMap(): NotifiedMap {
  try {
    const raw = localStorage.getItem(NOTIFIED_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};
    const now = Date.now();
    const clean: NotifiedMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && now - v < MAX_RECORD_AGE_MS) {
        clean[k] = v;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function writeNotifiedMap(map: NotifiedMap): void {
  try {
    localStorage.setItem(NOTIFIED_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

export function hasMilestoneBeenNotified(milestoneKey: string): boolean {
  const map = readNotifiedMap();
  return Boolean(map[milestoneKey]);
}

export function markMilestoneNotified(milestoneKey: string): void {
  const map = readNotifiedMap();
  map[milestoneKey] = Date.now();
  writeNotifiedMap(map);
}

export function clearMilestonesForDemanda(demandaId: string): void {
  const map = readNotifiedMap();
  let changed = false;
  for (const key of Object.keys(map)) {
    if (key.startsWith(`${demandaId}::`)) {
      delete map[key];
      changed = true;
    }
  }
  if (changed) {
    writeNotifiedMap(map);
  }
}

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return window.Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    const result = await window.Notification.requestPermission();
    return result;
  } catch {
    return window.Notification.permission;
  }
}

export async function dispatchSystemNotification(
  title: string,
  body: string,
  tag: string
): Promise<boolean> {
  if (getBrowserNotificationPermission() !== 'granted') {
    return false;
  }

  const options: NotificationOptions = {
    body,
    tag,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, options);
        return true;
      }
    }
  } catch {
    // Fallback to window Notification below
  }

  try {
    new window.Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

export async function sendTestDemandaNotification(): Promise<boolean> {
  return dispatchSystemNotification(
    'SISCOM · Lembretes de Demandas',
    'Notificações ativas. Você será avisado antes de cada prazo até o dia limite.',
    'siscom-demandas-test'
  );
}
