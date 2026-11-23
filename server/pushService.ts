import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as webpush from 'web-push';

export interface PushSubscriptionPayload {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface SyncedDemandaSnapshot {
  id: string;
  title: string;
  dueDate: string; // YYYY-MM-DD
  dueTime: string; // HH:mm or ''
  status: 'pendente' | 'concluida';
  remindBeforeDays: number;
}

interface StoredUserPushRecord {
  uid: string;
  subscriptions: PushSubscriptionPayload[];
  demandas: SyncedDemandaSnapshot[];
  notifiedMap: Record<string, number>;
  tzOffsetMinutes: number; // JS getTimezoneOffset() value (e.g., 180 for America/Sao_Paulo UTC-3)
  updatedAt: number;
}

interface PushStateSnapshot {
  users: Record<string, StoredUserPushRecord>;
}

const MAX_SUBSCRIPTIONS_PER_USER = 8;
const MAX_DEMANDAS_PER_USER = 120;
const MAX_NOTIFIED_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const REDIS_STATE_KEY = 'siscom:push:state:v1';
const LOCAL_STATE_FILE = path.join(os.tmpdir(), 'siscom-push-state-v1.json');

let vapidConfiguredForKeys = '';
let inMemoryState: PushStateSnapshot | null = null;

function getVapidConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = (process.env.VAPID_SUBJECT || 'mailto:siscom@exercito.local').trim();
  if (!publicKey || !privateKey) {
    return null;
  }
  return { publicKey, privateKey, subject };
}

function ensureWebPushConfigured(): boolean {
  const cfg = getVapidConfig();
  if (!cfg) return false;
  const sig = `${cfg.publicKey}:${cfg.subject}`;
  if (vapidConfiguredForKeys !== sig) {
    try {
      webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
      vapidConfiguredForKeys = sig;
    } catch (err) {
      console.error('[Push] Invalid VAPID configuration:', err instanceof Error ? err.message : err);
      return false;
    }
  }
  return true;
}

export function getPublicPushConfig(): { pushConfigured: boolean; publicKey: string } {
  const cfg = getVapidConfig();
  if (!cfg || !ensureWebPushConfigured()) {
    return { pushConfigured: false, publicKey: '' };
  }
  return { pushConfigured: true, publicKey: cfg.publicKey };
}

