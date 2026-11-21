import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import {
  AlertTriangle,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cloud,
  CloudOff,
  CloudUpload,
  ExternalLink,
  FileCheck2,
  FileWarning,
  Folder,
  FolderCheck,
  FolderLock,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  HardDrive,
  History,
  Link2,
  LogOut,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Unlink,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import { WorkspaceSplitLayout } from '../../shared/WorkspaceSplitLayout';
import { SiscomAlert, SiscomSpinner } from '../../shared/ui';
import {
  DEFAULT_INSTITUTIONAL_DRIVE_EMAIL,
  DriveUnauthorizedDomainError,
  GoogleDriveSession,
  connectGoogleDriveAccount,
  disconnectGoogleDriveSession,
  getGoogleDriveSession,
  subscribeGoogleDriveSession,
} from './googleDriveAuthService';
import {
  DriveApiError,
  clearDriveAncestryCache,
  createDriveSubfolder,
  deleteDriveSubfolder,
  extractDriveFolderIdFromInput,
  fetchDriveAccountInfo,
  inspectDriveFolderBeforeDelete,
  listDriveSubfolders,
  renameDriveSubfolder,
  searchDriveRootCandidates,
  verifyDriveRootFolder,
} from './driveApiClient';
import {
  clearDriveRootConfig,
  logDriveAuditEvent,
  saveDriveRootConfig,
  subscribeDriveAuditLogs,
  subscribeDriveRootConfig,
} from './arquivoStore';
import {
  ALLOWED_UPLOAD_ACCEPT,
  DRIVE_AUDIT_ACTION_LABELS,
  DriveAccountInfo,
  DriveAuditEntry,
  DriveBreadcrumbNode,
  DriveFolderCandidate,
  DriveFolderInspection,
  DriveFolderItem,
  DriveRootConfig,
  DriveUploadItem,
} from './arquivoTypes';
import { useArquivoUpload } from './ArquivoUploadContext';
import {
  CreateFolderModal,
  DeleteFolderModal,
  RenameFolderModal,
} from './ArquivoFolderModals';

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return 'Não informado';
  }
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(idx >= 2 ? 1 : 0)} ${units[idx]}`;
}

function formatIsoDatePtBr(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFirestoreDate(ts?: { toDate?: () => Date }): string {
  if (!ts?.toDate) return 'Agora';
  try {
    return ts.toDate().toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function getUploadStatusMeta(status: DriveUploadItem['status']): {
  label: string;
  badgeClass: string;
} {
  switch (status) {
    case 'queued':
      return {
        label: 'Na fila',
        badgeClass: 'border-white/15 bg-white/[0.04] text-[#C6D4CC]',
      };
    case 'checking':
      return {
        label: 'Verificando...',
        badgeClass: 'border-[#C9A961]/35 bg-[#C9A961]/10 text-[#F4E6C4]',
      };
    case 'uploading':
      return {
        label: 'Enviando',
        badgeClass: 'border-[#C9A961]/45 bg-[#C9A961]/15 text-[#F4E6C4]',
      };
    case 'completed':
      return {
        label: 'Concluído',
        badgeClass: 'border-emerald-500/40 bg-emerald-950/45 text-emerald-300',
      };
    case 'duplicate':
      return {
        label: 'Arquivo já existe',
        badgeClass: 'border-amber-500/45 bg-amber-950/45 text-amber-200',
      };
    case 'error':
      return {
        label: 'Erro no envio',
        badgeClass: 'border-red-500/45 bg-red-950/45 text-red-200',
      };
    case 'cancelled':
      return {
        label: 'Cancelado',
        badgeClass: 'border-white/15 bg-white/[0.04] text-[#98A89F]',
      };
  }
}

export function ArquivoInstitucional() {
  const { account } = useAuth();
  const isAdmin = account?.role === 'admin';

  // Global persistent upload queue (survives navigation between SISCOM modules)
  const {
    items: uploadItems,
    activeCount,
    queuedCount,
    completedCount,
    errorCount,
    duplicateCount,
    completedTick,
    enqueueFiles,
    retryUpload,
    retryAllFailed,
    resolveDuplicateWithRename,
    cancelUpload,
    removeUploadItem,
    clearFinishedUploads,
  } = useArquivoUpload();

  // OAuth session state (isolated from SISCOM military login)
  const [driveSession, setDriveSession] = useState<GoogleDriveSession>(() =>
    getGoogleDriveSession()
  );
  const [accountInfo, setAccountInfo] = useState<DriveAccountInfo | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Persisted root folder config in Firestore (remembers bound root folder across sessions)
  const [rootConfig, setRootConfig] = useState<DriveRootConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [auditEntries, setAuditEntries] = useState<DriveAuditEntry[]>([]);

  // Institutional email hint & root selector state
  const [institutionalEmailInput, setInstitutionalEmailInput] = useState(
    DEFAULT_INSTITUTIONAL_DRIVE_EMAIL
  );
  const [isSelectingRoot, setIsSelectingRoot] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [candidates, setCandidates] = useState<DriveFolderCandidate[]>([]);
  const [searchingCandidates, setSearchingCandidates] = useState(false);
  const [manualFolderInput, setManualFolderInput] = useState('');
  const [savingRootId, setSavingRootId] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  // Verification of persisted root folder against currently connected Drive session
  const [rootAccessStatus, setRootAccessStatus] = useState<
    'idle' | 'checking' | 'verified' | 'error'
  >('idle');
  const [rootAccessError, setRootAccessError] = useState<string | null>(null);

  // Etapa 3: Confined folder browser state
  const [breadcrumbs, setBreadcrumbs] = useState<DriveBreadcrumbNode[]>([]);
  const [subfolders, setSubfolders] = useState<DriveFolderItem[]>([]);
  const [directFileCount, setDirectFileCount] = useState(0);
  const [directFileCountTruncated, setDirectFileCountTruncated] = useState(false);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [foldersError, setFoldersError] = useState<string | null>(null);

  // Etapa 3: Create / Rename / Safe Delete modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [renameTarget, setRenameTarget] = useState<DriveFolderItem | null>(null);
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<DriveFolderItem | null>(null);
  const [deleteInspecting, setDeleteInspecting] = useState(false);
  const [deleteInspection, setDeleteInspection] = useState<DriveFolderInspection | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Etapa 4: Upload destination & file picker state
  const [uploadTargetFolder, setUploadTargetFolder] = useState<DriveBreadcrumbNode | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadAlert, setUploadAlert] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadSectionRef = useRef<HTMLElement | null>(null);

  // Feedback banners
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionLink, setActionLink] = useState<{ label: string; url: string } | null>(null);

  // Subscribe to isolated Google Drive OAuth session
  useEffect(() => {
    return subscribeGoogleDriveSession((next) => {
      setDriveSession(next);
      if (!next.connected) {
        setAccountInfo(null);
        setRootAccessStatus('idle');
        setRootAccessError(null);
      }
    });
  }, []);

  // Subscribe to Firestore root folder config & recent audit logs
  useEffect(() => {
    setLoadingConfig(true);
    const unsubConfig = subscribeDriveRootConfig(
      (cfg) => {
        setRootConfig(cfg);
        setLoadingConfig(false);
        if (cfg?.institutionalEmail) {
          setInstitutionalEmailInput(cfg.institutionalEmail);
        }
      },
      () => {
        setLoadingConfig(false);
      }
    );
    const unsubAudit = subscribeDriveAuditLogs((entries) => {
      setAuditEntries(entries);
    }, 25);

    return () => {
      unsubConfig();
      unsubAudit();
    };
  }, []);

  // Reset breadcrumbs whenever root folder changes
  useEffect(() => {
    if (!rootConfig) {
      setBreadcrumbs([]);
      setSubfolders([]);
      setDirectFileCount(0);
      setDirectFileCountTruncated(false);
      setUploadTargetFolder(null);
      return;
    }
    const rootNode: DriveBreadcrumbNode = {
      id: rootConfig.rootFolderId,
      name: rootConfig.rootFolderName,
    };
    setBreadcrumbs((prev) => {
      if (prev.length > 0 && prev[0].id === rootNode.id) {
        if (prev[0].name !== rootNode.name) {
          return [rootNode, ...prev.slice(1)];
        }
        return prev;
      }
      return [rootNode];
    });
  }, [rootConfig]);

  const currentFolder = useMemo<DriveBreadcrumbNode | null>(() => {
    if (breadcrumbs.length > 0) {
      return breadcrumbs[breadcrumbs.length - 1];
    }
    if (rootConfig) {
      return { id: rootConfig.rootFolderId, name: rootConfig.rootFolderName };
    }
    return null;
  }, [breadcrumbs, rootConfig]);

  // Keep default upload destination synchronized when navigating to a new folder
  useEffect(() => {
    if (currentFolder) {
      setUploadTargetFolder(currentFolder);
    }
  }, [currentFolder]);

  // Verify live Google Drive account & storage quota when connected
  const refreshAccountAndRootVerification = useCallback(async () => {
    if (!driveSession.connected) return;
    setLoadingAccount(true);
    try {
      const info = await fetchDriveAccountInfo();
      setAccountInfo(info);
    } catch (err) {
      setAccountInfo(null);
      if (err instanceof DriveApiError && err.status === 401) {
        setErrorMsg(err.message);
      }
    } finally {
      setLoadingAccount(false);
    }

    if (rootConfig?.rootFolderId) {
      setRootAccessStatus('checking');
      setRootAccessError(null);
      try {
        await verifyDriveRootFolder(rootConfig.rootFolderId);
        setRootAccessStatus('verified');
      } catch (err) {
        setRootAccessStatus('error');
        setRootAccessError(
          err instanceof Error
            ? err.message
            : 'Não foi possível acessar a pasta raiz vinculada com esta conta Google.'
        );
      }
    } else {
      setRootAccessStatus('idle');
      setRootAccessError(null);
    }
  }, [driveSession.connected, rootConfig?.rootFolderId]);

  useEffect(() => {
    void refreshAccountAndRootVerification();
  }, [refreshAccountAndRootVerification]);

  // Etapa 3: Load subfolders of the currently active folder inside the bound root
  const loadCurrentFolderListing = useCallback(
    async (silent = false) => {
      if (!driveSession.connected || !rootConfig?.rootFolderId || !currentFolder?.id) {
        return;
      }
      if (!silent) {
        setLoadingFolders(true);
      }
      setFoldersError(null);
      try {
        const result = await listDriveSubfolders(rootConfig.rootFolderId, currentFolder.id);
        setSubfolders(result.folders);
        setDirectFileCount(result.directFileCount);
        setDirectFileCountTruncated(result.directFileCountTruncated);
      } catch (err) {
        if (!silent) {
          setSubfolders([]);
        }
        setFoldersError(
          err instanceof Error
            ? err.message
            : 'Não foi possível listar as subpastas no Google Drive.'
        );
      } finally {
        if (!silent) {
          setLoadingFolders(false);
        }
      }
    },
    [driveSession.connected, rootConfig?.rootFolderId, currentFolder?.id]
  );

  const isOperationalReady = Boolean(
    driveSession.connected && rootConfig && !isSelectingRoot && currentFolder
  );

  useEffect(() => {
    if (isOperationalReady) {
      void loadCurrentFolderListing(false);
    }
  }, [isOperationalReady, loadCurrentFolderListing]);

  // Silently refresh current folder's file count whenever an upload completes
  useEffect(() => {
    if (completedTick > 0 && isOperationalReady) {
      void loadCurrentFolderListing(true);
    }
  }, [completedTick, isOperationalReady, loadCurrentFolderListing]);

  // Search for folders in Meu Drive automatically when Admin opens root selection while connected
  const runCandidateSearch = useCallback(
    async (queryToRun: string) => {
      if (!driveSession.connected) return;
      setSearchingCandidates(true);
      setErrorMsg(null);
      setActionLink(null);
      try {
        const list = await searchDriveRootCandidates(queryToRun);
        setCandidates(list);
      } catch (err) {
        setCandidates([]);
        if (err instanceof DriveApiError && err.code === 'DRIVE_API_DISABLED') {
          setActionLink({
            label: 'Ativar Google Drive API',
            url: 'https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=209099306810',
          });
        }
        setErrorMsg(
          err instanceof Error ? err.message : 'Erro ao buscar pastas no Google Drive.'
        );
      } finally {
        setSearchingCandidates(false);
      }
    },
    [driveSession.connected]
  );

  const shouldShowRootSelector = useMemo(() => {
    if (!driveSession.connected || !isAdmin) return false;
    return !rootConfig || isSelectingRoot;
  }, [driveSession.connected, isAdmin, rootConfig, isSelectingRoot]);

  useEffect(() => {
    if (shouldShowRootSelector) {
      void runCandidateSearch(searchQuery);
    }
    // Intentionally trigger on selector open / connection change, not on every keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShowRootSelector]);

  const activeConnectedEmail = (accountInfo?.email || driveSession.email || '').toLowerCase();
  const expectedEmail = (
    rootConfig?.institutionalEmail ||
    institutionalEmailInput ||
    DEFAULT_INSTITUTIONAL_DRIVE_EMAIL
  )
    .trim()
    .toLowerCase();

  const isDifferentAccountWarning = Boolean(
    driveSession.connected &&
      activeConnectedEmail &&
      expectedEmail &&
      activeConnectedEmail !== expectedEmail
  );

  const handleConnectDrive = async () => {
    if (!account) return;
    setConnecting(true);
    setErrorMsg(null);
    setNotice(null);
    setActionLink(null);
    try {
      const hint = institutionalEmailInput.trim() || DEFAULT_INSTITUTIONAL_DRIVE_EMAIL;
      const session = await connectGoogleDriveAccount(hint);
      clearDriveAncestryCache();
      setNotice(
        `Conta Google conectada com sucesso: ${session.email || 'conta selecionada'}.`
      );
      void logDriveAuditEvent({
        action: 'drive_connect',
        targetName: session.email || '',
        summary: `Conexão Google Drive ativada (${session.email || 'conta institucional'}).`,
        actorUid: account.uid,
        actorName: account.displayName,
      });
    } catch (err) {
      if (err instanceof DriveUnauthorizedDomainError) {
        setActionLink({
          label: 'Abrir Domínios Autorizados',
          url: err.consoleUrl,
        });
      }
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Não foi possível conectar a conta institucional do Google Drive.'
      );
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnectDrive = async () => {
    if (!account) return;
    const prevEmail = activeConnectedEmail;
    setErrorMsg(null);
    setNotice(null);
    clearDriveAncestryCache();
    await disconnectGoogleDriveSession();
    setCandidates([]);
    setSubfolders([]);
    setIsSelectingRoot(false);
    setNotice('Conta do Google Drive desconectada desta sessão.');
    void logDriveAuditEvent({
      action: 'drive_disconnect',
      targetName: prevEmail,
      summary: `Conexão Google Drive desconectada${prevEmail ? ` (${prevEmail})` : ''}.`,
      actorUid: account.uid,
      actorName: account.displayName,
    });
  };

  const handleSelectRootFolder = async (folderId: string) => {
    if (!account || !isAdmin) return;
    setSavingRootId(folderId);
    setErrorMsg(null);
    setNotice(null);
    try {
      const verified = await verifyDriveRootFolder(folderId);
      const institutionalTarget =
        institutionalEmailInput.trim().toLowerCase() || DEFAULT_INSTITUTIONAL_DRIVE_EMAIL;
      const linkedEmail = (verified.accountEmail || activeConnectedEmail || '').toLowerCase();

      await saveDriveRootConfig({
        rootFolderId: verified.folder.id,
        rootFolderName: verified.folder.name,
        institutionalEmail: institutionalTarget,
        linkedAccountEmail: linkedEmail,
        driveWebViewUrl: verified.folder.webViewLink,
        actorUid: account.uid,
        actorName: account.displayName,
      });

      clearDriveAncestryCache();

      await logDriveAuditEvent({
        action: 'root_select',
        targetId: verified.folder.id,
        targetName: verified.folder.name,
        summary: `Pasta raiz "${verified.folder.name}" vinculada ao Arquivo Institucional.`,
        actorUid: account.uid,
        actorName: account.displayName,
      });

      setIsSelectingRoot(false);
      setManualFolderInput('');
      setRootAccessStatus('verified');
      setRootAccessError(null);
      setNotice(
        `Pasta raiz "${verified.folder.name}" vinculada e registrada com sucesso.`
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Não foi possível validar e vincular a pasta selecionada.'
      );
    } finally {
      setSavingRootId(null);
    }
  };

  const handleManualBindSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const extracted = extractDriveFolderIdFromInput(manualFolderInput);
    if (!extracted) {
      setErrorMsg(
        'Informe um ID de pasta válido ou cole o link completo da pasta do Google Drive.'
      );
      return;
    }
    await handleSelectRootFolder(extracted);
  };

  const handleUnlinkRootFolder = async () => {
    if (!account || !isAdmin || !rootConfig) return;
    setUnlinking(true);
    setErrorMsg(null);
    setNotice(null);
    try {
      const oldName = rootConfig.rootFolderName;
      const oldId = rootConfig.rootFolderId;
      await clearDriveRootConfig();
      clearDriveAncestryCache();
      await logDriveAuditEvent({
        action: 'root_unlink',
        targetId: oldId,
        targetName: oldName,
        summary: `Pasta raiz "${oldName}" desvinculada da configuração do SISCOM.`,
        actorUid: account.uid,
        actorName: account.displayName,
      });
      setConfirmUnlink(false);
      setRootAccessStatus('idle');
      setRootAccessError(null);
      setNotice('Vinculação da pasta raiz removida. Selecione uma nova pasta quando desejar.');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Erro ao desvincular a pasta raiz.'
      );
    } finally {
      setUnlinking(false);
    }
  };

  /* ── Etapa 3 Handlers: Navigation, Create, Rename, Safe Delete ─────────── */

  const currentPathLabel = useMemo(() => {
    if (breadcrumbs.length === 0) return rootConfig?.rootFolderName || 'Pasta Raiz';
    return breadcrumbs.map((node) => node.name).join(' / ');
  }, [breadcrumbs, rootConfig?.rootFolderName]);

  const handleOpenSubfolder = (folder: DriveFolderItem) => {
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const handleBreadcrumbClick = (index: number) => {
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
  };

  const handleNavigateUp = () => {
    if (breadcrumbs.length <= 1) return;
    setBreadcrumbs((prev) => prev.slice(0, prev.length - 1));
  };

  const handleCreateSubfolder = async (folderName: string) => {
    if (!account || !rootConfig || !currentFolder) return;
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const created = await createDriveSubfolder({
        rootFolderId: rootConfig.rootFolderId,
        parentId: currentFolder.id,
        name: folderName,
      });

      setCreateModalOpen(false);
      setNotice(`Pasta "${created.name}" criada dentro de "${currentFolder.name}".`);
      void logDriveAuditEvent({
        action: 'folder_create',
        targetId: created.id,
        targetName: created.name,
        summary: `Subpasta "${created.name}" criada em "${currentPathLabel}".`,
        actorUid: account.uid,
        actorName: account.displayName,
      });
      await loadCurrentFolderListing(false);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : 'Não foi possível criar a pasta no Google Drive.'
      );
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleRenameSubfolder = async (folder: DriveFolderItem, newName: string) => {
    if (!account || !rootConfig) return;
    setRenameSubmitting(true);
    setRenameError(null);
    try {
      const updated = await renameDriveSubfolder({
        rootFolderId: rootConfig.rootFolderId,
        folderId: folder.id,
        name: newName,
      });

      setRenameTarget(null);
      setNotice(`Pasta "${folder.name}" renomeada para "${updated.name}".`);
      if (uploadTargetFolder?.id === folder.id) {
        setUploadTargetFolder({ id: folder.id, name: updated.name });
      }
      void logDriveAuditEvent({
        action: 'folder_rename',
        targetId: updated.id,
        targetName: updated.name,
        summary: `Subpasta "${folder.name}" renomeada para "${updated.name}".`,
        actorUid: account.uid,
        actorName: account.displayName,
      });
      await loadCurrentFolderListing(false);
    } catch (err) {
      setRenameError(
        err instanceof Error ? err.message : 'Não foi possível renomear a pasta.'
      );
    } finally {
      setRenameSubmitting(false);
    }
  };

  const handleStartDeleteFolder = async (folder: DriveFolderItem) => {
    if (!rootConfig) return;
    setDeleteTarget(folder);
    setDeleteInspection(null);
    setDeleteError(null);
    setDeleteInspecting(true);
    try {
      const inspection = await inspectDriveFolderBeforeDelete(
        rootConfig.rootFolderId,
        folder.id
      );
      setDeleteInspection(inspection);
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : 'Não foi possível inspecionar o conteúdo da pasta antes da exclusão.'
      );
    } finally {
      setDeleteInspecting(false);
    }
  };

  const handleConfirmDeleteFolder = async (
    folder: DriveFolderItem,
    confirmNonEmpty: boolean
  ) => {
    if (!account || !rootConfig) return;
    setDeleteSubmitting(true);
    setDeleteError(null);
    try {
      await deleteDriveSubfolder({
        rootFolderId: rootConfig.rootFolderId,
        folderId: folder.id,
        confirmNonEmpty,
      });

      const deletedSummary =
        deleteInspection && !deleteInspection.isEmpty
          ? `Subpasta "${folder.name}" movida para a Lixeira do Drive (${deleteInspection.totalSubfolderCount} subpasta(s), ${deleteInspection.totalFileCount} arquivo(s)).`
          : `Subpasta vazia "${folder.name}" movida para a Lixeira do Drive.`;

      setDeleteTarget(null);
      setDeleteInspection(null);
      if (uploadTargetFolder?.id === folder.id && currentFolder) {
        setUploadTargetFolder(currentFolder);
      }
      setNotice(`Pasta "${folder.name}" movida para a Lixeira do Google Drive.`);
      void logDriveAuditEvent({
        action: 'folder_delete',
        targetId: folder.id,
        targetName: folder.name,
        summary: deletedSummary,
        actorUid: account.uid,
        actorName: account.displayName,
      });
      await loadCurrentFolderListing(false);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Não foi possível excluir a pasta selecionada.'
      );
    } finally {
      setDeleteSubmitting(false);
    }
  };

  /* ── Etapa 4 Handlers: Multi-file Selection, Destination & Drag-and-Drop ─ */

  const destinationOptions = useMemo<Array<{ id: string; name: string; label: string }>>(() => {
    if (!currentFolder) return [];
    const options: Array<{ id: string; name: string; label: string }> = [
      {
        id: currentFolder.id,
        name: currentFolder.name,
        label: `Pasta atual: ${currentFolder.name}`,
      },
    ];
    for (const sub of subfolders) {
      options.push({
        id: sub.id,
        name: sub.name,
        label: `↳ Subpasta: ${sub.name}`,
      });
    }
    return options;
  }, [currentFolder, subfolders]);

  const effectiveUploadTarget = useMemo<DriveBreadcrumbNode | null>(() => {
    if (uploadTargetFolder) {
      const stillValid = destinationOptions.some((o) => o.id === uploadTargetFolder.id);
      if (stillValid) return uploadTargetFolder;
    }
    return currentFolder;
  }, [uploadTargetFolder, destinationOptions, currentFolder]);

  const handleFilesSelected = (fileList: FileList | File[]) => {
    if (!rootConfig || !effectiveUploadTarget) return;
    const filesArray = Array.from(fileList);
    if (filesArray.length === 0) return;

    const result = enqueueFiles({
      files: filesArray,
      rootFolderId: rootConfig.rootFolderId,
      targetFolderId: effectiveUploadTarget.id,
      targetFolderName: effectiveUploadTarget.name,
    });

    const notes: string[] = [];
    if (result.skippedDuplicates.length > 0) {
      notes.push(
        `${result.skippedDuplicates.length} arquivo(s) ignorado(s) por já estarem na fila para "${effectiveUploadTarget.name}" (${result.skippedDuplicates.slice(0, 2).join(', ')}${result.skippedDuplicates.length > 2 ? '...' : ''}).`
      );
    }
    if (result.rejectedFiles.length > 0) {
      notes.push(
        `${result.rejectedFiles.length} arquivo(s) recusado(s) por formato inválido (aceitos: JPG, JPEG, PNG, HEIC, MP4, MOV e PDF).`
      );
    }
    setUploadAlert(notes.length > 0 ? notes.join(' ') : null);
  };

  const handleQuickUploadToSubfolder = (folder: DriveFolderItem) => {
    setUploadTargetFolder({ id: folder.id, name: folder.name });
    uploadSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    window.setTimeout(() => {
      fileInputRef.current?.click();
    }, 150);
  };

  const handleDropZoneDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (!isOperationalReady) return;
    if (e.dataTransfer?.files?.length) {
      handleFilesSelected(e.dataTransfer.files);
    }
  };

  /* ── Sidebar Quota & Connection Status Memo ────────────────────────────── */

  const quotaUsedPercent = useMemo(() => {
    const limit = accountInfo?.storageQuota?.limitBytes;
    const usage = accountInfo?.storageQuota?.usageBytes;
    if (!limit || !usage || limit <= 0) return null;
    return Math.min(100, Math.round((usage / limit) * 100));
  }, [accountInfo]);

  const statusMeta = useMemo(() => {
    if (driveSession.status === 'connected') {
      return {
        label: 'Conexão ativa',
        dotClass: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.75)]',
        textClass: 'text-emerald-300',
        borderClass: 'border-emerald-500/35 bg-emerald-950/35',
      };
    }
    if (driveSession.status === 'expired') {
      return {
        label: 'Sessão expirada',
        dotClass: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.75)]',
        textClass: 'text-amber-200',
        borderClass: 'border-amber-500/40 bg-amber-950/35',
      };
    }
    return {
      label: 'Desconectado',
      dotClass: 'bg-[#8F9F96]',
      textClass: 'text-[#B8C6BE]',
      borderClass: 'border-white/12 bg-white/[0.03]',
    };
  }, [driveSession.status]);

  const expiresInMinutes = useMemo(() => {
    if (!driveSession.connected || !driveSession.expiresAt) return null;
    return Math.max(1, Math.round((driveSession.expiresAt - Date.now()) / 60_000));
  }, [driveSession.connected, driveSession.expiresAt]);

  const hasFinishedUploads = useMemo(
    () => uploadItems.some((it) => it.status === 'completed' || it.status === 'cancelled'),
    [uploadItems]
  );

  return (
    <>
      <WorkspaceSplitLayout
        sidebarWidthClass="lg:w-[365px] xl:w-[395px]"
        sidebar={
          <div className="space-y-4">
            {/* Card 1: Conexão Google Drive Institucional */}
            <section className="metal-surface rounded-xl p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between gap-2 border-b border-white/8 pb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Cloud className="w-4 h-4 text-[#E5C17B] shrink-0" />
                  <h2 className="font-display text-sm font-semibold text-[#F4E6C4] tracking-tight truncate">
                    Conexão Google Drive
                  </h2>
                </div>

                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium shrink-0 ${statusMeta.borderClass} ${statusMeta.textClass}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dotClass}`} />
                  {statusMeta.label}
                </span>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="drive-inst-email"
                    className="siscom-field-label !text-[11px]"
                  >
                    Conta institucional esperada
                  </label>
                  <input
                    id="drive-inst-email"
                    type="email"
                    value={institutionalEmailInput}
                    onChange={(e) => setInstitutionalEmailInput(e.target.value)}
                    disabled={!isAdmin && Boolean(rootConfig?.institutionalEmail)}
                    placeholder="comsocsampaio2026@gmail.com"
                    className="siscom-input !min-h-[38px] text-xs font-mono"
                  />
                  <p className="text-[11px] text-[#98A89F] leading-relaxed">
                    Ao conectar, o Google abre o seletor de contas para escolher a conta da Seção de
                    Comunicação Social, sem alterar seu login militar do SISCOM.
                  </p>
                </div>

                {driveSession.connected && (
                  <div className="rounded-lg border border-white/10 bg-[#0A110D]/70 p-3 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#98A89F]">Conta conectada</span>
                      {loadingAccount && <SiscomSpinner className="w-3 h-3" tone="gold" />}
                    </div>
                    <div className="font-mono text-[#F4E6C4] break-all">
                      {activeConnectedEmail || 'Verificando...'}
                    </div>
                    {expiresInMinutes !== null && (
                      <div className="flex items-center gap-1.5 text-[11px] text-[#98A89F] pt-0.5">
                        <Clock className="w-3 h-3 text-[#C9A961]" />
                        <span>Sessão ativa (~{expiresInMinutes} min restantes)</span>
                      </div>
                    )}
                  </div>
                )}

                {driveSession.connected && accountInfo && (
                  <div className="rounded-lg border border-white/10 bg-[#0A110D]/60 p-3 space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-[#D6E0DA] font-medium">
                        <HardDrive className="w-3.5 h-3.5 text-[#E5C17B]" />
                        <span>Armazenamento Drive</span>
                      </div>
                      {quotaUsedPercent !== null && (
                        <span className="font-mono text-[11px] text-[#E5C17B]">
                          {quotaUsedPercent}%
                        </span>
                      )}
                    </div>
                    {quotaUsedPercent !== null && (
                      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            quotaUsedPercent >= 90
                              ? 'bg-red-400'
                              : quotaUsedPercent >= 75
                                ? 'bg-amber-400'
                                : 'bg-[#83B499]'
                          }`}
                          style={{ width: `${quotaUsedPercent}%` }}
                        />
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[11px] text-[#98A89F] font-mono">
                      <span>{formatBytes(accountInfo.storageQuota.usageBytes)} usados</span>
                      <span>de {formatBytes(accountInfo.storageQuota.limitBytes)}</span>
                    </div>
                  </div>
                )}

                {driveSession.status === 'expired' && (
                  <div className="rounded-lg border border-amber-500/35 bg-amber-950/30 p-3 text-xs text-amber-100 space-y-1">
                    <div className="font-medium flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                      <span>Autorização temporária expirada</span>
                    </div>
                    <p className="text-[11px] text-amber-100/80 leading-relaxed">
                      A pasta raiz continua salva no SISCOM, mas por segurança a autorização do
                      Google Drive expira periodicamente. Clique em <strong>Reconectar</strong>.
                    </p>
                  </div>
                )}

                {isDifferentAccountWarning && (
                  <div className="rounded-lg border border-amber-500/45 bg-amber-950/35 p-3 text-xs text-amber-100 space-y-1">
                    <div className="font-semibold flex items-center gap-1.5 text-amber-200">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>Conta diferente da institucional</span>
                    </div>
                    <p className="text-[11px] text-amber-100/85 leading-relaxed">
                      Você entrou com <span className="font-mono">{activeConnectedEmail}</span>, mas
                      a conta institucional definida é{' '}
                      <span className="font-mono">{expectedEmail}</span>. Clique em{' '}
                      <strong>Trocar conta</strong> para evitar usar conta pessoal.
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  {!driveSession.connected ? (
                    <button
                      type="button"
                      onClick={() => void handleConnectDrive()}
                      disabled={connecting}
                      className="siscom-btn siscom-btn-gold flex-1 text-xs"
                    >
                      {connecting ? (
                        <SiscomSpinner className="w-3.5 h-3.5" tone="gold" />
                      ) : (
                        <Link2 className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {connecting
                          ? 'Conectando...'
                          : driveSession.status === 'expired'
                            ? 'Reconectar Google Drive'
                            : 'Conectar Google Drive'}
                      </span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleConnectDrive()}
                        disabled={connecting}
                        className="siscom-btn siscom-btn-secondary flex-1 text-xs"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${connecting ? 'animate-spin' : ''}`} />
                        <span>Trocar conta</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDisconnectDrive()}
                        className="siscom-btn siscom-btn-secondary text-xs text-red-200 hover:text-red-100 hover:border-red-400/40"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Desconectar</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </section>

            {/* Card 2: Pasta Raiz Autorizada */}
            <section className="metal-surface rounded-xl p-4 sm:p-5 space-y-3.5">
              <div className="flex items-center justify-between gap-2 border-b border-white/8 pb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <FolderLock className="w-4 h-4 text-[#83B499] shrink-0" />
                  <h2 className="font-display text-sm font-semibold text-[#F4E6C4] tracking-tight truncate">
                    Pasta Raiz Autorizada
                  </h2>
                </div>
                {rootConfig && (
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#83B499]">
                    Protegida
                  </span>
                )}
              </div>

              {loadingConfig ? (
                <div className="py-4 flex items-center gap-2 text-xs text-[#98A89F]">
                  <SiscomSpinner className="w-3.5 h-3.5" tone="gold" />
                  <span>Carregando configuração...</span>
                </div>
              ) : !rootConfig ? (
                <div className="space-y-2.5 text-xs text-[#B8C6BE]">
                  <p className="leading-relaxed">
                    Nenhuma pasta raiz vinculada ainda. O administrador deve conectar a conta{' '}
                    <span className="font-mono text-[#E5C17B]">
                      {DEFAULT_INSTITUTIONAL_DRIVE_EMAIL}
                    </span>{' '}
                    e selecionar a pasta <strong>FOTOS - 2026</strong>.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 text-xs">
                  <div className="rounded-lg border border-[#C9A961]/25 bg-[#0A120E]/75 p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11px] text-[#98A89F]">Pasta raiz confinada</div>
                        <div className="font-display text-sm font-semibold text-[#F4E6C4] truncate mt-0.5">
                          {rootConfig.rootFolderName}
                        </div>
                      </div>
                      {rootAccessStatus === 'verified' && (
                        <CheckCircle2
                          className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5"
                          aria-label="Pasta verificada"
                        />
                      )}
                      {rootAccessStatus === 'checking' && (
                        <SiscomSpinner className="w-3.5 h-3.5 shrink-0 mt-0.5" tone="gold" />
                      )}
                      {rootAccessStatus === 'error' && (
                        <AlertTriangle
                          className="w-4 h-4 text-amber-400 shrink-0 mt-0.5"
                          aria-label="Erro de validação"
                        />
                      )}
                    </div>

                    <div className="pt-1 border-t border-white/8 space-y-1 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#98A89F]">ID:</span>
                        <span className="font-mono text-[#D6E0DA] truncate max-w-[190px]">
                          {rootConfig.rootFolderId}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#98A89F]">Conta:</span>
                        <span className="font-mono text-[#D6E0DA] truncate max-w-[190px]">
                          {rootConfig.linkedAccountEmail || rootConfig.institutionalEmail}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#98A89F]">Configurada por:</span>
                        <span className="text-[#D6E0DA] truncate max-w-[190px]">
                          {rootConfig.updatedByName}
                        </span>
                      </div>
                    </div>
                  </div>

                  {rootAccessStatus === 'error' && rootAccessError && (
                    <div className="rounded-lg border border-red-500/35 bg-red-950/30 p-2.5 text-[11px] text-red-200 leading-relaxed">
                      {rootAccessError}
                    </div>
                  )}

                  {isAdmin && (
                    <div className="space-y-2 pt-0.5">
                      {driveSession.connected && (
                        <button
                          type="button"
                          onClick={() => setIsSelectingRoot((prev) => !prev)}
                          className="siscom-btn siscom-btn-secondary w-full text-xs"
                        >
                          <FolderSearch className="w-3.5 h-3.5 text-[#E5C17B]" />
                          <span>
                            {isSelectingRoot
                              ? 'Voltar ao gerenciamento'
                              : 'Alterar pasta raiz'}
                          </span>
                        </button>
                      )}

                      {!confirmUnlink ? (
                        <button
                          type="button"
                          onClick={() => setConfirmUnlink(true)}
                          className="w-full min-h-[36px] rounded-lg border border-white/10 hover:border-red-400/35 text-[11px] text-[#98A89F] hover:text-red-200 inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Unlink className="w-3.5 h-3.5" />
                          <span>Desvincular pasta raiz do SISCOM</span>
                        </button>
                      ) : (
                        <div className="rounded-lg border border-red-500/35 bg-red-950/25 p-3 space-y-2">
                          <p className="text-[11px] text-red-100 leading-relaxed">
                            Isso remove apenas a vinculação no SISCOM (nenhum arquivo ou pasta do
                            Google Drive será apagado). Confirmar?
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={unlinking}
                              onClick={() => void handleUnlinkRootFolder()}
                              className="siscom-btn flex-1 !min-h-[34px] text-xs bg-red-900/70 hover:bg-red-800/80 border border-red-500/40 text-red-50"
                            >
                              {unlinking ? 'Removendo...' : 'Confirmar'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmUnlink(false)}
                              className="siscom-btn siscom-btn-secondary flex-1 !min-h-[34px] text-xs"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        }
      >
        <div className="space-y-5">
          {/* Top Notice / Error Banner */}
          <AnimatePresence>
            {(notice || errorMsg) && (
              <SiscomAlert
                tone={errorMsg ? 'error' : 'success'}
                onDismiss={() => {
                  setNotice(null);
                  setErrorMsg(null);
                  setActionLink(null);
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{errorMsg || notice}</span>
                  {actionLink && (
                    <a
                      href={actionLink.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[#E5C17B] underline font-medium"
                    >
                      <span>{actionLink.label}</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </SiscomAlert>
            )}
          </AnimatePresence>

          {/* Main Panel State 1: Not Connected */}
          {!driveSession.connected && (
            <section className="metal-surface rounded-xl p-6 sm:p-8 space-y-5">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-[#0E1813]/80 border border-[#C9A961]/35 flex items-center justify-center text-[#E5C17B] shrink-0">
                  <CloudOff className="w-6 h-6" />
                </div>
                <div className="space-y-1.5 min-w-0">
                  <h2 className="font-display text-lg font-semibold text-[#F4E6C4] tracking-tight">
                    Arquivo Institucional — Google Drive
                  </h2>
                  <p className="text-sm text-[#C6D4CC] leading-relaxed">
                    Conecte a conta Google da Seção de Comunicação Social para administrar a pasta{' '}
                    <strong className="text-[#F4E6C4]">
                      {rootConfig?.rootFolderName || 'FOTOS - 2026'}
                    </strong>{' '}
                    e enviar arquivos diretamente ao Drive institucional.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="rounded-lg border border-white/8 bg-[#0A110D]/60 p-3.5 space-y-1">
                  <div className="font-medium text-[#E5C17B]">1. Conta isolada</div>
                  <p className="text-[#98A89F] leading-relaxed">
                    Use a conta <span className="font-mono">{expectedEmail}</span>. Seu login do
                    SISCOM permanece ativo normalmente.
                  </p>
                </div>
                <div className="rounded-lg border border-white/8 bg-[#0A110D]/60 p-3.5 space-y-1">
                  <div className="font-medium text-[#E5C17B]">2. Pasta raiz confinada</div>
                  <p className="text-[#98A89F] leading-relaxed">
                    Todas as operações ficam restritas à pasta{' '}
                    <strong>{rootConfig?.rootFolderName || 'FOTOS - 2026'}</strong> e suas
                    subpastas.
                  </p>
                </div>
                <div className="rounded-lg border border-white/8 bg-[#0A110D]/60 p-3.5 space-y-1">
                  <div className="font-medium text-[#E5C17B]">3. Interface administrativa</div>
                  <p className="text-[#98A89F] leading-relaxed">
                    Gerenciamento de pastas e envio direto sem galeria de imagens nem armazenamento
                    paralelo no banco interno.
                  </p>
                </div>
              </div>

              <div className="pt-1 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleConnectDrive()}
                  disabled={connecting}
                  className="siscom-btn siscom-btn-gold text-sm"
                >
                  {connecting ? (
                    <SiscomSpinner className="w-4 h-4" tone="gold" />
                  ) : (
                    <Link2 className="w-4 h-4" />
                  )}
                  <span>
                    {connecting
                      ? 'Abrindo seleção de conta...'
                      : driveSession.status === 'expired'
                        ? 'Reconectar conta institucional'
                        : 'Conectar conta institucional'}
                  </span>
                </button>
              </div>
            </section>
          )}

          {/* Main Panel State 2: Connected + Admin Selecting Root Folder */}
          {shouldShowRootSelector && (
            <section className="metal-surface rounded-xl p-5 sm:p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 pb-3.5">
                <div className="flex items-center gap-2.5">
                  <FolderSearch className="w-5 h-5 text-[#E5C17B]" />
                  <div>
                    <h2 className="font-display text-base font-semibold text-[#F4E6C4] tracking-tight">
                      Selecionar Pasta Raiz no Google Drive
                    </h2>
                    <p className="text-xs text-[#98A89F]">
                      Escolha a pasta existente <strong>FOTOS - 2026</strong> para registrar seu ID
                      oficial como raiz única do Arquivo Institucional.
                    </p>
                  </div>
                </div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void runCandidateSearch(searchQuery);
                }}
                className="flex flex-col sm:flex-row gap-2.5"
              >
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-[#98A89F] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filtrar pasta pelo nome (ou deixe vazio para ver pastas de Meu Drive)"
                    className="siscom-input !pl-9 !min-h-[40px] text-xs"
                  />
                </div>
                <button
                  type="submit"
                  disabled={searchingCandidates}
                  className="siscom-btn siscom-btn-primary !min-h-[40px] text-xs shrink-0"
                >
                  {searchingCandidates ? (
                    <SiscomSpinner className="w-3.5 h-3.5" />
                  ) : (
                    <Search className="w-3.5 h-3.5" />
                  )}
                  <span>{searchQuery.trim() ? 'Buscar pastas' : 'Listar Meu Drive'}</span>
                </button>
              </form>

              <div className="space-y-2">
                {searchingCandidates ? (
                  <div className="py-8 flex items-center justify-center gap-2 text-xs text-[#98A89F]">
                    <SiscomSpinner className="w-4 h-4" tone="gold" />
                    <span>Consultando pastas na conta conectada...</span>
                  </div>
                ) : candidates.length === 0 ? (
                  <div className="rounded-lg border border-white/8 bg-[#0A110D]/60 p-5 text-center space-y-1.5">
                    <p className="text-xs text-[#E4EAE6]">
                      Nenhuma pasta encontrada
                      {searchQuery.trim() ? ` para “${searchQuery.trim()}”` : ' em Meu Drive'}
                      {activeConnectedEmail ? (
                        <>
                          {' '}
                          na conta{' '}
                          <span className="font-mono text-[#E5C17B]">{activeConnectedEmail}</span>
                        </>
                      ) : null}
                      .
                    </p>
                    <p className="text-[11px] text-[#98A89F]">
                      Verifique se você conectou a conta institucional correta ou informe o link/ID
                      da pasta logo abaixo.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/8 rounded-xl border border-white/10 bg-[#0A110D]/55 overflow-hidden">
                    {candidates.map((folder) => {
                      const lowerName = folder.name.trim().toLowerCase();
                      const isExactTarget =
                        lowerName.includes('fotos') && lowerName.includes('2026');
                      const isCurrentRoot = rootConfig?.rootFolderId === folder.id;
                      const isBusy = savingRootId === folder.id;
                      return (
                        <div
                          key={folder.id}
                          className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-white/[0.025] transition-colors"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <FolderCheck className="w-4 h-4 text-[#E5C17B] shrink-0" />
                              <span className="font-medium text-sm text-[#F4F7F5] truncate">
                                {folder.name}
                              </span>
                              {isExactTarget && (
                                <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#2D5A43]/45 border border-[#83B499]/35 text-[#BCE0CC]">
                                  Recomendada
                                </span>
                              )}
                              {isCurrentRoot && (
                                <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#C9A961]/20 border border-[#C9A961]/40 text-[#F4E6C4]">
                                  Atual
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#98A89F]">
                              <span className="font-mono">ID: {folder.id}</span>
                              {folder.ownerEmail && (
                                <span>Proprietário: {folder.ownerEmail}</span>
                              )}
                              <span>Modificada: {formatIsoDatePtBr(folder.modifiedTime)}</span>
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={Boolean(savingRootId)}
                            onClick={() => void handleSelectRootFolder(folder.id)}
                            className="siscom-btn siscom-btn-gold !min-h-[36px] text-xs shrink-0"
                          >
                            {isBusy ? (
                              <SiscomSpinner className="w-3.5 h-3.5" tone="gold" />
                            ) : (
                              <ShieldCheck className="w-3.5 h-3.5" />
                            )}
                            <span>{isBusy ? 'Vinculando...' : 'Vincular como raiz'}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <form
                onSubmit={(e) => void handleManualBindSubmit(e)}
                className="pt-3 border-t border-white/8 space-y-2"
              >
                <label
                  htmlFor="manual-folder-id"
                  className="siscom-field-label !text-[11px]"
                >
                  Ou vincule colando o link ou ID da pasta do Google Drive
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    id="manual-folder-id"
                    type="text"
                    value={manualFolderInput}
                    onChange={(e) => setManualFolderInput(e.target.value)}
                    placeholder="https://drive.google.com/drive/folders/... ou ID da pasta"
                    className="siscom-input !min-h-[38px] text-xs font-mono flex-1"
                  />
                  <button
                    type="submit"
                    disabled={!manualFolderInput.trim() || Boolean(savingRootId)}
                    className="siscom-btn siscom-btn-secondary !min-h-[38px] text-xs shrink-0"
                  >
                    Validar e vincular
                  </button>
                </div>
              </form>
            </section>
          )}

          {/* Main Panel State 3: Connected + Non-Admin waiting for Admin root setup */}
          {driveSession.connected && !rootConfig && !isAdmin && (
            <section className="metal-surface rounded-xl p-6 space-y-3">
              <div className="flex items-center gap-2.5 text-[#E5C17B]">
                <FolderLock className="w-5 h-5" />
                <h2 className="font-display text-base font-semibold text-[#F4E6C4]">
                  Aguardando configuração da pasta raiz
                </h2>
              </div>
              <p className="text-sm text-[#C6D4CC] leading-relaxed">
                Sua conexão com o Google Drive está ativa, mas a pasta raiz oficial (
                <strong>FOTOS - 2026</strong>) ainda não foi vinculada. Solicite a um administrador
                do SISCOM para vincular a pasta raiz no módulo Arquivo Institucional.
              </p>
            </section>
          )}

          {/* Main Panel State 4: Operational Workspace (ETAPA 3: Pastas + ETAPA 4: Envios) */}
          {isOperationalReady && rootConfig && currentFolder && (
            <>
              {/* ETAPA 3: Confined Folder Browser */}
              <section className="metal-surface rounded-xl p-5 sm:p-6 space-y-4">
                {/* Header: Current folder title & primary actions */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-white/8 pb-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-[#1A3326]/70 border border-[#C9A961]/35 flex items-center justify-center text-[#E5C17B] shrink-0">
                      <FolderOpen className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="font-display text-base font-semibold text-[#F4E6C4] tracking-tight truncate">
                          {currentFolder.name}
                        </h2>
                        {currentFolder.id === rootConfig.rootFolderId && (
                          <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#2D5A43]/45 border border-[#83B499]/35 text-[#BCE0CC]">
                            Pasta Raiz
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#98A89F] mt-0.5">
                        {loadingFolders
                          ? 'Atualizando pastas...'
                          : `${subfolders.length} subpasta${subfolders.length === 1 ? '' : 's'} · ${directFileCount}${directFileCountTruncated ? '+' : ''} arquivo${directFileCount === 1 ? '' : 's'} armazenado${directFileCount === 1 ? '' : 's'} neste nível`}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setCreateError(null);
                        setCreateModalOpen(true);
                      }}
                      className="siscom-btn siscom-btn-gold !min-h-[38px] text-xs"
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                      <span>Nova pasta</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUploadTargetFolder(currentFolder);
                        uploadSectionRef.current?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'nearest',
                        });
                        window.setTimeout(() => fileInputRef.current?.click(), 120);
                      }}
                      className="siscom-btn siscom-btn-primary !min-h-[38px] text-xs"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Enviar arquivos</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void loadCurrentFolderListing(false)}
                      disabled={loadingFolders}
                      aria-label="Atualizar listagem de pastas"
                      className="siscom-btn siscom-btn-secondary !min-h-[38px] text-xs"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${loadingFolders ? 'animate-spin' : ''}`}
                      />
                      <span className="hidden sm:inline">Atualizar</span>
                    </button>
                  </div>
                </div>

                {/* Breadcrumb Navigation Bar */}
                <div className="flex items-center gap-2 flex-wrap">
                  {breadcrumbs.length > 1 && (
                    <button
                      type="button"
                      onClick={handleNavigateUp}
                      className="siscom-btn siscom-btn-secondary !min-h-[32px] !px-2.5 text-[11px] shrink-0"
                    >
                      <ArrowUp className="w-3.5 h-3.5 text-[#E5C17B]" />
                      <span>Subir nível</span>
                    </button>
                  )}

                  <nav
                    aria-label="Caminho das pastas"
                    className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto rounded-lg border border-white/8 bg-[#0A110D]/60 px-3 py-1.5 text-xs"
                  >
                    {breadcrumbs.map((node, idx) => {
                      const isLast = idx === breadcrumbs.length - 1;
                      return (
                        <React.Fragment key={node.id}>
                          {idx > 0 && (
                            <ChevronRight className="w-3.5 h-3.5 text-[#708278] shrink-0" />
                          )}
                          {isLast ? (
                            <span className="font-medium text-[#F4E6C4] whitespace-nowrap">
                              {node.name}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleBreadcrumbClick(idx)}
                              className="text-[#A8B8AF] hover:text-[#F4E6C4] transition-colors whitespace-nowrap cursor-pointer"
                            >
                              {node.name}
                            </button>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </nav>
                </div>

                {/* Folder listing error */}
                {foldersError && (
                  <div className="rounded-lg border border-red-500/35 bg-red-950/30 p-3 text-xs text-red-200 flex items-center justify-between gap-3">
                    <span>{foldersError}</span>
                    <button
                      type="button"
                      onClick={() => void loadCurrentFolderListing(false)}
                      className="siscom-btn siscom-btn-secondary !min-h-[32px] text-[11px] shrink-0"
                    >
                      Tentar novamente
                    </button>
                  </div>
                )}

                {/* Subfolder administrative rows (ZERO thumbnails / ZERO gallery / ZERO previews) */}
                {loadingFolders ? (
                  <div className="py-10 flex items-center justify-center gap-2.5 text-xs text-[#98A89F]">
                    <SiscomSpinner className="w-4 h-4" tone="gold" />
                    <span>Carregando subpastas de “{currentFolder.name}”...</span>
                  </div>
                ) : subfolders.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/12 bg-[#0A110D]/45 p-6 text-center space-y-2">
                    <Folder className="w-7 h-7 text-[#708278] mx-auto" />
                    <div className="text-xs font-medium text-[#E4EAE6]">
                      Nenhuma subpasta dentro de “{currentFolder.name}”
                    </div>
                    <p className="text-[11px] text-[#98A89F] max-w-md mx-auto leading-relaxed">
                      Você pode criar uma nova subpasta para organizar eventos ou enviar arquivos
                      diretamente para esta pasta abaixo.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/8 rounded-xl border border-white/10 bg-[#0A110D]/55 overflow-hidden">
                    {subfolders.map((folder) => {
                      const isRootProtected = folder.id === rootConfig.rootFolderId;
                      return (
                        <div
                          key={folder.id}
                          className="p-3 sm:px-4 sm:py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 hover:bg-white/[0.025] transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() => handleOpenSubfolder(folder)}
                            className="flex items-center gap-3 min-w-0 flex-1 text-left group cursor-pointer"
                          >
                            <div className="w-9 h-9 rounded-lg bg-[#15261D]/80 border border-[#C9A961]/25 group-hover:border-[#C9A961]/55 flex items-center justify-center text-[#E5C17B] shrink-0 transition-colors">
                              <Folder className="w-4 h-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-[#F4F7F5] group-hover:text-[#F4E6C4] truncate transition-colors">
                                {folder.name}
                              </div>
                              <div className="text-[11px] text-[#8E9F96] flex items-center gap-2">
                                <span>Atualizada: {formatIsoDatePtBr(folder.modifiedTime)}</span>
                              </div>
                            </div>
                            <ChevronRight className="w-4 h-4 text-[#708278] group-hover:text-[#E5C17B] shrink-0 transition-colors sm:hidden" />
                          </button>

                          <div className="flex items-center gap-1.5 shrink-0 pl-12 sm:pl-0">
                            <button
                              type="button"
                              onClick={() => handleOpenSubfolder(folder)}
                              className="siscom-btn siscom-btn-secondary !min-h-[34px] !px-2.5 text-[11px]"
                            >
                              <FolderOpen className="w-3.5 h-3.5 text-[#83B499]" />
                              <span>Abrir</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleQuickUploadToSubfolder(folder)}
                              title={`Enviar arquivos direto para ${folder.name}`}
                              className="siscom-btn siscom-btn-secondary !min-h-[34px] !px-2.5 text-[11px]"
                            >
                              <Upload className="w-3.5 h-3.5 text-[#E5C17B]" />
                              <span className="hidden md:inline">Enviar aqui</span>
                            </button>
                            {!isRootProtected && (
                              <>
                                <button
                                  type="button"
                                  disabled={!folder.canRename}
                                  onClick={() => {
                                    setRenameError(null);
                                    setRenameTarget(folder);
                                  }}
                                  title="Renomear pasta"
                                  aria-label={`Renomear pasta ${folder.name}`}
                                  className="siscom-btn siscom-btn-secondary !min-h-[34px] !px-2.5 text-[11px] disabled:opacity-40"
                                >
                                  <Pencil className="w-3.5 h-3.5 text-[#D6E0DA]" />
                                </button>
                                <button
                                  type="button"
                                  disabled={!folder.canDelete}
                                  onClick={() => void handleStartDeleteFolder(folder)}
                                  title="Excluir pasta"
                                  aria-label={`Excluir pasta ${folder.name}`}
                                  className="siscom-btn siscom-btn-secondary !min-h-[34px] !px-2.5 text-[11px] text-red-200 hover:text-red-100 hover:border-red-400/45 disabled:opacity-40"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 text-[11px] text-[#8E9F96] pt-0.5">
                  <span>
                    Modo administrativo: arquivos não são pré-visualizados nem armazenados no banco
                    interno do SISCOM.
                  </span>
                </div>
              </section>

              {/* ETAPA 4: Multi-File Upload Panel */}
              <section
                ref={uploadSectionRef}
                className="metal-surface rounded-xl p-5 sm:p-6 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/8 pb-3.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <CloudUpload className="w-5 h-5 text-[#E5C17B] shrink-0" />
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-semibold text-[#F4E6C4] tracking-tight">
                        Envio de Arquivos ao Google Drive
                      </h3>
                      <p className="text-xs text-[#98A89F]">
                        Envio direto retomável em blocos (ideal para fotos em lote e vídeos grandes
                        no celular ou computador).
                      </p>
                    </div>
                  </div>
                </div>

                {/* Destination Folder Selector */}
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="upload-target-folder"
                      className="siscom-field-label !text-[11px]"
                    >
                      Pasta de destino no Google Drive
                    </label>
                    <select
                      id="upload-target-folder"
                      value={effectiveUploadTarget?.id || ''}
                      onChange={(e) => {
                        const picked = destinationOptions.find((o) => o.id === e.target.value);
                        if (picked) {
                          setUploadTargetFolder({ id: picked.id, name: picked.name });
                        }
                      }}
                      className="siscom-input !min-h-[40px] text-xs"
                    >
                      {destinationOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="siscom-btn siscom-btn-gold !min-h-[40px] text-xs shrink-0"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Selecionar arquivos</span>
                  </button>
                </div>

                {/* Hidden Multi-File Input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ALLOWED_UPLOAD_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) {
                      handleFilesSelected(e.target.files);
                    }
                    e.target.value = '';
                  }}
                />

                {/* Drag & Drop / Tap Zone (No media previews!) */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setIsDragOver(false);
                  }}
                  onDrop={handleDropZoneDrop}
                  className={`rounded-xl border-2 border-dashed p-5 sm:p-6 text-center transition-colors cursor-pointer space-y-2 ${
                    isDragOver
                      ? 'border-[#E5C17B] bg-[#C9A961]/10'
                      : 'border-white/15 hover:border-[#C9A961]/45 bg-[#0A110D]/50'
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-[#15261D]/80 border border-[#C9A961]/30 flex items-center justify-center text-[#E5C17B] mx-auto">
                    <CloudUpload className="w-5 h-5" />
                  </div>
                  <div className="text-sm font-medium text-[#F4F7F5]">
                    Toque para escolher arquivos ou arraste e solte aqui
                  </div>
                  <p className="text-[11px] text-[#98A89F] leading-relaxed">
                    Destino:{' '}
                    <strong className="text-[#F4E6C4]">{effectiveUploadTarget?.name}</strong> ·
                    Formatos aceitos:{' '}
                    <span className="font-mono text-[#D6E0DA]">
                      JPG, JPEG, PNG, HEIC, MP4, MOV, PDF
                    </span>
                  </p>
                  <p className="text-[11px] text-[#83B499]">
                    Sem limite artificial de tamanho — você pode navegar para outros módulos do
                    SISCOM sem interromper os envios.
                  </p>
                </div>

                {uploadAlert && (
                  <div className="rounded-lg border border-amber-500/35 bg-amber-950/30 px-3.5 py-2.5 text-xs text-amber-100 flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
                      <span className="leading-relaxed">{uploadAlert}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setUploadAlert(null)}
                      aria-label="Fechar aviso"
                      className="text-amber-200 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </section>
            </>
          )}

          {/* Persistent Upload Queue (kept visible even if session temporarily expires so user can reconnect & retry) */}
          {uploadItems.length > 0 && (
            <section className="metal-surface rounded-xl p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-white/8 pb-3.5">
                <div className="space-y-0.5">
                  <h3 className="font-display text-sm font-semibold text-[#F4E6C4] tracking-tight">
                    Fila de Envios ({uploadItems.length})
                  </h3>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#98A89F] font-mono">
                    {(activeCount > 0 || queuedCount > 0) && (
                      <span className="text-[#E5C17B]">
                        Em andamento: {activeCount + queuedCount}
                      </span>
                    )}
                    {completedCount > 0 && (
                      <span className="text-emerald-300">Concluídos: {completedCount}</span>
                    )}
                    {duplicateCount > 0 && (
                      <span className="text-amber-300">Duplicados: {duplicateCount}</span>
                    )}
                    {errorCount > 0 && <span className="text-red-300">Com erro: {errorCount}</span>}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {errorCount > 0 && driveSession.connected && (
                    <button
                      type="button"
                      onClick={retryAllFailed}
                      className="siscom-btn siscom-btn-secondary !min-h-[34px] text-xs"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-[#E5C17B]" />
                      <span>Reenviar com erro</span>
                    </button>
                  )}
                  {hasFinishedUploads && (
                    <button
                      type="button"
                      onClick={clearFinishedUploads}
                      className="siscom-btn siscom-btn-secondary !min-h-[34px] text-xs"
                    >
                      <span>Limpar concluídos</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2.5">
                {uploadItems.map((item) => {
                  const meta = getUploadStatusMeta(item.status);
                  const isRunning =
                    item.status === 'queued' ||
                    item.status === 'checking' ||
                    item.status === 'uploading';

                  return (
                    <div
                      key={item.localId}
                      className="rounded-xl border border-white/10 bg-[#0A110D]/65 p-3.5 space-y-2.5"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 min-w-0">
                            {item.status === 'completed' ? (
                              <FileCheck2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            ) : item.status === 'error' || item.status === 'duplicate' ? (
                              <FileWarning className="w-4 h-4 text-amber-300 shrink-0" />
                            ) : (
                              <CloudUpload className="w-4 h-4 text-[#E5C17B] shrink-0" />
                            )}
                            <span className="text-xs sm:text-sm font-medium text-[#F4F7F5] break-all">
                              {item.uploadName}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#98A89F]">
                            <span className="font-mono">{formatBytes(item.fileSize)}</span>
                            <span>Pasta: {item.targetFolderName}</span>
                            {item.status === 'uploading' && (
                              <span className="font-mono text-[#E5C17B]">
                                {formatBytes(item.bytesUploaded)} / {formatBytes(item.fileSize)} (
                                {item.progress}%)
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium ${meta.badgeClass}`}
                          >
                            {meta.label}
                          </span>
                          {!isRunning && (
                            <button
                              type="button"
                              onClick={() => removeUploadItem(item.localId)}
                              aria-label={`Remover ${item.uploadName} da lista`}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-[#98A89F] hover:text-[#F4F7F5] hover:bg-white/[0.06] cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Individual progress bar */}
                      {(isRunning || item.status === 'completed') && (
                        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-200 ${
                              item.status === 'completed'
                                ? 'bg-emerald-400'
                                : item.status === 'checking'
                                  ? 'bg-[#C9A961]/70 animate-pulse'
                                  : 'bg-gradient-to-r from-[#2D5A43] to-[#DFBC75]'
                            }`}
                            style={{
                              width: `${
                                item.status === 'completed'
                                  ? 100
                                  : item.status === 'checking'
                                    ? 15
                                    : Math.max(3, item.progress)
                              }%`,
                            }}
                          />
                        </div>
                      )}

                      {/* Error or Duplicate details */}
                      {item.errorMessage && (
                        <p
                          className={`text-[11px] leading-relaxed ${
                            item.status === 'duplicate' ? 'text-amber-200' : 'text-red-200'
                          }`}
                        >
                          {item.errorMessage}
                        </p>
                      )}

                      {/* Item-level actions */}
                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        {isRunning && (
                          <button
                            type="button"
                            onClick={() => cancelUpload(item.localId)}
                            className="siscom-btn siscom-btn-secondary !min-h-[32px] !px-2.5 text-[11px] text-red-200 hover:border-red-400/40"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Cancelar</span>
                          </button>
                        )}

                        {item.status === 'duplicate' && (
                          <>
                            <button
                              type="button"
                              disabled={!driveSession.connected}
                              onClick={() => resolveDuplicateWithRename(item.localId)}
                              className="siscom-btn siscom-btn-gold !min-h-[32px] !px-3 text-[11px]"
                            >
                              <Upload className="w-3.5 h-3.5" />
                              <span>
                                Enviar como “{item.suggestedUniqueName || 'cópia renomeada'}”
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => removeUploadItem(item.localId)}
                              className="siscom-btn siscom-btn-secondary !min-h-[32px] !px-2.5 text-[11px]"
                            >
                              Ignorar
                            </button>
                          </>
                        )}

                        {(item.status === 'error' || item.status === 'cancelled') && (
                          <button
                            type="button"
                            disabled={!driveSession.connected}
                            onClick={() => retryUpload(item.localId)}
                            className="siscom-btn siscom-btn-secondary !min-h-[32px] !px-3 text-[11px]"
                          >
                            <RotateCcw className="w-3.5 h-3.5 text-[#E5C17B]" />
                            <span>Tentar novamente</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Recent Immutable Audit Trail */}
          <section className="metal-surface rounded-xl p-5 sm:p-6 space-y-3.5">
            <div className="flex items-center justify-between gap-2 border-b border-white/8 pb-3">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-[#E5C17B]" />
                <h3 className="font-display text-sm font-semibold text-[#F4E6C4] tracking-tight">
                  Registro de Auditoria Recente
                </h3>
              </div>
              <span className="text-[11px] font-mono text-[#98A89F]">
                {auditEntries.length} evento{auditEntries.length === 1 ? '' : 's'}
              </span>
            </div>

            {auditEntries.length === 0 ? (
              <p className="text-xs text-[#98A89F] py-2">
                Nenhuma atividade registrada no Arquivo Institucional até o momento.
              </p>
            ) : (
              <div className="divide-y divide-white/6 text-xs">
                {auditEntries.slice(0, 10).map((entry) => (
                  <div
                    key={entry.id}
                    className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-[#E5C17B]">
                          {DRIVE_AUDIT_ACTION_LABELS[entry.action] || entry.action}
                        </span>
                        <span className="text-[#E4EAE6]">{entry.summary}</span>
                      </div>
                      <div className="text-[11px] text-[#98A89F]">Por {entry.actorName}</div>
                    </div>
                    <div className="text-[11px] font-mono text-[#98A89F] shrink-0">
                      {formatFirestoreDate(entry.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </WorkspaceSplitLayout>

      {/* Etapa 3 Modals: Create, Rename & Safe Delete */}
      <CreateFolderModal
        open={createModalOpen}
        parentPathLabel={currentPathLabel}
        submitting={createSubmitting}
        error={createError}
        onClose={() => {
          if (!createSubmitting) {
            setCreateModalOpen(false);
            setCreateError(null);
          }
        }}
        onSubmit={(folderName) => void handleCreateSubfolder(folderName)}
      />

      <RenameFolderModal
        folder={renameTarget}
        submitting={renameSubmitting}
        error={renameError}
        onClose={() => {
          if (!renameSubmitting) {
            setRenameTarget(null);
            setRenameError(null);
          }
        }}
        onSubmit={(folder, newName) => void handleRenameSubfolder(folder, newName)}
      />

      <DeleteFolderModal
        folder={deleteTarget}
        inspecting={deleteInspecting}
        inspection={deleteInspection}
        submitting={deleteSubmitting}
        error={deleteError}
        onClose={() => {
          if (!deleteSubmitting) {
            setDeleteTarget(null);
            setDeleteInspection(null);
            setDeleteError(null);
          }
        }}
        onConfirmDelete={(folder, confirmNonEmpty) =>
          void handleConfirmDeleteFolder(folder, confirmNonEmpty)
        }
      />
    </>
  );
}
