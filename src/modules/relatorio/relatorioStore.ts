import {
  Unsubscribe,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { OperationType, db, handleFirestoreError } from '../../core/auth/firebase';
import { logActivity } from '../../core/audit/activityLogger';
import {
  COM_SOC_PROVIDENCIA_OPTIONS,
  type ComSocProvidenciaOption,
  createDefaultRelatorioDocument,
  type RelatorioDocument,
  type RelatorioEventEntry,
} from './relatorioExport';

function clampString(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function clampRawString(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLen);
}

export function sanitizeRelatorioId(rawId: string): string {
  const cleaned = rawId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
  if (cleaned.length >= 1) return cleaned;
  return `rel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeEventEntry(raw: unknown): RelatorioEventEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<RelatorioEventEntry>;
  const providencias = Array.isArray(obj.providencias)
    ? obj.providencias.filter((p): p is ComSocProvidenciaOption =>
        (COM_SOC_PROVIDENCIA_OPTIONS as readonly string[]).includes(String(p))
      )
    : [];
  return {
    id: clampString(obj.id, 80) || `ev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    dataPeriodo: clampRawString(obj.dataPeriodo, 120),
    evento: clampRawString(obj.evento, 1500),
    providencias,
    observacao: clampRawString(obj.observacao, 600),
  };
}

export function sanitizeRelatorioForFirestore(userId: string, input: RelatorioDocument) {
  const base = createDefaultRelatorioDocument();
  const id = sanitizeRelatorioId(input.id);
  const vtr = input.vtrDisponibilidade || base.vtrDisponibilidade;

  const marcaModeloRows = (
    Array.isArray(input.marcaModeloRows) && input.marcaModeloRows.length > 0
      ? input.marcaModeloRows
      : base.marcaModeloRows
  )
    .slice(0, 40)
    .map((r, i) => ({
      marcaModelo: clampRawString(
        typeof r?.marcaModelo === 'string'
          ? r.marcaModelo
          : base.marcaModeloRows[i]?.marcaModelo || '',
        80
      ),
      disponiveis: clampRawString(typeof r?.disponiveis === 'string' ? r.disponiveis : '0', 24),
      indisponiveis: clampRawString(
        typeof r?.indisponiveis === 'string' ? r.indisponiveis : '0',
        24
      ),
      isTotal: Boolean(r?.isTotal),
    }));

  const execucaoFinanceiraRows = (
    Array.isArray(input.execucaoFinanceiraRows) && input.execucaoFinanceiraRows.length > 0
      ? input.execucaoFinanceiraRows
      : base.execucaoFinanceiraRows
  )
    .slice(0, 40)
    .map((fr) => ({
      contaContabil: clampRawString(fr?.contaContabil, 120),
      empenhado2026: clampRawString(fr?.empenhado2026, 40),
      liquidado2026: clampRawString(fr?.liquidado2026, 40),
      rp2025Inscrito: clampRawString(fr?.rp2025Inscrito, 40),
      rp2025Liquidado: clampRawString(fr?.rp2025Liquidado, 40),
      rp2024Inscrito: clampRawString(fr?.rp2024Inscrito, 40),
      rp2024Liquidado: clampRawString(fr?.rp2024Liquidado, 40),
    }));

  const diversosEventos = (Array.isArray(input.diversosEventos) ? input.diversosEventos : [])
    .slice(0, 200)
    .map(sanitizeEventEntry)
    .filter((e): e is RelatorioEventEntry => e !== null);

  const periodoCabecalho = clampRawString(input.periodoCabecalho, 120);
  const title =
    clampString(input.title, 160) ||
    clampString(`Relatório Semanal – ${periodoCabecalho || base.periodoCabecalho}`, 160);

  return {
    id,
    ownerUid: userId,
    title,
    periodoCabecalho,
    preparoEmprego: clampRawString(input.preparoEmprego, 400),
    estadoSanitario: clampRawString(input.estadoSanitario, 400),
    problemasDisciplinares: clampRawString(input.problemasDisciplinares, 400),
    generosAlimenticios: clampRawString(input.generosAlimenticios, 400),
    vtrDisponibilidade: {
      om: clampRawString(vtr.om ?? base.vtrDisponibilidade.om, 60),
      motocicletasExistente: clampRawString(
        vtr.motocicletasExistente ?? base.vtrDisponibilidade.motocicletasExistente,
        24
      ),
      motocicletasDisponivel: clampRawString(
        vtr.motocicletasDisponivel ?? base.vtrDisponibilidade.motocicletasDisponivel,
        24
      ),
      vtrOpExistente: clampRawString(
        vtr.vtrOpExistente ?? base.vtrDisponibilidade.vtrOpExistente,
        24
      ),
      vtrOpDisponivel: clampRawString(
        vtr.vtrOpDisponivel ?? base.vtrDisponibilidade.vtrOpDisponivel,
        24
      ),
      vtrAdmExistente: clampRawString(
        vtr.vtrAdmExistente ?? base.vtrDisponibilidade.vtrAdmExistente,
        24
      ),
      vtrAdmDisponivel: clampRawString(
        vtr.vtrAdmDisponivel ?? base.vtrDisponibilidade.vtrAdmDisponivel,
        24
      ),
      vtrBldExistente: clampRawString(
        vtr.vtrBldExistente ?? base.vtrDisponibilidade.vtrBldExistente,
        24
      ),
      vtrBldDisponivel: clampRawString(
        vtr.vtrBldDisponivel ?? base.vtrDisponibilidade.vtrBldDisponivel,
        24
      ),
      obusMrtExistente: clampRawString(
        vtr.obusMrtExistente ?? base.vtrDisponibilidade.obusMrtExistente,
        24
      ),
      obusMrtDisponivel: clampRawString(
        vtr.obusMrtDisponivel ?? base.vtrDisponibilidade.obusMrtDisponivel,
        24
      ),
    },
    marcaModeloRows,
    execucaoFinanceiraRows,
    diversosEventos,
    clientUpdatedAt: clampString(input.updatedAt, 40) || new Date().toISOString(),
  };
}

