import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cloud,
  CloudOff,
  ExternalLink,
  FolderCheck,
  FolderLock,
  FolderSearch,
  HardDrive,
  History,
  Link2,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  Unlink,
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
  extractDriveFolderIdFromInput,
  fetchDriveAccountInfo,
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
  DRIVE_AUDIT_ACTION_LABELS,
  DriveAccountInfo,
  DriveAuditEntry,
  DriveFolderCandidate,
  DriveRootConfig,
} from './arquivoTypes';

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

export function ArquivoInstitucional() {
  const { account } = useAuth();
  const isAdmin = account?.role === 'admin';

  // OAuth session state (isolated from SISCOM military login)
  const [driveSession, setDriveSession] = useState<GoogleDriveSession>(() => getGoogleDriveSession());
  const [accountInfo, setAccountInfo] = useState<DriveAccountInfo | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Persisted root folder config in Firestore (remembers "fotos 2026" across sessions)
  const [rootConfig, setRootConfig] = useState<DriveRootConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [auditEntries, setAuditEntries] = useState<DriveAuditEntry[]>([]);

  // Institutional email hint & root selector state
  const [institutionalEmailInput, setInstitutionalEmailInput] = useState(
    DEFAULT_INSTITUTIONAL_DRIVE_EMAIL
  );
  const [isSelectingRoot, setIsSelectingRoot] = useState(false);
  const [searchQuery, setSearchQuery] = useState('fotos 2026');
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

  // Feedback banners
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [unauthorizedDomainUrl, setUnauthorizedDomainUrl] = useState<string | null>(null);

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

  // Search for "fotos 2026" candidates automatically when Admin opens root selection while connected
  const runCandidateSearch = useCallback(
    async (queryToRun: string) => {
      if (!driveSession.connected) return;
      setSearchingCandidates(true);
      setErrorMsg(null);
      try {
        const list = await searchDriveRootCandidates(queryToRun);
        setCandidates(list);
      } catch (err) {
        setCandidates([]);
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
    setUnauthorizedDomainUrl(null);
    try {
      const hint = institutionalEmailInput.trim() || DEFAULT_INSTITUTIONAL_DRIVE_EMAIL;
      const session = await connectGoogleDriveAccount(hint);
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
        setUnauthorizedDomainUrl(err.consoleUrl);
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
    await disconnectGoogleDriveSession();
    setCandidates([]);
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

  return (
    <WorkspaceSplitLayout
      sidebarWidthClass="lg:w-[375px] xl:w-[410px]"
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
                  placeholder="comsoc1bimeces@gmail.com"
                  className="siscom-input !min-h-[38px] text-xs font-mono"
                />
                <p className="text-[11px] text-[#98A89F] leading-relaxed">
                  Ao conectar, o Google sempre abrirá o seletor de contas para escolher a conta da
                  Seção de Comunicação Social, sem alterar seu login militar do SISCOM.
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

              {driveSession.status === 'expired' && (
                <div className="rounded-lg border border-amber-500/35 bg-amber-950/30 p-3 text-xs text-amber-100 space-y-1">
                  <div className="font-medium flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                    <span>Autorização temporária expirada</span>
                  </div>
                  <p className="text-[11px] text-amber-100/80 leading-relaxed">
                    A pasta raiz continua salva no SISCOM, mas por segurança a autorização do Google
                    Drive expira periodicamente. Clique em <strong>Reconectar</strong> abaixo.
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
                    Você entrou com <span className="font-mono">{activeConnectedEmail}</span>, mas a
                    conta institucional definida é{' '}
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

          {/* Card 2: Pasta Raiz Autorizada (fotos 2026) */}
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
                  Confinada
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
                  e selecionar a pasta <strong>fotos 2026</strong>.
                </p>
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <div className="rounded-lg border border-[#C9A961]/25 bg-[#0A120E]/75 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] text-[#98A89F]">Pasta raiz registrada</div>
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
                      <span className="text-[#98A89F]">ID da pasta:</span>
                      <span className="font-mono text-[#D6E0DA] truncate max-w-[190px]">
                        {rootConfig.rootFolderId}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#98A89F]">Conta vinculada:</span>
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
                            ? 'Fechar seletor de pasta raiz'
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
        <AnimatePresence>
          {(notice || errorMsg) && (
            <SiscomAlert
              tone={errorMsg ? 'error' : 'success'}
              onDismiss={() => {
                setNotice(null);
                setErrorMsg(null);
                setUnauthorizedDomainUrl(null);
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{errorMsg || notice}</span>
                {unauthorizedDomainUrl && (
                  <a
                    href={unauthorizedDomainUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[#E5C17B] underline font-medium"
                  >
                    <span>Abrir Domínios Autorizados</span>
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
                    {rootConfig?.rootFolderName || 'fotos 2026'}
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
                  <strong>{rootConfig?.rootFolderName || 'fotos 2026'}</strong> e suas subpastas.
                </p>
              </div>
              <div className="rounded-lg border border-white/8 bg-[#0A110D]/60 p-3.5 space-y-1">
                <div className="font-medium text-[#E5C17B]">3. Interface administrativa</div>
                <p className="text-[#98A89F] leading-relaxed">
                  Gerenciamento de pastas e envio direto sem galeria de imagens nem duplicação no
                  banco interno.
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

        {/* Main Panel State 2: Connected + Admin Selecting Root Folder ("fotos 2026") */}
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
                    Escolha a pasta existente <strong>fotos 2026</strong> para registrar seu ID
                    oficial como raiz única do Arquivo Institucional.
                  </p>
                </div>
              </div>
            </div>

            {/* Search bar for Drive folders */}
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
                  placeholder="Buscar pasta pelo nome (ex: fotos 2026)"
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
                <span>Buscar pastas</span>
              </button>
            </form>

            {/* Folder candidates list (administrative metadata ONLY — zero thumbnails/previews) */}
            <div className="space-y-2">
              {searchingCandidates ? (
                <div className="py-8 flex items-center justify-center gap-2 text-xs text-[#98A89F]">
                  <SiscomSpinner className="w-4 h-4" tone="gold" />
                  <span>Consultando pastas na conta conectada...</span>
                </div>
              ) : candidates.length === 0 ? (
                <div className="rounded-lg border border-white/8 bg-[#0A110D]/60 p-5 text-center space-y-1.5">
                  <p className="text-xs text-[#E4EAE6]">
                    Nenhuma pasta encontrada para “{searchQuery || 'todos'}” na conta{' '}
                    <span className="font-mono text-[#E5C17B]">{activeConnectedEmail}</span>.
                  </p>
                  <p className="text-[11px] text-[#98A89F]">
                    Verifique se você conectou a conta institucional correta ou informe o link/ID da
                    pasta logo abaixo.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-white/8 rounded-xl border border-white/10 bg-[#0A110D]/55 overflow-hidden">
                  {candidates.map((folder) => {
                    const isExactTarget =
                      folder.name.trim().toLowerCase() === 'fotos 2026';
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

            {/* Fallback: Manual folder ID / Google Drive link */}
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
              <strong>fotos 2026</strong>) ainda não foi vinculada. Solicite a um administrador do
              SISCOM para vincular a pasta raiz no módulo Arquivo Institucional.
            </p>
          </section>
        )}

        {/* Main Panel State 4: Connected + Root Folder Configured & Verified */}
        {driveSession.connected && rootConfig && !isSelectingRoot && (
          <section className="metal-surface rounded-xl p-5 sm:p-6 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/8 pb-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-[#1A3326]/70 border border-[#83B499]/35 flex items-center justify-center text-[#9AD0B3] shrink-0">
                  <FolderCheck className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-display text-base font-semibold text-[#F4E6C4] tracking-tight truncate">
                    Pasta raiz ativa: {rootConfig.rootFolderName}
                  </h2>
                  <p className="text-xs text-[#98A89F] mt-0.5">
                    Confinamento ativo — o SISCOM opera exclusivamente dentro desta pasta e suas
                    subpastas.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void refreshAccountAndRootVerification()}
                disabled={loadingAccount || rootAccessStatus === 'checking'}
                className="siscom-btn siscom-btn-secondary !min-h-[36px] text-xs shrink-0"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${
                    loadingAccount || rootAccessStatus === 'checking' ? 'animate-spin' : ''
                  }`}
                />
                <span>Revalidar conexão</span>
              </button>
            </div>

            {/* Storage quota & confinement summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <div className="rounded-xl border border-white/10 bg-[#0A110D]/60 p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-[#E4EAE6]">
                    <HardDrive className="w-4 h-4 text-[#E5C17B]" />
                    <span>Armazenamento do Drive institucional</span>
                  </div>
                  {quotaUsedPercent !== null && (
                    <span className="text-xs font-mono text-[#E5C17B]">{quotaUsedPercent}%</span>
                  )}
                </div>

                {quotaUsedPercent !== null && (
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden">
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
                  <span>Usado: {formatBytes(accountInfo?.storageQuota?.usageBytes)}</span>
                  <span>Limite: {formatBytes(accountInfo?.storageQuota?.limitBytes)}</span>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-[#0A110D]/60 p-4 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-medium text-[#E4EAE6]">
                  <ShieldCheck className="w-4 h-4 text-[#83B499]" />
                  <span>Integridade da Pasta Raiz</span>
                </div>
                <p className="text-xs text-[#C6D4CC] leading-relaxed">
                  {rootAccessStatus === 'verified'
                    ? `Pasta "${rootConfig.rootFolderName}" localizada e validada na conta ${activeConnectedEmail}.`
                    : rootAccessStatus === 'checking'
                      ? 'Validando acesso à pasta raiz no Google Drive...'
                      : rootAccessError ||
                        'Clique em "Revalidar conexão" para confirmar o acesso à pasta raiz.'}
                </p>
                <div className="text-[11px] font-mono text-[#98A89F] truncate">
                  ID registrado: {rootConfig.rootFolderId}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[#C9A961]/25 bg-[#C9A961]/[0.06] px-4 py-3 text-xs text-[#E8E4D8] leading-relaxed">
              Conexão institucional e pasta raiz prontas. O gerenciamento de subpastas (listar,
              criar, renomear e excluir com segurança) e o envio de múltiplos arquivos serão
              habilitados nas próximas etapas (<strong>Etapa 3</strong> e <strong>Etapa 4</strong>).
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
  );
}
