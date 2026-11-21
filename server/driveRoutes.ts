import express, { type Request, type Response, type Router } from 'express';

const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const DRIVE_ID_REGEX = /^[a-zA-Z0-9_-]{8,128}$/;
const MAX_ANCESTRY_DEPTH = 25;

export class DriveRouteError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'DriveRouteError';
    this.status = status;
    this.code = code;
  }
}

export function isValidDriveId(value: unknown): value is string {
  return typeof value === 'string' && DRIVE_ID_REGEX.test(value.trim());
}

export function escapeDriveQueryLiteral(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function extractDriveAccessToken(req: Request): string {
  // Primary header: X-Google-Drive-Token avoids Google Cloud Run / IAP proxy intercepting Authorization: Bearer
  const customHeader = req.headers['x-google-drive-token'];
  if (typeof customHeader === 'string' && customHeader.trim().length >= 20 && customHeader.trim().length <= 4096) {
    return customHeader.trim();
  }

  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') {
    throw new DriveRouteError(
      401,
      'TOKEN_MISSING',
      'Conexão com o Google Drive não autenticada. Conecte a conta institucional para continuar.'
    );
  }
  const match = header.match(/^Bearer\s+([^\s]+)$/i);
  if (!match || !match[1] || match[1].length < 20 || match[1].length > 4096) {
    throw new DriveRouteError(
      401,
      'TOKEN_INVALID',
      'Credencial do Google Drive ausente ou inválida. Reconecte a conta institucional.'
    );
  }
  return match[1];
}

interface GoogleDriveErrorPayload {
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
}

export async function googleDriveFetchJson<T>(
  accessToken: string,
  url: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: globalThis.Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
    });
  } catch {
    throw new DriveRouteError(
      502,
      'DRIVE_NETWORK_ERROR',
      'Não foi possível comunicar com o Google Drive. Verifique a conexão com a internet e tente novamente.'
    );
  }

  if (response.status === 401) {
    throw new DriveRouteError(
      401,
      'TOKEN_EXPIRED',
      'A sessão do Google Drive expirou. Clique em "Reconectar" com a conta institucional.'
    );
  }

  const rawText = await response.text();
  let parsed: unknown = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const errPayload = parsed as GoogleDriveErrorPayload | null;
    const reason = errPayload?.error?.errors?.[0]?.reason || '';
    const apiMessage = errPayload?.error?.message || '';

    if (
      response.status === 403 &&
      (reason === 'accessNotConfigured' || apiMessage.toLowerCase().includes('drive api has not been used'))
    ) {
      throw new DriveRouteError(
        403,
        'DRIVE_API_DISABLED',
        'A Google Drive API ainda precisa ser ativada no projeto Google Cloud (gen-lang-client-0187607531). Clique no link ao lado para ativá-la em 1 clique.'
      );
    }
    if (response.status === 403 && reason === 'storageQuotaExceeded') {
      throw new DriveRouteError(
        507,
        'STORAGE_QUOTA_EXCEEDED',
        'Armazenamento do Google Drive institucional cheio. Libere espaço na conta antes de enviar novos arquivos.'
      );
    }
    if (response.status === 403 && (reason === 'insufficientFilePermissions' || reason === 'forbidden')) {
      throw new DriveRouteError(
        403,
        'INSUFFICIENT_PERMISSIONS',
        'A conta conectada não possui permissão suficiente nesta pasta do Google Drive.'
      );
    }
    if (response.status === 404) {
      throw new DriveRouteError(
        404,
        'DRIVE_NOT_FOUND',
        'A pasta ou recurso solicitado não foi encontrado na conta do Google Drive conectada.'
      );
    }
    if (response.status === 429) {
      throw new DriveRouteError(
        429,
        'DRIVE_RATE_LIMIT',
        'Limite temporário do Google Drive atingido. Aguarde alguns segundos e tente novamente.'
      );
    }

    throw new DriveRouteError(
      response.status >= 400 && response.status < 600 ? response.status : 502,
      'DRIVE_API_ERROR',
      apiMessage || `Erro HTTP ${response.status} ao comunicar com o Google Drive.`
    );
  }

  return (parsed as T) ?? ({} as T);
}

interface DriveFolderMeta {
  id: string;
  name: string;
  mimeType: string;
  trashed?: boolean;
  parents?: string[];
  webViewLink?: string;
  modifiedTime?: string;
  ownedByMe?: boolean;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
  capabilities?: {
    canAddChildren?: boolean;
    canListChildren?: boolean;
    canRename?: boolean;
    canTrash?: boolean;
    canDelete?: boolean;
  };
}

