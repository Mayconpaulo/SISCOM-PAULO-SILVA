import {
  getGoogleDriveAccessToken,
  markGoogleDriveTokenExpired,
} from './googleDriveAuthService';
import type { DriveAccountInfo, DriveFolderCandidate } from './arquivoTypes';

const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const DRIVE_ID_REGEX = /^[a-zA-Z0-9_-]{8,128}$/;

// Tracks whether /api/drive/* Express proxy is unavailable (e.g., static hosting / preview)
let preferDirectDriveApi = false;

export class DriveApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'DriveApiError';
    this.status = status;
    this.code = code;
  }
}

export function isValidDriveId(value: string): boolean {
  return DRIVE_ID_REGEX.test(value.trim());
}

export function escapeDriveQueryLiteral(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function requireToken(): string {
  const token = getGoogleDriveAccessToken();
  if (!token) {
    throw new DriveApiError(
      401,
      'TOKEN_EXPIRED',
      'Conexão com o Google Drive inativa ou expirada. Conecte a conta institucional para continuar.'
    );
  }
  return token;
}

interface GoogleDriveErrorPayload {
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
}

export async function directGoogleDriveFetchJson<T>(
  url: string,
  init: RequestInit = {}
): Promise<T> {
  const token = requireToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers,
    });
  } catch {
    throw new DriveApiError(
      0,
      'NETWORK_ERROR',
      'Falha de conexão com o Google Drive. Verifique sua internet e tente novamente.'
    );
  }

  if (res.status === 401) {
    markGoogleDriveTokenExpired();
    throw new DriveApiError(
      401,
      'TOKEN_EXPIRED',
      'A sessão do Google Drive expirou. Clique em "Reconectar" com a conta institucional.'
    );
  }

  const rawText = await res.text();
  let parsed: unknown = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const errPayload = parsed as GoogleDriveErrorPayload | null;
    const reason = errPayload?.error?.errors?.[0]?.reason || '';
    const apiMessage = errPayload?.error?.message || '';

    if (
      res.status === 403 &&
      (reason === 'accessNotConfigured' || apiMessage.toLowerCase().includes('drive api has not been used'))
    ) {
      throw new DriveApiError(
        403,
        'DRIVE_API_DISABLED',
        'A Google Drive API ainda precisa ser ativada no projeto Google Cloud (gen-lang-client-0187607531). Clique no link ao lado para ativá-la em 1 clique.'
      );
    }
    if (res.status === 403 && reason === 'storageQuotaExceeded') {
      throw new DriveApiError(
        507,
        'STORAGE_QUOTA_EXCEEDED',
        'Armazenamento do Google Drive institucional cheio. Libere espaço na conta antes de enviar novos arquivos.'
      );
    }
    if (res.status === 403 && (reason === 'insufficientFilePermissions' || reason === 'forbidden')) {
      throw new DriveApiError(
        403,
        'INSUFFICIENT_PERMISSIONS',
        'A conta conectada não possui permissão suficiente nesta pasta do Google Drive.'
      );
    }
    if (res.status === 404) {
      throw new DriveApiError(
        404,
        'DRIVE_NOT_FOUND',
        'A pasta ou recurso solicitado não foi encontrado na conta do Google Drive conectada.'
      );
    }
    if (res.status === 429) {
      throw new DriveApiError(
        429,
        'DRIVE_RATE_LIMIT',
        'Limite temporário do Google Drive atingido. Aguarde alguns segundos e tente novamente.'
      );
    }

    throw new DriveApiError(
      res.status,
      'DRIVE_API_ERROR',
      apiMessage || `Erro HTTP ${res.status} ao comunicar com o Google Drive.`
    );
  }

  return (parsed as T) ?? ({} as T);
}

/**
 * Calls the SISCOM Express backend (/api/drive/*) first. If the hosting environment does not serve
 * custom Express API routes (HTTP 404 / non-JSON static fallback), seamlessly runs the validated
 * direct fallback against Google Drive API v3 (matching the Agenda module's proven pattern).
 */
