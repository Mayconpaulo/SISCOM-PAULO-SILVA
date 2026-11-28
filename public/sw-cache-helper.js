// Helper imported by the SISCOM PWA service worker for instant updates,
// Web Push delivery (even when the app is closed), notification clicks,
// and Periodic Background Sync reminder checks.

const SW_DEMANDAS_DB = 'siscom_sw_demandas_v1';
const SW_DEMANDAS_STORE = 'state';
const SW_DEMANDAS_KEY = 'current';
const SW_MAX_RECORD_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const SW_NOTIFICATION_ICON = '/notification-icon-192x192.png';
const SW_NOTIFICATION_BADGE = '/notification-badge-96x96.png';
const SW_MAX_REMINDER_OFFSETS = 10;
const SW_MAX_REMINDER_OFFSET_MINUTES = 43200;

function openSwDemandasDb() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(SW_DEMANDAS_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SW_DEMANDAS_STORE)) {
          db.createObjectStore(SW_DEMANDAS_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

async function readSwDemandasState() {
  try {
    const db = await openSwDemandasDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(SW_DEMANDAS_STORE, 'readonly');
      const store = tx.objectStore(SW_DEMANDAS_STORE);
      const req = store.get(SW_DEMANDAS_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function writeSwDemandasState(state) {
  try {
    const db = await openSwDemandasDb();
    await new Promise((resolve) => {
      const tx = db.transaction(SW_DEMANDAS_STORE, 'readwrite');
      const store = tx.objectStore(SW_DEMANDAS_STORE);
      store.put(state, SW_DEMANDAS_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore IndexedDB errors in restricted contexts
  }
}

function formatDateKeyLocalSw(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatFullDateBrSw(dueDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate || '');
  if (!match) return dueDate || '';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatTimeSuffixSw(dueTime) {
  const tm = dueTime ? /^(\d{2}):(\d{2})$/.exec(String(dueTime).trim()) : null;
  if (!tm) return '';
  return tm[2] === '00' ? `, às ${tm[1]}h` : `, às ${tm[1]}h${tm[2]}`;
}

function formatCountdownSw(daysLeft) {
  if (daysLeft > 1) return `Faltam ${daysLeft} dias`;
  if (daysLeft === 1) return 'Falta 1 dia';
  if (daysLeft === 0) return 'É hoje';
  const abs = Math.abs(daysLeft);
  return abs === 1 ? 'Atrasada há 1 dia' : `Atrasada há ${abs} dias`;
}

function formatNotificationPayloadSw(item, daysLeft) {
  const title = (item && item.title ? String(item.title).trim() : '') || 'Demanda';
  const countdown = formatCountdownSw(daysLeft);
  const dateBr = formatFullDateBrSw(item.dueDate);
  const timeSuffix = formatTimeSuffixSw(item.dueTime);
  return {
    title,
    body: `Prazo: ${countdown} – ${dateBr}${timeSuffix}`,
  };
}

function sanitizeReminderOffsetsSw(raw) {
  if (!Array.isArray(raw)) return [];
  const unique = new Set();
  for (const val of raw) {
    if (typeof val === 'number' && Number.isFinite(val)) {
      const clamped = Math.max(0, Math.min(SW_MAX_REMINDER_OFFSET_MINUTES, Math.round(val)));
      unique.add(clamped);
      if (unique.size >= SW_MAX_REMINDER_OFFSETS) break;
    }
  }
  return Array.from(unique).sort((a, b) => b - a);
}

function parseDueDatePartsSw(dueDate, dueTime) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate || '');
  const now = new Date();
  const y = match ? Number(match[1]) : now.getFullYear();
  const m = match ? Number(match[2]) - 1 : now.getMonth();
  const d = match ? Number(match[3]) : now.getDate();

  const dateOnly = new Date(y, m, d, 0, 0, 0, 0);
  const timeMatch = dueTime ? /^(\d{2}):(\d{2})$/.exec(String(dueTime).trim()) : null;
  if (timeMatch) {
    const hh = Math.min(23, Math.max(0, Number(timeMatch[1])));
    const mm = Math.min(59, Math.max(0, Number(timeMatch[2])));
    return {
      dateOnly,
      exactDateTime: new Date(y, m, d, hh, mm, 0, 0),
      hasTime: true,
    };
  }
  return {
    dateOnly,
    exactDateTime: new Date(y, m, d, 23, 59, 59, 999),
    hasTime: false,
  };
}

function computeReminderAlertsSw(item, now) {
  if (!item || item.status !== 'pendente' || !item.dueDate) return [];
  const todayKey = formatDateKeyLocalSw(now);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const { dateOnly, exactDateTime, hasTime } = parseDueDatePartsSw(item.dueDate, item.dueTime);
  const daysLeft = Math.round((dateOnly.getTime() - todayStart.getTime()) / 86400000);
  const formatted = formatNotificationPayloadSw(item, daysLeft);

  if (Array.isArray(item.reminderOffsetsMinutes)) {
    const offsets = sanitizeReminderOffsetsSw(item.reminderOffsetsMinutes);
    if (offsets.length === 0) return [];

    if (daysLeft < 0) {
      return [
        {
          milestoneKey: `${item.id}::overdue::${todayKey}`,
          title: formatted.title,
          body: formatted.body,
        },
      ];
    }

    const alerts = [];
    const msUntilDue = exactDateTime.getTime() - now.getTime();
    for (const offsetMin of offsets) {
      let shouldFire = false;
      if (hasTime) {
        shouldFire = msUntilDue <= offsetMin * 60000;
      } else if (offsetMin >= 1440) {
        const offsetDays = Math.round(offsetMin / 1440);
        shouldFire = daysLeft <= offsetDays;
      } else {
        shouldFire = daysLeft <= 0;
      }
      if (shouldFire) {
        alerts.push({
          milestoneKey: `${item.id}::rem-${offsetMin}::${item.dueDate}::${item.dueTime || 'allday'}`,
          title: formatted.title,
          body: formatted.body,
        });
      }
    }
    return alerts;
  }

  const remindBefore = typeof item.remindBeforeDays === 'number' ? item.remindBeforeDays : 0;
  if (daysLeft > remindBefore) return [];

  if (daysLeft < 0) {
    return [
      {
        milestoneKey: `${item.id}::overdue::${todayKey}`,
        title: formatted.title,
        body: formatted.body,
      },
    ];
  }

  if (daysLeft === 0) {
    if (hasTime) {
      const minsLeft = Math.round((exactDateTime.getTime() - now.getTime()) / 60000);
      if (minsLeft <= 0) {
        return [
          {
            milestoneKey: `${item.id}::due-now::${todayKey}::${item.dueTime}`,
            title: formatted.title,
            body: formatted.body,
          },
        ];
      }
      if (minsLeft <= 120) {
        return [
          {
            milestoneKey: `${item.id}::due-2h::${todayKey}::${item.dueTime}`,
            title: formatted.title,
            body: formatted.body,
          },
        ];
      }
      return [
        {
          milestoneKey: `${item.id}::due-today::${todayKey}`,
          title: formatted.title,
          body: formatted.body,
        },
      ];
    }
    return [
      {
        milestoneKey: `${item.id}::due-today::${todayKey}`,
        title: formatted.title,
        body: formatted.body,
      },
    ];
  }

  if (daysLeft === 1) {
    return [
      {
        milestoneKey: `${item.id}::before-1d::${item.dueDate}`,
        title: formatted.title,
        body: formatted.body,
      },
    ];
  }

  return [
    {
      milestoneKey: `${item.id}::before-${daysLeft}d::${item.dueDate}`,
      title: formatted.title,
      body: formatted.body,
    },
  ];
}

async function evaluatePendingDemandasInSw() {
  const state = await readSwDemandasState();
  if (!state || !Array.isArray(state.demandas) || state.demandas.length === 0) return;

  const now = new Date();
  const nowMs = now.getTime();
  const notifiedMap = {};
  const rawMap = state.notifiedMap && typeof state.notifiedMap === 'object' ? state.notifiedMap : {};
  for (const [k, ts] of Object.entries(rawMap)) {
    if (typeof ts === 'number' && nowMs - ts < SW_MAX_RECORD_AGE_MS) {
      notifiedMap[k] = ts;
    }
  }

  let changed = false;
  for (const item of state.demandas) {
    const alerts = computeReminderAlertsSw(item, now);
    for (const alert of alerts) {
      if (notifiedMap[alert.milestoneKey]) continue;

      notifiedMap[alert.milestoneKey] = nowMs;
      changed = true;

      try {
        await self.registration.showNotification(alert.title, {
          body: alert.body,
          tag: alert.milestoneKey,
          icon: SW_NOTIFICATION_ICON,
          badge: SW_NOTIFICATION_BADGE,
          data: {
            url: '/?openDemandas=1',
            demandaId: item.id,
          },
        });
      } catch {
        // ignore showNotification failures when permission revoked
      }
    }
  }

  if (changed) {
    await writeSwDemandasState({
      ...state,
      notifiedMap,
      updatedAt: nowMs,
    });
  }
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data.type === 'SISCOM_SYNC_DEMANDAS') {
    event.waitUntil(
      (async () => {
        const prev = (await readSwDemandasState()) || {};
        const incomingNotified =
          event.data.notifiedMap && typeof event.data.notifiedMap === 'object'
            ? event.data.notifiedMap
            : {};
        const mergedNotified = {
          ...(prev.notifiedMap && typeof prev.notifiedMap === 'object' ? prev.notifiedMap : {}),
          ...incomingNotified,
        };
        const demandas = Array.isArray(event.data.demandas) ? event.data.demandas : [];
        await writeSwDemandasState({
          userId: typeof event.data.userId === 'string' ? event.data.userId : prev.userId || '',
          demandas,
          notifiedMap: mergedNotified,
          updatedAt: Date.now(),
        });
      })()
    );
    return;
  }

  if (event.data.type === 'SISCOM_CHECK_DEMANDAS_NOW') {
    event.waitUntil(evaluatePendingDemandasInSw());
    return;
  }

  if (event.data.type === 'SISCOM_CLEAR_ALL_CACHES') {
    const replyPort = event.ports && event.ports[0];
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch(() => undefined)
        .finally(() => {
          if (replyPort) {
            try {
              replyPort.postMessage({ ok: true });
            } catch {
              // ignore closed port
            }
          }
        })
    );
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith('workbox-precache') ||
                key.startsWith('siscom-ephemeral-')
            )
            .map((key) => caches.delete(key))
        );
      } catch {
        // ignore cache cleanup failures
      }

      try {
        await self.clients.claim();
        const allClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        for (const client of allClients) {
          client.postMessage({ type: 'SISCOM_SW_ACTIVATED' });
        }
      } catch {
        // ignore client notify failures
      }
    })()
  );
});

