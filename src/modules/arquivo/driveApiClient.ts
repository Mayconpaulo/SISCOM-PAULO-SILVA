import {
  getGoogleDriveAccessToken,
  markGoogleDriveTokenExpired,
} from './googleDriveAuthService';
import type {
  DriveAccountInfo,
  DriveFolderCandidate,
  DriveFolderInspection,
  DriveFolderItem,
  DriveFolderListResult,
} from './arquivoTypes';

const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const GOOGLE_DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const DRIVE_ID_REGEX = /^[a-zA-Z0-9_-]{8,128}$/;
const MAX_ANCESTRY_DEPTH = 25;

// Must be a multiple of 256 KB per Google Drive Resumable Upload specification (4 MB chunks)
const RESUMABLE_CHUNK_SIZE = 4 * 1024 * 1024;
const MAX_CHUNK_RETRIES = 3;

// Tracks whether /api/drive/* Express proxy is unavailable (e.g., static hosting / preview)
let preferDirectDriveApi = false;

// In-memory short-lived ancestry verification cache (folderId -> rootFolderId) to avoid redundant parent lookups during batch uploads
const verifiedAncestryCache = new Map<string, { rootFolderId: string; verifiedAt: number }>();
const ANCESTRY_CACHE_TTL_MS = 5 * 60 * 1000;

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