async function callBackendWithDirectFallback<T>(
  backendPath: string,
  init: RequestInit,
  directFallback: () => Promise<T>
): Promise<T> {
  if (preferDirectDriveApi) {
    return directFallback();
  }

  const token = requireToken();
  const headers = new Headers(init.headers);
  headers.set('X-Google-Drive-Token', token);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(`/api/drive${backendPath}`, {
      ...init,
      headers,
    });
  } catch {
    preferDirectDriveApi = true;
    return directFallback();
  }

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  // If the host returned 404 or HTML (no /api/drive Express route on this deployment), switch to direct Drive API
  if (!isJson || res.status === 404) {
    let parsedErr: { code?: string; error?: string } | null = null;
    if (isJson) {
      parsedErr = (await res.json().catch(() => null)) as { code?: string; error?: string } | null;
    }
    // Only treat as real Drive 404 if our Express handler explicitly sent a known Drive error code
    if (parsedErr?.code && parsedErr.code !== 'NOT_FOUND') {
      throw new DriveApiError(
        res.status,
        parsedErr.code,
        parsedErr.error || 'A pasta ou recurso solicitado não foi encontrado no Google Drive.'
      );
    }
    preferDirectDriveApi = true;
    return directFallback();
  }

  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };

  if (res.status === 401 || data.code === 'TOKEN_EXPIRED' || data.code === 'TOKEN_INVALID') {
    markGoogleDriveTokenExpired();
    throw new DriveApiError(
      401,
      data.code || 'TOKEN_EXPIRED',
      data.error || 'A sessão do Google Drive expirou. Reconecte a conta institucional.'
    );
  }

  if (!res.ok) {
    throw new DriveApiError(
      res.status,
      data.code || 'DRIVE_API_ERROR',
      data.error || `Erro HTTP ${res.status} ao comunicar com o servidor do Google Drive.`
    );
  }

  return data as T;
}

interface RawDriveAboutResponse {
  user?: {
    displayName?: string;
    emailAddress?: string;
  };
  storageQuota?: {
    limit?: string;
    usage?: string;
    usageInDrive?: string;
  };
}

interface RawDriveFolderMeta {
  id: string;
  name: string;
  mimeType?: string;
  trashed?: boolean;
  modifiedTime?: string;
  ownedByMe?: boolean;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
  webViewLink?: string;
  capabilities?: {
    canAddChildren?: boolean;
    canListChildren?: boolean;
  };
}

function mapRawFolderCandidate(f: RawDriveFolderMeta): DriveFolderCandidate {
  return {
    id: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime || null,
    ownedByMe: Boolean(f.ownedByMe),
    ownerEmail: f.owners?.[0]?.emailAddress || null,
    ownerName: f.owners?.[0]?.displayName || null,
    webViewLink: f.webViewLink || null,
    canAddChildren: Boolean(f.capabilities?.canAddChildren),
    canListChildren: Boolean(f.capabilities?.canListChildren),
  };
}

export async function fetchDriveAccountInfo(): Promise<DriveAccountInfo> {
  return callBackendWithDirectFallback<DriveAccountInfo>(
    '/account',
    { method: 'GET' },
    async () => {
      const fields = encodeURIComponent(
        'user(displayName,emailAddress),storageQuota(limit,usage,usageInDrive)'
      );
      const about = await directGoogleDriveFetchJson<RawDriveAboutResponse>(
        `${GOOGLE_DRIVE_API_BASE}/about?fields=${fields}`
      );
      const limitBytes = about.storageQuota?.limit ? Number(about.storageQuota.limit) : null;
      const usageBytes = about.storageQuota?.usage ? Number(about.storageQuota.usage) : null;
      const usageInDriveBytes = about.storageQuota?.usageInDrive
        ? Number(about.storageQuota.usageInDrive)
        : null;

      return {
        email: about.user?.emailAddress || null,
        displayName: about.user?.displayName || null,
        storageQuota: {
          limitBytes: Number.isFinite(limitBytes) ? limitBytes : null,
          usageBytes: Number.isFinite(usageBytes) ? usageBytes : null,
          usageInDriveBytes: Number.isFinite(usageInDriveBytes) ? usageInDriveBytes : null,
        },
      };
    }
  );
}

