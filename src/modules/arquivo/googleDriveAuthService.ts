import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  GoogleAuthProvider,
  User,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';

/**
 * Isolated OAuth 2.0 client app for the Arquivo Institucional module (Google Drive).
 * Runs alongside — never replacing — SISCOM's primary Firebase Auth session
 * (controle-financeiro-a58e5) so military users signed in with @siscom.app remain logged in.
 */
const GOOGLE_DRIVE_OAUTH_CONFIG = {
  projectId: 'gen-lang-client-0187607531',
  appId: '1:209099306810:web:fd4b2916f81a804b560203',
  apiKey: 'AIzaSyBUO0BLFYradXpJJbtH2gwpYM3Gxb0xTzk',
  authDomain: 'gen-lang-client-0187607531.firebaseapp.com',
  storageBucket: 'gen-lang-client-0187607531.firebasestorage.app',
  messagingSenderId: '209099306810',
};

const DRIVE_APP_NAME = 'siscom-google-drive';

export const GOOGLE_DRIVE_OAUTH_PROJECT_ID = GOOGLE_DRIVE_OAUTH_CONFIG.projectId;
export const DEFAULT_INSTITUTIONAL_DRIVE_EMAIL = 'comsoc1bimeces@gmail.com';

// Explicitly authorized scope (Option B) — strictly confined to the authorized root folder ("fotos 2026") on the backend
export const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
] as const;

// Google OAuth access tokens expire in ~60 minutes; proactively mark expired at 55 minutes
const ACCESS_TOKEN_TTL_MS = 55 * 60 * 1000;

export type GoogleDriveConnectionStatus = 'disconnected' | 'connected' | 'expired';

export interface GoogleDriveSession {
  status: GoogleDriveConnectionStatus;
  connected: boolean;
  email: string | null;
  displayName: string | null;
  expiresAt: number | null;
}

let driveApp: FirebaseApp | null = null;
let driveAuth: Auth | null = null;
let isSigningIn = false;

// Strictly in-memory OAuth access token cache (NEVER persisted to localStorage or sessionStorage)
let cachedAccessToken: string | null = null;
let cachedTokenExpiresAt: number | null = null;
let cachedUserEmail: string | null = null;
let cachedUserName: string | null = null;
let wasPreviouslyConnected = false;
let expiryTimerId: number | null = null;

type SessionListener = (session: GoogleDriveSession) => void;
const listeners = new Set<SessionListener>();
let authWatcherInitialized = false;

function clearExpiryTimer(): void {
  if (expiryTimerId !== null && typeof window !== 'undefined') {
    window.clearTimeout(expiryTimerId);
    expiryTimerId = null;
  }
}

function scheduleExpiryCheck(expiresAt: number): void {
  clearExpiryTimer();
  if (typeof window === 'undefined') return;
  const delay = Math.max(1_000, expiresAt - Date.now());
  expiryTimerId = window.setTimeout(() => {
    markGoogleDriveTokenExpired();
  }, delay);
}

function getDriveAuth(): Auth {
  if (!driveApp) {
    const existing = getApps().find((a) => a.name === DRIVE_APP_NAME);
    driveApp = existing ?? initializeApp(GOOGLE_DRIVE_OAUTH_CONFIG, DRIVE_APP_NAME);
  }
  if (!driveAuth) {
    driveAuth = getAuth(driveApp);
  }
  if (!authWatcherInitialized) {
    authWatcherInitialized = true;
    onAuthStateChanged(driveAuth, (user: User | null) => {
      if (!user) {
        clearExpiryTimer();
        cachedAccessToken = null;
        cachedTokenExpiresAt = null;
        cachedUserEmail = null;
        cachedUserName = null;
        wasPreviouslyConnected = false;
        notifyListeners();
      } else if (!cachedAccessToken && !isSigningIn) {
        cachedUserEmail = user.email;
        cachedUserName = user.displayName;
        // User has a remembered Google account on this browser, but in-memory OAuth token is absent/expired
        wasPreviouslyConnected = true;
        notifyListeners();
      }
    });
  }
  return driveAuth;
}

function isTokenStillValid(): boolean {
  if (!cachedAccessToken || !cachedTokenExpiresAt) return false;
  return Date.now() < cachedTokenExpiresAt;
}

function notifyListeners(): void {
  const snapshot = getGoogleDriveSession();
  listeners.forEach((cb) => cb(snapshot));
}

