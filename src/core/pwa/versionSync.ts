const FORCE_ATTEMPT_KEY = 'siscom_force_update_attempt_v2';
const BUST_QUERY_PARAM = '_siscom_v';
const BROADCAST_CHANNEL_NAME = 'siscom-mandatory-version-sync';
const POLL_INTERVAL_MS = import.meta.env.PROD ? 60_000 : 10_000;
const SSE_RECONNECT_MS = 10_000;
const MAX_ATTEMPTS_PER_VERSION = 2;

let reloadInProgress = false;
let baselineServerVersion: string | null = null;
let swRegistrationRef: ServiceWorkerRegistration | null = null;
let versionSyncStarted = false;
let eventSourceRef: EventSource | null = null;
let sseDisabled = false;
let broadcastChannelRef: BroadcastChannel | null = null;
let deferMandatoryUpdates = false;
let pendingDeferredVersion: string | null = null;

export function setActiveSwRegistration(reg: ServiceWorkerRegistration | null): void {
  swRegistrationRef = reg;
}

/**
 * Temporarily defers forced PWA version reloads (e.g. while large Google Drive uploads are running)
 * and automatically resumes the pending update as soon as transfers finish.
 */
export function setDeferMandatoryUpdates(busy: boolean): void {
  deferMandatoryUpdates = busy;
  if (!busy && pendingDeferredVersion && !reloadInProgress) {
    const versionToApply = pendingDeferredVersion;
    pendingDeferredVersion = null;
    void forceDeviceUpdate(versionToApply);
  }
}

/**
 * Strips the temporary cache-busting query param from the address bar immediately after
 * a mandatory reload completes, keeping the URL clean.
 */
export function stripVersionBustParam(): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(BUST_QUERY_PARAM)) return;
    url.searchParams.delete(BUST_QUERY_PARAM);
    const clean = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, '', clean || '/');
  } catch {
    // ignore URL parse errors
  }
}

function getEmbeddedBuildId(): string {
  const fromDefine = typeof __SISCOM_BUILD_ID__ === 'string' ? __SISCOM_BUILD_ID__.trim() : '';
  if (fromDefine) return fromDefine;
  if (typeof document !== 'undefined') {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="siscom-build-id"]');
    if (meta?.content?.trim()) return meta.content.trim();
  }
  return '';
}

function showMandatoryUpdateOverlay(showManualRetryButton = false, targetVersion?: string): void {
  if (typeof document === 'undefined') return;
  let overlay = document.getElementById('siscom-mandatory-update-overlay');
  if (overlay && !showManualRetryButton) return;
  if (overlay) {
    overlay.remove();
  }

  overlay = document.createElement('div');
  overlay.id = 'siscom-mandatory-update-overlay';
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-live', 'assertive');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483647',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:14px',
    'background:rgba(11,14,13,0.96)',
    'backdrop-filter:blur(8px)',
    'color:#F4E6C4',
    'font-family:"Plus Jakarta Sans",system-ui,sans-serif',
    'padding:24px',
    'text-align:center',
  ].join(';');

  const styleTag = document.createElement('style');
  styleTag.textContent = '@keyframes siscomUpdateSpin{to{transform:rotate(360deg)}}';
  overlay.appendChild(styleTag);

  if (!showManualRetryButton) {
    const spinner = document.createElement('div');
    spinner.style.cssText = [
      'width:34px',
      'height:34px',
      'border-radius:9999px',
      'border:3px solid rgba(200,164,97,0.25)',
      'border-top-color:#E5C17B',
      'animation:siscomUpdateSpin 0.8s linear infinite',
    ].join(';');
    overlay.appendChild(spinner);
  }

  const title = document.createElement('div');
  title.textContent = showManualRetryButton
    ? 'Nova versão do SISCOM obrigatória'
    : 'Atualizando SISCOM...';
  title.style.cssText = 'font-size:15px;font-weight:600;letter-spacing:0.02em;color:#F4E6C4;';

  const subtitle = document.createElement('div');
  subtitle.textContent = showManualRetryButton
    ? 'Toque abaixo para concluir a atualização e carregar a versão mais recente.'
    : 'Aplicando a versão mais recente do sistema.';
  subtitle.style.cssText = 'font-size:12px;color:#98A89F;max-width:300px;line-height:1.5;';

  overlay.appendChild(title);
  overlay.appendChild(subtitle);

  if (showManualRetryButton) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Atualizar Agora';
    btn.style.cssText = [
      'margin-top:6px',
      'min-height:42px',
      'padding:0 22px',
      'border-radius:10px',
      'border:1px solid rgba(200,164,97,0.55)',
      'background:#2D5A43',
      'color:#FFFFFF',
      'font-size:13px',
      'font-weight:600',
      'cursor:pointer',
    ].join(';');
    btn.onclick = () => {
      clearUpdateAttemptTracker();
      reloadInProgress = false;
      void forceDeviceUpdate(targetVersion || `manual-${Date.now()}`);
    };
    overlay.appendChild(btn);
  }

  document.body?.appendChild(overlay);
}

