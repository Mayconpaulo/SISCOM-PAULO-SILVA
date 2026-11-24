import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import {
  checkBiExtractRateLimit,
  validateAndNormalizeBiExtractBody,
  verifyFirebaseIdToken,
} from './server/biApiCore.ts';
import {
  getPublicPushConfig,
  runPushReminderSweep,
  sendTestPushForUser,
  syncUserPushState,
  verifyCronAuthorization,
} from './server/pushService.ts';

let biExtractionModulePromise: Promise<typeof import('./server/biExtractionService.ts')> | null = null;
function getBiExtractionModule() {
  if (!biExtractionModulePromise) {
    biExtractionModulePromise = import('./server/biExtractionService.ts');
  }
  return biExtractionModulePromise;
}

function resolveServerPort(): number {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    } else if (argv[i].startsWith('--port=')) {
      const parsed = Number(argv[i].slice('--port='.length));
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  const envPort = Number(process.env.PORT || 3000);
  if (
    process.env.NODE_ENV === 'development' &&
    process.env.NGINX_PORT &&
    String(envPort) === String(process.env.NGINX_PORT)
  ) {
    return Number(process.env.DEFAULT_APP_PORT || 3000);
  }
  return Number.isFinite(envPort) && envPort > 0 ? envPort : 3000;
}

const PORT = resolveServerPort();
const isProduction =
  process.env.NODE_ENV === 'production' ||
  (process.env.NODE_ENV !== 'development' &&
    fs.existsSync(path.resolve(import.meta.dirname, 'dist', 'index.html')));
const SERVER_BOOT_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// Simple per-IP sliding window limiter for /api/* routes
const apiHits = new Map<string, number[]>();
const API_WINDOW_MS = 60_000;
const API_MAX_REQ = 240;

interface AuthenticatedRequest extends Request {
  verifiedUid?: string;
}

async function verifyFirebaseAuthMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  setNoStoreHeaders(res);
  const authResult = await verifyFirebaseIdToken(req.headers.authorization);
  if (!authResult.ok) {
    res.status(authResult.status).json({ error: authResult.error });
    return;
  }
  req.verifiedUid = authResult.uid;
  next();
}

function biExtractRateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const rateResult = checkBiExtractRateLimit(clientIp);
  if (!rateResult.ok) {
    res.status(rateResult.status).json({ error: rateResult.error });
    return;
  }
  next();
}

function getNewestMtimeMs(dirPath: string): number {
  let newest = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === 'dist' ||
          entry.name === 'dev-dist' ||
          entry.name === '.git' ||
          entry.name === 'aistudio'
        ) {
          continue;
        }
        const sub = getNewestMtimeMs(fullPath);
        if (sub > newest) newest = sub;
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs > newest) newest = stat.mtimeMs;
      }
    }
  } catch {
    // Ignore transient FS errors
  }
  return newest;
}

function getCurrentAppVersion(): string {
  const rootDir = import.meta.dirname;
  if (isProduction) {
    const versionFile = path.join(rootDir, 'dist', 'version.json');
    try {
      if (fs.existsSync(versionFile)) {
        const parsed = JSON.parse(fs.readFileSync(versionFile, 'utf-8')) as { version?: string };
        if (typeof parsed.version === 'string' && parsed.version.trim()) {
          return parsed.version.trim();
        }
      }
    } catch {
      // Fallback to index.html mtime + boot id
    }
    try {
      const idxStat = fs.statSync(path.join(rootDir, 'dist', 'index.html'));
      return `prod-${Math.floor(idxStat.mtimeMs)}-${SERVER_BOOT_ID}`;
    } catch {
      return `prod-${SERVER_BOOT_ID}`;
    }
  }

  const srcMtime = getNewestMtimeMs(path.join(rootDir, 'src'));
  const publicMtime = getNewestMtimeMs(path.join(rootDir, 'public'));
  let htmlMtime = 0;
  try {
    htmlMtime = fs.statSync(path.join(rootDir, 'index.html')).mtimeMs;
  } catch {
    // ignore
  }
  const latest = Math.floor(Math.max(srcMtime, publicMtime, htmlMtime));
  return `dev-${SERVER_BOOT_ID}-${latest}`;
}

function setNoStoreHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, private');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

function enforceNoStoreHeaders(res: Response): void {
  setNoStoreHeaders(res);
  const originalSetHeader = res.setHeader.bind(res);
  res.setHeader = ((name: string, value: number | string | readonly string[]) => {
    if (name.toLowerCase() === 'cache-control') {
      return originalSetHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, max-age=0, private'
      );
    }
    return originalSetHeader(name, value);
  }) as Response['setHeader'];
}