export function getGoogleDriveSession(): GoogleDriveSession {
  const active = isTokenStillValid();
  if (!active && cachedAccessToken) {
    cachedAccessToken = null;
    cachedTokenExpiresAt = null;
    wasPreviouslyConnected = true;
  }

  const status: GoogleDriveConnectionStatus = active
    ? 'connected'
    : wasPreviouslyConnected || Boolean(cachedUserEmail)
      ? 'expired'
      : 'disconnected';

  return {
    status,
    connected: active,
    email: cachedUserEmail,
    displayName: cachedUserName,
    expiresAt: active ? cachedTokenExpiresAt : null,
  };
}

export function subscribeGoogleDriveSession(listener: SessionListener): () => void {
  getDriveAuth();
  listeners.add(listener);
  listener(getGoogleDriveSession());
  return () => {
    listeners.delete(listener);
  };
}

export function getGoogleDriveAccessToken(): string | null {
  if (!isTokenStillValid()) {
    if (cachedAccessToken) {
      markGoogleDriveTokenExpired();
    }
    return null;
  }
  return cachedAccessToken;
}

export function markGoogleDriveTokenExpired(): void {
  clearExpiryTimer();
  cachedAccessToken = null;
  cachedTokenExpiresAt = null;
  wasPreviouslyConnected = true;
  notifyListeners();
}

export class DriveUnauthorizedDomainError extends Error {
  readonly domain: string;
  readonly consoleUrl: string;

  constructor(domain: string) {
    const consoleUrl = `https://console.firebase.google.com/project/${GOOGLE_DRIVE_OAUTH_PROJECT_ID}/authentication/settings`;
    super(
      `O domínio "${domain}" ainda não está autorizado para o login do Google Drive no projeto "${GOOGLE_DRIVE_OAUTH_PROJECT_ID}". Adicione esse domínio em Authentication → Settings → Domínios autorizados.`
    );
    this.name = 'DriveUnauthorizedDomainError';
    this.domain = domain;
    this.consoleUrl = consoleUrl;
  }
}

/**
 * Initiates an interactive OAuth 2.0 popup explicitly prompting account selection
 * (never silently reusing a personal Google AI Studio account).
 */
export async function connectGoogleDriveAccount(
  loginHintEmail: string = DEFAULT_INSTITUTIONAL_DRIVE_EMAIL
): Promise<GoogleDriveSession> {
  const authInstance = getDriveAuth();
  const provider = new GoogleAuthProvider();
  GOOGLE_DRIVE_SCOPES.forEach((scope) => provider.addScope(scope));

  const trimmedHint = loginHintEmail.trim().toLowerCase();
  provider.setCustomParameters({
    prompt: 'select_account',
    ...(trimmedHint ? { login_hint: trimmedHint } : {}),
  });

  try {
    isSigningIn = true;
    const result = await signInWithPopup(authInstance, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error(
        'Não foi possível obter a autorização de acesso ao Google Drive. Tente conectar novamente.'
      );
    }

    const expiresAt = Date.now() + ACCESS_TOKEN_TTL_MS;
    cachedAccessToken = credential.accessToken;
    cachedTokenExpiresAt = expiresAt;
    cachedUserEmail = result.user.email || null;
    cachedUserName = result.user.displayName || null;
    wasPreviouslyConnected = true;
    scheduleExpiryCheck(expiresAt);
    notifyListeners();
    return getGoogleDriveSession();
  } catch (error) {
    const code = (error as { code?: string })?.code || '';
    if (code === 'auth/unauthorized-domain') {
      const currentHost =
        typeof window !== 'undefined' ? window.location.hostname : 'domínio atual';
      throw new DriveUnauthorizedDomainError(currentHost);
    }
    if (code === 'auth/popup-closed-by-user') {
      throw new Error('Janela de autorização do Google fechada antes da conclusão.');
    }
    if (code === 'auth/popup-blocked') {
      throw new Error(
        'O navegador bloqueou o pop-up do Google. Permita pop-ups para este site e tente novamente.'
      );
    }
    throw error instanceof Error
      ? error
      : new Error('Falha ao conectar com a conta institucional do Google Drive.');
  } finally {
    isSigningIn = false;
  }
}

export async function disconnectGoogleDriveSession(): Promise<void> {
  clearExpiryTimer();
  cachedAccessToken = null;
  cachedTokenExpiresAt = null;
  cachedUserEmail = null;
  cachedUserName = null;
  wasPreviouslyConnected = false;
  try {
    if (driveAuth) {
      await signOut(driveAuth);
    }
  } catch {
    // Non-fatal cleanup
  }
  notifyListeners();
}