function postMessageWithAck(worker: ServiceWorker, msg: unknown, timeoutMs = 400): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    try {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        window.clearTimeout(timer);
        finish();
      };
      worker.postMessage(msg, [channel.port2]);
    } catch {
      try {
        worker.postMessage(msg);
      } catch {
        // ignore
      }
      window.clearTimeout(timer);
      finish();
    }
  });
}

export async function clearAllPwaCaches(): Promise<void> {
  if (typeof window === 'undefined') return;

  if ('caches' in window) {
    try {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((key) => window.caches.delete(key)));
    } catch {
      // ignore cache deletion errors
    }
  }

  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    await postMessageWithAck(
      navigator.serviceWorker.controller,
      { type: 'SISCOM_CLEAR_ALL_CACHES' },
      350
    );
  }
}

async function fetchRemoteVersion(): Promise<string | null> {
  if (typeof window === 'undefined' || !navigator.onLine) return null;

  const bust = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  // In production, static /version.json works on both Vercel and Node servers without causing /api/version 404 noise.
  const endpoints = import.meta.env.PROD
    ? [`/version.json?t=${bust}`]
    : [`/api/version?t=${bust}`, `/version.json?t=${bust}`];

  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 4500);
      const res = await fetch(url, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store',
          Pragma: 'no-cache',
        },
        signal: controller.signal,
      });
      window.clearTimeout(timeoutId);

      if (!res.ok) continue;
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) continue;

      const data = (await res.json()) as { version?: unknown };
      if (typeof data?.version === 'string' && data.version.trim().length > 0) {
        return data.version.trim();
      }
    } catch {
      // Try next endpoint or skip if temporarily unreachable
    }
  }

  return null;
}

function recordUpdateAttempt(targetVersion: string): boolean {
  if (reloadInProgress) return false;
  try {
    const raw = window.sessionStorage.getItem(FORCE_ATTEMPT_KEY);
    let attempts = 0;
    if (raw) {
      const parsed = JSON.parse(raw) as { version?: string; count?: number; at?: number };
      if (parsed.version === targetVersion && Date.now() - (parsed.at || 0) < 30_000) {
        attempts = Number(parsed.count || 0);
      }
    }
    if (attempts >= MAX_ATTEMPTS_PER_VERSION) {
      showMandatoryUpdateOverlay(true, targetVersion);
      return false;
    }
    window.sessionStorage.setItem(
      FORCE_ATTEMPT_KEY,
      JSON.stringify({ version: targetVersion, count: attempts + 1, at: Date.now() })
    );
  } catch {
    // Continue even if sessionStorage is restricted
  }
  return true;
}

function clearUpdateAttemptTracker(): void {
  try {
    window.sessionStorage.removeItem(FORCE_ATTEMPT_KEY);
  } catch {
    // ignore
  }
}

export async function forceDeviceUpdate(targetVersion: string, fromBroadcast = false): Promise<void> {
  if (typeof window === 'undefined') return;
  if (deferMandatoryUpdates) {
    pendingDeferredVersion = targetVersion;
    return;
  }
  if (!recordUpdateAttempt(targetVersion)) return;

  reloadInProgress = true;
  showMandatoryUpdateOverlay();

  // Notify every other open tab on the same device immediately
  if (!fromBroadcast && broadcastChannelRef) {
    try {
      broadcastChannelRef.postMessage({ type: 'FORCE_UPDATE', version: targetVersion });
    } catch {
      // ignore broadcast errors
    }
  }

  if (eventSourceRef) {
    try {
      eventSourceRef.close();
    } catch {
      // ignore
    }
    eventSourceRef = null;
  }

  await clearAllPwaCaches();

  // Activate waiting service worker and clear caches WITHOUT unregistering the SW,
  // preserving active Web Push subscriptions for closed-app background notifications.
  if ('serviceWorker' in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        regs.map(async (reg) => {
          try {
            if (reg.waiting) {
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
            if (reg.active) {
              await postMessageWithAck(reg.active, { type: 'SISCOM_CLEAR_ALL_CACHES' }, 250);
            }
            await reg.update();
          } catch {
            // ignore transient SW update failures
          }
        })
      );
    } catch {
      // ignore
    }
  }

  // Final cache sweep after SW unregistration
  await clearAllPwaCaches();

  // Hard cache-busted navigation (far more reliable than window.location.reload() on mobile PWAs)
  try {
    const nextUrl = new URL(window.location.href);
    const cleanToken = targetVersion.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 32);
    nextUrl.searchParams.set(BUST_QUERY_PARAM, `${cleanToken}-${Date.now().toString(36)}`);
    window.location.replace(nextUrl.toString());
  } catch {
    window.location.reload();
  }
}