export async function fetchDriveFolderMetadata(
  accessToken: string,
  folderId: string
): Promise<DriveFolderMeta> {
  if (!isValidDriveId(folderId)) {
    throw new DriveRouteError(400, 'INVALID_FOLDER_ID', 'Identificador de pasta inválido.');
  }

  const fields = encodeURIComponent(
    'id,name,mimeType,trashed,parents,webViewLink,modifiedTime,ownedByMe,owners(displayName,emailAddress),capabilities(canAddChildren,canListChildren,canRename,canTrash,canDelete)'
  );
  const url = `${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(folderId)}?fields=${fields}&supportsAllDrives=false`;
  const meta = await googleDriveFetchJson<DriveFolderMeta>(accessToken, url);

  if (meta.mimeType !== FOLDER_MIME_TYPE) {
    throw new DriveRouteError(
      400,
      'NOT_A_FOLDER',
      'O identificador selecionado não corresponde a uma pasta do Google Drive.'
    );
  }
  if (meta.trashed) {
    throw new DriveRouteError(
      404,
      'FOLDER_TRASHED',
      'A pasta informada está na lixeira do Google Drive.'
    );
  }

  return meta;
}

/**
 * Strictly confines every folder/file operation to the authorized root folder ("fotos 2026")
 * and its descendants by walking the Google Drive parent chain upward on the server.
 */
export async function assertFolderWithinRoot(
  accessToken: string,
  targetFolderId: string,
  rootFolderId: string
): Promise<DriveFolderMeta> {
  if (!isValidDriveId(rootFolderId) || !isValidDriveId(targetFolderId)) {
    throw new DriveRouteError(400, 'INVALID_FOLDER_ID', 'Identificador de pasta inválido.');
  }

  const targetMeta = await fetchDriveFolderMetadata(accessToken, targetFolderId);
  if (targetMeta.id === rootFolderId) {
    return targetMeta;
  }

  const visited = new Set<string>([targetMeta.id]);
  let currentParents = targetMeta.parents || [];

  for (let depth = 0; depth < MAX_ANCESTRY_DEPTH; depth += 1) {
    if (currentParents.length === 0) {
      break;
    }
    if (currentParents.includes(rootFolderId)) {
      return targetMeta;
    }

    const nextParents: string[] = [];
    for (const parentId of currentParents) {
      if (!isValidDriveId(parentId) || visited.has(parentId)) {
        continue;
      }
      visited.add(parentId);
      const parentFields = encodeURIComponent('id,mimeType,trashed,parents');
      const parentUrl = `${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(parentId)}?fields=${parentFields}`;
      let parentMeta: DriveFolderMeta;
      try {
        parentMeta = await googleDriveFetchJson<DriveFolderMeta>(accessToken, parentUrl);
      } catch {
        continue;
      }
      if (parentMeta.trashed) {
        continue;
      }
      if (parentMeta.id === rootFolderId) {
        return targetMeta;
      }
      if (parentMeta.parents?.length) {
        nextParents.push(...parentMeta.parents);
      }
    }

    currentParents = nextParents;
  }

  throw new DriveRouteError(
    403,
    'OUTSIDE_AUTHORIZED_ROOT',
    'Operação bloqueada: o SISCOM só tem permissão para atuar dentro da pasta raiz autorizada.'
  );
}

function sendRouteError(res: Response, error: unknown): void {
  if (error instanceof DriveRouteError) {
    res.status(error.status).json({
      error: error.message,
      code: error.code,
    });
    return;
  }
  res.status(500).json({
    error: 'Erro interno ao processar operação do Arquivo Institucional.',
    code: 'INTERNAL_ERROR',
  });
}

