import {
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
import type { UserAccount } from '../../core/auth/authService';
import type {
  AgendaAuditAction,
  AgendaAuditLog,
  AgendaCategory,
  AgendaEvent,
  AgendaIntegrationConfig,
  AgendaStatus,
  AgendaSyncStatus,
} from './agendaTypes';

const EVENTS_COLLECTION = 'agenda_events';
const AUDIT_COLLECTION = 'agenda_audit';
const CONFIG_COLLECTION = 'agenda_config';
const GOOGLE_CONFIG_DOC_ID = 'google_calendar';

function generateSafeDocId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${ts}_${rnd}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

function clampString(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function clampReminderMinutes(value: number): number {
  const num = Number.isFinite(value) ? Math.round(value) : 0;
  return Math.max(0, Math.min(10080, num));
}

export interface AgendaEventInput {
  title: string;
  category: AgendaCategory;
  status: AgendaStatus;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string;
  responsibles: string;
  description: string;
  reminderMinutes: number;
  googleEventId?: string;
  googleCalendarId?: string;
  googleCalendarSummary?: string;
  googleHtmlLink?: string;
  syncStatus?: AgendaSyncStatus;
  lastSyncedAt?: string;
}

export function subscribeAgendaEvents(
  onData: (events: AgendaEvent[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(
    collection(db, EVENTS_COLLECTION),
    where('sectionScope', '==', 'comsoc')
  );

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as AgendaEvent)
        .sort((a, b) => a.startAt.localeCompare(b.startAt));
      onData(list);
    },
    (err) => {
      if (onError) {
        onError(err instanceof Error ? err : new Error(String(err)));
      } else {
        handleFirestoreError(err, OperationType.LIST, EVENTS_COLLECTION);
      }
    }
  );
}

export function subscribeAgendaAudit(
  onData: (logs: AgendaAuditLog[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(
    collection(db, AUDIT_COLLECTION),
    where('sectionScope', '==', 'comsoc')
  );

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as AgendaAuditLog)
        .sort((a, b) => {
          const aMs = a.createdAt?.toMillis?.() ?? 0;
          const bMs = b.createdAt?.toMillis?.() ?? 0;
          return bMs - aMs;
        })
        .slice(0, 100);
      onData(list);
    },
    (err) => {
      if (onError) {
        onError(err instanceof Error ? err : new Error(String(err)));
      } else {
        handleFirestoreError(err, OperationType.LIST, AUDIT_COLLECTION);
      }
    }
  );
}

export function subscribeAgendaGoogleConfig(
  onData: (config: AgendaIntegrationConfig | null) => void,
  onError?: (err: Error) => void
): () => void {
  return onSnapshot(
    doc(db, CONFIG_COLLECTION, GOOGLE_CONFIG_DOC_ID),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData(snap.data() as AgendaIntegrationConfig);
    },
    (err) => {
      if (onError) {
        onError(err instanceof Error ? err : new Error(String(err)));
      } else {
        handleFirestoreError(
          err,
          OperationType.GET,
          `${CONFIG_COLLECTION}/${GOOGLE_CONFIG_DOC_ID}`
        );
      }
    }
  );
}

export async function recordAgendaAudit(params: {
  actor: UserAccount;
  action: AgendaAuditAction;
  summary: string;
  eventId?: string;
}): Promise<void> {
  const id = generateSafeDocId('aud');
  const safeActorName = clampString(params.actor.displayName || params.actor.username, 80) || 'Usuário';
  const safeSummary = clampString(params.summary, 240) || 'Ação registrada na agenda';
  const safeEventId = params.eventId ? params.eventId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128) : '';

  try {
    await setDoc(doc(db, AUDIT_COLLECTION, id), {
      id,
      eventId: safeEventId,
      action: params.action,
      summary: safeSummary,
      actorUid: params.actor.uid,
      actorName: safeActorName,
      sectionScope: 'comsoc',
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    // Audit logging should not block a primary user workflow if transiently denied
    console.warn('Falha ao gravar auditoria da Agenda:', err);
  }
}

export async function createAgendaEvent(
  input: AgendaEventInput,
  actor: UserAccount
): Promise<AgendaEvent> {
  const id = generateSafeDocId('evt');
  const title = clampString(input.title, 140);
  if (!title) {
    throw new Error('Informe o título da atividade.');
  }

  const actorName = clampString(actor.displayName || actor.username, 80) || 'Usuário';
  const payload = {
    id,
    title,
    category: input.category,
    status: input.status,
    startAt: clampString(input.startAt, 40),
    endAt: clampString(input.endAt, 40),
    allDay: Boolean(input.allDay),
    location: clampString(input.location, 180),
    responsibles: clampString(input.responsibles, 240),
    description: clampString(input.description, 2000),
    reminderMinutes: clampReminderMinutes(input.reminderMinutes),
    sectionScope: 'comsoc' as const,
    googleEventId: clampString(input.googleEventId || '', 256),
    googleCalendarId: clampString(input.googleCalendarId || '', 256),
    googleCalendarSummary: clampString(input.googleCalendarSummary || '', 140),
    googleHtmlLink: clampString(input.googleHtmlLink || '', 400),
    syncStatus: (input.syncStatus || 'internal') as AgendaSyncStatus,
    lastSyncedAt: clampString(input.lastSyncedAt || '', 40),
    createdByUid: actor.uid,
    createdByName: actorName,
    updatedByUid: actor.uid,
    updatedByName: actorName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, EVENTS_COLLECTION, id), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `${EVENTS_COLLECTION}/${id}`);
  }

  void recordAgendaAudit({
    actor,
    action: 'create',
    eventId: id,
    summary: `Atividade criada: "${title}"`,
  });

  return {
    ...payload,
    createdAt: undefined,
    updatedAt: undefined,
  };
}

