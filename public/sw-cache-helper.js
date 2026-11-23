// Helper imported by the SISCOM PWA service worker for instant updates,
// Web Push delivery (even when the app is closed), notification clicks,
// and Periodic Background Sync reminder checks.

const SW_DEMANDAS_DB = 'siscom_sw_demandas_v1';
const SW_DEMANDAS_STORE = 'state';
const SW_DEMANDAS_KEY = 'current';
const SW_MAX_RECORD_AGE_MS = 14 * 24 * 60 * 60 * 1000;

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

function formatShortDueDateSw(dueDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate || '');
  if (!match) return dueDate || '';
  return `${match[3]}/${match[2]}`;
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

function computeReminderAlertSw(item, now) {
  if (!item || item.status !== 'pendente' || !item.dueDate) return null;
  const todayKey = formatDateKeyLocalSw(now);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const { dateOnly, exactDateTime, hasTime } = parseDueDatePartsSw(item.dueDate, item.dueTime);
  const daysLeft = Math.round((dateOnly.getTime() - todayStart.getTime()) / 86400000);
  const remindBefore = typeof item.remindBeforeDays === 'number' ? item.remindBeforeDays : 0;

  if (daysLeft > remindBefore) return null;

  if (daysLeft < 0) {
    const abs = Math.abs(daysLeft);
    return {
      milestoneKey: `${item.id}::overdue::${todayKey}`,
      headline: abs === 1 ? 'Demanda atrasada (1 dia)' : `Demanda atrasada (${abs} dias)`,
      detail: `Prazo era ${formatShortDueDateSw(item.dueDate)}${hasTime ? ` às ${item.dueTime}` : ''}`,
    };
  }

  if (daysLeft === 0) {
    if (hasTime) {
      const minsLeft = Math.round((exactDateTime.getTime() - now.getTime()) / 60000);
      if (minsLeft <= 0) {
        return {
          milestoneKey: `${item.id}::due-now::${todayKey}::${item.dueTime}`,
          headline: 'Prazo atingido',
          detail: `Venceu hoje às ${item.dueTime}`,
        };
      }
      if (minsLeft <= 120) {
        return {
          milestoneKey: `${item.id}::due-2h::${todayKey}::${item.dueTime}`,
          headline: minsLeft <= 60 ? `Faltam ${minsLeft} min` : 'Prazo em menos de 2 horas',
          detail: `Vence hoje às ${item.dueTime}`,
        };
      }
      return {
        milestoneKey: `${item.id}::due-today::${todayKey}`,
        headline: 'Vence hoje',
        detail: `Prazo hoje às ${item.dueTime}`,
      };
    }
    return {
      milestoneKey: `${item.id}::due-today::${todayKey}`,
      headline: 'Vence hoje',
      detail: `Prazo para hoje (${formatShortDueDateSw(item.dueDate)})`,
    };
  }

  if (daysLeft === 1) {
    return {
      milestoneKey: `${item.id}::before-1d::${item.dueDate}`,
      headline: 'Vence amanhã',
      detail: `Prazo amanhã (${formatShortDueDateSw(item.dueDate)})${hasTime ? ` às ${item.dueTime}` : ''}`,
    };
  }

  return {
    milestoneKey: `${item.id}::before-${daysLeft}d::${item.dueDate}`,
    headline: `Faltam ${daysLeft} dias`,
    detail: `Prazo em ${formatShortDueDateSw(item.dueDate)}${hasTime ? ` às ${item.dueTime}` : ''}`,
  };
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
    const alert = computeReminderAlertSw(item, now);
    if (!alert) continue;
    if (notifiedMap[alert.milestoneKey]) continue;

    notifiedMap[alert.milestoneKey] = nowMs;
    changed = true;

    try {
      await self.registration.showNotification(`SISCOM · ${alert.headline}`, {
        body: `${item.title} — ${alert.detail}`,
        tag: alert.milestoneKey,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        data: {
          url: '/?openDemandas=1',
          demandaId: item.id,
        },
      });
    } catch {
      // ignore showNotification failures when permission revoked
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
    title: 'SISCOM · Notificação',
    body: 'Você tem uma demanda ou lembrete pendente no SISCOM.',
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
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
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
