import React, { useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  Calendar,
  ChevronRight,
  Cloud,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  Layers,
  Pencil,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import { SiscomAlert, SiscomModal, SiscomSpinner } from '../../shared/ui';
import {
  AlteracaoArchiveDocRecord,
  AlteracaoFolderRecord,
  BatchAlteracaoDocPatch,
  SaveAlteracaoDocInput,
  batchUpdateAlteracaoDocs,
  createAlteracaoFolder,
  deleteAlteracaoDoc,
  deleteAlteracaoFolderCascade,
  getDescendantFolderIds,
  moveAlteracaoDoc,
  moveAlteracaoFolder,
  parseStructuredDocJson,
  renameAlteracaoDoc,
  renameAlteracaoFolder,
  saveAlteracaoDoc,
  subscribeAlteracaoDocs,
  subscribeAlteracaoFolders,
} from './alteracaoArchiveService';
import {
  applyServiceTimeToPart2Lines,
  calculateServiceTime,
  formatPtBrDateLong,
  normalizeTimeValueStr,
} from './alteracaoFormatter';
import { applyPart2UpdatesSurgicallyToPages } from './alteracaoLiveReflow';
import { sanitizeAlteracaoHtml } from '../../shared/htmlSanitizer';

export interface AlteracaoArchivePanelProps {
  activeDocId: string | null;
  activeDocTitle: string;
  activeDocFolderId: string;
  suggestedTitle: string;
  getCurrentSnapshot: () => Omit<SaveAlteracaoDocInput, 'existingDocId' | 'folderId' | 'title'>;
  onOpenArchivedDoc: (doc: AlteracaoArchiveDocRecord) => void;
  onActiveDocChange: (info: { id: string | null; title: string; folderId: string }) => void;
  onBatchUpdatedDocs?: (updatedDocs: AlteracaoArchiveDocRecord[]) => void;
  onNotify: (msg: string) => void;
}

interface FolderOption {
  id: string;
  label: string;
  depth: number;
}

function buildFolderTreeOptions(
  folders: readonly AlteracaoFolderRecord[],
  excludeIds?: Set<string>
): FolderOption[] {
  const byParent = new Map<string, AlteracaoFolderRecord[]>();
  for (const f of folders) {
    if (excludeIds?.has(f.id)) continue;
    const list = byParent.get(f.parentId) ?? [];
    list.push(f);
    byParent.set(f.parentId, list);
  }
  const result: FolderOption[] = [{ id: '', label: 'Raiz (Arquivo Principal)', depth: 0 }];
  const visited = new Set<string>();

  const walk = (parentId: string, depth: number, prefix: string) => {
    const children = byParent.get(parentId) ?? [];
    for (const child of children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      const pathLabel = prefix ? `${prefix} / ${child.name}` : child.name;
      result.push({ id: child.id, label: pathLabel, depth });
      walk(child.id, depth + 1, pathLabel);
    }
  };
  walk('', 1, '');
  return result;
}

function getFolderBreadcrumb(
  folderId: string,
  foldersById: Map<string, AlteracaoFolderRecord>
): AlteracaoFolderRecord[] {
  const chain: AlteracaoFolderRecord[] = [];
  const visited = new Set<string>();
  let cur = folderId;
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    const f = foldersById.get(cur);
    if (!f) break;
    chain.unshift(f);
    cur = f.parentId;
  }
  return chain;
}

function formatShortDate(ms: number): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return '';
  }
}

