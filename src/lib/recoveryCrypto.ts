function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function normalizeSecurityAnswer(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

async function deriveAesKey(normalizedAnswer: string, saltBytes: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(normalizedAnswer),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes.buffer as ArrayBuffer,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptPasswordWithAnswer(
  password: string,
  rawAnswer: string
): Promise<{ salt: string; iv: string; encryptedPassword: string }> {
  const normalized = normalizeSecurityAnswer(rawAnswer);
  if (!normalized) {
    throw new Error('Informe uma resposta válida para a pergunta de segurança.');
  }

  const saltBytes = window.crypto.getRandomValues(new Uint8Array(16));
  const ivBytes = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(normalized, saltBytes);

  const enc = new TextEncoder();
  const cipherBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBytes.buffer as ArrayBuffer },
    key,
    enc.encode(password)
  );

  return {
    salt: bytesToBase64(saltBytes),
    iv: bytesToBase64(ivBytes),
    encryptedPassword: bytesToBase64(new Uint8Array(cipherBuffer)),
  };
}

export async function decryptPasswordWithAnswer(
  payload: { salt: string; iv: string; encryptedPassword: string },
  rawAnswer: string
): Promise<string> {
  const normalized = normalizeSecurityAnswer(rawAnswer);
  if (!normalized) {
    throw new Error('Digite a resposta da pergunta de segurança.');
  }

  try {
    const saltBytes = base64ToBytes(payload.salt);
    const ivBytes = base64ToBytes(payload.iv);
    const cipherBytes = base64ToBytes(payload.encryptedPassword);

    const key = await deriveAesKey(normalized, saltBytes);
    const plainBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes.buffer as ArrayBuffer },
      key,
      cipherBytes.buffer as ArrayBuffer
    );

    const dec = new TextDecoder();
    return dec.decode(plainBuffer);
  } catch {
    throw new Error('Resposta incorreta. Verifique e tente novamente.');
  }
}
