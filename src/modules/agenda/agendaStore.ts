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
  ComsocScope,
  GoogleCalendarRemoteEvent,
  GoogleContactSuggestion,
  GoogleEventTransparency,
  GoogleEventVisibility,
  GoogleSendUpdates,
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
  comsocScope?: ComsocScope;
  colorId?: string;
  recurrenceRule?: string;
  visibility?: GoogleEventVisibility;
  transparency?: GoogleEventTransparency;
  meetLink?: string;
  createMeet?: boolean;
  attendeesJson?: string;
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  sendUpdates?: GoogleSendUpdates;
  attachmentsJson?: string;
  remindersJson?: string;
  pendingGoogleSync?: boolean;
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
  const safeActorName =
    clampString(params.actor.displayName || params.actor.username, 80) || 'Usuário';
  const safeSummary = clampString(params.summary, 240) || 'Ação registrada na agenda';
  const safeEventId = params.eventId
    ? params.eventId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128)
    : '';

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
    console.warn('Falha ao gravar auditoria da Agenda:', err);
  }
}

export async function createAgendaEvent(
  input: AgendaEventInput,
  actor: UserAccount,
  skipAudit = false
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
    comsocScope: (input.comsocScope || 'comsoc') as ComsocScope,
    colorId: clampString(input.colorId || '', 16),
    recurrenceRule: clampString(input.recurrenceRule || '', 200),
    visibility: (input.visibility || 'default') as GoogleEventVisibility,
    transparency: (input.transparency || 'opaque') as GoogleEventTransparency,
    meetLink: clampString(input.meetLink || '', 400),
    createMeet: Boolean(input.createMeet),
    attendeesJson: (input.attendeesJson || '[]').slice(0, 12000),
    guestsCanModify: Boolean(input.guestsCanModify),
    guestsCanInviteOthers: input.guestsCanInviteOthers !== false,
    guestsCanSeeOtherGuests: input.guestsCanSeeOtherGuests !== false,
    sendUpdates: (input.sendUpdates || 'none') as GoogleSendUpdates,
    attachmentsJson: (input.attachmentsJson || '[]').slice(0, 12000),
    remindersJson: (input.remindersJson || '[]').slice(0, 2000),
    pendingGoogleSync: Boolean(input.pendingGoogleSync),
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

  if (!skipAudit) {
    void recordAgendaAudit({
      actor,
      action: 'create',
      eventId: id,
      summary: `Atividade criada: "${title}"`,
    });
  }

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
  if (input.comsocScope !== undefined) updates.comsocScope = input.comsocScope;
  if (input.colorId !== undefined) updates.colorId = clampString(input.colorId, 16);
  if (input.recurrenceRule !== undefined) {
    updates.recurrenceRule = clampString(input.recurrenceRule, 200);
  }
  if (input.visibility !== undefined) updates.visibility = input.visibility;
  if (input.transparency !== undefined) updates.transparency = input.transparency;
  if (input.meetLink !== undefined) updates.meetLink = clampString(input.meetLink, 400);
  if (input.createMeet !== undefined) updates.createMeet = Boolean(input.createMeet);
  if (input.attendeesJson !== undefined) updates.attendeesJson = input.attendeesJson.slice(0, 12000);
  if (input.guestsCanModify !== undefined) updates.guestsCanModify = Boolean(input.guestsCanModify);
  if (input.guestsCanInviteOthers !== undefined) {
    updates.guestsCanInviteOthers = Boolean(input.guestsCanInviteOthers);
  }
  if (input.guestsCanSeeOtherGuests !== undefined) {
    updates.guestsCanSeeOtherGuests = Boolean(input.guestsCanSeeOtherGuests);
  }
  if (input.sendUpdates !== undefined) updates.sendUpdates = input.sendUpdates;
  if (input.attachmentsJson !== undefined) {
    updates.attachmentsJson = input.attachmentsJson.slice(0, 12000);
  }
  if (input.remindersJson !== undefined) updates.remindersJson = input.remindersJson.slice(0, 2000);
  if (input.pendingGoogleSync !== undefined) {
    updates.pendingGoogleSync = Boolean(input.pendingGoogleSync);
  }

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

function serializeContactsBounded(contacts: GoogleContactSuggestion[]): string {
  const safeList = contacts
    .filter((c) => c.email && c.email.includes('@'))
    .slice(0, 350)
    .map((c) => ({
      email: c.email.trim().toLowerCase().slice(0, 120),
      displayName: (c.displayName || c.email).trim().slice(0, 80),
    }));
  let json = JSON.stringify(safeList);
  while (json.length > 58000 && safeList.length > 0) {
    safeList.pop();
    json = JSON.stringify(safeList);
  }
  return json;
}

export async function saveSelectedGoogleCalendarConfig(params: {
  calendarId: string;
  calendarSummary: string;
  lockedAccountEmail?: string;
  lastSyncAt?: string;
  contactsCache?: GoogleContactSuggestion[];
  existingContactsCacheJson?: string;
  actor: UserAccount;
}): Promise<void> {
  const actorName = clampString(params.actor.displayName || params.actor.username, 80) || 'Admin';
  const contactsJson = params.contactsCache
    ? serializeContactsBounded(params.contactsCache)
    : (params.existingContactsCacheJson || '[]').slice(0, 60000);

  const payload = {
    id: GOOGLE_CONFIG_DOC_ID,
    selectedCalendarId: clampString(params.calendarId, 256),
    selectedCalendarSummary: clampString(params.calendarSummary, 140),
    lockedAccountEmail: clampString(params.lockedAccountEmail || '', 140),
    lastSyncAt: clampString(params.lastSyncAt || new Date().toISOString(), 40),
    contactsCacheJson: contactsJson,
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

/**
 * Mirrors all events from the institutional Google Calendar into Firestore so that
 * EVERY SISCOM profile immediately sees Calendário COMSOC & Calendário Geral
 * without requiring individual Google logins. Brand-new Google events arrive with
 * `comsocScope: 'pending'` to feed the Tinder-style triage deck!
 */
export async function mirrorGoogleEventsToFirestore(params: {
  remoteEvents: GoogleCalendarRemoteEvent[];
  existingEvents: AgendaEvent[];
  actor: UserAccount;
}): Promise<{ createdPending: number; updatedMirrored: number }> {
  const byGoogleId = new Map<string, AgendaEvent>();
  const bySiscomId = new Map<string, AgendaEvent>();
  params.existingEvents.forEach((ev) => {
    if (ev.googleEventId) byGoogleId.set(ev.googleEventId, ev);
    bySiscomId.set(ev.id, ev);
  });

  let createdPending = 0;
  let updatedMirrored = 0;
  const nowIso = new Date().toISOString();

  for (const rem of params.remoteEvents) {
    const matched =
      byGoogleId.get(rem.id) ||
      (rem.siscomEventId ? bySiscomId.get(rem.siscomEventId) : undefined);

    const attendeesJson = JSON.stringify(rem.attendees).slice(0, 12000);
    const attachmentsJson = JSON.stringify(rem.attachments).slice(0, 12000);
    const remindersJson = JSON.stringify(rem.reminders).slice(0, 2000);
    const primaryReminderMinutes = rem.reminders[0]?.minutes ?? 60;

    if (!matched) {
      await createAgendaEvent(
        {
          title: rem.summary || '(Sem título)',
          category: 'outros',
          status: 'agendado',
          startAt: rem.startAt,
          endAt: rem.endAt,
          allDay: rem.allDay,
          location: rem.location,
          responsibles: '',
          description: rem.description,
          reminderMinutes: primaryReminderMinutes,
          googleEventId: rem.id,
          googleCalendarId: rem.calendarId,
          googleCalendarSummary: rem.calendarSummary,
          googleHtmlLink: rem.htmlLink,
          syncStatus: 'synced',
          lastSyncedAt: nowIso,
          comsocScope: 'pending',
          colorId: rem.colorId,
          recurrenceRule: rem.recurrenceRule,
          visibility: rem.visibility,
          transparency: rem.transparency,
          meetLink: rem.meetLink,
          createMeet: Boolean(rem.meetLink),
          attendeesJson,
          guestsCanModify: rem.guestsCanModify,
          guestsCanInviteOthers: rem.guestsCanInviteOthers,
          guestsCanSeeOtherGuests: rem.guestsCanSeeOtherGuests,
          sendUpdates: 'none',
          attachmentsJson,
          remindersJson,
          pendingGoogleSync: false,
        },
        params.actor,
        true
      );
      createdPending += 1;
    } else if (!matched.pendingGoogleSync) {
      // Only refresh mirrored fields if nothing is locally waiting to be pushed
      const changed =
        matched.title !== rem.summary ||
        matched.startAt !== rem.startAt ||
        matched.endAt !== rem.endAt ||
        matched.location !== rem.location ||
        matched.meetLink !== rem.meetLink ||
        matched.attendeesJson !== attendeesJson ||
        matched.attachmentsJson !== attachmentsJson;

      if (changed) {
        await updateAgendaEvent(
          matched.id,
          {
            title: rem.summary || matched.title,
            startAt: rem.startAt,
            endAt: rem.endAt,
            allDay: rem.allDay,
            location: rem.location,
            description: rem.description || matched.description,
            googleEventId: rem.id,
            googleCalendarId: rem.calendarId,
            googleCalendarSummary: rem.calendarSummary,
            googleHtmlLink: rem.htmlLink,
            syncStatus: 'synced',
            lastSyncedAt: nowIso,
            colorId: rem.colorId,
            recurrenceRule: rem.recurrenceRule,
            visibility: rem.visibility,
            transparency: rem.transparency,
            meetLink: rem.meetLink,
            attendeesJson,
            attachmentsJson,
            remindersJson,
          },
          params.actor
        );
        updatedMirrored += 1;
      }
    }
  }

  return { createdPending, updatedMirrored };
}