export const AlteracaoArchivePanel: React.FC<AlteracaoArchivePanelProps> = ({
  activeDocId,
  activeDocTitle,
  activeDocFolderId,
  suggestedTitle,
  getCurrentSnapshot,
  onOpenArchivedDoc,
  onActiveDocChange,
  onBatchUpdatedDocs,
  onNotify,
}) => {
  const { firebaseUser } = useAuth();
  const uid = firebaseUser?.uid ?? null;

  const [folders, setFolders] = useState<AlteracaoFolderRecord[]>([]);
  const [docs, setDocs] = useState<AlteracaoArchiveDocRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  // Modals state
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveAsNew, setSaveAsNew] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveFolderId, setSaveFolderId] = useState('');
  const [inlineNewFolderName, setInlineNewFolderName] = useState('');
  const [showInlineNewFolder, setShowInlineNewFolder] = useState(false);

  const [folderModal, setFolderModal] = useState<
    | { mode: 'create'; parentId: string }
    | { mode: 'rename'; folder: AlteracaoFolderRecord }
    | { mode: 'move'; folder: AlteracaoFolderRecord }
    | { mode: 'delete'; folder: AlteracaoFolderRecord }
    | null
  >(null);
  const [folderNameInput, setFolderNameInput] = useState('');
  const [moveTargetFolderId, setMoveTargetFolderId] = useState('');

  const [docModal, setDocModal] = useState<
    | { mode: 'rename'; doc: AlteracaoArchiveDocRecord }
    | { mode: 'move'; doc: AlteracaoArchiveDocRecord }
    | { mode: 'delete'; doc: AlteracaoArchiveDocRecord }
    | null
  >(null);
  const [docTitleInput, setDocTitleInput] = useState('');

  // Batch edit modal state
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchFolderId, setBatchFolderId] = useState('');
  const [batchIncludeSubfolders, setBatchIncludeSubfolders] = useState(true);
  const [batchExcludedDocIds, setBatchExcludedDocIds] = useState<Set<string>>(new Set());
  const [batchApplyServiceTime, setBatchApplyServiceTime] = useState(false);
  const [batchTimeMode, setBatchTimeMode] = useState<'dates' | 'manual'>('dates');
  const [batchDataPraca, setBatchDataPraca] = useState('');
  const [batchDataFinal, setBatchDataFinal] = useState('');
  const [batchManualTime, setBatchManualTime] = useState('');
  const [batchApplyClosingDate, setBatchApplyClosingDate] = useState(false);
  const [batchClosingDateIso, setBatchClosingDateIso] = useState('');
  const [batchApplyHeader, setBatchApplyHeader] = useState(false);
  const [batchNomeGuerra, setBatchNomeGuerra] = useState('');
  const [batchQasQms, setBatchQasQms] = useState('');
  const [batchPostoGraduacao, setBatchPostoGraduacao] = useState('');
  const [batchNomeCompleto, setBatchNomeCompleto] = useState('');
  const [batchIdentidade, setBatchIdentidade] = useState('');
  const [batchSemestre, setBatchSemestre] = useState('');
  const [batchPeriodo, setBatchPeriodo] = useState('');
  const [batchGuarnicao, setBatchGuarnicao] = useState('');
  const [batchGeneroCont, setBatchGeneroCont] = useState<'keep' | 'auto' | 'do' | 'da'>('keep');
  const [batchError, setBatchError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) {
      setFolders([]);
      setDocs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setSyncError(null);
    let foldersReady = false;
    let docsReady = false;

    const markReady = () => {
      if (foldersReady && docsReady) setLoading(false);
    };

    const unsubFolders = subscribeAlteracaoFolders(
      uid,
      (list) => {
        setFolders(list);
        foldersReady = true;
        markReady();
      },
      () => {
        setSyncError('Não foi possível sincronizar as pastas desta conta.');
        foldersReady = true;
        markReady();
      }
    );

    const unsubDocs = subscribeAlteracaoDocs(
      uid,
      (list) => {
        setDocs(list);
        docsReady = true;
        markReady();
      },
      () => {
        setSyncError('Não foi possível sincronizar as alterações arquivadas.');
        docsReady = true;
        markReady();
      }
    );

    return () => {
      unsubFolders();
      unsubDocs();
    };
  }, [uid]);

  const foldersById = useMemo(() => {
    const map = new Map<string, AlteracaoFolderRecord>();
    for (const f of folders) map.set(f.id, f);
    return map;
  }, [folders]);

  // If current folder was deleted externally, step back to root safely
  useEffect(() => {
    if (currentFolderId && !foldersById.has(currentFolderId)) {
      setCurrentFolderId('');
    }
  }, [currentFolderId, foldersById]);

  const breadcrumbs = useMemo(
    () => getFolderBreadcrumb(currentFolderId, foldersById),
    [currentFolderId, foldersById]
  );

  const folderOptions = useMemo(() => buildFolderTreeOptions(folders), [folders]);

  const moveFolderOptions = useMemo(() => {
    if (folderModal?.mode !== 'move') return folderOptions;
    const blocked = getDescendantFolderIds(folderModal.folder.id, folders);
    return buildFolderTreeOptions(folders, blocked);
  }, [folderModal, folders, folderOptions]);

  const folderCounts = useMemo(() => {
    const subCount = new Map<string, number>();
    const docCount = new Map<string, number>();
    for (const f of folders) {
      if (f.parentId) subCount.set(f.parentId, (subCount.get(f.parentId) ?? 0) + 1);
    }
    for (const d of docs) {
      if (d.folderId) docCount.set(d.folderId, (docCount.get(d.folderId) ?? 0) + 1);
    }
    return { subCount, docCount };
  }, [folders, docs]);

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const visibleFolders = useMemo(() => {
    if (normalizedSearch) {
      return folders.filter((f) => f.name.toLowerCase().includes(normalizedSearch));
    }
    return folders.filter((f) => f.parentId === currentFolderId);
  }, [folders, currentFolderId, normalizedSearch]);

  const visibleDocs = useMemo(() => {
    if (normalizedSearch) {
      return docs.filter(
        (d) =>
          d.title.toLowerCase().includes(normalizedSearch) ||
          d.header.nomeCompleto.toLowerCase().includes(normalizedSearch) ||
          d.header.nomeGuerra.toLowerCase().includes(normalizedSearch) ||
          d.header.semestre.toLowerCase().includes(normalizedSearch)
      );
    }
    return docs.filter((d) => d.folderId === currentFolderId);
  }, [docs, currentFolderId, normalizedSearch]);

  const getFolderPathLabel = (folderId: string): string => {
    if (!folderId) return 'Raiz';
    const chain = getFolderBreadcrumb(folderId, foldersById);
    return chain.length > 0 ? chain.map((c) => c.name).join(' / ') : 'Raiz';
  };

  const openSaveModal = (asNew: boolean) => {
    setSaveAsNew(asNew);
    setSaveTitle(asNew ? suggestedTitle || activeDocTitle || 'Alteração' : activeDocTitle || suggestedTitle || 'Alteração');
    setSaveFolderId(activeDocId && !asNew ? activeDocFolderId : currentFolderId);
    setShowInlineNewFolder(false);
    setInlineNewFolderName('');
    setShowSaveModal(true);
  };

  const handleQuickSaveActive = async () => {
    if (!uid || !activeDocId) {
      openSaveModal(false);
      return;
    }
    setIsBusy(true);
    try {
      const snapshot = getCurrentSnapshot();
      await saveAlteracaoDoc(uid, {
        ...snapshot,
        existingDocId: activeDocId,
        folderId: activeDocFolderId,
        title: activeDocTitle || suggestedTitle || 'Alteração',
      });
      onNotify('Alteração salva na nuvem.');
    } catch {
      setSyncError('Erro ao salvar alteração na conta.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleConfirmSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid) return;
    const cleanTitle = saveTitle.trim();
    if (!cleanTitle) return;

    setIsBusy(true);
    setSyncError(null);
    try {
      const snapshot = getCurrentSnapshot();
      const targetId = saveAsNew ? null : activeDocId;
      const savedId = await saveAlteracaoDoc(uid, {
        ...snapshot,
        existingDocId: targetId,
        folderId: saveFolderId,
        title: cleanTitle,
      });
      onActiveDocChange({ id: savedId, title: cleanTitle, folderId: saveFolderId });
      setCurrentFolderId(saveFolderId);
      setShowSaveModal(false);
      onNotify(`Arquivada em "${getFolderPathLabel(saveFolderId)}".`);
    } catch {
      setSyncError('Não foi possível arquivar esta alteração.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleInlineCreateFolderInSaveModal = async () => {
    if (!uid) return;
    const clean = inlineNewFolderName.trim();
    if (!clean) return;
    setIsBusy(true);
    try {
      const newId = await createAlteracaoFolder(uid, clean, saveFolderId);
      setSaveFolderId(newId);
      setInlineNewFolderName('');
      setShowInlineNewFolder(false);
    } catch {
      setSyncError('Não foi possível criar a pasta.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleConfirmFolderModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid || !folderModal) return;
    setIsBusy(true);
    setSyncError(null);
    try {
      if (folderModal.mode === 'create') {
        const clean = folderNameInput.trim();
        if (!clean) return;
        await createAlteracaoFolder(uid, clean, folderModal.parentId);
        onNotify(`Pasta "${clean}" criada.`);
      } else if (folderModal.mode === 'rename') {
        const clean = folderNameInput.trim();
        if (!clean) return;
        await renameAlteracaoFolder(uid, folderModal.folder.id, clean);
        onNotify('Pasta renomeada.');
      } else if (folderModal.mode === 'move') {
        await moveAlteracaoFolder(uid, folderModal.folder.id, moveTargetFolderId, folders);
        onNotify('Pasta movida.');
      } else if (folderModal.mode === 'delete') {
        const deletedIds = getDescendantFolderIds(folderModal.folder.id, folders);
        await deleteAlteracaoFolderCascade(uid, folderModal.folder.id, folders, docs);
        if (activeDocId && activeDocFolderId && deletedIds.has(activeDocFolderId)) {
          onActiveDocChange({ id: null, title: '', folderId: '' });
        }
        if (currentFolderId && deletedIds.has(currentFolderId)) {
          setCurrentFolderId(folderModal.folder.parentId || '');
        }
        onNotify(`Pasta "${folderModal.folder.name}" removida.`);
      }
      setFolderModal(null);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Erro ao atualizar pasta.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleConfirmDocModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid || !docModal) return;
    setIsBusy(true);
    setSyncError(null);
    try {
      if (docModal.mode === 'rename') {
        const clean = docTitleInput.trim();
        if (!clean) return;
        await renameAlteracaoDoc(uid, docModal.doc.id, clean);
        if (activeDocId === docModal.doc.id) {
          onActiveDocChange({ id: docModal.doc.id, title: clean, folderId: docModal.doc.folderId });
        }
        onNotify('Alteração renomeada.');
      } else if (docModal.mode === 'move') {
        await moveAlteracaoDoc(uid, docModal.doc.id, moveTargetFolderId);
        if (activeDocId === docModal.doc.id) {
          onActiveDocChange({
            id: docModal.doc.id,
            title: docModal.doc.title,
            folderId: moveTargetFolderId,
          });
        }
        onNotify(`Movida para "${getFolderPathLabel(moveTargetFolderId)}".`);
      } else if (docModal.mode === 'delete') {
        await deleteAlteracaoDoc(uid, docModal.doc.id);
        if (activeDocId === docModal.doc.id) {
          onActiveDocChange({ id: null, title: '', folderId: '' });
        }
        onNotify('Alteração excluída do arquivo.');
      }
      setDocModal(null);
    } catch {
      setSyncError('Erro ao atualizar alteração arquivada.');
    } finally {
      setIsBusy(false);
    }
  };

  const deleteFolderStats = useMemo(() => {
    if (folderModal?.mode !== 'delete') return { subfolders: 0, docs: 0 };
    const descendants = getDescendantFolderIds(folderModal.folder.id, folders);
    const docsInside = docs.filter((d) => d.folderId && descendants.has(d.folderId)).length;
    return { subfolders: Math.max(0, descendants.size - 1), docs: docsInside };
  }, [folderModal, folders, docs]);

  const batchTargetDocs = useMemo(() => {
    if (!showBatchModal) return [];
    if (batchFolderId === '') {
      if (batchIncludeSubfolders) return docs;
      return docs.filter((d) => d.folderId === '');
    }
    const allowedFolders = batchIncludeSubfolders
      ? getDescendantFolderIds(batchFolderId, folders)
      : new Set<string>([batchFolderId]);
    return docs.filter((d) => allowedFolders.has(d.folderId));
  }, [showBatchModal, batchFolderId, batchIncludeSubfolders, docs, folders]);

  const batchSelectedDocs = useMemo(
    () => batchTargetDocs.filter((d) => !batchExcludedDocIds.has(d.id)),
    [batchTargetDocs, batchExcludedDocIds]
  );

  const batchCalculatedServiceTime = useMemo(
    () => calculateServiceTime(batchDataPraca, batchDataFinal),
    [batchDataPraca, batchDataFinal]
  );

  const batchResolvedServiceTime = useMemo(() => {
    if (!batchApplyServiceTime) return '';
    if (batchTimeMode === 'dates') {
      return batchCalculatedServiceTime?.formatted || '';
    }
    const clean = batchManualTime.trim();
    if (!/^\d{1,2}\s*a\s*\d{1,2}\s*m\s*\d{1,2}\s*d$/i.test(clean)) return '';
    return normalizeTimeValueStr(clean);
  }, [batchApplyServiceTime, batchTimeMode, batchCalculatedServiceTime, batchManualTime]);

  const batchClosingDatePtBr = useMemo(
    () => (batchApplyClosingDate && batchClosingDateIso ? formatPtBrDateLong(batchClosingDateIso) : ''),
    [batchApplyClosingDate, batchClosingDateIso]
  );

  const openBatchEditModal = (targetFolderId: string) => {
    setBatchFolderId(targetFolderId);
    setBatchIncludeSubfolders(true);
    setBatchExcludedDocIds(new Set());
    setBatchApplyServiceTime(false);
    setBatchTimeMode('dates');
    setBatchDataPraca('');
    setBatchDataFinal('');
    setBatchManualTime('');
    setBatchApplyClosingDate(false);
    setBatchClosingDateIso('');
    setBatchApplyHeader(false);
    setBatchNomeGuerra('');
    setBatchQasQms('');
    setBatchPostoGraduacao('');
    setBatchNomeCompleto('');
    setBatchIdentidade('');
    setBatchSemestre('');
    setBatchPeriodo('');
    setBatchGuarnicao('');
    setBatchGeneroCont('keep');
    setBatchError(null);
    setShowBatchModal(true);
  };

  const handleConfirmBatchEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid) return;
    setBatchError(null);

    if (batchSelectedDocs.length === 0) {
      setBatchError('Selecione pelo menos uma alteração para editar em lote.');
      return;
    }

    const hasHeaderChange =
      batchApplyHeader &&
      (batchNomeGuerra.trim() !== '' ||
        batchQasQms.trim() !== '' ||
        batchPostoGraduacao.trim() !== '' ||
        batchNomeCompleto.trim() !== '' ||
        batchIdentidade.trim() !== '' ||
        batchSemestre.trim() !== '' ||
        batchPeriodo.trim() !== '' ||
        batchGuarnicao.trim() !== '' ||
        batchGeneroCont !== 'keep');

    if (batchApplyServiceTime && !batchResolvedServiceTime) {
      setBatchError(
        batchTimeMode === 'dates'
          ? 'Informe Data de praça e Data final válidas para o Tempo de Serviço.'
          : 'Informe o tempo no formato "XX a XX m XX d" (ex.: 08 a 04 m 12 d).'
      );
      return;
    }

    if (batchApplyClosingDate && !batchClosingDatePtBr) {
      setBatchError('Informe uma data válida para o fecho da 2ª Parte.');
      return;
    }

    if (!batchApplyServiceTime && !batchApplyClosingDate && !hasHeaderChange) {
      setBatchError('Marque e preencha pelo menos uma alteração para aplicar em lote.');
      return;
    }

    setIsBusy(true);
    try {
      const patches: BatchAlteracaoDocPatch[] = [];
      const updatedRecords: AlteracaoArchiveDocRecord[] = [];

      for (const docItem of batchSelectedDocs) {
        const nextHeader = { ...docItem.header };
        if (hasHeaderChange) {
          if (batchNomeGuerra.trim()) nextHeader.nomeGuerra = batchNomeGuerra.trim();
          if (batchQasQms.trim()) nextHeader.qasQms = batchQasQms.trim();
          if (batchPostoGraduacao.trim()) nextHeader.postoGraduacao = batchPostoGraduacao.trim();
          if (batchNomeCompleto.trim()) nextHeader.nomeCompleto = batchNomeCompleto.trim();
          if (batchIdentidade.trim()) nextHeader.identidade = batchIdentidade.trim();
          if (batchSemestre.trim()) nextHeader.semestre = batchSemestre.trim();
          if (batchPeriodo.trim()) nextHeader.periodo = batchPeriodo.trim();
          if (batchGuarnicao.trim()) nextHeader.guarnicao = batchGuarnicao.trim();
          if (batchGeneroCont !== 'keep') nextHeader.generoCont = batchGeneroCont;
        }

        let nextPagesHtml = docItem.pagesHtml;
        let nextDataPraca = docItem.dataPraca;
        let nextDataFinal = docItem.dataFinal;
        let nextStructuredDocJson = docItem.structuredDocJson;

        if (batchApplyServiceTime || batchApplyClosingDate) {
          const surgical = applyPart2UpdatesSurgicallyToPages({
            livePagesHtml: docItem.pagesHtml,
            serviceTimeFormatted: batchApplyServiceTime ? batchResolvedServiceTime : undefined,
            closingDatePtBr: batchApplyClosingDate ? batchClosingDatePtBr : undefined,
            guarnicao: nextHeader.guarnicao,
          });
          nextPagesHtml = surgical.pagesHtml.map((p) => sanitizeAlteracaoHtml(p));

          if (batchApplyServiceTime && batchTimeMode === 'dates') {
            if (batchDataPraca) nextDataPraca = batchDataPraca;
            if (batchDataFinal) nextDataFinal = batchDataFinal;
          } else if (batchApplyClosingDate && batchClosingDateIso) {
            nextDataFinal = batchClosingDateIso;
          }
        }

        const parsedStructured = parseStructuredDocJson(docItem.structuredDocJson);
        if (parsedStructured) {
          const nextStructured = {
            ...parsedStructured,
            extractedHeader: {
              ...parsedStructured.extractedHeader,
              ...(hasHeaderChange
                ? {
                    ...(batchNomeGuerra.trim() ? { nomeGuerra: batchNomeGuerra.trim() } : {}),
                    ...(batchQasQms.trim() ? { qasQms: batchQasQms.trim() } : {}),
                    ...(batchPostoGraduacao.trim()
                      ? { postoGraduacao: batchPostoGraduacao.trim() }
                      : {}),
                    ...(batchNomeCompleto.trim()
                      ? { nomeCompleto: batchNomeCompleto.trim() }
                      : {}),
                    ...(batchIdentidade.trim() ? { identidade: batchIdentidade.trim() } : {}),
                    ...(batchSemestre.trim() ? { semestre: batchSemestre.trim() } : {}),
                    ...(batchPeriodo.trim() ? { periodo: batchPeriodo.trim() } : {}),
                    ...(batchGuarnicao.trim() ? { guarnicao: batchGuarnicao.trim() } : {}),
                  }
                : {}),
            },
            part2Lines:
              batchApplyServiceTime || batchApplyClosingDate
                ? applyServiceTimeToPart2Lines(
                    parsedStructured.part2Lines,
                    batchApplyServiceTime ? batchResolvedServiceTime : '',
                    {
                      datePtBr: batchApplyClosingDate ? batchClosingDatePtBr : undefined,
                      guarnicao: nextHeader.guarnicao,
                      updateClosingDate: batchApplyClosingDate,
                    }
                  )
                : parsedStructured.part2Lines,
          };
          try {
            nextStructuredDocJson = JSON.stringify(nextStructured);
          } catch {
            // Keep existing JSON if serialization fails
          }
        }

        patches.push({
          id: docItem.id,
          header: nextHeader,
          pagesHtml: nextPagesHtml,
          dataPraca: nextDataPraca,
          dataFinal: nextDataFinal,
          structuredDocJson: nextStructuredDocJson,
        });

        updatedRecords.push({
          ...docItem,
          header: nextHeader,
          pagesHtml: nextPagesHtml,
          dataPraca: nextDataPraca,
          dataFinal: nextDataFinal,
          structuredDocJson: nextStructuredDocJson,
        });
      }

      const count = await batchUpdateAlteracaoDocs(uid, patches);
      setShowBatchModal(false);
      onBatchUpdatedDocs?.(updatedRecords);
      onNotify(
        `${count} alteraç${count === 1 ? 'ão atualizada' : 'ões atualizadas'} em lote com sucesso.`
      );
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : 'Erro ao aplicar edição em lote.');
    } finally {
      setIsBusy(false);
    }
  };

  if (!uid) return null;

  return (
    <div className="space-y-3 pb-4 border-b border-white/[0.07]">
      {/* Header & Quick Save Actions */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Cloud className="w-4 h-4 text-[#E5C17B] shrink-0" />
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#C8A461] truncate">
            Arquivo da Conta
          </h3>
        </div>
        <span className="text-[10px] font-mono text-[#7C8F84] shrink-0">
          {docs.length} arq.
        </span>
      </div>

      {activeDocId ? (
        <div className="rounded-lg border border-[#C8A461]/35 bg-[#C8A461]/[0.07] p-2.5 space-y-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.1em] text-[#C8A461]">
              Editando arquivada • {getFolderPathLabel(activeDocFolderId)}
            </div>
            <div className="text-xs font-semibold text-[#F4E6C4] truncate mt-0.5">
              {activeDocTitle}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={handleQuickSaveActive}
              className="siscom-btn siscom-btn-primary min-h-[38px] px-2.5 text-xs"
            >
              {isBusy ? <SiscomSpinner className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              <span>Salvar</span>
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => openSaveModal(true)}
              className="siscom-btn siscom-btn-secondary min-h-[38px] px-2.5 text-xs"
            >
              <FolderInput className="w-3.5 h-3.5" />
              <span>Salvar como</span>
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={isBusy}
          onClick={() => openSaveModal(false)}
          className="siscom-btn siscom-btn-gold w-full min-h-[40px] px-3 text-xs"
        >
          <Save className="w-3.5 h-3.5 text-[#E5C17B]" />
          <span>Arquivar Alteração em Pasta</span>
        </button>
      )}

      {syncError && (
        <SiscomAlert tone="error" onDismiss={() => setSyncError(null)}>
          {syncError}
        </SiscomAlert>
      )}

      {/* Search + New Folder bar */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1 min-w-0">
          <Search className="w-3.5 h-3.5 text-[#7C8F84] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar pasta ou alteração..."
            className="siscom-input h-9 pl-8 pr-2.5 text-xs"
          />
        </div>
        <button
          type="button"
          disabled={isBusy || docs.length === 0}
          title="Editar várias alterações de uma pasta de uma vez"
          onClick={() => openBatchEditModal(currentFolderId)}
          className="siscom-btn siscom-btn-secondary h-9 px-2.5 text-xs shrink-0"
        >
          <Layers className="w-3.5 h-3.5 text-[#83B499]" />
          <span className="hidden sm:inline">Lote</span>
        </button>
        <button
          type="button"
          disabled={isBusy}
          title={currentFolderId ? 'Nova subpasta aqui' : 'Nova pasta'}
          onClick={() => {
            setFolderNameInput('');
            setFolderModal({ mode: 'create', parentId: currentFolderId });
          }}
          className="siscom-btn siscom-btn-secondary h-9 px-2.5 text-xs shrink-0"
        >
          <FolderPlus className="w-3.5 h-3.5 text-[#E5C17B]" />
          <span className="hidden sm:inline">{currentFolderId ? 'Subpasta' : 'Pasta'}</span>
        </button>
      </div>

      {/* Breadcrumbs */}
      {!normalizedSearch && (
        <div className="flex items-center flex-wrap gap-1 text-[11px] text-[#98A89F]">
          <button
            type="button"
            onClick={() => setCurrentFolderId('')}
            className={`px-1.5 py-0.5 rounded transition-colors ${
              currentFolderId === ''
                ? 'text-[#F4E6C4] font-semibold bg-white/[0.06]'
                : 'hover:text-[#E4EAE6] hover:bg-white/[0.04]'
            }`}
          >
            Raiz
          </button>
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <React.Fragment key={crumb.id}>
                <ChevronRight className="w-3 h-3 text-[#65756C] shrink-0" />
                <button
                  type="button"
                  onClick={() => setCurrentFolderId(crumb.id)}
                  className={`px-1.5 py-0.5 rounded truncate max-w-[140px] transition-colors ${
                    isLast
                      ? 'text-[#F4E6C4] font-semibold bg-white/[0.06]'
                      : 'hover:text-[#E4EAE6] hover:bg-white/[0.04]'
                  }`}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* Folder & Document List */}
      <div className="siscom-liquid-subcard rounded-lg divide-y divide-white/[0.06] max-h-64 overflow-y-auto">
        {loading ? (
          <div className="py-5 flex items-center justify-center gap-2 text-xs text-[#98A89F]">
            <SiscomSpinner tone="gold" className="w-4 h-4" />
            <span>Sincronizando arquivo...</span>
          </div>
        ) : visibleFolders.length === 0 && visibleDocs.length === 0 ? (
          <div className="px-3 py-5 text-center">
            <p className="text-xs text-[#98A89F]">
              {normalizedSearch
                ? 'Nenhum resultado.'
                : currentFolderId
                  ? 'Pasta vazia.'
                  : 'Nenhuma alteração arquivada.'}
            </p>
          </div>
        ) : (
          <>
            {visibleFolders.map((folder) => {
              const subN = folderCounts.subCount.get(folder.id) ?? 0;
              const docN = folderCounts.docCount.get(folder.id) ?? 0;
              return (
                <div
                  key={folder.id}
                  className="flex items-center gap-1.5 px-2.5 py-2 hover:bg-white/[0.04] transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setCurrentFolderId(folder.id);
                    }}
                    className="flex-1 min-w-0 flex items-center gap-2 text-left min-h-[34px] cursor-pointer"
                  >
                    <Folder className="w-4 h-4 text-[#E5C17B] shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-[#E4EAE6] truncate">
                        {folder.name}
                      </div>
                      <div className="text-[10px] text-[#7C8F84] truncate">
                        {normalizedSearch
                          ? getFolderPathLabel(folder.parentId)
                          : `${subN > 0 ? `${subN} subpasta${subN > 1 ? 's' : ''} • ` : ''}${docN} alteraç${docN === 1 ? 'ão' : 'ões'}`}
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      title="Editar alterações desta pasta em lote"
                      onClick={() => openBatchEditModal(folder.id)}
                      className="h-8 w-8 inline-flex items-center justify-center rounded-md text-[#83B499] hover:text-[#F4E6C4] hover:bg-white/[0.07] transition-colors"
                    >
                      <Layers className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Renomear pasta"
                      onClick={() => {
                        setFolderNameInput(folder.name);
                        setFolderModal({ mode: 'rename', folder });
                      }}
                      className="h-8 w-8 inline-flex items-center justify-center rounded-md text-[#98A89F] hover:text-[#E4EAE6] hover:bg-white/[0.07] transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Mover pasta"
                      onClick={() => {
                        setMoveTargetFolderId(folder.parentId);
                        setFolderModal({ mode: 'move', folder });
                      }}
                      className="h-8 w-8 inline-flex items-center justify-center rounded-md text-[#98A89F] hover:text-[#E4EAE6] hover:bg-white/[0.07] transition-colors"
                    >
                      <FolderInput className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Excluir pasta"
                      onClick={() => setFolderModal({ mode: 'delete', folder })}
                      className="h-8 w-8 inline-flex items-center justify-center rounded-md text-[#98A89F] hover:text-red-300 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}

            {visibleDocs.map((docItem) => {
              const isActive = activeDocId === docItem.id;
              return (
                <div
                  key={docItem.id}
                  className={`flex items-center gap-1.5 px-2.5 py-2 transition-colors ${
                    isActive ? 'bg-[#2D5A43]/22' : 'hover:bg-white/[0.04]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onOpenArchivedDoc(docItem)}
                    className="flex-1 min-w-0 flex items-center gap-2 text-left min-h-[34px] cursor-pointer"
                  >
                    <FileText
                      className={`w-4 h-4 shrink-0 ${
                        isActive ? 'text-[#83B499]' : 'text-[#98A89F]'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-xs font-medium truncate ${
                          isActive ? 'text-[#F4E6C4]' : 'text-[#E4EAE6]'
                        }`}
                      >
                        {docItem.title}
                      </div>
                      <div className="text-[10px] text-[#7C8F84] truncate">
                        {normalizedSearch
                          ? `${getFolderPathLabel(docItem.folderId)} • `
                          : ''}
                        {docItem.pagesHtml.length} fls
                        {docItem.updatedAtMs ? ` • ${formatShortDate(docItem.updatedAtMs)}` : ''}
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      title="Renomear alteração"
                      onClick={() => {
                        setDocTitleInput(docItem.title);
                        setDocModal({ mode: 'rename', doc: docItem });
                      }}
                      className="h-8 w-8 inline-flex items-center justify-center rounded-md text-[#98A89F] hover:text-[#E4EAE6] hover:bg-white/[0.07] transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Mover para outra pasta"
                      onClick={() => {
                        setMoveTargetFolderId(docItem.folderId);
                        setDocModal({ mode: 'move', doc: docItem });
                      }}
                      className="h-8 w-8 inline-flex items-center justify-center rounded-md text-[#98A89F] hover:text-[#E4EAE6] hover:bg-white/[0.07] transition-colors"
                    >
                      <FolderInput className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Excluir alteração"
                      onClick={() => setDocModal({ mode: 'delete', doc: docItem })}
                      className="h-8 w-8 inline-flex items-center justify-center rounded-md text-[#98A89F] hover:text-red-300 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Modal: Save / Archive Alteração */}
      <SiscomModal
        open={showSaveModal}
        onClose={() => !isBusy && setShowSaveModal(false)}
        title={saveAsNew ? 'Salvar Cópia no Arquivo' : 'Arquivar Alteração na Conta'}
      >
        <form onSubmit={handleConfirmSaveModal} className="space-y-4">
          <div className="space-y-1.5">
            <label className="siscom-label">Nome da Alteração</label>
            <input
              type="text"
              required
              maxLength={160}
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              placeholder="Ex.: 3º Sgt Silva — 1º Semestre 2022"
              className="siscom-input"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="siscom-label mb-0">Pasta / Subpasta de destino</label>
              <button
                type="button"
                onClick={() => setShowInlineNewFolder((v) => !v)}
                className="text-[11px] text-[#E5C17B] hover:underline inline-flex items-center gap-1"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>Nova subpasta</span>
              </button>
            </div>
            <select
              value={saveFolderId}
              onChange={(e) => setSaveFolderId(e.target.value)}
              className="siscom-select"
            >
              {folderOptions.map((opt) => (
                <option key={opt.id || '__root__'} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {showInlineNewFolder && (
            <div className="siscom-liquid-subcard rounded-lg p-3 space-y-2">
              <div className="text-[11px] text-[#98A89F]">
                Criar dentro de:{' '}
                <span className="text-[#F4E6C4] font-medium">
                  {getFolderPathLabel(saveFolderId)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={80}
                  value={inlineNewFolderName}
                  onChange={(e) => setInlineNewFolderName(e.target.value)}
                  placeholder="Nome da pasta ou subpasta"
                  className="siscom-input h-9 text-xs flex-1"
                />
                <button
                  type="button"
                  disabled={isBusy || !inlineNewFolderName.trim()}
                  onClick={handleInlineCreateFolderInSaveModal}
                  className="siscom-btn siscom-btn-gold h-9 px-3 text-xs shrink-0"
                >
                  Criar
                </button>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setShowSaveModal(false)}
              className="siscom-btn siscom-btn-secondary min-h-[40px] px-4 text-xs"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isBusy || !saveTitle.trim()}
              className="siscom-btn siscom-btn-primary min-h-[40px] px-4 text-xs"
            >
              {isBusy ? <SiscomSpinner className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              <span>Salvar na Conta</span>
            </button>
          </div>
        </form>
      </SiscomModal>

      {/* Modal: Folder Actions (Create / Rename / Move / Delete) */}
      <SiscomModal
        open={Boolean(folderModal)}
        onClose={() => !isBusy && setFolderModal(null)}
        title={
          folderModal?.mode === 'create'
            ? folderModal.parentId
              ? 'Nova Subpasta'
              : 'Nova Pasta'
            : folderModal?.mode === 'rename'
              ? 'Renomear Pasta'
              : folderModal?.mode === 'move'
                ? 'Mover Pasta'
                : 'Excluir Pasta'
        }
      >
        {folderModal && (
          <form onSubmit={handleConfirmFolderModal} className="space-y-4">
            {(folderModal.mode === 'create' || folderModal.mode === 'rename') && (
              <div className="space-y-1.5">
                {folderModal.mode === 'create' && (
                  <p className="text-xs text-[#98A89F]">
                    Local:{' '}
                    <span className="text-[#F4E6C4] font-medium">
                      {getFolderPathLabel(folderModal.parentId)}
                    </span>
                  </p>
                )}
                <label className="siscom-label">Nome da Pasta</label>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={folderNameInput}
                  onChange={(e) => setFolderNameInput(e.target.value)}
                  placeholder="Ex.: 2022, 1º Semestre, Pelotão..."
                  className="siscom-input"
                  autoFocus
                />
              </div>
            )}

            {folderModal.mode === 'move' && (
              <div className="space-y-1.5">
                <p className="text-xs text-[#98A89F]">
                  Mover <strong className="text-[#F4E6C4]">{folderModal.folder.name}</strong> para:
                </p>
                <select
                  value={moveTargetFolderId}
                  onChange={(e) => setMoveTargetFolderId(e.target.value)}
                  className="siscom-select"
                >
                  {moveFolderOptions.map((opt) => (
                    <option key={opt.id || '__root__'} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {folderModal.mode === 'delete' && (
              <div className="space-y-2.5 text-xs text-[#C6D4CC]">
                <p>
                  Deseja excluir a pasta{' '}
                  <strong className="text-[#F4E6C4]">{folderModal.folder.name}</strong>?
                </p>
                {(deleteFolderStats.subfolders > 0 || deleteFolderStats.docs > 0) && (
                  <SiscomAlert tone="warning">
                    Esta ação também excluirá{' '}
                    {deleteFolderStats.subfolders > 0
                      ? `${deleteFolderStats.subfolders} subpasta${deleteFolderStats.subfolders > 1 ? 's' : ''}`
                      : ''}
                    {deleteFolderStats.subfolders > 0 && deleteFolderStats.docs > 0 ? ' e ' : ''}
                    {deleteFolderStats.docs > 0
                      ? `${deleteFolderStats.docs} alteraç${deleteFolderStats.docs === 1 ? 'ão' : 'ões'} arquivada${deleteFolderStats.docs === 1 ? '' : 's'}`
                      : ''}
                    .
                  </SiscomAlert>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => setFolderModal(null)}
                className="siscom-btn siscom-btn-secondary min-h-[40px] px-4 text-xs"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={
                  isBusy ||
                  ((folderModal.mode === 'create' || folderModal.mode === 'rename') &&
                    !folderNameInput.trim())
                }
                className={`siscom-btn min-h-[40px] px-4 text-xs ${
                  folderModal.mode === 'delete' ? 'siscom-btn-danger' : 'siscom-btn-primary'
                }`}
              >
                {isBusy && <SiscomSpinner className="w-4 h-4" />}
                <span>
                  {folderModal.mode === 'create'
                    ? 'Criar Pasta'
                    : folderModal.mode === 'rename'
                      ? 'Salvar Nome'
                      : folderModal.mode === 'move'
                        ? 'Mover'
                        : 'Excluir'}
                </span>
              </button>
            </div>
          </form>
        )}
      </SiscomModal>

      {/* Modal: Archived Doc Actions (Rename / Move / Delete) */}
      <SiscomModal
        open={Boolean(docModal)}
        onClose={() => !isBusy && setDocModal(null)}
        title={
          docModal?.mode === 'rename'
            ? 'Renomear Alteração'
            : docModal?.mode === 'move'
              ? 'Mover Alteração'
              : 'Excluir Alteração'
        }
      >
        {docModal && (
          <form onSubmit={handleConfirmDocModal} className="space-y-4">
            {docModal.mode === 'rename' && (
              <div className="space-y-1.5">
                <label className="siscom-label">Novo Título</label>
                <input
                  type="text"
                  required
                  maxLength={160}
                  value={docTitleInput}
                  onChange={(e) => setDocTitleInput(e.target.value)}
                  className="siscom-input"
                  autoFocus
                />
              </div>
            )}

            {docModal.mode === 'move' && (
              <div className="space-y-1.5">
                <p className="text-xs text-[#98A89F]">
                  Mover <strong className="text-[#F4E6C4]">{docModal.doc.title}</strong> para:
                </p>
                <select
                  value={moveTargetFolderId}
                  onChange={(e) => setMoveTargetFolderId(e.target.value)}
                  className="siscom-select"
                >
                  {folderOptions.map((opt) => (
                    <option key={opt.id || '__root__'} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {docModal.mode === 'delete' && (
              <p className="text-xs text-[#C6D4CC]">
                Excluir permanentemente{' '}
                <strong className="text-[#F4E6C4]">{docModal.doc.title}</strong> do arquivo da sua
                conta?
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => setDocModal(null)}
                className="siscom-btn siscom-btn-secondary min-h-[40px] px-4 text-xs"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isBusy || (docModal.mode === 'rename' && !docTitleInput.trim())}
                className={`siscom-btn min-h-[40px] px-4 text-xs ${
                  docModal.mode === 'delete' ? 'siscom-btn-danger' : 'siscom-btn-primary'
                }`}
              >
                {isBusy && <SiscomSpinner className="w-4 h-4" />}
                <span>
                  {docModal.mode === 'rename'
                    ? 'Salvar Título'
                    : docModal.mode === 'move'
                      ? 'Mover'
                      : 'Excluir'}
                </span>
              </button>
            </div>
          </form>
        )}
      </SiscomModal>

      {/* Modal: Batch Edit Alterations in Folder */}
      <SiscomModal
        open={showBatchModal}
        onClose={() => !isBusy && setShowBatchModal(false)}
        title="Editar Alterações em Lote"
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={handleConfirmBatchEdit} className="space-y-4">
          {batchError && (
            <SiscomAlert tone="error" onDismiss={() => setBatchError(null)}>
              {batchError}
            </SiscomAlert>
          )}

          {/* Pasta alvo + documentos */}
          <div className="space-y-2">
            <label className="siscom-label">Pasta de destino</label>
            <select
              value={batchFolderId}
              onChange={(e) => {
                setBatchFolderId(e.target.value);
                setBatchExcludedDocIds(new Set());
              }}
              className="siscom-select"
            >
              {folderOptions.map((opt) => (
                <option key={opt.id || 'root'} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>

            <div className="flex items-center justify-between gap-2 text-xs">
              <label className="inline-flex items-center gap-2 text-[#C6D4CC] cursor-pointer">
                <input
                  type="checkbox"
                  checked={batchIncludeSubfolders}
                  onChange={(e) => {
                    setBatchIncludeSubfolders(e.target.checked);
                    setBatchExcludedDocIds(new Set());
                  }}
                  className="h-4 w-4 accent-[#C8A461] cursor-pointer"
                />
                <span>Incluir subpastas</span>
              </label>
              <span className="font-mono text-[11px] text-[#E5C17B]">
                {batchSelectedDocs.length}/{batchTargetDocs.length} selecionada
                {batchSelectedDocs.length === 1 ? '' : 's'}
              </span>
            </div>

            {batchTargetDocs.length > 0 ? (
              <details className="rounded-lg border border-white/[0.08] bg-[#0A110E]/45 p-2.5">
                <summary className="cursor-pointer text-[11px] text-[#B8C6BE] hover:text-white select-none">
                  Escolher quais alterações incluir ({batchSelectedDocs.length} de{' '}
                  {batchTargetDocs.length})
                </summary>
                <div className="mt-2 max-h-32 overflow-y-auto space-y-1 pr-1">
                  {batchTargetDocs.map((d) => {
                    const checked = !batchExcludedDocIds.has(d.id);
                    return (
                      <label
                        key={d.id}
                        className="flex items-center gap-2 text-xs text-[#D4DFD9] py-0.5 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setBatchExcludedDocIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(d.id)) next.delete(d.id);
                              else next.add(d.id);
                              return next;
                            })
                          }
                          className="h-3.5 w-3.5 accent-[#2D5A43] cursor-pointer"
                        />
                        <span className="truncate">{d.title}</span>
                      </label>
                    );
                  })}
                </div>
              </details>
            ) : (
              <p className="text-xs text-[#98A89F] rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                Nenhuma alteração arquivada encontrada nesta pasta.
              </p>
            )}
          </div>

          {/* 1. Tempo de Serviço (2ª Parte) */}
          <div className="rounded-lg border border-white/[0.09] bg-[#0C1410]/60 p-3 space-y-2.5">
            <label className="flex items-center justify-between gap-2 cursor-pointer">
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#F4E6C4]">
                <input
                  type="checkbox"
                  checked={batchApplyServiceTime}
                  onChange={(e) => setBatchApplyServiceTime(e.target.checked)}
                  className="h-4 w-4 accent-[#C8A461] cursor-pointer"
                />
                <Calculator className="w-3.5 h-3.5 text-[#E5C17B]" />
                <span>Alterar Tempo de Serviço (2ª Parte)</span>
              </span>
              {batchApplyServiceTime && batchResolvedServiceTime && (
                <span className="font-mono text-[11px] font-semibold text-[#E5C17B]">
                  {batchResolvedServiceTime}
                </span>
              )}
            </label>

            {batchApplyServiceTime && (
              <div className="space-y-2.5 pt-1">
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setBatchTimeMode('dates')}
                    className={`siscom-btn !min-h-[34px] text-[11px] ${
                      batchTimeMode === 'dates' ? 'siscom-btn-primary' : 'siscom-btn-secondary'
                    }`}
                  >
                    Calcular por datas
                  </button>
                  <button
                    type="button"
                    onClick={() => setBatchTimeMode('manual')}
                    className={`siscom-btn !min-h-[34px] text-[11px] ${
                      batchTimeMode === 'manual' ? 'siscom-btn-primary' : 'siscom-btn-secondary'
                    }`}
                  >
                    Digitar tempo
                  </button>
                </div>

                {batchTimeMode === 'dates' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="block space-y-1">
                      <span className="block text-[11px] text-[#98A89F]">Data de praça</span>
                      <input
                        type="date"
                        value={batchDataPraca}
                        onChange={(e) => setBatchDataPraca(e.target.value)}
                        className="siscom-input !min-h-[36px] text-xs"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="block text-[11px] text-[#98A89F]">Data final</span>
                      <input
                        type="date"
                        value={batchDataFinal}
                        onChange={(e) => setBatchDataFinal(e.target.value)}
                        className="siscom-input !min-h-[36px] text-xs"
                      />
                    </label>
                  </div>
                ) : (
                  <label className="block space-y-1">
                    <span className="block text-[11px] text-[#98A89F]">
                      Tempo formatado (anos, meses e dias)
                    </span>
                    <input
                      type="text"
                      value={batchManualTime}
                      onChange={(e) => setBatchManualTime(e.target.value)}
                      placeholder="Ex.: 08 a 04 m 12 d"
                      className="siscom-input !min-h-[36px] font-mono text-xs"
                    />
                  </label>
                )}

              </div>
            )}
          </div>

          {/* 2. Data do Fecho / Documento na 2ª Parte */}
          <div className="rounded-lg border border-white/[0.09] bg-[#0C1410]/60 p-3 space-y-2.5">
            <label className="flex items-center justify-between gap-2 cursor-pointer">
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#F4E6C4]">
                <input
                  type="checkbox"
                  checked={batchApplyClosingDate}
                  onChange={(e) => setBatchApplyClosingDate(e.target.checked)}
                  className="h-4 w-4 accent-[#C8A461] cursor-pointer"
                />
                <Calendar className="w-3.5 h-3.5 text-[#E5C17B]" />
                <span>Data do Fecho (2ª Parte)</span>
              </span>
            </label>

            {batchApplyClosingDate && (
              <div className="space-y-1.5 pt-1">
                <input
                  type="date"
                  value={batchClosingDateIso}
                  onChange={(e) => setBatchClosingDateIso(e.target.value)}
                  className="siscom-input !min-h-[36px] text-xs"
                />
                {batchClosingDatePtBr && (
                  <p className="text-[11px] text-[#83B499]">
                    Prévia: Quartel ..., {batchClosingDatePtBr}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 3. Dados do Militar / Cabeçalho */}
          <div className="rounded-lg border border-white/[0.09] bg-[#0C1410]/60 p-3 space-y-2.5">
            <label className="flex items-center gap-2 text-xs font-semibold text-[#F4E6C4] cursor-pointer">
              <input
                type="checkbox"
                checked={batchApplyHeader}
                onChange={(e) => setBatchApplyHeader(e.target.checked)}
                className="h-4 w-4 accent-[#C8A461] cursor-pointer"
              />
              <FileText className="w-3.5 h-3.5 text-[#83B499]" />
              <span>Alterar Dados do Militar / Cabeçalho</span>
            </label>

            {batchApplyHeader && (
              <div className="space-y-2 pt-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={batchNomeGuerra}
                    onChange={(e) => setBatchNomeGuerra(e.target.value)}
                    placeholder="Nome de guerra"
                    className="siscom-input !min-h-[36px] text-xs"
                  />
                  <input
                    type="text"
                    value={batchQasQms}
                    onChange={(e) => setBatchQasQms(e.target.value)}
                    placeholder="QAS / QMS"
                    className="siscom-input !min-h-[36px] text-xs"
                  />
                  <input
                    type="text"
                    value={batchPostoGraduacao}
                    onChange={(e) => setBatchPostoGraduacao(e.target.value)}
                    placeholder="Posto / Graduação"
                    className="siscom-input !min-h-[36px] text-xs"
                  />
                  <input
                    type="text"
                    value={batchIdentidade}
                    onChange={(e) => setBatchIdentidade(e.target.value)}
                    placeholder="Identidade"
                    className="siscom-input !min-h-[36px] font-mono text-xs"
                  />
                  <input
                    type="text"
                    value={batchNomeCompleto}
                    onChange={(e) => setBatchNomeCompleto(e.target.value)}
                    placeholder="Nome completo"
                    className="siscom-input !min-h-[36px] text-xs sm:col-span-2"
                  />
                  <input
                    type="text"
                    value={batchSemestre}
                    onChange={(e) => setBatchSemestre(e.target.value)}
                    placeholder="Semestre (ex.: 1º SEMESTRE DE 2026)"
                    className="siscom-input !min-h-[36px] text-xs"
                  />
                  <input
                    type="text"
                    value={batchPeriodo}
                    onChange={(e) => setBatchPeriodo(e.target.value)}
                    placeholder="Período (ex.: 01/01/2026 a 30/06/2026)"
                    className="siscom-input !min-h-[36px] text-xs"
                  />
                  <input
                    type="text"
                    value={batchGuarnicao}
                    onChange={(e) => setBatchGuarnicao(e.target.value)}
                    placeholder="Guarnição"
                    className="siscom-input !min-h-[36px] text-xs"
                  />
                  <select
                    value={batchGeneroCont}
                    onChange={(e) =>
                      setBatchGeneroCont(e.target.value as 'keep' | 'auto' | 'do' | 'da')
                    }
                    className="siscom-select !min-h-[36px] text-xs"
                  >
                    <option value="keep">Tratamento: manter atual</option>
                    <option value="auto">Tratamento: Automático</option>
                    <option value="do">Tratamento: do (Masculino)</option>
                    <option value="da">Tratamento: da (Feminino)</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setShowBatchModal(false)}
              className="siscom-btn siscom-btn-secondary min-h-[40px] px-4 text-xs"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isBusy || batchSelectedDocs.length === 0}
              className="siscom-btn siscom-btn-primary min-h-[40px] px-4 text-xs"
            >
              {isBusy ? <SiscomSpinner className="w-4 h-4" /> : <Layers className="w-3.5 h-3.5" />}
              <span>
                Aplicar em {batchSelectedDocs.length} alteraç
                {batchSelectedDocs.length === 1 ? 'ão' : 'ões'}
              </span>
            </button>
          </div>
        </form>
      </SiscomModal>
    </div>
  );
};
