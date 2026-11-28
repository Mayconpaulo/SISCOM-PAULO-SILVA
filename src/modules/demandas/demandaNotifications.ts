import {
  type DemandaItem,
  formatDateKeyLocal,
  formatDemandaNotificationPayload,
} from './demandaTypes';

const NOTIFIED_STORAGE_KEY = 'siscom_demandas_notified_v1';
const SEEN_BELL_STORAGE_KEY = 'siscom_demandas_bell_seen_v1';
const MAX_RECORD_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export const SISCOM_NOTIFICATION_ICON = '/notification-icon-192x192.png';
export const SISCOM_NOTIFICATION_BADGE = '/notification-badge-96x96.png';

export type BrowserNotificationPermission = NotificationPermission | 'unsupported';
export type BackgroundPushStatus = 'active' | 'sw-only' | 'inactive' | 'unsupported';

interface NotifiedMap {
  [milestoneKey: string]: number;
}

function readTimestampMap(storageKey: string): NotifiedMap {
  try {
    const raw = localStorage.getItem(storageKey);
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

function writeTimestampMap(storageKey: string, map: NotifiedMap): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

export function getNotifiedMapSnapshot(): NotifiedMap {
  return readTimestampMap(NOTIFIED_STORAGE_KEY);
}

export function hasMilestoneBeenNotified(milestoneKey: string): boolean {
  const map = readTimestampMap(NOTIFIED_STORAGE_KEY);
  return Boolean(map[milestoneKey]);
}

export function markMilestoneNotified(milestoneKey: string): void {
  const map = readTimestampMap(NOTIFIED_STORAGE_KEY);
  map[milestoneKey] = Date.now();
  writeTimestampMap(NOTIFIED_STORAGE_KEY, map);
}

export function clearMilestonesForDemanda(demandaId: string): void {
  for (const storageKey of [NOTIFIED_STORAGE_KEY, SEEN_BELL_STORAGE_KEY]) {
    const map = readTimestampMap(storageKey);
    let changed = false;
    for (const key of Object.keys(map)) {
      if (key.startsWith(`${demandaId}::`)) {
        delete map[key];
        changed = true;
      }
    }
    if (changed) {
      writeTimestampMap(storageKey, map);
    }
  }
}

export function getSeenBellMap(): NotifiedMap {
  return readTimestampMap(SEEN_BELL_STORAGE_KEY);
}

export function markBellKeysSeen(keys: string[]): void {
  if (keys.length === 0) return;
  const map = readTimestampMap(SEEN_BELL_STORAGE_KEY);
  const now = Date.now();
  for (const key of keys) {
    map[key] = now;
  }
  writeTimestampMap(SEEN_BELL_STORAGE_KEY, map);
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

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function getReadyServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

function toCompactPendingDemandas(demandas: DemandaItem[]) {
  return demandas
    .filter((d) => d.status === 'pendente')
    .slice(0, 120)
    .map((d) => ({
      id: d.id,
      title: d.title,
      dueDate: d.dueDate,
      dueTime: d.dueTime,
      status: d.status,
      remindBeforeDays: d.remindBeforeDays,
      ...(Array.isArray(d.reminderOffsetsMinutes)
        ? { reminderOffsetsMinutes: d.reminderOffsetsMinutes }
        : {}),
    }));
}

export async function syncDemandasToServiceWorker(
  userId: string,
  demandas: DemandaItem[]
): Promise<void> {
  const reg = await getReadyServiceWorkerRegistration();
  const target = reg?.active || navigator.serviceWorker?.controller;
  if (!target) return;

  const compact = toCompactPendingDemandas(demandas);

  try {
    target.postMessage({
      type: 'SISCOM_SYNC_DEMANDAS',
      userId,
      demandas: compact,
      notifiedMap: getNotifiedMapSnapshot(),
    });
  } catch {
    // ignore postMessage failures
  }
}

async function registerPeriodicDemandasSync(reg: ServiceWorkerRegistration): Promise<void> {
  try {
    const periodicSync = (
      reg as ServiceWorkerRegistration & {
        periodicSync?: {
          register: (tag: string, options: { minInterval: number }) => Promise<void>;
        };
      }
    ).periodicSync;
    if (periodicSync && typeof periodicSync.register === 'function') {
      await periodicSync.register('siscom-demandas-check', {
        minInterval: 60 * 60 * 1000, // 1 hour minimum interval
      });
    }
  } catch {
    // Periodic Background Sync is optional and only available on installed PWAs in Chromium
  }
}

let cachedPushConfigPromise: Promise<{ pushConfigured: boolean; publicKey: string }> | null = null;

export async function fetchServerPushConfig(): Promise<{ pushConfigured: boolean; publicKey: string }> {
  if (!cachedPushConfigPromise) {
    cachedPushConfigPromise = fetch('/api/push/config', { cache: 'no-store' })
      .then(async (resp) => {
        if (!resp.ok) return { pushConfigured: false, publicKey: '' };
        const data = (await resp.json()) as { pushConfigured?: boolean; publicKey?: string };
        return {
          pushConfigured: Boolean(data.pushConfigured && data.publicKey),
          publicKey: typeof data.publicKey === 'string' ? data.publicKey : '',
        };
      })
      .catch(() => ({ pushConfigured: false, publicKey: '' }));
  }
  return cachedPushConfigPromise;
}

export async function syncBackgroundPushAndDemandas(params: {
  idToken: string;
  userId: string;
  demandas: DemandaItem[];
}): Promise<BackgroundPushStatus> {
  if (getBrowserNotificationPermission() !== 'granted') {
    return getBrowserNotificationPermission() === 'unsupported' ? 'unsupported' : 'inactive';
  }

  await syncDemandasToServiceWorker(params.userId, params.demandas);

  const reg = await getReadyServiceWorkerRegistration();
  if (!reg) {
    return 'sw-only';
  }

  await registerPeriodicDemandasSync(reg);

  const pushConfig = await fetchServerPushConfig();
  let subscriptionJson: PushSubscriptionJSON | null = null;

  if (pushConfig.pushConfigured && pushConfig.publicKey && 'pushManager' in reg) {
    try {
      let subscription = await reg.pushManager.getSubscription();
      if (!subscription) {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(pushConfig.publicKey),
        });
      }
      subscriptionJson = subscription.toJSON();
    } catch {
      subscriptionJson = null;
    }
  }

  const pendingCompact = toCompactPendingDemandas(params.demandas);

  if (subscriptionJson) {
    try {
      const resp = await fetch('/api/push/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.idToken}`,
        },
        body: JSON.stringify({
          subscription: subscriptionJson,
          demandas: pendingCompact,
          tzOffsetMinutes: new Date().getTimezoneOffset(),
          notifiedKeys: Object.keys(getNotifiedMapSnapshot()),
        }),
      });
      if (resp.ok) {
        return 'active';
      }
    } catch {
      // Fallback to SW-only status below
    }
  }

  return 'sw-only';
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
    icon: SISCOM_NOTIFICATION_ICON,
    badge: SISCOM_NOTIFICATION_BADGE,
    data: { url: '/?openDemandas=1' },
  };

  try {
    const reg = await getReadyServiceWorkerRegistration();
    if (reg && typeof reg.showNotification === 'function') {
      await reg.showNotification(title, options);
      return true;
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

export async function sendTestDemandaNotification(
  idToken?: string | null,
  sampleDemanda?: Pick<DemandaItem, 'title' | 'dueDate' | 'dueTime'> | null
): Promise<boolean> {
  if (idToken) {
    try {
      const resp = await fetch('/api/push/test', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });
      if (resp.ok) {
        return true;
      }
    } catch {
      // Fallback to local Service Worker notification
    }
  }

  const demoItem = sampleDemanda ?? {
    title: 'Reunião de pauta',
    dueDate: formatDateKeyLocal(new Date()),
    dueTime: '09:00',
  };
  const formatted = formatDemandaNotificationPayload(demoItem, new Date());

  return dispatchSystemNotification(
    formatted.title,
    formatted.body,
    'siscom-demandas-test'
  );
}