function getRedisRestConfig(): { url: string; token: string } | null {
  const url = (
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    ''
  ).trim();
  const token = (
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    ''
  ).trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

async function loadPushState(): Promise<PushStateSnapshot> {
  const redis = getRedisRestConfig();
  if (redis) {
    try {
      const resp = await fetch(`${redis.url}/get/${encodeURIComponent(REDIS_STATE_KEY)}`, {
        headers: { Authorization: `Bearer ${redis.token}` },
      });
      if (resp.ok) {
        const json = (await resp.json()) as { result?: string | null };
        if (typeof json.result === 'string' && json.result) {
          const parsed = JSON.parse(json.result) as PushStateSnapshot;
          if (parsed && parsed.users && typeof parsed.users === 'object') {
            inMemoryState = parsed;
            return parsed;
          }
        }
        return { users: {} };
      }
    } catch (err) {
      console.error('[Push] Redis read failed, using fallback:', err instanceof Error ? err.message : err);
    }
  }

  if (inMemoryState) return inMemoryState;

  try {
    if (fs.existsSync(LOCAL_STATE_FILE)) {
      const raw = fs.readFileSync(LOCAL_STATE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as PushStateSnapshot;
      if (parsed && parsed.users && typeof parsed.users === 'object') {
        inMemoryState = parsed;
        return parsed;
      }
    }
  } catch {
    // Ignore corrupt local state
  }

  inMemoryState = { users: {} };
  return inMemoryState;
}

async function savePushState(state: PushStateSnapshot): Promise<void> {
  inMemoryState = state;

  const redis = getRedisRestConfig();
  if (redis) {
    try {
      await fetch(`${redis.url}/set/${encodeURIComponent(REDIS_STATE_KEY)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${redis.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(JSON.stringify(state)),
      });
      return;
    } catch (err) {
      console.error('[Push] Redis write failed:', err instanceof Error ? err.message : err);
    }
  }

  try {
    fs.writeFileSync(LOCAL_STATE_FILE, JSON.stringify(state), { mode: 0o600 });
  } catch {
    // Ephemeral filesystem or read-only environment
  }
}

/**
 * Strictly validates that a Web Push subscription endpoint is a safe public HTTPS push service URL.
 * Blocks non-HTTPS protocols, credentials in URL, loopback, and private/link-local IP ranges.
 */
export function validatePushSubscription(raw: unknown): PushSubscriptionPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.endpoint !== 'string') return null;
  const endpoint = obj.endpoint.trim();
  if (endpoint.length < 16 || endpoint.length > 2048) return null;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(endpoint);
  } catch {
    return null;
  }

  if (parsedUrl.protocol !== 'https:') return null;
  if (parsedUrl.username || parsedUrl.password) return null;

  const host = parsedUrl.hostname.toLowerCase();
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '::1' ||
    host.startsWith('[') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) ||
    /^0\./.test(host)
  ) {
    return null;
  }

  const keys = obj.keys as Record<string, unknown> | undefined;
  if (!keys || typeof keys !== 'object') return null;
  const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh.trim() : '';
  const auth = typeof keys.auth === 'string' ? keys.auth.trim() : '';
  if (p256dh.length < 20 || p256dh.length > 512 || auth.length < 8 || auth.length > 256) {
    return null;
  }

  return {
    endpoint,
    expirationTime: typeof obj.expirationTime === 'number' ? obj.expirationTime : null,
    keys: { p256dh, auth },
  };
}

function sanitizeDemandasList(raw: unknown): SyncedDemandaSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const out: SyncedDemandaSnapshot[] = [];
  for (const item of raw.slice(0, MAX_DEMANDAS_PER_USER)) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id.trim().slice(0, 128) : '';
    const title = typeof obj.title === 'string' ? obj.title.trim().slice(0, 180) : '';
    const dueDate = typeof obj.dueDate === 'string' ? obj.dueDate.trim() : '';
    const dueTime = typeof obj.dueTime === 'string' ? obj.dueTime.trim() : '';
    const status = obj.status === 'concluida' ? 'concluida' : 'pendente';
    const remindBeforeDays =
      typeof obj.remindBeforeDays === 'number' && Number.isFinite(obj.remindBeforeDays)
        ? Math.min(30, Math.max(0, Math.round(obj.remindBeforeDays)))
        : 0;

    if (!id || !title || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) continue;
    if (dueTime && !/^\d{2}:\d{2}$/.test(dueTime)) continue;
    if (status !== 'pendente') continue;

    out.push({ id, title, dueDate, dueTime, status, remindBeforeDays });
  }
  return out;
}

export async function syncUserPushState(params: {
  uid: string;
  subscription?: unknown;
  removeEndpoint?: string;
  demandas?: unknown;
  tzOffsetMinutes?: unknown;
  notifiedKeys?: unknown;
}): Promise<{ ok: true; subscriptionCount: number; demandaCount: number; pushConfigured: boolean }> {
  const state = await loadPushState();
  const existing: StoredUserPushRecord = state.users[params.uid] || {
    uid: params.uid,
    subscriptions: [],
    demandas: [],
    notifiedMap: {},
    tzOffsetMinutes: 180, // Default America/Sao_Paulo (UTC-3)
    updatedAt: Date.now(),
  };

  let subs = [...existing.subscriptions];

  if (typeof params.removeEndpoint === 'string' && params.removeEndpoint.trim()) {
    const target = params.removeEndpoint.trim();
    subs = subs.filter((s) => s.endpoint !== target);
  }

  if (params.subscription !== undefined && params.subscription !== null) {
    const validSub = validatePushSubscription(params.subscription);
    if (validSub) {
      subs = [validSub, ...subs.filter((s) => s.endpoint !== validSub.endpoint)].slice(
        0,
        MAX_SUBSCRIPTIONS_PER_USER
      );
    }
  }

  const demandas =
    params.demandas !== undefined ? sanitizeDemandasList(params.demandas) : existing.demandas;

  const tzOffsetMinutes =
    typeof params.tzOffsetMinutes === 'number' &&
    Number.isFinite(params.tzOffsetMinutes) &&
    params.tzOffsetMinutes >= -840 &&
    params.tzOffsetMinutes <= 840
      ? Math.round(params.tzOffsetMinutes)
      : existing.tzOffsetMinutes;

  const nowMs = Date.now();
  const notifiedMap: Record<string, number> = {};
  for (const [k, ts] of Object.entries(existing.notifiedMap || {})) {
    if (typeof ts === 'number' && nowMs - ts < MAX_NOTIFIED_AGE_MS) {
      notifiedMap[k] = ts;
    }
  }
  if (Array.isArray(params.notifiedKeys)) {
    for (const rawKey of params.notifiedKeys.slice(0, 300)) {
      if (typeof rawKey === 'string' && rawKey.trim().length > 0 && rawKey.length <= 200) {
        notifiedMap[rawKey.trim()] = nowMs;
      }
    }
  }

  state.users[params.uid] = {
    uid: params.uid,
    subscriptions: subs,
    demandas,
    notifiedMap,
    tzOffsetMinutes,
    updatedAt: nowMs,
  };

  await savePushState(state);

  return {
    ok: true,
    subscriptionCount: subs.length,
    demandaCount: demandas.length,
    pushConfigured: getPublicPushConfig().pushConfigured,
  };
}

function getLocalClockForOffset(utcNow: Date, tzOffsetMinutes: number) {
  // JS getTimezoneOffset() is UTC - Local (so Brasilia UTC-3 is +180)
  const localMs = utcNow.getTime() - tzOffsetMinutes * 60_000;
  const shifted = new Date(localMs);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(), // 0-based
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    localMs,
  };
}

function computeServerReminderAlert(
  item: SyncedDemandaSnapshot,
  utcNow: Date,
  tzOffsetMinutes: number
): { milestoneKey: string; headline: string; detail: string } | null {
  if (item.status !== 'pendente') return null;

  const clock = getLocalClockForOffset(utcNow, tzOffsetMinutes);
  const todayKey = `${clock.year}-${String(clock.month + 1).padStart(2, '0')}-${String(clock.day).padStart(2, '0')}`;
  const todayStartUtcMs = Date.UTC(clock.year, clock.month, clock.day, 0, 0, 0, 0);

  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(item.dueDate);
  if (!dm) return null;
  const dy = Number(dm[1]);
  const dmo = Number(dm[2]) - 1;
  const dd = Number(dm[3]);
  const dueStartUtcMs = Date.UTC(dy, dmo, dd, 0, 0, 0, 0);
  const daysLeft = Math.round((dueStartUtcMs - todayStartUtcMs) / 86_400_000);
  const shortDate = `${dm[3]}/${dm[2]}`;

  if (daysLeft > item.remindBeforeDays) return null;

  const tm = item.dueTime ? /^(\d{2}):(\d{2})$/.exec(item.dueTime) : null;
  const hasTime = Boolean(tm);

  if (daysLeft < 0) {
    const abs = Math.abs(daysLeft);
    return {
      milestoneKey: `${item.id}::overdue::${todayKey}`,
      headline: abs === 1 ? 'Demanda atrasada (1 dia)' : `Demanda atrasada (${abs} dias)`,
      detail: `Prazo era ${shortDate}${hasTime ? ` às ${item.dueTime}` : ''}`,
    };
  }

  if (daysLeft === 0) {
    if (tm) {
      const dueExactLocalMs = Date.UTC(dy, dmo, dd, Number(tm[1]), Number(tm[2]), 0, 0);
      const minsLeft = Math.round((dueExactLocalMs - clock.localMs) / 60_000);
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
      detail: `Prazo para hoje (${shortDate})`,
    };
  }

  if (daysLeft === 1) {
    return {
      milestoneKey: `${item.id}::before-1d::${item.dueDate}`,
      headline: 'Vence amanhã',
      detail: `Prazo amanhã (${shortDate})${hasTime ? ` às ${item.dueTime}` : ''}`,
    };
  }

  return {
    milestoneKey: `${item.id}::before-${daysLeft}d::${item.dueDate}`,
    headline: `Faltam ${daysLeft} dias`,
    detail: `Prazo em ${shortDate}${hasTime ? ` às ${item.dueTime}` : ''}`,
  };
}

async function sendWebPushToSubscriptions(
  subs: PushSubscriptionPayload[],
  payload: { title: string; body: string; tag: string; url: string; demandaId?: string }
): Promise<{ sent: number; expiredEndpoints: string[] }> {
  if (!ensureWebPushConfigured() || subs.length === 0) {
    return { sent: 0, expiredEndpoints: [] };
  }

  let sent = 0;
  const expiredEndpoints: string[] = [];
  const bodyStr = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, bodyStr, { TTL: 60 * 60 * 12 });
        sent += 1;
      } catch (err: unknown) {
        const statusCode =
          typeof err === 'object' && err !== null && 'statusCode' in err
            ? Number((err as { statusCode?: unknown }).statusCode)
            : 0;
        if (statusCode === 404 || statusCode === 410) {
          expiredEndpoints.push(sub.endpoint);
        } else {
          console.error('[Push] Delivery error:', err instanceof Error ? err.message : err);
        }
      }
    })
  );

  return { sent, expiredEndpoints };
}

export async function sendTestPushForUser(uid: string): Promise<{
  ok: boolean;
  sent: number;
  reason?: string;
}> {
  if (!ensureWebPushConfigured()) {
    return {
      ok: false,
      sent: 0,
      reason: 'VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY ainda não configuradas no servidor.',
    };
  }

  const state = await loadPushState();
  const userRecord = state.users[uid];
  if (!userRecord || userRecord.subscriptions.length === 0) {
    return {
      ok: false,
      sent: 0,
      reason: 'Nenhum dispositivo registrado para push neste login.',
    };
  }

  const { sent, expiredEndpoints } = await sendWebPushToSubscriptions(userRecord.subscriptions, {
    title: 'SISCOM · Notificações em segundo plano',
    body: 'Tudo certo! Você receberá alertas de demandas mesmo com o aplicativo fechado.',
    tag: 'siscom-push-test',
    url: '/?openDemandas=1',
  });

  if (expiredEndpoints.length > 0) {
    userRecord.subscriptions = userRecord.subscriptions.filter(
      (s) => !expiredEndpoints.includes(s.endpoint)
    );
    await savePushState(state);
  }

  return { ok: sent > 0, sent };
}

export async function runPushReminderSweep(): Promise<{
  checkedUsers: number;
  sentNotifications: number;
  pushConfigured: boolean;
}> {
  if (!ensureWebPushConfigured()) {
    return { checkedUsers: 0, sentNotifications: 0, pushConfigured: false };
  }

  const state = await loadPushState();
  const now = new Date();
  const nowMs = now.getTime();
  let checkedUsers = 0;
  let sentNotifications = 0;
  let dirty = false;

  for (const record of Object.values(state.users)) {
    if (!record || record.subscriptions.length === 0 || record.demandas.length === 0) continue;
    checkedUsers += 1;

    const expiredSet = new Set<string>();
    for (const item of record.demandas) {
      const alert = computeServerReminderAlert(item, now, record.tzOffsetMinutes ?? 180);
      if (!alert) continue;
      if (record.notifiedMap[alert.milestoneKey]) continue;

      const { sent, expiredEndpoints } = await sendWebPushToSubscriptions(record.subscriptions, {
        title: `SISCOM · ${alert.headline}`,
        body: `${item.title} — ${alert.detail}`,
        tag: alert.milestoneKey,
        url: '/?openDemandas=1',
        demandaId: item.id,
      });

      for (const ep of expiredEndpoints) expiredSet.add(ep);
      if (sent > 0) {
        record.notifiedMap[alert.milestoneKey] = nowMs;
        sentNotifications += sent;
        dirty = true;
      }
    }

    if (expiredSet.size > 0) {
      record.subscriptions = record.subscriptions.filter((s) => !expiredSet.has(s.endpoint));
      dirty = true;
    }
  }

  if (dirty) {
    await savePushState(state);
  }

  return { checkedUsers, sentNotifications, pushConfigured: true };
}

export function verifyCronAuthorization(authHeader: string | string[] | undefined): boolean {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (!secret) return false;
  const raw = Array.isArray(authHeader) ? authHeader[0] || '' : authHeader || '';
  const match = raw.match(/^Bearer\s+(.+)$/i);
  const candidate = match?.[1]?.trim() || '';
  if (!candidate || candidate.length !== secret.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(secret));
  } catch {
    return false;
  }
}
