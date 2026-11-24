import {
  Timestamp,
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { OperationType, auth, db, handleFirestoreError } from '../auth/firebase';
import type { UserAccount } from '../auth/authService';

export type ActivityModule =
  | 'auth'
  | 'admin'
  | 'prismas'
  | 'crachas'
  | 'alteracao'
  | 'documentos'
  | 'cartoes'
  | 'relatorio'
  | 'agenda'
  | 'arquivo'
  | 'demandas'
  | 'sistema';

export interface ActivityLogRecord {
  id: string;
  actorUid: string;
  actorUsername: string;
  actorDisplayName: string;
  actorRole: 'admin' | 'user';
  module: ActivityModule;
  action: string;
  summary: string;
  detail: string;
  sectionScope: 'siscom';
  createdAt?: Timestamp;
}

export interface LogActivityInput {
  module: ActivityModule;
  action: string;
  summary: string;
  detail?: string;
  actorOverride?: {
    uid: string;
    username: string;
    displayName: string;
    role: 'admin' | 'user';
  };
}

export const ACTIVITY_MODULE_LABELS: Record<ActivityModule, string> = {
  auth: 'Acesso',
  admin: 'Administração',
  prismas: 'Prismas',
  crachas: 'Crachás',
  alteracao: 'Alterações',
  documentos: 'Documentos',
  cartoes: 'Cartões',
  relatorio: 'Relatório',
  agenda: 'Agenda',
  arquivo: 'Arquivo',
  demandas: 'Demandas',
  sistema: 'Sistema',
};

const COLLECTION_NAME = 'activity_logs';
const MAX_TIMESTAMP_MS = 9_999_999_999_999;

interface ActorSnapshot {
  uid: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
}

let activeActor: ActorSnapshot | null = null;
const recentEventTimestamps = new Map<string, number>();

export function setActivityActor(account: UserAccount | null): void {
  if (!account || !account.active) {
    activeActor = null;
    return;
  }
  activeActor = {
    uid: account.uid,
    username: account.username,
    displayName: account.displayName,
    role: account.role === 'admin' ? 'admin' : 'user',
  };
}

function generateReverseChronoLogId(): string {
  const invTs = String(Math.max(0, MAX_TIMESTAMP_MS - Date.now())).padStart(13, '0');
  const rnd = Math.random().toString(36).slice(2, 10);
  return `act_${invTs}_${rnd}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

function sanitizeActionCode(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return cleaned || 'action';
}

function clampNonEmpty(value: string, fallback: string, maxLen: number): string {
  const cleaned = value.replace(/\s+/g, ' ').trim().slice(0, maxLen);
  return cleaned || fallback.slice(0, maxLen);
}

function clampOptional(value: string | undefined, maxLen: number): string {
  if (!value) return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

/**
 * Records an immutable activity entry in `/activity_logs/{logId}` for the signed-in user.
 * Never throws so auditing cannot block user workflows.
 */
export async function logActivity(
  input: LogActivityInput,
  options?: { dedupeKey?: string; cooldownMs?: number }
): Promise<void> {
  const currentUid = auth.currentUser?.uid;
  if (!currentUid) return;

  const actor = input.actorOverride ?? activeActor;
  if (!actor || actor.uid !== currentUid) return;

  if (options?.dedupeKey && options.cooldownMs && options.cooldownMs > 0) {
    const now = Date.now();
    const prev = recentEventTimestamps.get(options.dedupeKey) ?? 0;
    if (now - prev < options.cooldownMs) {
      return;
    }
    recentEventTimestamps.set(options.dedupeKey, now);
    if (recentEventTimestamps.size > 120) {
      for (const [key, ts] of recentEventTimestamps.entries()) {
        if (now - ts > 120_000) recentEventTimestamps.delete(key);
      }
    }
  }

  const id = generateReverseChronoLogId();
  const payload = {
    id,
    actorUid: currentUid,
    actorUsername: clampNonEmpty(actor.username, 'usuario', 60),
    actorDisplayName: clampNonEmpty(actor.displayName, actor.username || 'Usuário', 80),
    actorRole: actor.role === 'admin' ? 'admin' : 'user',
    module: input.module,
    action: sanitizeActionCode(input.action),
    summary: clampNonEmpty(input.summary, 'Ação executada', 240),
    detail: clampOptional(input.detail, 300),
    sectionScope: 'siscom' as const,
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, COLLECTION_NAME, id), payload);
  } catch (err) {
    try {
      handleFirestoreError(err, OperationType.CREATE, `${COLLECTION_NAME}/${id}`);
    } catch {
      // Non-blocking audit log write
    }
  }
}

export function subscribeActivityLogs(
  onData: (logs: ActivityLogRecord[]) => void,
  onError?: (err: Error) => void,
  maxItems = 300
): () => void {
  const q = query(
    collection(db, COLLECTION_NAME),
    where('sectionScope', '==', 'siscom'),
    limit(Math.max(1, Math.min(500, maxItems)))
  );

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as ActivityLogRecord)
        .sort((a, b) => {
          const aMs = a.createdAt?.toMillis?.() ?? 0;
          const bMs = b.createdAt?.toMillis?.() ?? 0;
          if (aMs !== bMs) return bMs - aMs;
          return a.id.localeCompare(b.id);
        });
      onData(list);
    },
    (err) => {
      if (onError) {
        onError(err instanceof Error ? err : new Error(String(err)));
      } else {
        try {
          handleFirestoreError(err, OperationType.LIST, COLLECTION_NAME);
        } catch {
          // Structured error logged via handleFirestoreError
        }
      }
    }
  );
}