export async function updateAgendaEvent(
  eventId: string,
  input: Partial<AgendaEventInput>,
  actor: UserAccount,
  auditSummary?: string
): Promise<void> {
  const actorName = clampString(actor.displayName || actor.username, 80) || 'Usuário';
  const updates: Record<string, unknown> = {
    updatedByUid: actor.uid,
    updatedByName: actorName,
    updatedAt: serverTimestamp(),
  };

  if (input.title !== undefined) {
    const cleanTitle = clampString(input.title, 140);
    if (!cleanTitle) throw new Error('O título da atividade não pode ficar vazio.');
    updates.title = cleanTitle;
  }
  if (input.category !== undefined) updates.category = input.category;
  if (input.status !== undefined) updates.status = input.status;
  if (input.startAt !== undefined) updates.startAt = clampString(input.startAt, 40);
  if (input.endAt !== undefined) updates.endAt = clampString(input.endAt, 40);
  if (input.allDay !== undefined) updates.allDay = Boolean(input.allDay);
  if (input.location !== undefined) updates.location = clampString(input.location, 180);
  if (input.responsibles !== undefined) updates.responsibles = clampString(input.responsibles, 240);
  if (input.description !== undefined) updates.description = clampString(input.description, 2000);
  if (input.reminderMinutes !== undefined) {
    updates.reminderMinutes = clampReminderMinutes(input.reminderMinutes);
  }
  if (input.googleEventId !== undefined) {
    updates.googleEventId = clampString(input.googleEventId, 256);
  }
  if (input.googleCalendarId !== undefined) {
    updates.googleCalendarId = clampString(input.googleCalendarId, 256);
  }
  if (input.googleCalendarSummary !== undefined) {
    updates.googleCalendarSummary = clampString(input.googleCalendarSummary, 140);
  }
  if (input.googleHtmlLink !== undefined) {
    updates.googleHtmlLink = clampString(input.googleHtmlLink, 400);
  }
  if (input.syncStatus !== undefined) updates.syncStatus = input.syncStatus;
  if (input.lastSyncedAt !== undefined) updates.lastSyncedAt = clampString(input.lastSyncedAt, 40);

  try {
    await updateDoc(doc(db, EVENTS_COLLECTION, eventId), updates);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `${EVENTS_COLLECTION}/${eventId}`);
  }

  if (auditSummary) {
    void recordAgendaAudit({
      actor,
      action: 'update',
      eventId,
      summary: auditSummary,
    });
  }
}

export async function deleteAgendaEvent(
  event: AgendaEvent,
  actor: UserAccount
): Promise<void> {
  try {
    await deleteDoc(doc(db, EVENTS_COLLECTION, event.id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `${EVENTS_COLLECTION}/${event.id}`);
  }

  void recordAgendaAudit({
    actor,
    action: 'delete',
    eventId: event.id,
    summary: `Atividade excluída: "${event.title}"`,
  });
}

export async function saveSelectedGoogleCalendarConfig(params: {
  calendarId: string;
  calendarSummary: string;
  actor: UserAccount;
}): Promise<void> {
  const actorName = clampString(params.actor.displayName || params.actor.username, 80) || 'Usuário';
  const payload = {
    id: GOOGLE_CONFIG_DOC_ID,
    selectedCalendarId: clampString(params.calendarId, 256),
    selectedCalendarSummary: clampString(params.calendarSummary, 140),
    updatedByUid: params.actor.uid,
    updatedByName: actorName,
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, CONFIG_COLLECTION, GOOGLE_CONFIG_DOC_ID), payload);
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.WRITE,
      `${CONFIG_COLLECTION}/${GOOGLE_CONFIG_DOC_ID}`
    );
  }
}