const BLOCKED_SENSITIVE_PATHS =
  /^\/(?:\.env(?:\.[^/]*)?|\.git(?:\/.*)?|firestore\.rules|DRAFT_firestore\.rules|firebase-blueprint\.json|security_spec\.md|firestore\.rules\.test\.ts|package(?:-lock)?\.json|server\.ts|server\/.*|api\/.*\.ts|vercel\.json|tsconfig\.json|eslint\.config\.[a-z]+)$/i;

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://apis.google.com https://www.gstatic.com https://accounts.google.com https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' blob: data: https://*.googleusercontent.com https://www.gstatic.com",
  "worker-src 'self' blob: https://cdn.jsdelivr.net",
  "connect-src 'self' blob: data: https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebaseapp.com https://accounts.google.com https://www.gstatic.com https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.jsdelivr.net",
  "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self' https://*",
].join('; ');

function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction) {
  // Never serve internal config/rules/source metadata over HTTP
  if (BLOCKED_SENSITIVE_PATHS.test(req.path) || (isProduction && /\.map$/i.test(req.path))) {
    res.status(404).type('text/plain').send('Not found');
    return;
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), usb=(), bluetooth=(), payment=(), interest-cohort=()'
  );
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);

  const isStaticMedia = /\.(?:png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf)$/i.test(req.path);

  if (
    (!isProduction && !isStaticMedia) ||
    req.path.startsWith('/api/') ||
    req.path === '/' ||
    req.path.endsWith('.html') ||
    /^\/(?:sw\.js|dev-sw\.js|registerSW\.js|sw-cache-helper\.js|manifest\.webmanifest|version\.json)$/i.test(
      req.path
    )
  ) {
    enforceNoStoreHeaders(res);
  }

  next();
}

function apiRateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  // Exempt lightweight version sync & health endpoints so shared Wi-Fi NATs never block mandatory updates
  if (req.path === '/version' || req.path === '/version-stream' || req.path === '/health') {
    next();
    return;
  }

  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const prev = apiHits.get(clientIp) || [];
  const recent = prev.filter((ts) => now - ts < API_WINDOW_MS);

  if (recent.length >= API_MAX_REQ) {
    res.status(429).json({ error: 'Muitas requisições seguidas. Tente novamente em instantes.' });
    return;
  }

  recent.push(now);
  apiHits.set(clientIp, recent);

  if (apiHits.size > 1000) {
    for (const [ip, hits] of apiHits.entries()) {
      if (hits.every((ts) => now - ts >= API_WINDOW_MS)) {
        apiHits.delete(ip);
      }
    }
  }

  next();
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const httpServer = http.createServer(app);

  // Real-time Server-Sent Events broadcast so every connected device updates immediately
  const sseClients = new Set<Response>();
  let lastBroadcastVersion = getCurrentAppVersion();

  const broadcastVersion = (version: string) => {
    const payload = `data: ${JSON.stringify({ version, mode: isProduction ? 'production' : 'development' })}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  };

  setInterval(() => {
    if (sseClients.size === 0) return;
    const latest = getCurrentAppVersion();
    if (latest !== lastBroadcastVersion) {
      lastBroadcastVersion = latest;
      broadcastVersion(latest);
    }
  }, 2000);

  setInterval(() => {
    for (const client of sseClients) {
      try {
        client.write(': keepalive\n\n');
      } catch {
        sseClients.delete(client);
      }
    }
  }, 25_000);

  app.use(securityHeadersMiddleware);
  app.use('/api', apiRateLimitMiddleware);
  app.use('/api', express.json({ limit: '25mb' }));

  app.get('/api/health', (_req, res) => {
    setNoStoreHeaders(res);
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.get('/api/bi/provider-status', verifyFirebaseAuthMiddleware, async (_req, res) => {
    setNoStoreHeaders(res);
    try {
      const { getBiAiProviderStatus } = await getBiExtractionModule();
      res.json(getBiAiProviderStatus());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao consultar provedor de BI.';
      res.status(500).json({ error: message });
    }
  });

  app.post(
    '/api/bi/extract',
    verifyFirebaseAuthMiddleware,
    biExtractRateLimitMiddleware,
    async (req, res) => {
      setNoStoreHeaders(res);
      try {
        const validationResult = validateAndNormalizeBiExtractBody(req.body);
        if (!validationResult.ok) {
          res.status(validationResult.status).json({ error: validationResult.error });
          return;
        }

        const { extractAlterationsFromBulletin } = await getBiExtractionModule();
        const result = await extractAlterationsFromBulletin(validationResult.payload);
        res.json(result);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Erro inesperado ao processar o Boletim Interno.';
        console.error('[BI Extract Error]', message);
        res.status(502).json({ error: message });
      }
    }
  );

  app.get('/api/push/config', (_req, res) => {
    setNoStoreHeaders(res);
    res.json(getPublicPushConfig());
  });

  app.post('/api/push/sync', verifyFirebaseAuthMiddleware, async (req: AuthenticatedRequest, res) => {
    setNoStoreHeaders(res);
    try {
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
      const result = await syncUserPushState({
        uid: req.verifiedUid || '',
        subscription: body.subscription,
        removeEndpoint: typeof body.removeEndpoint === 'string' ? body.removeEndpoint : undefined,
        demandas: body.demandas,
        tzOffsetMinutes: body.tzOffsetMinutes,
        notifiedKeys: body.notifiedKeys,
      });
      res.json(result);
    } catch (err) {
      console.error('[Push Sync Error]', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Não foi possível sincronizar as notificações em segundo plano.' });
    }
  });

  app.post('/api/push/test', verifyFirebaseAuthMiddleware, async (req: AuthenticatedRequest, res) => {
    setNoStoreHeaders(res);
    try {
      const result = await sendTestPushForUser(req.verifiedUid || '');
      res.status(result.ok ? 200 : 400).json(result);
    } catch (err) {
      console.error('[Push Test Error]', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Falha ao disparar notificação push de teste.' });
    }
  });

  app.all('/api/push/cron', async (req, res) => {
    setNoStoreHeaders(res);
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      res.status(405).json({ error: 'Método não permitido.' });
      return;
    }
    if (!verifyCronAuthorization(req.headers.authorization)) {
      res.status(401).json({ error: 'Acesso não autorizado ao agendador de notificações.' });
      return;
    }
    try {
      const result = await runPushReminderSweep();
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error('[Push Cron Error]', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Erro ao executar varredura de notificações.' });
    }
  });

  app.get('/api/version', (_req, res) => {
    setNoStoreHeaders(res);
    res.json({
      version: getCurrentAppVersion(),
      mode: isProduction ? 'production' : 'development',
    });
  });

  app.get('/api/version-stream', (req, res) => {
    setNoStoreHeaders(res);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const currentVersion = getCurrentAppVersion();
    lastBroadcastVersion = currentVersion;
    res.write(
      `data: ${JSON.stringify({ version: currentVersion, mode: isProduction ? 'production' : 'development' })}\n\n`
    );

    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  app.use('/api', (_req, res) => {
    setNoStoreHeaders(res);
    res.status(404).json({ error: 'Rota de API não encontrada neste servidor.' });
  });

  if (!isProduction) {
    app.get('/version.json', (_req, res) => {
      setNoStoreHeaders(res);
      res.json({
        version: getCurrentAppVersion(),
        mode: 'development',
      });
    });

    // Initialize Vite asynchronously so port 3000 binds immediately without timing out cold boots
    const viteReadyPromise = import('vite')
      .then(({ createServer: createViteServer }) =>
        createViteServer({
          server: {
            middlewareMode: true,
            hmr: false,
            ws: false,
          },
          appType: 'spa',
        })
      )
      .catch((err) => {
        console.error('[Vite Init Error]', err);
        throw err;
      });

    app.use((req, res, next) => {
      viteReadyPromise
        .then((vite) => {
          vite.middlewares(req, res, next);
        })
        .catch(next);
    });
  } else {
    const distDir = path.resolve(import.meta.dirname, 'dist');
    app.use(
      express.static(distDir, {
        dotfiles: 'ignore',
        setHeaders: (res, filePath) => {
          if (
            /(?:^|\/)(?:index\.html|sw\.js|registerSW\.js|sw-cache-helper\.js|manifest\.webmanifest|version\.json)$/i.test(
              filePath
            )
          ) {
            setNoStoreHeaders(res);
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        setNoStoreHeaders(res);
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build não encontrado. Execute npm run build.');
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`SISCOM server running on http://0.0.0.0:${PORT}`);
    // Background Web Push reminder sweep every 5 minutes when VAPID keys are configured
    if (getPublicPushConfig().pushConfigured) {
      setInterval(() => {
        void runPushReminderSweep().catch((err) => {
          console.error('[Push Sweep Error]', err instanceof Error ? err.message : err);
        });
      }, 5 * 60_000);
    }
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