export function clearDriveAncestryCache(): void {
  verifiedAncestryCache.clear();
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
  parents?: string[];
  modifiedTime?: string;
  createdTime?: string;
  ownedByMe?: boolean;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
  webViewLink?: string;
  capabilities?: {
    canAddChildren?: boolean;
    canListChildren?: boolean;
    canRename?: boolean;
    canTrash?: boolean;
    canDelete?: boolean;
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

function mapRawFolderItem(f: RawDriveFolderMeta): DriveFolderItem {
  return {
    id: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime || null,
    createdTime: f.createdTime || null,
    canRename: Boolean(f.capabilities?.canRename),
    canDelete: Boolean(f.capabilities?.canTrash || f.capabilities?.canDelete),
    canAddChildren: Boolean(f.capabilities?.canAddChildren),
  };
}

/**
 * Strictly validates that targetFolderId is either rootFolderId or a descendant inside rootFolderId
 * by walking the Drive parent chain upward. Blocks any operation outside the authorized root tree.
 */
async function assertFolderWithinRootDirect(
  targetFolderId: string,
  rootFolderId: string,
  allowCache = false
): Promise<RawDriveFolderMeta> {
  if (!isValidDriveId(targetFolderId) || !isValidDriveId(rootFolderId)) {
    throw new DriveApiError(400, 'INVALID_FOLDER_ID', 'Identificador de pasta inválido.');
  }

  if (allowCache) {
    const cached = verifiedAncestryCache.get(targetFolderId);
    if (
      cached &&
      cached.rootFolderId === rootFolderId &&
      Date.now() - cached.verifiedAt < ANCESTRY_CACHE_TTL_MS
    ) {
      return { id: targetFolderId, name: '', mimeType: FOLDER_MIME_TYPE };
    }
  }

  const fields = encodeURIComponent(
    'id,name,mimeType,trashed,parents,modifiedTime,createdTime,capabilities(canRename,canTrash,canDelete,canAddChildren)'
  );
  const targetMeta = await directGoogleDriveFetchJson<RawDriveFolderMeta>(
    `${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(targetFolderId)}?fields=${fields}&supportsAllDrives=false`
  );

  if (targetMeta.mimeType !== FOLDER_MIME_TYPE) {
    throw new DriveApiError(
      400,
      'NOT_A_FOLDER',
      'O identificador selecionado não corresponde a uma pasta do Google Drive.'
    );
  }
  if (targetMeta.trashed) {
    throw new DriveApiError(
      404,
      'FOLDER_TRASHED',
      'A pasta selecionada foi movida para a lixeira do Google Drive.'
    );
  }

  if (targetMeta.id === rootFolderId) {
    verifiedAncestryCache.set(targetFolderId, { rootFolderId, verifiedAt: Date.now() });
    return targetMeta;
  }

  const visited = new Set<string>([targetMeta.id]);
  let currentParents = targetMeta.parents || [];

  for (let depth = 0; depth < MAX_ANCESTRY_DEPTH; depth += 1) {
    if (currentParents.length === 0) break;
    if (currentParents.includes(rootFolderId)) {
      verifiedAncestryCache.set(targetFolderId, { rootFolderId, verifiedAt: Date.now() });
      return targetMeta;
    }

    const nextParents: string[] = [];
    for (const parentId of currentParents) {
      if (!isValidDriveId(parentId) || visited.has(parentId)) continue;
      visited.add(parentId);
      try {
        const parentMeta = await directGoogleDriveFetchJson<RawDriveFolderMeta>(
          `${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(parentId)}?fields=${encodeURIComponent('id,mimeType,trashed,parents')}`
        );
        if (parentMeta.trashed) continue;
        if (parentMeta.id === rootFolderId) {
          verifiedAncestryCache.set(targetFolderId, { rootFolderId, verifiedAt: Date.now() });
          return targetMeta;
        }
        if (parentMeta.parents?.length) {
          nextParents.push(...parentMeta.parents);
        }
      } catch {
        continue;
      }
    }
    currentParents = nextParents;
  }

  throw new DriveApiError(
    403,
    'OUTSIDE_AUTHORIZED_ROOT',
    'Operação bloqueada: o SISCOM só tem permissão para atuar dentro da pasta raiz autorizada.'
  );
}

/* ── Etapa 2: Account & Root Folder Verification ────────────────────────── */

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

/* ── Etapa 3: Confined Folder Management inside Root Folder ─────────────── */

export async function listDriveSubfolders(
  rootFolderId: string,
  parentId: string
): Promise<DriveFolderListResult> {
  const cleanRoot = rootFolderId.trim();
  const cleanParent = (parentId || rootFolderId).trim();
  const qs = new URLSearchParams({
    rootFolderId: cleanRoot,
    parentId: cleanParent,
  }).toString();

  return callBackendWithDirectFallback<DriveFolderListResult>(
    `/folders?${qs}`,
    { method: 'GET' },
    async () => {
      await assertFolderWithinRootDirect(cleanParent, cleanRoot, true);

      const folderParams = new URLSearchParams({
        q: `'${escapeDriveQueryLiteral(cleanParent)}' in parents and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`,
        spaces: 'drive',
        pageSize: '200',
        orderBy: 'name_natural',
        fields:
          'files(id,name,modifiedTime,createdTime,capabilities(canRename,canTrash,canDelete,canAddChildren))',
      });

      const fileCountParams = new URLSearchParams({
        q: `'${escapeDriveQueryLiteral(cleanParent)}' in parents and mimeType != '${FOLDER_MIME_TYPE}' and trashed = false`,
        spaces: 'drive',
        pageSize: '200',
        fields: 'nextPageToken,files(id)',
      });

      const [folderRes, fileCountRes] = await Promise.all([
        directGoogleDriveFetchJson<{ files?: RawDriveFolderMeta[] }>(
          `${GOOGLE_DRIVE_API_BASE}/files?${folderParams.toString()}`
        ),
        directGoogleDriveFetchJson<{ nextPageToken?: string; files?: Array<{ id: string }> }>(
          `${GOOGLE_DRIVE_API_BASE}/files?${fileCountParams.toString()}`
        ),
      ]);

      return {
        parentId: cleanParent,
        folders: (folderRes.files || []).map(mapRawFolderItem),
        directFileCount: (fileCountRes.files || []).length,
        directFileCountTruncated: Boolean(fileCountRes.nextPageToken),
      };
    }
  );
}

export async function createDriveSubfolder(params: {
  rootFolderId: string;
  parentId: string;
  name: string;
}): Promise<DriveFolderItem> {
  const cleanRoot = params.rootFolderId.trim();
  const cleanParent = (params.parentId || params.rootFolderId).trim();
  const cleanName = params.name.trim();

  if (cleanName.length < 1 || cleanName.length > 120) {
    throw new DriveApiError(
      400,
      'INVALID_FOLDER_NAME',
      'Informe um nome de pasta entre 1 e 120 caracteres.'
    );
  }
  if (/[\\/]/.test(cleanName)) {
    throw new DriveApiError(
      400,
      'INVALID_FOLDER_NAME',
      'O nome da pasta não pode conter barras (/ ou \\).'
    );
  }

  const res = await callBackendWithDirectFallback<{ folder: DriveFolderItem }>(
    '/folders',
    {
      method: 'POST',
      body: JSON.stringify({
        rootFolderId: cleanRoot,
        parentId: cleanParent,
        name: cleanName,
      }),
    },
    async () => {
      await assertFolderWithinRootDirect(cleanParent, cleanRoot, true);

      const dupParams = new URLSearchParams({
        q: `'${escapeDriveQueryLiteral(cleanParent)}' in parents and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false and name = '${escapeDriveQueryLiteral(cleanName)}'`,
        spaces: 'drive',
        pageSize: '1',
        fields: 'files(id)',
      });
      const dupCheck = await directGoogleDriveFetchJson<{ files?: Array<{ id: string }> }>(
        `${GOOGLE_DRIVE_API_BASE}/files?${dupParams.toString()}`
      );
      if ((dupCheck.files || []).length > 0) {
        throw new DriveApiError(
          409,
          'FOLDER_ALREADY_EXISTS',
          `Já existe uma pasta chamada "${cleanName}" neste diretório.`
        );
      }

      const fields = encodeURIComponent(
        'id,name,modifiedTime,createdTime,capabilities(canRename,canTrash,canDelete,canAddChildren)'
      );
      const created = await directGoogleDriveFetchJson<RawDriveFolderMeta>(
        `${GOOGLE_DRIVE_API_BASE}/files?fields=${fields}`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: cleanName,
            mimeType: FOLDER_MIME_TYPE,
            parents: [cleanParent],
          }),
        }
      );

      verifiedAncestryCache.set(created.id, { rootFolderId: cleanRoot, verifiedAt: Date.now() });
      return { folder: mapRawFolderItem(created) };
    }
  );

  return res.folder;
}

