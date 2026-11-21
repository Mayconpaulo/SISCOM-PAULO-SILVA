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

  /**
   * GET /api/drive/folders?rootFolderId=...&parentId=...
   * Lists subfolders strictly inside parentId (which must be rootFolderId or a descendant)
   * and returns the numeric count of direct files (ZERO thumbnails/media previews).
   */
  router.get('/folders', async (req: Request, res: Response) => {
    try {
      const accessToken = extractDriveAccessToken(req);
      const rootFolderId = typeof req.query.rootFolderId === 'string' ? req.query.rootFolderId.trim() : '';
      const parentId = typeof req.query.parentId === 'string' && req.query.parentId.trim()
        ? req.query.parentId.trim()
        : rootFolderId;

      await assertFolderWithinRoot(accessToken, parentId, rootFolderId);

      const folderParams = new URLSearchParams({
        q: `'${escapeDriveQueryLiteral(parentId)}' in parents and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`,
        spaces: 'drive',
        pageSize: '200',
        orderBy: 'name_natural',
        fields:
          'files(id,name,modifiedTime,createdTime,capabilities(canRename,canTrash,canDelete,canAddChildren))',
      });

      const fileCountParams = new URLSearchParams({
        q: `'${escapeDriveQueryLiteral(parentId)}' in parents and mimeType != '${FOLDER_MIME_TYPE}' and trashed = false`,
        spaces: 'drive',
        pageSize: '200',
        fields: 'nextPageToken,files(id)',
      });

      const [folderRes, fileCountRes] = await Promise.all([
        googleDriveFetchJson<{ files?: Array<DriveFolderMeta & { createdTime?: string }> }>(
          accessToken,
          `${GOOGLE_DRIVE_API_BASE}/files?${folderParams.toString()}`
        ),
        googleDriveFetchJson<{ nextPageToken?: string; files?: Array<{ id: string }> }>(
          accessToken,
          `${GOOGLE_DRIVE_API_BASE}/files?${fileCountParams.toString()}`
        ),
      ]);

      const folders = (folderRes.files || []).map((f) => ({
        id: f.id,
        name: f.name,
        modifiedTime: f.modifiedTime || null,
        createdTime: f.createdTime || null,
        canRename: Boolean(f.capabilities?.canRename),
        canDelete: Boolean(f.capabilities?.canTrash || f.capabilities?.canDelete),
        canAddChildren: Boolean(f.capabilities?.canAddChildren),
      }));

      res.json({
        parentId,
        folders,
        directFileCount: (fileCountRes.files || []).length,
        directFileCountTruncated: Boolean(fileCountRes.nextPageToken),
      });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  /**
   * POST /api/drive/folders
   * Creates a new subfolder strictly inside parentId (validated within rootFolderId).
   */
  router.post('/folders', async (req: Request, res: Response) => {
    try {
      const accessToken = extractDriveAccessToken(req);
      const body = (req.body || {}) as {
        rootFolderId?: unknown;
        parentId?: unknown;
        name?: unknown;
      };
      const rootFolderId = typeof body.rootFolderId === 'string' ? body.rootFolderId.trim() : '';
      const parentId =
        typeof body.parentId === 'string' && body.parentId.trim()
          ? body.parentId.trim()
          : rootFolderId;
      const rawName = typeof body.name === 'string' ? body.name.trim() : '';

      if (rawName.length < 1 || rawName.length > 120) {
        throw new DriveRouteError(
          400,
          'INVALID_FOLDER_NAME',
          'Informe um nome de pasta entre 1 e 120 caracteres.'
        );
      }
      if (/[\\/]/.test(rawName)) {
        throw new DriveRouteError(
          400,
          'INVALID_FOLDER_NAME',
          'O nome da pasta não pode conter barras (/ ou \\).'
        );
      }

      await assertFolderWithinRoot(accessToken, parentId, rootFolderId);

      // Avoid accidental duplicate folder name in the same parent
      const dupParams = new URLSearchParams({
        q: `'${escapeDriveQueryLiteral(parentId)}' in parents and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false and name = '${escapeDriveQueryLiteral(rawName)}'`,
        spaces: 'drive',
        pageSize: '1',
        fields: 'files(id,name)',
      });
      const dupCheck = await googleDriveFetchJson<{ files?: Array<{ id: string }> }>(
        accessToken,
        `${GOOGLE_DRIVE_API_BASE}/files?${dupParams.toString()}`
      );
      if ((dupCheck.files || []).length > 0) {
        throw new DriveRouteError(
          409,
          'FOLDER_ALREADY_EXISTS',
          `Já existe uma pasta chamada "${rawName}" neste diretório.`
        );
      }

      const fields = encodeURIComponent(
        'id,name,modifiedTime,createdTime,capabilities(canRename,canTrash,canDelete,canAddChildren)'
      );
      const created = await googleDriveFetchJson<DriveFolderMeta & { createdTime?: string }>(
        accessToken,
        `${GOOGLE_DRIVE_API_BASE}/files?fields=${fields}`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: rawName,
            mimeType: FOLDER_MIME_TYPE,
            parents: [parentId],
          }),
        }
      );

      res.status(201).json({
        folder: {
          id: created.id,
          name: created.name,
          modifiedTime: created.modifiedTime || null,
          createdTime: created.createdTime || null,
          canRename: Boolean(created.capabilities?.canRename),
          canDelete: Boolean(created.capabilities?.canTrash || created.capabilities?.canDelete),
          canAddChildren: Boolean(created.capabilities?.canAddChildren),
        },
      });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  /**
   * PATCH /api/drive/folders/:folderId
   * Renames a subfolder strictly inside rootFolderId (forbids renaming the root folder itself).
   */
  router.patch('/folders/:folderId', async (req: Request, res: Response) => {
    try {
      const accessToken = extractDriveAccessToken(req);
      const folderId = req.params.folderId?.trim() || '';
      const body = (req.body || {}) as { rootFolderId?: unknown; name?: unknown };
      const rootFolderId = typeof body.rootFolderId === 'string' ? body.rootFolderId.trim() : '';
      const rawName = typeof body.name === 'string' ? body.name.trim() : '';

      if (!isValidDriveId(folderId) || !isValidDriveId(rootFolderId)) {
        throw new DriveRouteError(400, 'INVALID_FOLDER_ID', 'Identificador de pasta inválido.');
      }
      if (folderId === rootFolderId) {
        throw new DriveRouteError(
          403,
          'ROOT_FOLDER_PROTECTED',
          'A pasta raiz autorizada não pode ser renomeada pelo SISCOM.'
        );
      }
      if (rawName.length < 1 || rawName.length > 120 || /[\\/]/.test(rawName)) {
        throw new DriveRouteError(
          400,
          'INVALID_FOLDER_NAME',
          'Informe um nome válido (1 a 120 caracteres, sem barras).'
        );
      }

      await assertFolderWithinRoot(accessToken, folderId, rootFolderId);

      const fields = encodeURIComponent(
        'id,name,modifiedTime,createdTime,capabilities(canRename,canTrash,canDelete,canAddChildren)'
      );
      const updated = await googleDriveFetchJson<DriveFolderMeta & { createdTime?: string }>(
        accessToken,
        `${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(folderId)}?fields=${fields}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ name: rawName }),
        }
      );

      res.json({
        folder: {
          id: updated.id,
          name: updated.name,
          modifiedTime: updated.modifiedTime || null,
          createdTime: updated.createdTime || null,
          canRename: Boolean(updated.capabilities?.canRename),
          canDelete: Boolean(updated.capabilities?.canTrash || updated.capabilities?.canDelete),
          canAddChildren: Boolean(updated.capabilities?.canAddChildren),
        },
      });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  /**
   * GET /api/drive/folders/:folderId/inspect?rootFolderId=...
   * Inspects child subfolders and files before deletion so the UI can warn the user clearly.
   */
  router.get('/folders/:folderId/inspect', async (req: Request, res: Response) => {
    try {
      const accessToken = extractDriveAccessToken(req);
      const folderId = req.params.folderId?.trim() || '';
      const rootFolderId = typeof req.query.rootFolderId === 'string' ? req.query.rootFolderId.trim() : '';

      if (!isValidDriveId(folderId) || !isValidDriveId(rootFolderId)) {
        throw new DriveRouteError(400, 'INVALID_FOLDER_ID', 'Identificador de pasta inválido.');
      }
      if (folderId === rootFolderId) {
        throw new DriveRouteError(
          403,
          'ROOT_FOLDER_PROTECTED',
          'A pasta raiz autorizada não pode ser excluída.'
        );
      }

      const targetMeta = await assertFolderWithinRoot(accessToken, folderId, rootFolderId);

      // BFS scan up to 25 folders to report accurate impact without unbounded API calls
      const queue: string[] = [folderId];
      const visited = new Set<string>([folderId]);
      let directSubfolderCount = 0;
      let directFileCount = 0;
      let totalSubfolderCount = 0;
      let totalFileCount = 0;
      let scanTruncated = false;

      while (queue.length > 0 && visited.size <= 25) {
        const currentId = queue.shift() as string;
        const params = new URLSearchParams({
          q: `'${escapeDriveQueryLiteral(currentId)}' in parents and trashed = false`,
          spaces: 'drive',
          pageSize: '200',
          fields: 'nextPageToken,files(id,mimeType)',
        });
        const list = await googleDriveFetchJson<{
          nextPageToken?: string;
          files?: Array<{ id: string; mimeType: string }>;
        }>(accessToken, `${GOOGLE_DRIVE_API_BASE}/files?${params.toString()}`);

        if (list.nextPageToken) {
          scanTruncated = true;
        }

        for (const item of list.files || []) {
          if (item.mimeType === FOLDER_MIME_TYPE) {
            totalSubfolderCount += 1;
            if (currentId === folderId) directSubfolderCount += 1;
            if (!visited.has(item.id) && visited.size < 25) {
              visited.add(item.id);
              queue.push(item.id);
            } else if (!visited.has(item.id)) {
              scanTruncated = true;
            }
          } else {
            totalFileCount += 1;
            if (currentId === folderId) directFileCount += 1;
          }
        }
      }

      if (queue.length > 0) {
        scanTruncated = true;
      }

      res.json({
        folderId: targetMeta.id,
        folderName: targetMeta.name,
        directSubfolderCount,
        directFileCount,
        totalSubfolderCount,
        totalFileCount,
        scanTruncated,
        isEmpty: totalSubfolderCount === 0 && totalFileCount === 0,
      });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  /**
   * DELETE /api/drive/folders/:folderId?rootFolderId=...&confirmNonEmpty=true|false
   * Moves a subfolder to Google Drive Trash ONLY after verifying ancestry within rootFolderId,
   * strictly forbidding deletion of rootFolderId, and requiring explicit confirmNonEmpty=true if not empty.
   */
  router.delete('/folders/:folderId', async (req: Request, res: Response) => {
    try {
      const accessToken = extractDriveAccessToken(req);
      const folderId = req.params.folderId?.trim() || '';
      const rootFolderId = typeof req.query.rootFolderId === 'string' ? req.query.rootFolderId.trim() : '';
      const confirmNonEmpty = req.query.confirmNonEmpty === 'true';

      if (!isValidDriveId(folderId) || !isValidDriveId(rootFolderId)) {
        throw new DriveRouteError(400, 'INVALID_FOLDER_ID', 'Identificador de pasta inválido.');
      }
      if (folderId === rootFolderId) {
        throw new DriveRouteError(
          403,
          'ROOT_FOLDER_PROTECTED',
          'Operação bloqueada: não é permitido excluir a pasta raiz autorizada.'
        );
      }

      const targetMeta = await assertFolderWithinRoot(accessToken, folderId, rootFolderId);

      // Guard against accidental recursive deletion without explicit confirmation
      const childCheckParams = new URLSearchParams({
        q: `'${escapeDriveQueryLiteral(folderId)}' in parents and trashed = false`,
        spaces: 'drive',
        pageSize: '1',
        fields: 'files(id)',
      });
      const childCheck = await googleDriveFetchJson<{ files?: Array<{ id: string }> }>(
        accessToken,
        `${GOOGLE_DRIVE_API_BASE}/files?${childCheckParams.toString()}`
      );
      if ((childCheck.files || []).length > 0 && !confirmNonEmpty) {
        throw new DriveRouteError(
          409,
          'FOLDER_NOT_EMPTY_CONFIRMATION_REQUIRED',
          'Esta pasta contém arquivos ou subpastas e exige confirmação explícita antes de ser excluída.'
        );
      }

      // Move to Google Drive Trash (safer than irreversible permanent purge)
      await googleDriveFetchJson(
        accessToken,
        `${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(folderId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ trashed: true }),
        }
      );

      res.json({
        deleted: true,
        folderId: targetMeta.id,
        folderName: targetMeta.name,
      });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  /**
   * POST /api/drive/files/check-duplicate
   * Checks whether a non-trashed file with the same name already exists inside targetFolderId
   * (after verifying targetFolderId is strictly within rootFolderId).
   */
  router.post('/files/check-duplicate', async (req: Request, res: Response) => {
    try {
      const accessToken = extractDriveAccessToken(req);
      const body = (req.body || {}) as {
        rootFolderId?: unknown;
        parentId?: unknown;
        fileName?: unknown;
      };
      const rootFolderId = typeof body.rootFolderId === 'string' ? body.rootFolderId.trim() : '';
      const parentId = typeof body.parentId === 'string' ? body.parentId.trim() : '';
      const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';

      if (!fileName || fileName.length > 240) {
        throw new DriveRouteError(400, 'INVALID_FILE_NAME', 'Nome de arquivo inválido.');
      }

      await assertFolderWithinRoot(accessToken, parentId, rootFolderId);

      const params = new URLSearchParams({
        q: `'${escapeDriveQueryLiteral(parentId)}' in parents and name = '${escapeDriveQueryLiteral(fileName)}' and mimeType != '${FOLDER_MIME_TYPE}' and trashed = false`,
        spaces: 'drive',
        pageSize: '1',
        fields: 'files(id,name,size)',
      });
      const result = await googleDriveFetchJson<{
        files?: Array<{ id: string; name: string; size?: string }>;
      }>(accessToken, `${GOOGLE_DRIVE_API_BASE}/files?${params.toString()}`);

      const existing = result.files?.[0];
      res.json({
        exists: Boolean(existing),
        existingId: existing?.id || null,
        existingName: existing?.name || null,
      });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  return router;
}
