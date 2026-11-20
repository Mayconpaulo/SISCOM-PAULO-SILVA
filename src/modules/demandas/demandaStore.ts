import {
  Unsubscribe,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { OperationType, db, handleFirestoreError } from '../../core/auth/firebase';
import {
  CreateDemandaInput,
  DemandaItem,
  DemandaPriority,
  UpdateDemandaPatch,
  addDaysToDateKey,
  formatDateKeyLocal,
  getCalendarDaysUntil,
  parseDueDateParts,
  sortDemandasForDisplay,
} from './demandaTypes';

function clampString(value: string | undefined | null, maxLen: number): string {
  if (!value) return '';
  return value.trim().slice(0, maxLen);
}

function sanitizeDueDate(value: string): string {
  const clean = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return clean;
  }
  return formatDateKeyLocal(new Date());
}

function sanitizeDueTime(value: string | undefined): string {
  if (!value) return '';
  const clean = value.trim();
  if (/^\d{2}:\d{2}$/.test(clean)) {
    return clean;
  }
  return '';
}

function sanitizePriority(value: DemandaPriority | undefined): DemandaPriority {
  if (value === 'baixa' || value === 'media' || value === 'alta') {
    return value;
  }
  return 'media';
}

function sanitizeRemindDays(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 3;
  return Math.max(0, Math.min(30, Math.round(value)));
}

function generateDemandaId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `dem_${Date.now()}_${rand}`;
}

export function subscribeUserDemandas(
  userId: string,
  onData: (items: DemandaItem[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const colRef = collection(db, 'users', userId, 'demandas');
  const q = query(colRef, where('ownerUid', '==', userId));

  return onSnapshot(
    q,
    (snap) => {
      const list: DemandaItem[] = snap.docs.map((d) => {
        const raw = d.data() as Partial<DemandaItem>;
        return {
          id: raw.id || d.id,
          ownerUid: raw.ownerUid || userId,
          title: raw.title || '',
          notes: raw.notes || '',
          dueDate: raw.dueDate || formatDateKeyLocal(new Date()),
          dueTime: raw.dueTime || '',
          priority: sanitizePriority(raw.priority),
          status: raw.status === 'concluida' ? 'concluida' : 'pendente',
          remindBeforeDays:
            typeof raw.remindBeforeDays === 'number' ? raw.remindBeforeDays : 3,
          completedAt: raw.completedAt || '',
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt,
        };
      });
      onData(sortDemandasForDisplay(list));
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, `users/${userId}/demandas`);
      } catch (wrapped) {
        if (onError) onError(wrapped as Error);
      }
    }
  );
}

export async function createDemanda(
  userId: string,
  input: CreateDemandaInput
): Promise<string> {
  const title = clampString(input.title, 160);
  if (!title) {
    throw new Error('Informe o que precisa ser feito.');
  }

  const id = generateDemandaId();
  const payload = {
    id,
    ownerUid: userId,
    title,
    notes: clampString(input.notes, 1000),
    dueDate: sanitizeDueDate(input.dueDate),
    dueTime: sanitizeDueTime(input.dueTime),
    priority: sanitizePriority(input.priority),
    status: 'pendente' as const,
    remindBeforeDays: sanitizeRemindDays(input.remindBeforeDays),
    completedAt: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'users', userId, 'demandas', id), payload);
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `users/${userId}/demandas/${id}`);
  }
}

export async function updateDemanda(
  userId: string,
  demandaId: string,
  patch: UpdateDemandaPatch
): Promise<void> {
  const updateData: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (patch.title !== undefined) {
    const cleanTitle = clampString(patch.title, 160);
    if (!cleanTitle) {
      throw new Error('O título da demanda não pode ficar vazio.');
    }
    updateData.title = cleanTitle;
  }
  if (patch.notes !== undefined) {
    updateData.notes = clampString(patch.notes, 1000);
  }
  if (patch.dueDate !== undefined) {
    updateData.dueDate = sanitizeDueDate(patch.dueDate);
  }
  if (patch.dueTime !== undefined) {
    updateData.dueTime = sanitizeDueTime(patch.dueTime);
  }
  if (patch.priority !== undefined) {
    updateData.priority = sanitizePriority(patch.priority);
  }
  if (patch.status !== undefined) {
    updateData.status = patch.status === 'concluida' ? 'concluida' : 'pendente';
  }
  if (patch.remindBeforeDays !== undefined) {
    updateData.remindBeforeDays = sanitizeRemindDays(patch.remindBeforeDays);
  }
  if (patch.completedAt !== undefined) {
    updateData.completedAt = clampString(patch.completedAt, 40);
  }

  try {
    await updateDoc(doc(db, 'users', userId, 'demandas', demandaId), updateData);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${userId}/demandas/${demandaId}`);
  }
}

export async function toggleDemandaStatus(
  userId: string,
  item: DemandaItem
): Promise<void> {
  const nextStatus = item.status === 'concluida' ? 'pendente' : 'concluida';
  await updateDemanda(userId, item.id, {
    status: nextStatus,
    completedAt: nextStatus === 'concluida' ? new Date().toISOString() : '',
  });
}

export async function postponeDemanda(
  userId: string,
  item: DemandaItem,
  addDays: number
): Promise<void> {
  const now = new Date();
  const daysUntil = getCalendarDaysUntil(item.dueDate, now);
  const baseDate = daysUntil < 0 ? now : parseDueDateParts(item.dueDate).dateOnly;
  const nextDate = addDaysToDateKey(baseDate, addDays);

  await updateDemanda(userId, item.id, {
    dueDate: nextDate,
    status: 'pendente',
    completedAt: '',
  });
}

export async function deleteDemanda(userId: string, demandaId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'users', userId, 'demandas', demandaId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `users/${userId}/demandas/${demandaId}`);
  }
}