export async function renameDriveSubfolder(params: {
  rootFolderId: string;
  folderId: string;
  name: string;
}): Promise<DriveFolderItem> {
  const cleanRoot = params.rootFolderId.trim();
  const cleanFolder = params.folderId.trim();
  const cleanName = params.name.trim();

  if (cleanFolder === cleanRoot) {
    throw new DriveApiError(
      403,
      'ROOT_FOLDER_PROTECTED',
      'A pasta raiz autorizada não pode ser renomeada pelo SISCOM.'
    );
  }
  if (cleanName.length < 1 || cleanName.length > 120 || /[\\/]/.test(cleanName)) {
    throw new DriveApiError(
      400,
      'INVALID_FOLDER_NAME',
      'Informe um nome válido (1 a 120 caracteres, sem barras).'
    );
  }

  const res = await callBackendWithDirectFallback<{ folder: DriveFolderItem }>(
    `/folders/${encodeURIComponent(cleanFolder)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        rootFolderId: cleanRoot,
        name: cleanName,
      }),
    },
    async () => {
      await assertFolderWithinRootDirect(cleanFolder, cleanRoot, false);

      const fields = encodeURIComponent(
        'id,name,modifiedTime,createdTime,capabilities(canRename,canTrash,canDelete,canAddChildren)'
      );
      const updated = await directGoogleDriveFetchJson<RawDriveFolderMeta>(
        `${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(cleanFolder)}?fields=${fields}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ name: cleanName }),
        }
      );
      return { folder: mapRawFolderItem(updated) };
    }
  );

  return res.folder;
}