export async function searchDriveRootCandidates(queryText = ''): Promise<DriveFolderCandidate[]> {
  const trimmed = queryText.trim().slice(0, 80);
  const params = new URLSearchParams();
  if (trimmed) {
    params.set('q', trimmed);
  }
  const qs = params.toString();

  const result = await callBackendWithDirectFallback<{ folders: DriveFolderCandidate[] }>(
    `/root-candidates${qs ? `?${qs}` : ''}`,
    { method: 'GET' },
    async () => {
      const queryParts = [`mimeType = '${FOLDER_MIME_TYPE}'`, 'trashed = false'];
      if (trimmed.length > 0) {
        queryParts.push(`name contains '${escapeDriveQueryLiteral(trimmed)}'`);
      } else {
        queryParts.push(`'root' in parents`);
      }

      const driveParams = new URLSearchParams({
        q: queryParts.join(' and '),
        spaces: 'drive',
        pageSize: '30',
        orderBy: 'folder,name_natural',
        fields:
          'files(id,name,modifiedTime,ownedByMe,owners(displayName,emailAddress),webViewLink,capabilities(canAddChildren,canListChildren))',
      });

      const listRes = await directGoogleDriveFetchJson<{ files?: RawDriveFolderMeta[] }>(
        `${GOOGLE_DRIVE_API_BASE}/files?${driveParams.toString()}`
      );

      const folders = (listRes.files || []).map(mapRawFolderCandidate);
      folders.sort((a, b) => {
        const aNorm = a.name.trim().toLowerCase();
        const bNorm = b.name.trim().toLowerCase();
        const aScore = aNorm.includes('fotos') && aNorm.includes('2026') ? 0 : aNorm.includes('fotos') ? 1 : 2;
        const bScore = bNorm.includes('fotos') && bNorm.includes('2026') ? 0 : bNorm.includes('fotos') ? 1 : 2;
        if (aScore !== bScore) return aScore - bScore;
        return a.name.localeCompare(b.name, 'pt-BR');
      });

      return { folders };
    }
  );

  return result.folders || [];
}

export async function verifyDriveRootFolder(folderId: string): Promise<{
  folder: DriveFolderCandidate;
  accountEmail: string | null;
  accountDisplayName: string | null;
}> {
  const cleanId = folderId.trim();
  if (!isValidDriveId(cleanId)) {
    throw new DriveApiError(
      400,
      'INVALID_FOLDER_ID',
      'Informe um ID de pasta do Google Drive válido.'
    );
  }

  return callBackendWithDirectFallback(
    '/verify-root',
    {
      method: 'POST',
      body: JSON.stringify({ folderId: cleanId }),
    },
    async () => {
      const folderFields = encodeURIComponent(
        'id,name,mimeType,trashed,modifiedTime,ownedByMe,owners(displayName,emailAddress),webViewLink,capabilities(canAddChildren,canListChildren)'
      );
      const [meta, about] = await Promise.all([
        directGoogleDriveFetchJson<RawDriveFolderMeta>(
          `${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(cleanId)}?fields=${folderFields}&supportsAllDrives=false`
        ),
        directGoogleDriveFetchJson<RawDriveAboutResponse>(
          `${GOOGLE_DRIVE_API_BASE}/about?fields=${encodeURIComponent('user(displayName,emailAddress)')}`
        ),
      ]);

      if (meta.mimeType !== FOLDER_MIME_TYPE) {
        throw new DriveApiError(
          400,
          'NOT_A_FOLDER',
          'O identificador selecionado não corresponde a uma pasta do Google Drive.'
        );
      }
      if (meta.trashed) {
        throw new DriveApiError(
          404,
          'FOLDER_TRASHED',
          'A pasta informada está na lixeira do Google Drive.'
        );
      }

      return {
        folder: mapRawFolderCandidate(meta),
        accountEmail: about.user?.emailAddress || null,
        accountDisplayName: about.user?.displayName || null,
      };
    }
  );
}

/**
 * Extracts a Google Drive folder ID either from a raw ID or from a pasted Google Drive folder URL.
 */
export function extractDriveFolderIdFromInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]{8,128})/);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  const queryMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{8,128})/);
  if (queryMatch?.[1]) {
    return queryMatch[1];
  }

  if (/^[a-zA-Z0-9_-]{8,128}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}
