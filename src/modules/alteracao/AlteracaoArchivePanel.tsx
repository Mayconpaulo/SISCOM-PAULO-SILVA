import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  Cloud,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
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
  SaveAlteracaoDocInput,
  createAlteracaoFolder,
  deleteAlteracaoDoc,
  deleteAlteracaoFolderCascade,
  getDescendantFolderIds,
  moveAlteracaoDoc,
  moveAlteracaoFolder,
  renameAlteracaoDoc,
  renameAlteracaoFolder,
  saveAlteracaoDoc,
  subscribeAlteracaoDocs,
  subscribeAlteracaoFolders,
} from './alteracaoArchiveService';

export interface AlteracaoArchivePanelProps {
  activeDocId: string | null;
  activeDocTitle: string;
  activeDocFolderId: string;
  suggestedTitle: string;
  getCurrentSnapshot: () => Omit<SaveAlteracaoDocInput, 'existingDocId' | 'folderId' | 'title'>;
  onOpenArchivedDoc: (doc: AlteracaoArchiveDocRecord) => void;
  onActiveDocChange: (info: { id: string | null; title: string; folderId: string }) => void;
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
          <div className="px-3 py-5 text-center space-y-1">
            <p className="text-xs text-[#98A89F]">
              {normalizedSearch
                ? 'Nenhuma pasta ou alteração encontrada.'
                : currentFolderId
                  ? 'Pasta vazia.'
                  : 'Nenhuma pasta ou alteração arquivada.'}
            </p>
            {!normalizedSearch && (
              <p className="text-[11px] text-[#6E7F76]">
                Crie pastas/subpastas ou clique em Arquivar para sincronizar na sua conta.
              </p>
            )}
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
    </div>
  );
};