interface DriveAboutResponse {
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

interface DriveFilesListResponse {
  files?: DriveFolderMeta[];
}

export function createDriveRouter(): Router {
  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));

  /**
   * GET /api/drive/account
   * Validates the active Google Drive OAuth token and returns minimal institutional account info
   * + Drive storage quota summary.
   */
  router.get('/account', async (req: Request, res: Response) => {
    try {
      const accessToken = extractDriveAccessToken(req);
      const fields = encodeURIComponent(
        'user(displayName,emailAddress),storageQuota(limit,usage,usageInDrive)'
      );
      const about = await googleDriveFetchJson<DriveAboutResponse>(
        accessToken,
        `${GOOGLE_DRIVE_API_BASE}/about?fields=${fields}`
      );

      const limitBytes = about.storageQuota?.limit ? Number(about.storageQuota.limit) : null;
      const usageBytes = about.storageQuota?.usage ? Number(about.storageQuota.usage) : null;
      const usageInDriveBytes = about.storageQuota?.usageInDrive
        ? Number(about.storageQuota.usageInDrive)
        : null;

      res.json({
        email: about.user?.emailAddress || null,
        displayName: about.user?.displayName || null,
        storageQuota: {
          limitBytes: Number.isFinite(limitBytes) ? limitBytes : null,
          usageBytes: Number.isFinite(usageBytes) ? usageBytes : null,
          usageInDriveBytes: Number.isFinite(usageInDriveBytes) ? usageInDriveBytes : null,
        },
      });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  /**
   * GET /api/drive/root-candidates?q=...
   * Lists non-trashed folders in the connected account (when q is empty, lists top-level folders
   * in Meu Drive so folders like "FOTOS - 2026" appear immediately regardless of hyphens/case).
   * Returns strictly administrative metadata (zero thumbnails, zero media content).
   */
  router.get('/root-candidates', async (req: Request, res: Response) => {
    try {
      const accessToken = extractDriveAccessToken(req);
      const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const sanitizedQuery = rawQuery.slice(0, 80);

      const queryParts = [
        `mimeType = '${FOLDER_MIME_TYPE}'`,
        'trashed = false',
      ];
      if (sanitizedQuery.length > 0) {
        queryParts.push(`name contains '${escapeDriveQueryLiteral(sanitizedQuery)}'`);
      } else {
        queryParts.push(`'root' in parents`);
      }

      const params = new URLSearchParams({
        q: queryParts.join(' and '),
        spaces: 'drive',
        pageSize: '30',
        orderBy: 'folder,name_natural',
        fields:
          'files(id,name,modifiedTime,ownedByMe,owners(displayName,emailAddress),webViewLink,capabilities(canAddChildren,canListChildren))',
      });

      const listRes = await googleDriveFetchJson<DriveFilesListResponse>(
        accessToken,
        `${GOOGLE_DRIVE_API_BASE}/files?${params.toString()}`
      );

      const folders = (listRes.files || []).map((f) => ({
        id: f.id,
        name: f.name,
        modifiedTime: f.modifiedTime || null,
        ownedByMe: Boolean(f.ownedByMe),
        ownerEmail: f.owners?.[0]?.emailAddress || null,
        ownerName: f.owners?.[0]?.displayName || null,
        webViewLink: f.webViewLink || null,
        canAddChildren: Boolean(f.capabilities?.canAddChildren),
        canListChildren: Boolean(f.capabilities?.canListChildren),
      }));

      // Prioritize folders containing "fotos" and "2026" (e.g., "FOTOS - 2026", "fotos 2026") at the top
      folders.sort((a, b) => {
        const aNorm = a.name.trim().toLowerCase();
        const bNorm = b.name.trim().toLowerCase();
        const aScore = aNorm.includes('fotos') && aNorm.includes('2026') ? 0 : aNorm.includes('fotos') ? 1 : 2;
        const bScore = bNorm.includes('fotos') && bNorm.includes('2026') ? 0 : bNorm.includes('fotos') ? 1 : 2;
        if (aScore !== bScore) return aScore - bScore;
        return a.name.localeCompare(b.name, 'pt-BR');
      });

      res.json({ folders });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  /**
   * POST /api/drive/verify-root
   * Verifies that a specific folder ID exists, is a non-trashed folder accessible by the
   * connected institutional account, and returns its canonical metadata.
   */
  router.post('/verify-root', async (req: Request, res: Response) => {
    try {
      const accessToken = extractDriveAccessToken(req);
      const rawFolderId =
        req.body && typeof req.body === 'object' ? (req.body as { folderId?: unknown }).folderId : '';

      if (!isValidDriveId(rawFolderId)) {
        throw new DriveRouteError(
          400,
          'INVALID_FOLDER_ID',
          'Informe um ID de pasta do Google Drive válido.'
        );
      }

      const [folderMeta, about] = await Promise.all([
        fetchDriveFolderMetadata(accessToken, rawFolderId.trim()),
        googleDriveFetchJson<DriveAboutResponse>(
          accessToken,
          `${GOOGLE_DRIVE_API_BASE}/about?fields=${encodeURIComponent('user(displayName,emailAddress)')}`
        ),
      ]);

      res.json({
        folder: {
          id: folderMeta.id,
          name: folderMeta.name,
          modifiedTime: folderMeta.modifiedTime || null,
          ownedByMe: Boolean(folderMeta.ownedByMe),
          ownerEmail: folderMeta.owners?.[0]?.emailAddress || null,
          ownerName: folderMeta.owners?.[0]?.displayName || null,
          webViewLink: folderMeta.webViewLink || null,
          canAddChildren: Boolean(folderMeta.capabilities?.canAddChildren),
          canListChildren: Boolean(folderMeta.capabilities?.canListChildren),
        },
        accountEmail: about.user?.emailAddress || null,
        accountDisplayName: about.user?.displayName || null,
      });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  return router;
}