export async function inspectDriveFolderBeforeDelete(
  rootFolderId: string,
  folderId: string
): Promise<DriveFolderInspection> {
  const cleanRoot = rootFolderId.trim();
  const cleanFolder = folderId.trim();

  if (cleanFolder === cleanRoot) {
    throw new DriveApiError(
      403,
      'ROOT_FOLDER_PROTECTED',
      'Operação bloqueada: não é permitido excluir a pasta raiz autorizada.'
    );
  }

  const qs = new URLSearchParams({ rootFolderId: cleanRoot }).toString();
  return callBackendWithDirectFallback<DriveFolderInspection>(
    `/folders/${encodeURIComponent(cleanFolder)}/inspect?${qs}`,
    { method: 'GET' },
    async () => {
      const targetMeta = await assertFolderWithinRootDirect(cleanFolder, cleanRoot, false);

      const queue: string[] = [cleanFolder];
      const visited = new Set<string>([cleanFolder]);
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
        const list = await directGoogleDriveFetchJson<{
          nextPageToken?: string;
          files?: Array<{ id: string; mimeType: string }>;
        }>(`${GOOGLE_DRIVE_API_BASE}/files?${params.toString()}`);

        if (list.nextPageToken) scanTruncated = true;

        for (const item of list.files || []) {
          if (item.mimeType === FOLDER_MIME_TYPE) {
            totalSubfolderCount += 1;
            if (currentId === cleanFolder) directSubfolderCount += 1;
            if (!visited.has(item.id) && visited.size < 25) {
              visited.add(item.id);
              queue.push(item.id);
            } else if (!visited.has(item.id)) {
              scanTruncated = true;
            }
          } else {
            totalFileCount += 1;
            if (currentId === cleanFolder) directFileCount += 1;
          }
        }
      }

      if (queue.length > 0) scanTruncated = true;

      return {
        folderId: targetMeta.id,
        folderName: targetMeta.name,
        directSubfolderCount,
        directFileCount,
        totalSubfolderCount,
        totalFileCount,
        scanTruncated,
        isEmpty: totalSubfolderCount === 0 && totalFileCount === 0,
      };
    }
  );
}

