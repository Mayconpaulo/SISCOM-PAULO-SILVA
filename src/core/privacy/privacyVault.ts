const VAULT_KEY_PREFIX = 'siscom_vault_v1:';
const SESSION_KEY_PREFIX = 'siscom_session_vk_v1:';

export const SENSITIVE_STORAGE_KEYS = [
  'siscom_alteracao_state_v2',
  'siscom_cracha_state_v2',
  'siscom_documentos_vault_v1',
  'siscom_prisma_state_v1',
  'siscom_cartoes_state_v1',
  'siscom_aniversario_state_v1',
  'siscom_pesames_state_v1',
  'siscom_relatorio_state_v1',
] as const;

let activeUid: string | null = null;
let activeCryptoKey: CryptoKey | null = null;
const memoryCache = new Map<string, string>();
let writeChain: Promise<void> = Promise.resolve();

function hasWebCrypto(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.crypto?.subtle) &&
    Boolean(window.crypto?.getRandomValues)
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function vaultStorageKey(uid: string, logicalKey: string): string {
  return `${VAULT_KEY_PREFIX}${uid}:${logicalKey}`;
}

function sessionKeyStorageName(uid: string): string {
  return `${SESSION_KEY_PREFIX}${uid}`;
}

async function getOrCreateSessionKey(uid: string): Promise<CryptoKey | null> {
  if (!hasWebCrypto() || typeof sessionStorage === 'undefined') return null;

  const ssName = sessionKeyStorageName(uid);
  let rawKeyB64: string | null = null;
  try {
    rawKeyB64 = sessionStorage.getItem(ssName);
  } catch {
    rawKeyB64 = null;
  }

  let keyBytes: Uint8Array | null = null;
  if (rawKeyB64) {
    try {
      const decoded = base64ToBytes(rawKeyB64);
      if (decoded.byteLength === 32) {
        keyBytes = decoded;
      }
    } catch {
      keyBytes = null;
    }
  }

  if (!keyBytes) {
    keyBytes = window.crypto.getRandomValues(new Uint8Array(32));
    try {
      sessionStorage.setItem(ssName, bytesToBase64(keyBytes));
    } catch {
      // Continue with in-memory key only
    }
  }

  return window.crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptVaultPayload(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    encoded
  );
  return `v1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(cipherBuffer))}`;
}

export async function decryptVaultPayload(key: CryptoKey, blob: string): Promise<string | null> {
  if (!blob.startsWith('v1:')) return null;
  const parts = blob.split(':');
  if (parts.length !== 3) return null;
  try {
    const iv = base64ToBytes(parts[1]);
    const cipher = base64ToBytes(parts[2]);
    const plainBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      key,
      cipher.buffer as ArrayBuffer
    );
    return new TextDecoder().decode(plainBuffer);
  } catch {
    return null;
  }
}

/**
 * Hydrates and unlocks the encrypted local vault for the authenticated user.
 * Any legacy unencrypted plaintext keys are immediately encrypted under the session AES-256-GCM key
 * and scrubbed from plaintext localStorage.
 */
export async function hydratePrivacyVaultForUser(uid: string): Promise<void> {
  if (!uid) return;
  if (activeUid === uid && activeCryptoKey) return;

  memoryCache.clear();
  activeUid = uid;
  activeCryptoKey = await getOrCreateSessionKey(uid);

  if (typeof localStorage === 'undefined') return;

  for (const key of SENSITIVE_STORAGE_KEYS) {
    const encKey = vaultStorageKey(uid, key);
    let loadedPlaintext: string | null = null;

    if (activeCryptoKey) {
      try {
        const storedEnc = localStorage.getItem(encKey);
        if (storedEnc) {
          loadedPlaintext = await decryptVaultPayload(activeCryptoKey, storedEnc);
          if (loadedPlaintext === null) {
            localStorage.removeItem(encKey);
          }
        }
      } catch {
        // Ignore storage read failure
      }
    }

    // One-time secure migration from any legacy plaintext localStorage key, then immediately wipe plaintext
    try {
      const legacyPlain = localStorage.getItem(key);
      if (legacyPlain) {
        if (!loadedPlaintext) {
          loadedPlaintext = legacyPlain;
          if (activeCryptoKey) {
            const encrypted = await encryptVaultPayload(activeCryptoKey, legacyPlain);
            localStorage.setItem(encKey, encrypted);
          }
        }
        localStorage.removeItem(key);
      }
    } catch {
      // Ignore migration errors
    }

    if (loadedPlaintext !== null) {
      memoryCache.set(key, loadedPlaintext);
    }
  }
}

export function getSecureVaultItem(key: string): string | null {
  return memoryCache.get(key) ?? null;
}

export function setSecureVaultItem(key: string, plaintextJson: string): void {
  memoryCache.set(key, plaintextJson);

  const uidAtWrite = activeUid;
  const keyAtWrite = activeCryptoKey;
  if (!uidAtWrite || !keyAtWrite || typeof localStorage === 'undefined') {
    return;
  }

  writeChain = writeChain
    .then(async () => {
      if (activeUid !== uidAtWrite || activeCryptoKey !== keyAtWrite) return;
      const encrypted = await encryptVaultPayload(keyAtWrite, plaintextJson);
      localStorage.setItem(vaultStorageKey(uidAtWrite, key), encrypted);
    })
    .catch(() => {
      // Ignore quota or transient storage errors
    });
}

export function removeSecureVaultItem(key: string): void {
  memoryCache.delete(key);
  if (typeof localStorage === 'undefined') return;
  try {
    if (activeUid) {
      localStorage.removeItem(vaultStorageKey(activeUid, key));
    }
    localStorage.removeItem(key);
  } catch {
    // Ignore
  }
}

/**
 * Scrubs all encrypted and legacy local document caches and session keys from browser storage.
 */
export function purgeAllSensitiveLocalData(): void {
  memoryCache.clear();
  activeUid = null;
  activeCryptoKey = null;

  if (typeof localStorage !== 'undefined') {
    try {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (
          k.startsWith(VAULT_KEY_PREFIX) ||
          (SENSITIVE_STORAGE_KEYS as readonly string[]).includes(k) ||
          k.startsWith('siscom_')
        ) {
          toRemove.push(k);
        }
      }
      for (const k of toRemove) {
        localStorage.removeItem(k);
      }
    } catch {
      // Ignore
    }
  }

  if (typeof sessionStorage !== 'undefined') {
    try {
      const toRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (!k) continue;
        if (k.startsWith(SESSION_KEY_PREFIX) || k.startsWith('siscom_')) {
          toRemove.push(k);
        }
      }
      for (const k of toRemove) {
        sessionStorage.removeItem(k);
      }
    } catch {
      // Ignore
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('siscom:vault-purged'));
  }
}
