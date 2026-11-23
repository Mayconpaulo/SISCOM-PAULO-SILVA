import crypto from 'crypto';
import fs from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import path from 'path';
import type { BiBulletinPageInput, BiExtractRequestPayload } from './biExtractionService.js';

export type ServerlessRequest = IncomingMessage & {
  body?: unknown;
  query?: Record<string, string | string[]>;
  ip?: string;
};

export type ServerlessResponse = ServerResponse & {
  status?: (code: number) => ServerlessResponse;
  json?: (body: unknown) => ServerlessResponse | void;
};

// Stricter per-IP sliding window limiter specifically for AI extraction calls
const biExtractHits = new Map<string, number[]>();
const BI_EXTRACT_WINDOW_MS = 60_000;
const BI_EXTRACT_MAX_REQ = 30;

// Short-lived in-memory cache of verified Firebase ID tokens (keyed by SHA-256 hash)
const verifiedTokenCache = new Map<string, { uid: string; expiresAt: number }>();

let cachedFirebaseWebApiKey: string | null | undefined;

export function loadFirebaseWebApiKey(): string | null {
  if (cachedFirebaseWebApiKey) {
    return cachedFirebaseWebApiKey;
  }

  const fromEnv = process.env.FIREBASE_WEB_API_KEY?.trim();
  if (fromEnv) {
    cachedFirebaseWebApiKey = fromEnv;
    return fromEnv;
  }

  const candidatePaths = [
    path.join(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(import.meta.dirname, '..', 'firebase-applet-config.json'),
    path.resolve(import.meta.dirname, 'firebase-applet-config.json'),
  ];

  for (const cfgPath of candidatePaths) {
    try {
      if (!fs.existsSync(cfgPath)) continue;
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as { apiKey?: string };
      if (typeof parsed.apiKey === 'string' && parsed.apiKey.trim()) {
        cachedFirebaseWebApiKey = parsed.apiKey.trim();
        return cachedFirebaseWebApiKey;
      }
    } catch {
      // Try next candidate path
    }
  }

  return null;
}

export function setApiSecurityAndNoStoreHeaders(res: Pick<ServerResponse, 'setHeader'>): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, private');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

export function sendJson(res: ServerlessResponse, statusCode: number, data: unknown): void {
  setApiSecurityAndNoStoreHeaders(res);
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    const target = res.status(statusCode);
    if (typeof target.json === 'function') {
      target.json(data);
      return;
    }
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

export function getClientIpFromRequest(req: ServerlessRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const rawForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof rawForwarded === 'string' && rawForwarded.trim()) {
    const first = rawForwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers['x-real-ip'];
  const rawRealIp = Array.isArray(realIp) ? realIp[0] : realIp;
  if (typeof rawRealIp === 'string' && rawRealIp.trim()) {
    return rawRealIp.trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export async function verifyFirebaseIdToken(
  authHeaderValue: string | string[] | undefined
): Promise<{ ok: true; uid: string } | { ok: false; status: 401 | 500 | 503; error: string }> {
  const authHeader = Array.isArray(authHeaderValue)
    ? authHeaderValue[0] || ''
    : authHeaderValue || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const idToken = match?.[1]?.trim();

  if (!idToken || idToken.length < 40 || idToken.length > 8192) {
    return {
      ok: false,
      status: 401,
      error: 'Sessão não autenticada. Faça login novamente no SISCOM.',
    };
  }

  const firebaseWebApiKey = loadFirebaseWebApiKey();
  if (!firebaseWebApiKey) {
    return {
      ok: false,
      status: 500,
      error: 'Configuração de autenticação do servidor indisponível.',
    };
  }

  const tokenHash = crypto.createHash('sha256').update(idToken).digest('hex');
  const now = Date.now();
  const cached = verifiedTokenCache.get(tokenHash);
  if (cached && cached.expiresAt > now) {
    return { ok: true, uid: cached.uid };
  }

  try {
    const lookupRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseWebApiKey)}`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );

    if (!lookupRes.ok) {
      return {
        ok: false,
        status: 401,
        error: 'Sessão expirada ou inválida. Faça login novamente.',
      };
    }

    const data = (await lookupRes.json()) as {
      users?: Array<{ localId?: string; disabled?: boolean }>;
    };
    const user = data.users?.[0];
    if (!user?.localId || user.disabled) {
      return {
        ok: false,
        status: 401,
        error: 'Conta não autorizada ou desativada.',
      };
    }

    verifiedTokenCache.set(tokenHash, { uid: user.localId, expiresAt: now + 120_000 });
    if (verifiedTokenCache.size > 500) {
      for (const [k, v] of verifiedTokenCache.entries()) {
        if (v.expiresAt <= now) verifiedTokenCache.delete(k);
      }
    }

    return { ok: true, uid: user.localId };
  } catch {
    return {
      ok: false,
      status: 503,
      error: 'Não foi possível validar sua sessão no momento.',
    };
  }
}

export function checkBiExtractRateLimit(
  clientIp: string
): { ok: true } | { ok: false; status: 429; error: string } {
  const now = Date.now();
  const prev = biExtractHits.get(clientIp) || [];
  const recent = prev.filter((ts) => now - ts < BI_EXTRACT_WINDOW_MS);

  if (recent.length >= BI_EXTRACT_MAX_REQ) {
    return {
      ok: false,
      status: 429,
      error: 'Limite temporário de análises atingido. Aguarde alguns segundos e tente novamente.',
    };
  }

  recent.push(now);
  biExtractHits.set(clientIp, recent);

  if (biExtractHits.size > 1000) {
    for (const [ip, hits] of biExtractHits.entries()) {
      if (hits.every((ts) => now - ts >= BI_EXTRACT_WINDOW_MS)) {
        biExtractHits.delete(ip);
      }
    }
  }

  return { ok: true };
}

export async function readJsonBody(
  req: ServerlessRequest,
  maxBytes = 4_500_000
): Promise<{ ok: true; body: unknown } | { ok: false; status: 400 | 413; error: string }> {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      if (Buffer.byteLength(req.body, 'utf-8') > maxBytes) {
        return {
          ok: false,
          status: 413,
          error: 'Boletim muito extenso para processamento único.',
        };
      }
      try {
        return { ok: true, body: JSON.parse(req.body) };
      } catch {
        return { ok: false, status: 400, error: 'Corpo da requisição inválido.' };
      }
    }
    if (Buffer.isBuffer(req.body)) {
      if (req.body.byteLength > maxBytes) {
        return {
          ok: false,
          status: 413,
          error: 'Boletim muito extenso para processamento único.',
        };
      }
      try {
        return { ok: true, body: JSON.parse(req.body.toString('utf-8')) };
      } catch {
        return { ok: false, status: 400, error: 'Corpo da requisição inválido.' };
      }
    }
    return { ok: true, body: req.body };
  }

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const finish = (
      result: { ok: true; body: unknown } | { ok: false; status: 400 | 413; error: string }
    ) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    req.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.byteLength;
      if (totalBytes > maxBytes) {
        finish({
          ok: false,
          status: 413,
          error: 'Boletim muito extenso para processamento único.',
        });
        return;
      }
      chunks.push(buf);
    });

    req.on('end', () => {
      if (settled) return;
      if (chunks.length === 0) {
        finish({ ok: false, status: 400, error: 'Corpo da requisição inválido.' });
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        finish({ ok: true, body: parsed });
      } catch {
        finish({ ok: false, status: 400, error: 'Corpo da requisição inválido.' });
      }
    });

    req.on('error', () => {
      finish({ ok: false, status: 400, error: 'Falha ao ler os dados da requisição.' });
    });
  });
}

export function validateAndNormalizeBiExtractBody(
  rawBody: unknown
):
  | { ok: true; payload: BiExtractRequestPayload }
  | { ok: false; status: 400 | 413; error: string } {
  const body = rawBody as Partial<BiExtractRequestPayload> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'Corpo da requisição inválido.' };
  }

  const rawMil = body.military;
  const nomeCompleto =
    typeof rawMil?.nomeCompleto === 'string' ? rawMil.nomeCompleto.trim() : '';
  if (nomeCompleto.length < 2 || nomeCompleto.length > 180) {
    return { ok: false, status: 400, error: 'Informe o nome do militar pesquisado.' };
  }

  const rawBul = body.bulletin;
  const fileName =
    typeof rawBul?.fileName === 'string' && rawBul.fileName.trim()
      ? rawBul.fileName.trim().slice(0, 240)
      : 'boletim.pdf';

  if (!Array.isArray(rawBul?.pages) || rawBul.pages.length === 0 || rawBul.pages.length > 250) {
    return { ok: false, status: 400, error: 'Boletim sem páginas válidas para análise.' };
  }

  const pages: BiBulletinPageInput[] = [];
  let totalChars = 0;
  for (const p of rawBul.pages) {
    const pageNumber = Math.floor(Number(p?.pageNumber));
    const text = typeof p?.text === 'string' ? p.text : '';
    if (!Number.isFinite(pageNumber) || pageNumber < 1 || pageNumber > 500) continue;
    const clampedText = text.slice(0, 40_000);
    totalChars += clampedText.length;
    if (totalChars > 1_200_000) {
      return {
        ok: false,
        status: 413,
        error: 'Boletim muito extenso para processamento único.',
      };
    }
    pages.push({
      pageNumber,
      text: clampedText,
      usedOcr: Boolean(p?.usedOcr),
    });
  }

  if (pages.length === 0 || totalChars < 20) {
    return {
      ok: false,
      status: 400,
      error: 'Não foi possível extrair texto legível deste boletim.',
    };
  }

  return {
    ok: true,
    payload: {
      military: {
        nomeCompleto,
        postoGraduacao:
          typeof rawMil?.postoGraduacao === 'string'
            ? rawMil.postoGraduacao.trim().slice(0, 80)
            : '',
        nomeGuerra:
          typeof rawMil?.nomeGuerra === 'string' ? rawMil.nomeGuerra.trim().slice(0, 80) : '',
        subunidade:
          typeof rawMil?.subunidade === 'string' ? rawMil.subunidade.trim().slice(0, 80) : '',
        identidade:
          typeof rawMil?.identidade === 'string' ? rawMil.identidade.trim().slice(0, 60) : '',
        qasQms: typeof rawMil?.qasQms === 'string' ? rawMil.qasQms.trim().slice(0, 100) : '',
      },
      bulletin: { fileName, pages },
      options: {
        includeFirstPart: Boolean(body.options?.includeFirstPart),
      },
    },
  };
}