export async function deleteDriveSubfolder(params: {
  rootFolderId: string;
  folderId: string;
  confirmNonEmpty: boolean;
}): Promise<{ deleted: boolean; folderId: string; folderName: string }> {
  const cleanRoot = params.rootFolderId.trim();
  const cleanFolder = params.folderId.trim();

  if (cleanFolder === cleanRoot) {
    throw new DriveApiError(
      403,
      'ROOT_FOLDER_PROTECTED',
      'Operação bloqueada: não é permitido excluir a pasta raiz autorizada.'
    );
  }

  const qs = new URLSearchParams({
    rootFolderId: cleanRoot,
    confirmNonEmpty: params.confirmNonEmpty ? 'true' : 'false',
  }).toString();

  const res = await callBackendWithDirectFallback<{
    deleted: boolean;
    folderId: string;
    folderName: string;
  }>(
    `/folders/${encodeURIComponent(cleanFolder)}?${qs}`,
    { method: 'DELETE' },
    async () => {
      const targetMeta = await assertFolderWithinRootDirect(cleanFolder, cleanRoot, false);

      const childCheckParams = new URLSearchParams({
        q: `'${escapeDriveQueryLiteral(cleanFolder)}' in parents and trashed = false`,
        spaces: 'drive',
        pageSize: '1',
        fields: 'files(id)',
      });
      const childCheck = await directGoogleDriveFetchJson<{ files?: Array<{ id: string }> }>(
        `${GOOGLE_DRIVE_API_BASE}/files?${childCheckParams.toString()}`
      );
      if ((childCheck.files || []).length > 0 && !params.confirmNonEmpty) {
        throw new DriveApiError(
          409,
          'FOLDER_NOT_EMPTY_CONFIRMATION_REQUIRED',
          'Esta pasta contém arquivos ou subpastas e exige confirmação explícita antes de ser excluída.'
        );
      }

      await directGoogleDriveFetchJson(
        `${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(cleanFolder)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ trashed: true }),
        }
      );

      verifiedAncestryCache.delete(cleanFolder);
      return {
        deleted: true,
        folderId: targetMeta.id,
        folderName: targetMeta.name,
      };
    }
  );

  verifiedAncestryCache.delete(cleanFolder);
  return res;
}

/* ── Etapa 4: Duplicate Check & Resumable Chunked File Upload ───────────── */

export async function checkDriveFileDuplicate(params: {
  rootFolderId: string;
  parentId: string;
  fileName: string;
}): Promise<{ exists: boolean; existingId: string | null; existingName: string | null }> {
  const cleanRoot = params.rootFolderId.trim();
  const cleanParent = params.parentId.trim();
  const cleanName = params.fileName.trim();

  return callBackendWithDirectFallback(
    '/files/check-duplicate',
    {
      method: 'POST',
      body: JSON.stringify({
        rootFolderId: cleanRoot,
        parentId: cleanParent,
        fileName: cleanName,
      }),
    },
    async () => {
      await assertFolderWithinRootDirect(cleanParent, cleanRoot, true);

      const queryParams = new URLSearchParams({
        q: `'${escapeDriveQueryLiteral(cleanParent)}' in parents and name = '${escapeDriveQueryLiteral(cleanName)}' and mimeType != '${FOLDER_MIME_TYPE}' and trashed = false`,
        spaces: 'drive',
        pageSize: '1',
        fields: 'files(id,name)',
      });
      const list = await directGoogleDriveFetchJson<{
        files?: Array<{ id: string; name: string }>;
      }>(`${GOOGLE_DRIVE_API_BASE}/files?${queryParams.toString()}`);

      const match = list.files?.[0];
      return {
        exists: Boolean(match),
        existingId: match?.id || null,
        existingName: match?.name || null,
      };
    }
  );
}

interface ChunkUploadResult {
  status: number;
  responseText: string;
  rangeHeader: string | null;
}

function sendChunkViaXhr(params: {
  sessionUri: string;
  chunk: Blob;
  startByte: number;
  endByte: number;
  totalSize: number;
  mimeType: string;
  signal?: AbortSignal;
  onChunkBytesProgress: (loadedInChunk: number) => void;
}): Promise<ChunkUploadResult> {
  return new Promise((resolve, reject) => {
    if (params.signal?.aborted) {
      reject(new DriveApiError(0, 'UPLOAD_CANCELLED', 'Envio cancelado pelo usuário.'));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('PUT', params.sessionUri, true);
    xhr.setRequestHeader('Content-Type', params.mimeType);
    xhr.setRequestHeader(
      'Content-Range',
      `bytes ${params.startByte}-${params.endByte}/${params.totalSize}`
    );

    const onAbort = () => {
      try {
        xhr.abort();
      } catch {
        // Ignore abort cleanup error
      }
      reject(new DriveApiError(0, 'UPLOAD_CANCELLED', 'Envio cancelado pelo usuário.'));
    };

    params.signal?.addEventListener('abort', onAbort, { once: true });

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        params.onChunkBytesProgress(ev.loaded);
      }
    };

    xhr.onload = () => {
      params.signal?.removeEventListener('abort', onAbort);
      resolve({
        status: xhr.status,
        responseText: xhr.responseText || '',
        rangeHeader: xhr.getResponseHeader('Range'),
      });
    };

    xhr.onerror = () => {
      params.signal?.removeEventListener('abort', onAbort);
      reject(
        new DriveApiError(
          0,
          'NETWORK_ERROR',
          'Conexão interrompida durante o envio do arquivo.'
        )
      );
    };

    xhr.ontimeout = () => {
      params.signal?.removeEventListener('abort', onAbort);
      reject(
        new DriveApiError(
          0,
          'UPLOAD_TIMEOUT',
          'Tempo esgotado durante o envio. Tente novamente.'
        )
      );
    };

    xhr.send(params.chunk);
  });
}

function parseResumeOffsetFromRange(rangeHeader: string | null, fallbackNextByte: number): number {
  if (!rangeHeader) return fallbackNextByte;
  const match = rangeHeader.match(/bytes=\d+-(\d+)/i);
  if (!match?.[1]) return fallbackNextByte;
  const parsedEnd = Number(match[1]);
  return Number.isFinite(parsedEnd) ? parsedEnd + 1 : fallbackNextByte;
}

/**
 * Uploads any supported file directly to the institutional Google Drive folder using the
 * Google Drive Resumable Upload protocol (4 MB chunks, real-time progress, retry on transient error,
 * strict ancestry confinement to rootFolderId, and zero arbitrary file size cap).
 */
export async function uploadFileResumableToDrive(params: {
  file: File;
  uploadName: string;
  mimeType: string;
  rootFolderId: string;
  targetFolderId: string;
  signal?: AbortSignal;
  onProgress: (percent: number, bytesUploaded: number) => void;
}): Promise<{ id: string; name: string }> {
  const { file, uploadName, mimeType, rootFolderId, targetFolderId, signal, onProgress } = params;

  if (file.size <= 0) {
    throw new DriveApiError(
      400,
      'EMPTY_FILE',
      'Este arquivo está vazio (0 bytes) e não pode ser enviado.'
    );
  }

  // Strictly confirm destination folder is inside the authorized root tree before uploading
  await assertFolderWithinRootDirect(targetFolderId, rootFolderId, true);

  if (signal?.aborted) {
    throw new DriveApiError(0, 'UPLOAD_CANCELLED', 'Envio cancelado pelo usuário.');
  }

  const token = requireToken();

  // Step 1: Initiate Google Drive Resumable Upload session
  let initRes: Response;
  try {
    initRes = await fetch(
      `${GOOGLE_DRIVE_UPLOAD_BASE}/files?uploadType=resumable&fields=id,name`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(file.size),
        },
        body: JSON.stringify({
          name: uploadName,
          parents: [targetFolderId],
        }),
        signal,
      }
    );
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new DriveApiError(0, 'UPLOAD_CANCELLED', 'Envio cancelado pelo usuário.');
    }
    throw new DriveApiError(
      0,
      'NETWORK_ERROR',
      'Não foi possível iniciar o envio ao Google Drive. Verifique sua conexão.'
    );
  }

  if (initRes.status === 401) {
    markGoogleDriveTokenExpired();
    throw new DriveApiError(
      401,
      'TOKEN_EXPIRED',
      'A sessão do Google Drive expirou. Reconecte a conta institucional e clique em "Tentar novamente".'
    );
  }

  if (!initRes.ok) {
    const errPayload = (await initRes.json().catch(() => null)) as GoogleDriveErrorPayload | null;
    const reason = errPayload?.error?.errors?.[0]?.reason || '';
    if (initRes.status === 403 && reason === 'storageQuotaExceeded') {
      throw new DriveApiError(
        507,
        'STORAGE_QUOTA_EXCEEDED',
        'Armazenamento do Google Drive institucional cheio. Libere espaço e tente novamente.'
      );
    }
    throw new DriveApiError(
      initRes.status,
      'UPLOAD_INIT_FAILED',
      errPayload?.error?.message || `Falha ao iniciar o envio (HTTP ${initRes.status}).`
    );
  }

  const sessionUri = initRes.headers.get('Location');
  if (!sessionUri) {
    throw new DriveApiError(
      502,
      'MISSING_UPLOAD_SESSION',
      'O Google Drive não retornou o endereço de sessão para o envio resumível.'
    );
  }

  // Step 2: Stream file in 4 MB resumable chunks with real-time progress and automatic transient retries
  let offset = 0;
  const totalSize = file.size;

  while (offset < totalSize) {
    const endByte = Math.min(offset + RESUMABLE_CHUNK_SIZE, totalSize) - 1;
    const chunk = file.slice(offset, endByte + 1);

    let chunkResult: ChunkUploadResult | null = null;
    let lastErr: unknown = null;

    for (let attempt = 1; attempt <= MAX_CHUNK_RETRIES; attempt += 1) {
      if (signal?.aborted) {
        throw new DriveApiError(0, 'UPLOAD_CANCELLED', 'Envio cancelado pelo usuário.');
      }

      try {
        chunkResult = await sendChunkViaXhr({
          sessionUri,
          chunk,
          startByte: offset,
          endByte,
          totalSize,
          mimeType,
          signal,
          onChunkBytesProgress: (loadedInChunk) => {
            const uploadedSoFar = Math.min(totalSize, offset + loadedInChunk);
            const pct = Math.min(99, Math.round((uploadedSoFar / totalSize) * 100));
            onProgress(pct, uploadedSoFar);
          },
        });

        // Retry transient 5xx or 429 status codes with exponential backoff
        if (
          chunkResult.status === 429 ||
          (chunkResult.status >= 500 && chunkResult.status < 600)
        ) {
          lastErr = new DriveApiError(
            chunkResult.status,
            'TRANSIENT_UPLOAD_ERROR',
            `Instabilidade temporária no Google Drive (HTTP ${chunkResult.status}).`
          );
          if (attempt < MAX_CHUNK_RETRIES) {
            await new Promise((r) => window.setTimeout(r, 1000 * attempt));
            continue;
          }
        }
        break;
      } catch (err) {
        if (err instanceof DriveApiError && err.code === 'UPLOAD_CANCELLED') {
          throw err;
        }
        lastErr = err;
        if (attempt < MAX_CHUNK_RETRIES) {
          await new Promise((r) => window.setTimeout(r, 1200 * attempt));
          continue;
        }
        throw err;
      }
    }

    if (!chunkResult) {
      throw lastErr instanceof Error
        ? lastErr
        : new DriveApiError(0, 'UPLOAD_FAILED', 'Falha durante o envio do arquivo.');
    }

    if (chunkResult.status === 308) {
      offset = parseResumeOffsetFromRange(chunkResult.rangeHeader, endByte + 1);
      const pct = Math.min(99, Math.round((offset / totalSize) * 100));
      onProgress(pct, offset);
      continue;
    }

    if (chunkResult.status === 200 || chunkResult.status === 201) {
      onProgress(100, totalSize);
      let parsed: { id?: string; name?: string } = {};
      try {
        parsed = JSON.parse(chunkResult.responseText) as { id?: string; name?: string };
      } catch {
        parsed = {};
      }
      return {
        id: parsed.id || '',
        name: parsed.name || uploadName,
      };
    }

    if (chunkResult.status === 401) {
      markGoogleDriveTokenExpired();
      throw new DriveApiError(
        401,
        'TOKEN_EXPIRED',
        'A sessão do Google Drive expirou durante o envio. Reconecte e clique em "Tentar novamente".'
      );
    }

    if (chunkResult.status === 403) {
      let reason = '';
      try {
        const parsedErr = JSON.parse(chunkResult.responseText) as GoogleDriveErrorPayload;
        reason = parsedErr?.error?.errors?.[0]?.reason || '';
      } catch {
        // Ignore parse error
      }
      if (reason === 'storageQuotaExceeded') {
        throw new DriveApiError(
          507,
          'STORAGE_QUOTA_EXCEEDED',
          'Armazenamento do Google Drive institucional cheio.'
        );
      }
    }

    throw new DriveApiError(
      chunkResult.status,
      'UPLOAD_FAILED',
      `Erro ao finalizar envio ao Google Drive (HTTP ${chunkResult.status}).`
    );
  }

  throw new DriveApiError(
    500,
    'UPLOAD_INCOMPLETE',
    'O envio foi interrompido antes da confirmação final do Google Drive.'
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