// Receive Web Push notifications even when SISCOM is completely closed
self.addEventListener('push', (event) => {
  let payload = {
    title: 'Demanda',
    body: 'Prazo pendente no SISCOM',
    tag: 'siscom-push',
    url: '/?openDemandas=1',
    demandaId: '',
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object') {
        payload = {
          title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : payload.title,
          body: typeof parsed.body === 'string' && parsed.body.trim() ? parsed.body.trim() : payload.body,
          tag: typeof parsed.tag === 'string' && parsed.tag.trim() ? parsed.tag.trim() : payload.tag,
          url: typeof parsed.url === 'string' && parsed.url.startsWith('/') ? parsed.url : payload.url,
          demandaId: typeof parsed.demandaId === 'string' ? parsed.demandaId : '',
        };
      }
    } catch {
      try {
        const text = event.data.text();
        if (text && text.trim()) {
          payload.body = text.trim();
        }
      } catch {
        // keep default payload
      }
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: SW_NOTIFICATION_ICON,
      badge: SW_NOTIFICATION_BADGE,
      data: {
        url: payload.url,
        demandaId: payload.demandaId,
      },
    })
  );
});

// Periodic Background Sync (Chromium / Android PWA) checks reminders even when closed
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'siscom-demandas-check') {
    event.waitUntil(evaluatePendingDemandasInSw());
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'siscom-demandas-check') {
    event.waitUntil(evaluatePendingDemandasInSw());
  }
});

// Clicking an OS notification focuses SISCOM and opens the Demandas panel
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = (event.notification && event.notification.data) || {};
  const targetUrl =
    typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/?openDemandas=1';

  event.waitUntil(
    (async () => {
      try {
        const allClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        for (const client of allClients) {
          if ('focus' in client) {
            await client.focus();
            client.postMessage({
              type: 'SISCOM_OPEN_DEMANDAS',
              demandaId: typeof data.demandaId === 'string' ? data.demandaId : '',
            });
            return;
          }
        }
        if (self.clients.openWindow) {
          await self.clients.openWindow(targetUrl);
        }
      } catch {
        // ignore focus/open failures
      }
    })()
  );
});