function hydrateRelatorioDoc(docId: string, raw: Record<string, unknown>): RelatorioDocument {
  const base = createDefaultRelatorioDocument({ id: docId });
  const vtrRaw =
    raw.vtrDisponibilidade && typeof raw.vtrDisponibilidade === 'object'
      ? (raw.vtrDisponibilidade as Partial<RelatorioDocument['vtrDisponibilidade']>)
      : null;

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : docId,
    title: typeof raw.title === 'string' && raw.title ? raw.title : base.title,
    periodoCabecalho:
      typeof raw.periodoCabecalho === 'string' ? raw.periodoCabecalho : base.periodoCabecalho,
    preparoEmprego:
      typeof raw.preparoEmprego === 'string' ? raw.preparoEmprego : base.preparoEmprego,
    estadoSanitario:
      typeof raw.estadoSanitario === 'string' ? raw.estadoSanitario : base.estadoSanitario,
    problemasDisciplinares:
      typeof raw.problemasDisciplinares === 'string'
        ? raw.problemasDisciplinares
        : base.problemasDisciplinares,
    generosAlimenticios:
      typeof raw.generosAlimenticios === 'string'
        ? raw.generosAlimenticios
        : base.generosAlimenticios,
    vtrDisponibilidade: vtrRaw
      ? {
          om: typeof vtrRaw.om === 'string' ? vtrRaw.om : base.vtrDisponibilidade.om,
          motocicletasExistente:
            typeof vtrRaw.motocicletasExistente === 'string'
              ? vtrRaw.motocicletasExistente
              : base.vtrDisponibilidade.motocicletasExistente,
          motocicletasDisponivel:
            typeof vtrRaw.motocicletasDisponivel === 'string'
              ? vtrRaw.motocicletasDisponivel
              : base.vtrDisponibilidade.motocicletasDisponivel,
          vtrOpExistente:
            typeof vtrRaw.vtrOpExistente === 'string'
              ? vtrRaw.vtrOpExistente
              : base.vtrDisponibilidade.vtrOpExistente,
          vtrOpDisponivel:
            typeof vtrRaw.vtrOpDisponivel === 'string'
              ? vtrRaw.vtrOpDisponivel
              : base.vtrDisponibilidade.vtrOpDisponivel,
          vtrAdmExistente:
            typeof vtrRaw.vtrAdmExistente === 'string'
              ? vtrRaw.vtrAdmExistente
              : base.vtrDisponibilidade.vtrAdmExistente,
          vtrAdmDisponivel:
            typeof vtrRaw.vtrAdmDisponivel === 'string'
              ? vtrRaw.vtrAdmDisponivel
              : base.vtrDisponibilidade.vtrAdmDisponivel,
          vtrBldExistente:
            typeof vtrRaw.vtrBldExistente === 'string'
              ? vtrRaw.vtrBldExistente
              : base.vtrDisponibilidade.vtrBldExistente,
          vtrBldDisponivel:
            typeof vtrRaw.vtrBldDisponivel === 'string'
              ? vtrRaw.vtrBldDisponivel
              : base.vtrDisponibilidade.vtrBldDisponivel,
          obusMrtExistente:
            typeof vtrRaw.obusMrtExistente === 'string'
              ? vtrRaw.obusMrtExistente
              : base.vtrDisponibilidade.obusMrtExistente,
          obusMrtDisponivel:
            typeof vtrRaw.obusMrtDisponivel === 'string'
              ? vtrRaw.obusMrtDisponivel
              : base.vtrDisponibilidade.obusMrtDisponivel,
        }
      : base.vtrDisponibilidade,
    marcaModeloRows:
      Array.isArray(raw.marcaModeloRows) && raw.marcaModeloRows.length > 0
        ? (raw.marcaModeloRows as RelatorioDocument['marcaModeloRows'])
        : base.marcaModeloRows,
    execucaoFinanceiraRows:
      Array.isArray(raw.execucaoFinanceiraRows) && raw.execucaoFinanceiraRows.length > 0
        ? (raw.execucaoFinanceiraRows as RelatorioDocument['execucaoFinanceiraRows'])
        : base.execucaoFinanceiraRows,
    diversosEventos: Array.isArray(raw.diversosEventos)
      ? raw.diversosEventos
          .map(sanitizeEventEntry)
          .filter((e): e is RelatorioEventEntry => e !== null)
      : [],
    updatedAt:
      typeof raw.clientUpdatedAt === 'string' && raw.clientUpdatedAt
        ? raw.clientUpdatedAt
        : new Date().toISOString(),
  };
}

