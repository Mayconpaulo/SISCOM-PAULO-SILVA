import {
  getGoogleDriveAccessToken,
  markGoogleDriveTokenExpired,
} from './googleDriveAuthService';
import type { DriveAccountInfo, DriveFolderCandidate } from './arquivoTypes';

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

async function driveApiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getGoogleDriveAccessToken();
  if (!token) {
    throw new DriveApiError(
      401,
      'TOKEN_EXPIRED',
      'Conexão com o Google Drive inativa ou expirada. Conecte a conta institucional para continuar.'
    );
  }

  const headers = new Headers(init.headers);
  // Use custom header so Google Cloud Run / AI Studio edge proxy does not intercept Authorization: Bearer
  headers.set('X-Google-Drive-Token', token);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(`/api/drive${path}`, {
      ...init,
      headers,
    });
  } catch {
    throw new DriveApiError(
      0,
      'NETWORK_ERROR',
      'Falha de conexão com o servidor do SISCOM. Verifique sua internet e tente novamente.'
    );
  }

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? ((await res.json().catch(() => ({}))) as { error?: string; code?: string })
    : {};

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

export async function fetchDriveAccountInfo(): Promise<DriveAccountInfo> {
  return driveApiRequest<DriveAccountInfo>('/account');
}

export async function searchDriveRootCandidates(queryText = ''): Promise<DriveFolderCandidate[]> {
  const params = new URLSearchParams();
  if (queryText.trim()) {
    params.set('q', queryText.trim());
  }
  const qs = params.toString();
  const res = await driveApiRequest<{ folders: DriveFolderCandidate[] }>(
    `/root-candidates${qs ? `?${qs}` : ''}`
  );
  return res.folders || [];
}

export async function verifyDriveRootFolder(folderId: string): Promise<{
  folder: DriveFolderCandidate;
  accountEmail: string | null;
  accountDisplayName: string | null;
}> {
  return driveApiRequest('/verify-root', {
    method: 'POST',
    body: JSON.stringify({ folderId: folderId.trim() }),
  });
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