async function evaluateRemoteVersion(remoteVersion: string): Promise<void> {
  if (!remoteVersion || reloadInProgress) return;

  const embeddedBuildId = getEmbeddedBuildId();

  // Production: NEVER allow a device to remain on an older bundle than what the server serves
  if (import.meta.env.PROD && embeddedBuildId) {
    if (remoteVersion !== embeddedBuildId) {
      await forceDeviceUpdate(remoteVersion);
      return;
    }
    clearUpdateAttemptTracker();
    return;
  }

  // Development: establish initial server version and force update immediately on any change
  if (baselineServerVersion === null) {
    baselineServerVersion = remoteVersion;
    clearUpdateAttemptTracker();
    return;
  }

  if (remoteVersion !== baselineServerVersion) {
    await forceDeviceUpdate(remoteVersion);
  }
}

export async function checkForAppUpdate(): Promise<void> {
  if (typeof window === 'undefined' || reloadInProgress) return;

  if (swRegistrationRef) {
    swRegistrationRef.update().catch(() => {
      // ignore transient offline SW update failures
    });
  }

  const remoteVersion = await fetchRemoteVersion();
  if (!remoteVersion) return;

  await evaluateRemoteVersion(remoteVersion);
}

function connectVersionEventStream(): void {
  // Only use SSE in development (Node server); in production rely on /version.json polling
  // to avoid continuous 404 reconnect loops on serverless/static hosts like Vercel.
  if (
    import.meta.env.PROD ||
    sseDisabled ||
    typeof window === 'undefined' ||
    typeof EventSource === 'undefined' ||
    reloadInProgress
  ) {
    return;
  }

  if (eventSourceRef) {
    try {
      eventSourceRef.close();
    } catch {
      // ignore
    }
    eventSourceRef = null;
  }

  try {
    let receivedMessage = false;
    const es = new EventSource(`/api/version-stream?t=${Date.now()}`);
    eventSourceRef = es;

    es.onmessage = (event) => {
      receivedMessage = true;
      try {
        const parsed = JSON.parse(event.data) as { version?: unknown };
        if (typeof parsed?.version === 'string' && parsed.version.trim()) {
          void evaluateRemoteVersion(parsed.version.trim());
        }
      } catch {
        // ignore malformed frames
      }
    };

    es.onerror = () => {
      es.close();
      if (eventSourceRef === es) {
        eventSourceRef = null;
      }
      if (!receivedMessage) {
        sseDisabled = true;
        return;
      }
      if (!reloadInProgress) {
        window.setTimeout(() => {
          if (document.visibilityState === 'visible' && navigator.onLine && !reloadInProgress) {
            connectVersionEventStream();
          }
        }, SSE_RECONNECT_MS);
      }
    };
  } catch {
    sseDisabled = true;
  }
}

export function startAutomaticVersionSync(): void {
  if (typeof window === 'undefined' || versionSyncStarted) return;
  versionSyncStarted = true;

  // Cross-tab mandatory sync
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      broadcastChannelRef = bc;
      bc.onmessage = (event) => {
        if (event.data?.type === 'FORCE_UPDATE' && typeof event.data.version === 'string') {
          void forceDeviceUpdate(event.data.version, true);
        }
      };
    } catch {
      // ignore BroadcastChannel failures
    }
  }

  // Listen to SW activation notifications
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'SISCOM_SW_ACTIVATED') {
        void checkForAppUpdate();
      }
    });
  }

  // 1. Immediate check on boot (catches stale installed PWAs the instant they open)
  void checkForAppUpdate();

  // 2. Real-time Server-Sent Events push (updates all connected devices in ~2s)
  connectVersionEventStream();

  // 3. Fast fallback polling while visible (works even on static hosts without SSE)
  window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      void checkForAppUpdate();
    }
  }, POLL_INTERVAL_MS);

  // 4. Instant re-checks on app resume, tab focus, network reconnect, or bfcache restore
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void checkForAppUpdate();
      if (!eventSourceRef) {
        connectVersionEventStream();
      }
    }
  });

  window.addEventListener('focus', () => {
    void checkForAppUpdate();
  });

  window.addEventListener('online', () => {
    void checkForAppUpdate();
    connectVersionEventStream();
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      void checkForAppUpdate();
    }
  });
}