export function subscribeUserRelatorios(
  userId: string,
  onData: (reports: RelatorioDocument[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const colRef = collection(db, 'users', userId, 'relatorios');
  const q = query(colRef, where('ownerUid', '==', userId));

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => hydrateRelatorioDoc(d.id, d.data() as Record<string, unknown>))
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      onData(list);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, `users/${userId}/relatorios`);
      } catch (wrapped) {
        if (onError) onError(wrapped as Error);
      }
    }
  );
}

const docWriteQueues = new Map<string, Promise<void>>();

export async function saveUserRelatorioDoc(
  userId: string,
  report: RelatorioDocument
): Promise<void> {
  const payload = sanitizeRelatorioForFirestore(userId, report);
  const path = `users/${userId}/relatorios/${payload.id}`;
  const ref = doc(db, 'users', userId, 'relatorios', payload.id);

  const prev = docWriteQueues.get(path) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      try {
        const existingSnap = await getDoc(ref);
        if (existingSnap.exists()) {
          await updateDoc(ref, {
            title: payload.title,
            periodoCabecalho: payload.periodoCabecalho,
            preparoEmprego: payload.preparoEmprego,
            estadoSanitario: payload.estadoSanitario,
            problemasDisciplinares: payload.problemasDisciplinares,
            generosAlimenticios: payload.generosAlimenticios,
            vtrDisponibilidade: payload.vtrDisponibilidade,
            marcaModeloRows: payload.marcaModeloRows,
            execucaoFinanceiraRows: payload.execucaoFinanceiraRows,
            diversosEventos: payload.diversosEventos,
            clientUpdatedAt: payload.clientUpdatedAt,
            updatedAt: serverTimestamp(),
          });
          void logActivity(
            {
              module: 'relatorio',
              action: 'update_relatorio',
              summary: `Atualizou relatório: ${payload.title}`,
              detail: `${payload.diversosEventos.length} atividade(s)`,
            },
            { dedupeKey: `relatorio:save:${payload.id}`, cooldownMs: 45_000 }
          );
        } else {
          await setDoc(ref, {
            ...payload,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          void logActivity({
            module: 'relatorio',
            action: 'create_relatorio',
            summary: `Criou relatório: ${payload.title}`,
            detail: `${payload.diversosEventos.length} atividade(s)`,
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, path);
      }
    });

  docWriteQueues.set(path, next);
  return next;
}

export async function deleteUserRelatorioDoc(
  userId: string,
  relatorioId: string
): Promise<void> {
  const safeId = sanitizeRelatorioId(relatorioId);
  const path = `users/${userId}/relatorios/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'relatorios', safeId));
    void logActivity({
      module: 'relatorio',
      action: 'delete_relatorio',
      summary: 'Excluiu um relatório semanal',
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}
