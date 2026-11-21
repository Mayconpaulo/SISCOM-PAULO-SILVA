import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { OperationType, db, handleFirestoreError } from '../../core/auth/firebase';
import type { DriveAuditAction, DriveAuditEntry, DriveRootConfig } from './arquivoTypes';

const DRIVE_CONFIG_COLLECTION = 'drive_config';
const DRIVE_CONFIG_DOC_ID = 'root_folder';
const DRIVE_AUDIT_COLLECTION = 'drive_audit';

const DRIVE_ID_REGEX = /^[a-zA-Z0-9_-]{1,256}$/;

function createAuditDocId(): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `drv_${Date.now().toString(36)}_${randomPart}`;
}

export function subscribeDriveRootConfig(
  onData: (config: DriveRootConfig | null) => void,
  onError?: (err: Error) => void
): () => void {
  const path = `${DRIVE_CONFIG_COLLECTION}/${DRIVE_CONFIG_DOC_ID}`;
  return onSnapshot(
    doc(db, DRIVE_CONFIG_COLLECTION, DRIVE_CONFIG_DOC_ID),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData(snap.data() as DriveRootConfig);
    },
    (err) => {
      if (onError) {
        onError(err);
        return;
      }
      handleFirestoreError(err, OperationType.GET, path);
    }
  );
}

export function subscribeDriveAuditLogs(
  onData: (entries: DriveAuditEntry[]) => void,
  maxItems = 30
): () => void {
  const q = query(
    collection(db, DRIVE_AUDIT_COLLECTION),
    where('sectionScope', '==', 'comsoc'),
    orderBy('createdAt', 'desc'),
    limit(Math.max(1, Math.min(maxItems, 50)))
  );

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as DriveAuditEntry);
      onData(items);
    },
    (err) => {
      // Non-fatal fallback if composite index is still building or user lacks permission
      console.warn('Falha ao carregar histórico de auditoria do Arquivo Institucional:', err);
      onData([]);
    }
  );
}

export async function saveDriveRootConfig(params: {
  rootFolderId: string;
  rootFolderName: string;
  institutionalEmail: string;
  linkedAccountEmail: string;
  driveWebViewUrl?: string | null;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  const cleanFolderId = params.rootFolderId.trim();
  if (!DRIVE_ID_REGEX.test(cleanFolderId)) {
    throw new Error('ID da pasta raiz inválido.');
  }

  const cleanFolderName = params.rootFolderName.trim().slice(0, 140) || 'fotos 2026';
  const cleanInstitutionalEmail = params.institutionalEmail.trim().toLowerCase().slice(0, 140);
  const cleanLinkedEmail = params.linkedAccountEmail.trim().toLowerCase().slice(0, 140);
  const cleanUrl = (params.driveWebViewUrl || '').trim().slice(0, 400);
  const cleanActorName = params.actorName.trim().slice(0, 80) || 'Administrador';

  const path = `${DRIVE_CONFIG_COLLECTION}/${DRIVE_CONFIG_DOC_ID}`;
  try {
    await setDoc(doc(db, DRIVE_CONFIG_COLLECTION, DRIVE_CONFIG_DOC_ID), {
      id: DRIVE_CONFIG_DOC_ID,
      rootFolderId: cleanFolderId,
      rootFolderName: cleanFolderName,
      institutionalEmail: cleanInstitutionalEmail,
      linkedAccountEmail: cleanLinkedEmail,
      driveWebViewUrl: cleanUrl,
      sectionScope: 'comsoc',
      updatedByUid: params.actorUid,
      updatedByName: cleanActorName,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function clearDriveRootConfig(): Promise<void> {
  const path = `${DRIVE_CONFIG_COLLECTION}/${DRIVE_CONFIG_DOC_ID}`;
  try {
    await deleteDoc(doc(db, DRIVE_CONFIG_COLLECTION, DRIVE_CONFIG_DOC_ID));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function logDriveAuditEvent(params: {
  action: DriveAuditAction;
  targetId?: string;
  targetName?: string;
  summary: string;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  const id = createAuditDocId();
  const path = `${DRIVE_AUDIT_COLLECTION}/${id}`;
  const cleanSummary = params.summary.trim().slice(0, 240) || 'Operação registrada no Arquivo Institucional';
  const cleanActorName = params.actorName.trim().slice(0, 80) || 'Usuário';

  try {
    await setDoc(doc(db, DRIVE_AUDIT_COLLECTION, id), {
      id,
      action: params.action,
      targetId: (params.targetId || '').trim().slice(0, 256),
      targetName: (params.targetName || '').trim().slice(0, 240),
      summary: cleanSummary,
      actorUid: params.actorUid,
      actorName: cleanActorName,
      sectionScope: 'comsoc',
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    // Audit write failures should surface cleanly for debugging without crashing user actions
    console.warn(`Não foi possível gravar auditoria (${path}):`, err);
  }
}
