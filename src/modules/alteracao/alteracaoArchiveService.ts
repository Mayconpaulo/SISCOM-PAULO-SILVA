import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { OperationType, db, handleFirestoreError } from '../../core/auth/firebase';
import { logActivity } from '../../core/audit/activityLogger';
import {
  sanitizeAlteracaoHtml,
  sanitizeCssFontFamily,
  sanitizeCssFontSizePt,
  sanitizeCssLineHeight,
} from '../../shared/htmlSanitizer';
import type { StructuredAlteracaoDoc } from './alteracaoFormatter';
import type { AlteracaoHeaderData } from './AlteracaoGenerator';

export interface AlteracaoFolderRecord {
  id: string;
  ownerUid: string;
  name: string;
  parentId: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface AlteracaoArchiveDocRecord {
  id: string;
  ownerUid: string;
  folderId: string;
  title: string;
  header: AlteracaoHeaderData;
  pagesHtml: string[];
  fontFamily: string;
  fontSizePt: string;
  lineHeight: string;
  dataPraca: string;
  dataFinal: string;
  enabledItemIds: string[];
  structuredDocJson: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface SaveAlteracaoDocInput {
  existingDocId?: string | null;
  folderId: string;
  title: string;
  header: AlteracaoHeaderData;
  pagesHtml: string[];
  fontFamily: string;
  fontSizePt: string;
  lineHeight: string;
  dataPraca: string;
  dataFinal: string;
  enabledItemIds: string[];
  structuredDoc: StructuredAlteracaoDoc | null;
}

const VALID_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function generateSafeId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}_${rand}`.slice(0, 64);
}

function clampStr(value: unknown, maxLen: number, fallback = ''): string {
  const s = typeof value === 'string' ? value : fallback;
  return s.slice(0, maxLen);
}

function sanitizeOptionalId(value: string | null | undefined): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return VALID_ID_RE.test(trimmed) ? trimmed : '';
}

function tsToMs(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (val && typeof val === 'object' && 'toMillis' in val && typeof (val as { toMillis: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

function sanitizeHeaderForFirestore(header: AlteracaoHeaderData): AlteracaoHeaderData {
  const folhaNum =
    typeof header.folhaInicial === 'number' && Number.isFinite(header.folhaInicial)
      ? Math.min(9999, Math.max(1, Math.floor(header.folhaInicial)))
      : 1;
  const generoCont: 'auto' | 'do' | 'da' =
    header.generoCont === 'do' || header.generoCont === 'da' || header.generoCont === 'auto'
      ? header.generoCont
      : 'auto';

  return {
    ministerio: clampStr(header.ministerio, 160),
    forca: clampStr(header.forca, 160),
    comandoDivisao: clampStr(header.comandoDivisao, 160),
    grandeUnidade: clampStr(header.grandeUnidade, 160),
    omCodom: clampStr(header.omCodom, 160),
    omExtenso: clampStr(header.omExtenso, 200),
    tituloDocumento: clampStr(header.tituloDocumento, 160),
    guarnicao: clampStr(header.guarnicao, 160),
    folhaInicial: folhaNum,
    nomeCompleto: clampStr(header.nomeCompleto, 180),
    nomeGuerra: clampStr(header.nomeGuerra, 100),
    generoCont,
    postoGraduacao: clampStr(header.postoGraduacao, 100),
    qasQms: clampStr(header.qasQms, 100),
    identidade: clampStr(header.identidade, 80),
    semestre: clampStr(header.semestre, 120),
    periodo: clampStr(header.periodo, 160),
  };
}

function utf8ByteLength(str: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).length;
  }
  return str.length * 2;
}

function buildArchiveDocFields(
  uid: string,
  docId: string,
  input: SaveAlteracaoDocInput
): Omit<AlteracaoArchiveDocRecord, 'createdAtMs' | 'updatedAtMs'> {
  const cleanTitle = clampStr(input.title.trim() || 'Alteração sem título', 160);
  const cleanPages = (
    Array.isArray(input.pagesHtml) && input.pagesHtml.length > 0
      ? input.pagesHtml.slice(0, 60)
      : ['<p><br></p>']
  ).map((p) => {
    const sanitized = sanitizeAlteracaoHtml(p);
    return sanitized.length > 195000 ? sanitized.slice(0, 195000) : sanitized;
  });

  const cleanEnabledIds = Array.isArray(input.enabledItemIds)
    ? input.enabledItemIds
        .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128)
        .slice(0, 500)
    : [];

  let structuredDocJson = '';
  if (input.structuredDoc) {
    try {
      const serialized = JSON.stringify(input.structuredDoc);
      const pagesBytes = cleanPages.reduce((acc, p) => acc + utf8ByteLength(p), 0);
      // Respect both Firestore rule cap (260k chars) and 1 MiB document size ceiling
      if (serialized.length <= 255000 && pagesBytes + utf8ByteLength(serialized) < 860000) {
        structuredDocJson = serialized;
      }
    } catch {
      structuredDocJson = '';
    }
  }

  return {
    id: docId,
    ownerUid: uid,
    folderId: sanitizeOptionalId(input.folderId),
    title: cleanTitle,
    header: sanitizeHeaderForFirestore(input.header),
    pagesHtml: cleanPages,
    fontFamily: clampStr(sanitizeCssFontFamily(input.fontFamily), 40, 'Times New Roman'),
    fontSizePt: clampStr(sanitizeCssFontSizePt(input.fontSizePt), 12, '12pt'),
    lineHeight: clampStr(sanitizeCssLineHeight(input.lineHeight), 12, '1.22'),
    dataPraca: clampStr(input.dataPraca, 20),
    dataFinal: clampStr(input.dataFinal, 20),
    enabledItemIds: cleanEnabledIds,
    structuredDocJson,
  };
}

export function parseStructuredDocJson(raw: string): StructuredAlteracaoDoc | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StructuredAlteracaoDoc>;
    if (parsed && Array.isArray(parsed.items) && Array.isArray(parsed.monthOrder)) {
      return {
        items: parsed.items,
        monthOrder: parsed.monthOrder,
        comportamentoLines: Array.isArray(parsed.comportamentoLines)
          ? parsed.comportamentoLines
          : undefined,
        part2Lines: Array.isArray(parsed.part2Lines) ? parsed.part2Lines : [],
        part2BoldSubstrings: parsed.part2BoldSubstrings,
        extractedHeader: parsed.extractedHeader ?? {},
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function subscribeAlteracaoFolders(
  uid: string,
  onData: (folders: AlteracaoFolderRecord[]) => void,
  onError?: (err: Error) => void
): () => void {
  const colPath = `users/${uid}/alteracao_folders`;
  const q = query(collection(db, 'users', uid, 'alteracao_folders'), where('ownerUid', '==', uid));

  return onSnapshot(
    q,
    (snap) => {
      const items: AlteracaoFolderRecord[] = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: typeof data.id === 'string' ? data.id : d.id,
            ownerUid: typeof data.ownerUid === 'string' ? data.ownerUid : uid,
            name: typeof data.name === 'string' ? data.name : 'Pasta',
            parentId: typeof data.parentId === 'string' ? data.parentId : '',
            createdAtMs: tsToMs(data.createdAt),
            updatedAtMs: tsToMs(data.updatedAt),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
      onData(items);
    },
    (err) => {
      if (onError) onError(err);
      try {
        handleFirestoreError(err, OperationType.LIST, colPath);
      } catch {
        // Logged via handleFirestoreError; caller handles UI feedback via onError
      }
    }
  );
}

export function subscribeAlteracaoDocs(
  uid: string,
  onData: (docs: AlteracaoArchiveDocRecord[]) => void,
  onError?: (err: Error) => void
): () => void {
  const colPath = `users/${uid}/alteracao_docs`;
  const q = query(collection(db, 'users', uid, 'alteracao_docs'), where('ownerUid', '==', uid));

  return onSnapshot(
    q,
    (snap) => {
      const items: AlteracaoArchiveDocRecord[] = snap.docs
        .map((d) => {
          const data = d.data();
          const h = (data.header || {}) as Partial<AlteracaoHeaderData>;
          const header = sanitizeHeaderForFirestore({
            ministerio: h.ministerio ?? 'MINISTÉRIO DA DEFESA',
            forca: h.forca ?? 'EXÉRCITO BRASILEIRO',
            comandoDivisao: h.comandoDivisao ?? '',
            grandeUnidade: h.grandeUnidade ?? '',
            omCodom: h.omCodom ?? '',
            omExtenso: h.omExtenso ?? '',
            tituloDocumento: h.tituloDocumento ?? 'FOLHAS DE ALTERAÇÕES',
            guarnicao: h.guarnicao ?? '',
            folhaInicial: typeof h.folhaInicial === 'number' ? h.folhaInicial : 1,
            nomeCompleto: h.nomeCompleto ?? '',
            nomeGuerra: h.nomeGuerra ?? '',
            generoCont:
              h.generoCont === 'do' || h.generoCont === 'da' || h.generoCont === 'auto'
                ? h.generoCont
                : 'auto',
            postoGraduacao: h.postoGraduacao ?? '',
            qasQms: h.qasQms ?? '',
            identidade: h.identidade ?? '',
            semestre: h.semestre ?? '',
            periodo: h.periodo ?? '',
          });

          const rawPages = Array.isArray(data.pagesHtml)
            ? data.pagesHtml.filter((p: unknown): p is string => typeof p === 'string')
            : ['<p><br></p>'];

          return {
            id: typeof data.id === 'string' ? data.id : d.id,
            ownerUid: typeof data.ownerUid === 'string' ? data.ownerUid : uid,
            folderId: typeof data.folderId === 'string' ? data.folderId : '',
            title: typeof data.title === 'string' ? data.title : 'Alteração',
            header,
            pagesHtml: rawPages.length > 0 ? rawPages : ['<p><br></p>'],
            fontFamily: typeof data.fontFamily === 'string' ? data.fontFamily : 'Times New Roman',
            fontSizePt: typeof data.fontSizePt === 'string' ? data.fontSizePt : '12pt',
            lineHeight: typeof data.lineHeight === 'string' ? data.lineHeight : '1.22',
            dataPraca: typeof data.dataPraca === 'string' ? data.dataPraca : '',
            dataFinal: typeof data.dataFinal === 'string' ? data.dataFinal : '',
            enabledItemIds: Array.isArray(data.enabledItemIds)
              ? data.enabledItemIds.filter((id: unknown): id is string => typeof id === 'string')
              : [],
            structuredDocJson: typeof data.structuredDocJson === 'string' ? data.structuredDocJson : '',
            createdAtMs: tsToMs(data.createdAt),
            updatedAtMs: tsToMs(data.updatedAt),
          };
        })
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      onData(items);
    },
    (err) => {
      if (onError) onError(err);
      try {
        handleFirestoreError(err, OperationType.LIST, colPath);
      } catch {
        // Logged via handleFirestoreError
      }
    }
  );
}

export async function createAlteracaoFolder(
  uid: string,
  name: string,
  parentId = ''
): Promise<string> {
  const cleanName = clampStr(name.trim(), 80);
  if (!cleanName) {
    throw new Error('Informe um nome para a pasta.');
  }
  const folderId = generateSafeId('fld');
  const cleanParentId = sanitizeOptionalId(parentId);
  const path = `users/${uid}/alteracao_folders/${folderId}`;
  try {
    await setDoc(doc(db, 'users', uid, 'alteracao_folders', folderId), {
      id: folderId,
      ownerUid: uid,
      name: cleanName,
      parentId: cleanParentId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    void logActivity({
      module: 'alteracao',
      action: 'create_folder',
      summary: `Criou pasta de alterações: ${cleanName}`,
    });
    return folderId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function renameAlteracaoFolder(
  uid: string,
  folderId: string,
  name: string
): Promise<void> {
  const cleanName = clampStr(name.trim(), 80);
  if (!cleanName) {
    throw new Error('Informe um nome válido para a pasta.');
  }
  const path = `users/${uid}/alteracao_folders/${folderId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'alteracao_folders', folderId), {
      name: cleanName,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export function getDescendantFolderIds(
  rootFolderId: string,
  allFolders: readonly AlteracaoFolderRecord[]
): Set<string> {
  const result = new Set<string>([rootFolderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of allFolders) {
      if (f.parentId && result.has(f.parentId) && !result.has(f.id)) {
        result.add(f.id);
        grew = true;
      }
    }
  }
  return result;
}

export async function moveAlteracaoFolder(
  uid: string,
  folderId: string,
  newParentId: string,
  allFolders: readonly AlteracaoFolderRecord[]
): Promise<void> {
  const cleanParentId = sanitizeOptionalId(newParentId);
  const blocked = getDescendantFolderIds(folderId, allFolders);
  if (cleanParentId && blocked.has(cleanParentId)) {
    throw new Error('Não é possível mover uma pasta para dentro dela mesma.');
  }
  const path = `users/${uid}/alteracao_folders/${folderId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'alteracao_folders', folderId), {
      parentId: cleanParentId,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteAlteracaoFolderCascade(
  uid: string,
  folderId: string,
  allFolders: readonly AlteracaoFolderRecord[],
  allDocs: readonly AlteracaoArchiveDocRecord[]
): Promise<{ deletedFolders: number; deletedDocs: number }> {
  const folderIdsToDelete = getDescendantFolderIds(folderId, allFolders);
  const docsToDelete = allDocs.filter((d) => d.folderId && folderIdsToDelete.has(d.folderId));

  const refsToDelete = [
    ...docsToDelete.map((d) => doc(db, 'users', uid, 'alteracao_docs', d.id)),
    ...Array.from(folderIdsToDelete).map((fId) =>
      doc(db, 'users', uid, 'alteracao_folders', fId)
    ),
  ];

  const path = `users/${uid}/alteracao_folders/${folderId}`;
  try {
    const CHUNK = 400;
    for (let i = 0; i < refsToDelete.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const ref of refsToDelete.slice(i, i + CHUNK)) {
        batch.delete(ref);
      }
      await batch.commit();
    }
    void logActivity({
      module: 'alteracao',
      action: 'delete_folder',
      summary: `Excluiu pasta de alterações (${folderIdsToDelete.size} pasta(s), ${docsToDelete.length} doc(s))`,
    });
    return {
      deletedFolders: folderIdsToDelete.size,
      deletedDocs: docsToDelete.length,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function saveAlteracaoDoc(
  uid: string,
  input: SaveAlteracaoDocInput
): Promise<string> {
  const isUpdate = Boolean(input.existingDocId && VALID_ID_RE.test(input.existingDocId));
  const docId = isUpdate ? input.existingDocId! : generateSafeId('alt');
  const fields = buildArchiveDocFields(uid, docId, input);
  const path = `users/${uid}/alteracao_docs/${docId}`;

  try {
    if (isUpdate) {
      await updateDoc(doc(db, 'users', uid, 'alteracao_docs', docId), {
        folderId: fields.folderId,
        title: fields.title,
        header: fields.header,
        pagesHtml: fields.pagesHtml,
        fontFamily: fields.fontFamily,
        fontSizePt: fields.fontSizePt,
        lineHeight: fields.lineHeight,
        dataPraca: fields.dataPraca,
        dataFinal: fields.dataFinal,
        enabledItemIds: fields.enabledItemIds,
        structuredDocJson: fields.structuredDocJson,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'users', uid, 'alteracao_docs', docId), {
        ...fields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    void logActivity(
      {
        module: 'alteracao',
        action: isUpdate ? 'update_alteracao_doc' : 'save_alteracao_doc',
        summary: `${isUpdate ? 'Atualizou' : 'Arquivou'} alteração: ${fields.title}`,
      },
      isUpdate ? { dedupeKey: `alt:save:${docId}`, cooldownMs: 30_000 } : undefined
    );
    return docId;
  } catch (err) {
    handleFirestoreError(
      err,
      isUpdate ? OperationType.UPDATE : OperationType.CREATE,
      path
    );
  }
}

export async function renameAlteracaoDoc(
  uid: string,
  docId: string,
  title: string
): Promise<void> {
  const cleanTitle = clampStr(title.trim(), 160);
  if (!cleanTitle) {
    throw new Error('Informe um título válido para a alteração.');
  }
  const path = `users/${uid}/alteracao_docs/${docId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'alteracao_docs', docId), {
      title: cleanTitle,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function moveAlteracaoDoc(
  uid: string,
  docId: string,
  targetFolderId: string
): Promise<void> {
  const cleanFolderId = sanitizeOptionalId(targetFolderId);
  const path = `users/${uid}/alteracao_docs/${docId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'alteracao_docs', docId), {
      folderId: cleanFolderId,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteAlteracaoDoc(uid: string, docId: string): Promise<void> {
  const path = `users/${uid}/alteracao_docs/${docId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'alteracao_docs', docId));
    void logActivity({
      module: 'alteracao',
      action: 'delete_alteracao_doc',
      summary: 'Excluiu uma alteração arquivada',
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export interface BatchAlteracaoDocPatch {
  id: string;
  header: AlteracaoHeaderData;
  pagesHtml: string[];
  dataPraca: string;
  dataFinal: string;
  structuredDocJson: string;
}

export async function batchUpdateAlteracaoDocs(
  uid: string,
  patches: BatchAlteracaoDocPatch[]
): Promise<number> {
  if (!uid || patches.length === 0) return 0;

  const CHUNK_SIZE = 350;
  let updatedCount = 0;

  for (let start = 0; start < patches.length; start += CHUNK_SIZE) {
    const chunk = patches.slice(start, start + CHUNK_SIZE);
    const batch = writeBatch(db);

    for (const patch of chunk) {
      const cleanPages = (
        Array.isArray(patch.pagesHtml) && patch.pagesHtml.length > 0
          ? patch.pagesHtml.slice(0, 60)
          : ['<p><br></p>']
      ).map((p) => {
        const sanitized = sanitizeAlteracaoHtml(p);
        return sanitized.length > 195000 ? sanitized.slice(0, 195000) : sanitized;
      });

      const pagesBytes = cleanPages.reduce((acc, p) => acc + utf8ByteLength(p), 0);
      let safeStructuredJson = typeof patch.structuredDocJson === 'string' ? patch.structuredDocJson : '';
      if (
        safeStructuredJson.length > 255000 ||
        pagesBytes + utf8ByteLength(safeStructuredJson) >= 860000
      ) {
        safeStructuredJson = '';
      }

      batch.update(doc(db, 'users', uid, 'alteracao_docs', patch.id), {
        header: sanitizeHeaderForFirestore(patch.header),
        pagesHtml: cleanPages,
        dataPraca: clampStr(patch.dataPraca, 20),
        dataFinal: clampStr(patch.dataFinal, 20),
        structuredDocJson: safeStructuredJson,
        updatedAt: serverTimestamp(),
      });
    }

    try {
      await batch.commit();
      updatedCount += chunk.length;
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/alteracao_docs`);
    }
  }

  return updatedCount;
}

