import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Eye,
  FileSearch,
  FileText,
  ListChecks,
  Search,
  ShieldAlert,
  Sparkles,
  Table as TableIcon,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useAuth } from '../../core/auth/AuthContext';
import { auth } from '../../core/auth/firebase';
import { WorkspaceSplitLayout } from '../../shared/WorkspaceSplitLayout';
import { SiscomAlert, SiscomModal, SiscomSpinner } from '../../shared/ui';
import { fadeSlideVariants, UI_TRANSITION } from '../../shared/motion';
import {
  AlteracaoHeaderExtract,
  MONTHS_UPPER,
  StructuredAlteracaoDoc,
} from './alteracaoFormatter';
import { subscribeAlteracaoDocs } from './alteracaoArchiveService';
import { readBulletinFileToPages } from './biReader';
import {
  BiBulletinPage,
  BiDiscardedHomonymItem,
  BiOccurrenceItem,
  BiProviderStatus,
  BiQueuedFile,
  BiSearchMilitaryProfile,
  BiSemesterSelection,
  buildStructuredAlteracaoFromBiOccurrences,
  formatAllSelectedPlainText,
  formatBiReferencePrefix,
  formatSingleOccurrencePlainText,
  getSemesterLabels,
  sortOccurrencesChronologically,
} from './biSearchTypes';

export interface BiSmartSearchSendPayload {
  structuredDoc: StructuredAlteracaoDoc;
  headerExtract: AlteracaoHeaderExtract;
  semestre: string;
  periodo: string;
  closingDateIso: string;
  summaryLabel: string;
}

export interface BiSmartSearchViewProps {
  onSendToEditor: (payload: BiSmartSearchSendPayload) => void;
}

interface ArchivedMilitarySuggestion {
  key: string;
  label: string;
  profile: BiSearchMilitaryProfile;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function makeLocalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getDefaultSemester(): BiSemesterSelection {
  const now = new Date();
  return {
    half: now.getMonth() < 6 ? '1' : '2',
    year: now.getFullYear(),
  };
}

/**
 * Highlights search terms safely in React JSX (no raw HTML injection).
 */
function renderHighlightedText(text: string, terms: string[]): React.ReactNode {
  const cleanTerms = Array.from(
    new Set(
      terms
        .map((t) => t.trim())
        .filter((t) => t.length >= 3)
        .sort((a, b) => b.length - a.length)
    )
  );
  if (cleanTerms.length === 0 || !text) return text;

  const escaped = cleanTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(re);

  return parts.map((part, idx) => {
    const isHit = cleanTerms.some((t) => t.toLowerCase() === part.toLowerCase());
    if (isHit) {
      return (
        <mark
          key={idx}
          className="bg-[#C9A961]/35 text-[#F9EED1] rounded px-0.5 font-semibold"
        >
          {part}
        </mark>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export const BiSmartSearchView: React.FC<BiSmartSearchViewProps> = ({ onSendToEditor }) => {
  const { account } = useAuth();
  const [military, setMilitary] = useState<BiSearchMilitaryProfile>({
    nomeCompleto: '',
    postoGraduacao: '',
    nomeGuerra: '',
    subunidade: '',
    identidade: '',
    qasQms: '',
  });
  const [semester, setSemester] = useState<BiSemesterSelection>(() => getDefaultSemester());
  const [includeFirstPart, setIncludeFirstPart] = useState(false);
  const [archivedSuggestions, setArchivedSuggestions] = useState<ArchivedMilitarySuggestion[]>([]);
  const [providerStatus, setProviderStatus] = useState<BiProviderStatus | null>(null);

  const [queuedFiles, setQueuedFiles] = useState<BiQueuedFile[]>([]);
  const [occurrences, setOccurrences] = useState<BiOccurrenceItem[]>([]);
  const [discardedHomonyms, setDiscardedHomonyms] = useState<BiDiscardedHomonymItem[]>([]);

  const [isSearching, setIsSearching] = useState(false);
  const [searchStatus, setSearchStatus] = useState<string>('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(
    null
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [inspectModal, setInspectModal] = useState<{
    occurrence: BiOccurrenceItem;
    pages: BiBulletinPage[];
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const semesterTouchedRef = useRef(false);

  // Load military profile suggestions quietly from the user's own already-archived Alterações
  useEffect(() => {
    if (!account?.uid) return;
    const unsub = subscribeAlteracaoDocs(
      account.uid,
      (docs) => {
        const seen = new Map<string, ArchivedMilitarySuggestion>();
        for (const doc of docs) {
          const full = doc.header.nomeCompleto?.trim() || '';
          if (!full) continue;
          const key = full.toUpperCase();
          if (seen.has(key)) continue;
          seen.set(key, {
            key,
            label: [doc.header.postoGraduacao, full].filter(Boolean).join(' '),
            profile: {
              nomeCompleto: full,
              postoGraduacao: doc.header.postoGraduacao || '',
              nomeGuerra: doc.header.nomeGuerra || '',
              subunidade: '',
              identidade: doc.header.identidade || '',
              qasQms: doc.header.qasQms || '',
            },
          });
        }
        setArchivedSuggestions(Array.from(seen.values()));
      },
      () => {
        // Ignore silently — suggestions are strictly optional
      }
    );
    return () => unsub();
  }, [account?.uid]);

  // Check active server AI provider status (OpenAI / Gemini)
  useEffect(() => {
    let cancelled = false;
    const checkProvider = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const res = await fetch('/api/bi/provider-status', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as BiProviderStatus;
        if (!cancelled) setProviderStatus(data);
      } catch {
        // Ignore transient network check errors
      }
    };
    void checkProvider();
    return () => {
      cancelled = true;
    };
  }, []);

  const semesterMeta = useMemo(() => getSemesterLabels(semester), [semester]);

  const sortedOccurrences = useMemo(
    () => sortOccurrencesChronologically(occurrences),
    [occurrences]
  );

  const pendingReviewOccurrences = useMemo(
    () => sortedOccurrences.filter((o) => o.matchConfidence === 'conferir'),
    [sortedOccurrences]
  );

  const confirmedOccurrences = useMemo(
    () => sortedOccurrences.filter((o) => o.matchConfidence === 'confirmada'),
    [sortedOccurrences]
  );

  const selectedCount = useMemo(
    () => occurrences.filter((o) => o.selected).length,
    [occurrences]
  );

  const emptyMonthsInSemester = useMemo(() => {
    const monthsWithSelected = new Set(
      occurrences.filter((o) => o.selected && o.bulletinMonth).map((o) => o.bulletinMonth)
    );
    return semesterMeta.months.filter((m) => !monthsWithSelected.has(m));
  }, [occurrences, semesterMeta.months]);

  const updateMilitary = <K extends keyof BiSearchMilitaryProfile>(
    field: K,
    value: BiSearchMilitaryProfile[K]
  ) => {
    setMilitary((prev) => ({ ...prev, [field]: value }));
  };

  const handleApplySuggestion = (key: string) => {
    const found = archivedSuggestions.find((s) => s.key === key);
    if (!found) return;
    setMilitary((prev) => ({
      ...prev,
      nomeCompleto: found.profile.nomeCompleto,
      postoGraduacao: found.profile.postoGraduacao || prev.postoGraduacao,
      nomeGuerra: found.profile.nomeGuerra || prev.nomeGuerra,
      identidade: found.profile.identidade || prev.identidade,
      qasQms: found.profile.qasQms || prev.qasQms,
    }));
  };

  const addFilesToQueue = (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).filter((f) => {
      const low = f.name.toLowerCase();
      return (
        low.endsWith('.pdf') ||
        low.endsWith('.docx') ||
        low.endsWith('.txt') ||
        f.type === 'application/pdf' ||
        f.type === 'text/plain'
      );
    });

    if (incoming.length === 0) {
      setNotice({
        tone: 'error',
        text: 'Selecione arquivos de Boletim Interno em formato .pdf, .docx ou .txt.',
      });
      return;
    }

    setQueuedFiles((prev) => {
      const existingSig = new Set(prev.map((q) => `${q.fileName}::${q.fileSize}`));
      const additions: BiQueuedFile[] = [];
      for (const file of incoming) {
        const sig = `${file.name}::${file.size}`;
        if (existingSig.has(sig)) continue;
        existingSig.add(sig);
        additions.push({
          id: makeLocalId('bi-file'),
          file,
          fileName: file.name,
          fileSize: file.size,
          status: 'queued',
        });
      }
      return [...prev, ...additions];
    });
    if (!semesterTouchedRef.current) {
      for (const file of incoming) {
        const m = file.name.match(/\b(20\d{2})-(\d{2})-\d{2}\b/);
        if (m) {
          const year = parseInt(m[1], 10);
          const month = parseInt(m[2], 10);
          if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12) {
            setSemester({ half: month <= 6 ? '1' : '2', year });
            break;
          }
        }
      }
    }
    setNotice(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFilesToQueue(e.target.files);
    }
    e.target.value = '';
  };

  const handleDropFiles = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFilesToQueue(e.dataTransfer.files);
    }
  };

  const handleRemoveFile = (fileId: string) => {
    if (isSearching) return;
    setQueuedFiles((prev) => prev.filter((f) => f.id !== fileId));
    setOccurrences((prev) => prev.filter((o) => o.fileId !== fileId));
    setDiscardedHomonyms((prev) => prev.filter((h) => h.fileId !== fileId));
  };

  const handleClearAll = () => {
    if (isSearching) return;
    setQueuedFiles([]);
    setOccurrences([]);
    setDiscardedHomonyms([]);
    setNotice(null);
  };

  const handleCancelSearch = () => {
    abortControllerRef.current?.abort();
  };

  const handleStartSearch = async () => {
    const cleanName = military.nomeCompleto.trim();
    if (cleanName.length < 2) {
      setNotice({
        tone: 'error',
        text: 'Digite o nome do militar que deseja pesquisar antes de iniciar.',
      });
      return;
    }
    if (queuedFiles.length === 0) {
      setNotice({
        tone: 'error',
        text: 'Importe ao menos um Boletim Interno (.pdf, .docx ou .txt) para iniciar a pesquisa.',
      });
      return;
    }

    const token = await auth.currentUser?.getIdToken().catch(() => null);
    if (!token) {
      setNotice({
        tone: 'error',
        text: 'Sessão não autenticada. Recarregue a página ou faça login novamente.',
      });
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsSearching(true);
    setNotice(null);
    setOccurrences([]);
    setDiscardedHomonyms([]);

    // Reset statuses
    setQueuedFiles((prev) =>
      prev.map((f) => ({
        ...f,
        status: 'queued',
        progressText: undefined,
        errorMessage: undefined,
        occurrencesCount: undefined,
        homonymsCount: undefined,
      }))
    );

    const collectedOccurrences: BiOccurrenceItem[] = [];
    const collectedHomonyms: BiDiscardedHomonymItem[] = [];
    let successFiles = 0;
    let failedFiles = 0;
    let lastProviderLabel = '';

    for (let idx = 0; idx < queuedFiles.length; idx++) {
      if (controller.signal.aborted) break;
      const item = queuedFiles[idx];
      setSearchStatus(`Processando ${idx + 1}/${queuedFiles.length}: ${item.fileName}`);

      try {
        // 1) Read pages (reuse cached pages if already parsed in this session)
        let pages = item.pages;
        if (!pages || pages.length === 0) {
          setQueuedFiles((prev) =>
            prev.map((f) =>
              f.id === item.id
                ? { ...f, status: 'reading', progressText: 'Lendo documento...' }
                : f
            )
          );
          pages = await readBulletinFileToPages(item.file, (stage, detail) => {
            setQueuedFiles((prev) =>
              prev.map((f) =>
                f.id === item.id ? { ...f, status: stage, progressText: detail } : f
              )
            );
          });
          setQueuedFiles((prev) =>
            prev.map((f) => (f.id === item.id ? { ...f, pages } : f))
          );
        }

        if (controller.signal.aborted) break;

        // 2) Send paginated text to authenticated server AI extraction endpoint
        setQueuedFiles((prev) =>
          prev.map((f) =>
            f.id === item.id
              ? { ...f, status: 'analyzing', progressText: 'Analisando boletim com IA...' }
              : f
          )
        );

        const freshToken = (await auth.currentUser?.getIdToken().catch(() => null)) || token;
        const response = await fetch('/api/bi/extract', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${freshToken}`,
          },
          body: JSON.stringify({
            military,
            bulletin: {
              fileName: item.fileName,
              pages,
            },
            options: {
              includeFirstPart,
            },
          }),
        });

        const rawBodyText = await response.text().catch(() => '');
        let payload: {
          error?: string;
          providerUsed?: 'openai' | 'gemini';
          modelUsed?: string;
          bulletinMeta?: {
            bulletinNumber?: string;
            bulletinDateIso?: string;
            bulletinMonth?: string;
          };
          occurrences?: Array<{
            title: string;
            subtitle: string;
            bulletinPart: string;
            bulletinNumber: string;
            bulletinDateIso: string;
            bulletinDay: number | null;
            bulletinMonth: string;
            bulletinYear: number | null;
            contentText: string;
            personnelListText: string;
            emConsequenciaText: string;
            tableRows: string[][];
            sourcePages: number[];
            matchConfidence: 'confirmada' | 'conferir';
            matchReason: string;
            matchedExcerpt: string;
          }>;
          discardedHomonyms?: Array<{
            nameFound: string;
            rankFound: string;
            pageNumber: number;
            bulletinPart: string;
            reason: string;
          }>;
        } = {};
        if (rawBodyText) {
          try {
            payload = JSON.parse(rawBodyText) as typeof payload;
          } catch {
            payload = {};
          }
        }

        if (!response.ok) {
          if (response.status === 404 && !payload.error) {
            const currentHost =
              typeof window !== 'undefined' && window.location?.host
                ? window.location.host
                : 'servidor atual';
            throw new Error(
              `Rota /api/bi/extract indisponível em ${currentHost} (HTTP 404). Este endereço está servindo apenas arquivos estáticos sem o servidor Node ativo — recarregue na URL de execução do servidor ou republique o aplicativo.`
            );
          }
          throw new Error(payload.error || `Falha na análise (HTTP ${response.status}).`);
        }

        if (payload.providerUsed) {
          lastProviderLabel = payload.providerUsed === 'openai' ? 'OpenAI' : 'Gemini';
        }

        const fileOccurrences: BiOccurrenceItem[] = (payload.occurrences || []).map((occ) => ({
          id: makeLocalId('occ'),
          fileId: item.id,
          fileName: item.fileName,
          title: occ.title || 'ASSUNTOS GERAIS E ADMINISTRATIVOS',
          subtitle: occ.subtitle || '',
          bulletinPart: occ.bulletinPart || '',
          bulletinNumber: occ.bulletinNumber || payload.bulletinMeta?.bulletinNumber || '',
          bulletinDateIso: occ.bulletinDateIso || payload.bulletinMeta?.bulletinDateIso || '',
          bulletinDay: occ.bulletinDay ?? null,
          bulletinMonth: occ.bulletinMonth || payload.bulletinMeta?.bulletinMonth || '',
          bulletinYear: occ.bulletinYear ?? null,
          contentText: occ.contentText || '',
          personnelListText: occ.personnelListText || '',
          emConsequenciaText: occ.emConsequenciaText || '',
          tableRows: Array.isArray(occ.tableRows) ? occ.tableRows : [],
          sourcePages: Array.isArray(occ.sourcePages) ? occ.sourcePages : [],
          matchConfidence: occ.matchConfidence === 'conferir' ? 'conferir' : 'confirmada',
          matchReason: occ.matchReason || '',
          matchedExcerpt: occ.matchedExcerpt || '',
          // Confirmed items start checked; uncertain items NEVER auto-assigned!
          selected: occ.matchConfidence !== 'conferir',
          includePersonnelList: false,
          includeEmConsequencia: false,
          includeTable: Array.isArray(occ.tableRows) && occ.tableRows.length > 0,
        }));

        const fileHomonyms: BiDiscardedHomonymItem[] = (payload.discardedHomonyms || []).map(
          (h) => ({
            id: makeLocalId('hom'),
            fileId: item.id,
            fileName: item.fileName,
            bulletinNumber: payload.bulletinMeta?.bulletinNumber || '',
            nameFound: h.nameFound,
            rankFound: h.rankFound,
            pageNumber: h.pageNumber,
            bulletinPart: h.bulletinPart,
            reason: h.reason,
          })
        );

        collectedOccurrences.push(...fileOccurrences);
        collectedHomonyms.push(...fileHomonyms);
        setOccurrences([...collectedOccurrences]);
        setDiscardedHomonyms([...collectedHomonyms]);

        if (!semesterTouchedRef.current && payload.bulletinMeta?.bulletinDateIso) {
          const m = payload.bulletinMeta.bulletinDateIso.match(/^(\d{4})-(\d{2})-\d{2}$/);
          if (m) {
            const year = parseInt(m[1], 10);
            const month = parseInt(m[2], 10);
            if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12) {
              setSemester({ half: month <= 6 ? '1' : '2', year });
            }
          }
        }

        successFiles++;
        setQueuedFiles((prev) =>
          prev.map((f) =>
            f.id === item.id
              ? {
                  ...f,
                  status: 'done',
                  progressText: undefined,
                  bulletinNumber: payload.bulletinMeta?.bulletinNumber || '',
                  bulletinDateIso: payload.bulletinMeta?.bulletinDateIso || '',
                  bulletinMonth: payload.bulletinMeta?.bulletinMonth || '',
                  occurrencesCount: fileOccurrences.length,
                  homonymsCount: fileHomonyms.length,
                }
              : f
          )
        );
      } catch (err) {
        if (controller.signal.aborted) break;
        failedFiles++;
        const msg = err instanceof Error ? err.message : 'Erro ao processar boletim.';
        setQueuedFiles((prev) =>
          prev.map((f) =>
            f.id === item.id
              ? { ...f, status: 'error', progressText: undefined, errorMessage: msg }
              : f
          )
        );
      }
    }

    abortControllerRef.current = null;
    setIsSearching(false);
    setSearchStatus('');

    if (controller.signal.aborted) {
      setNotice({ tone: 'info', text: 'Pesquisa interrompida pelo usuário.' });
      return;
    }

    const totalConf = collectedOccurrences.filter((o) => o.matchConfidence === 'confirmada').length;
    const totalRev = collectedOccurrences.filter((o) => o.matchConfidence === 'conferir').length;
    const provSuffix = lastProviderLabel ? ` via ${lastProviderLabel}` : '';

    if (failedFiles > 0 && successFiles === 0) {
      setNotice({
        tone: 'error',
        text: 'Não foi possível concluir a análise dos boletins. Verifique os detalhes nos arquivos listados.',
      });
    } else if (collectedOccurrences.length === 0) {
      setNotice({
        tone: 'info',
        text: `Análise concluída${provSuffix} (${successFiles} BI${successFiles > 1 ? 's' : ''}): nenhuma alteração encontrada para ${cleanName}.`,
      });
    } else {
      const reviewNote =
        totalRev > 0
          ? ` e ${totalRev} para conferência manual`
          : '';
      setNotice({
        tone: 'success',
        text: `Análise concluída${provSuffix}: ${totalConf} ocorrência${totalConf !== 1 ? 's' : ''} confirmada${totalConf !== 1 ? 's' : ''}${reviewNote}.`,
      });
    }
  };

  const updateOccurrence = (
    id: string,
    patch: Partial<BiOccurrenceItem>
  ) => {
    setOccurrences((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  };

  const handleCopyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(key);
      window.setTimeout(() => setCopiedId((curr) => (curr === key ? null : curr)), 1800);
    } catch {
      setNotice({ tone: 'error', text: 'Não foi possível copiar para a área de transferência.' });
    }
  };

  const handleInspectOriginal = (occ: BiOccurrenceItem) => {
    const fileRec = queuedFiles.find((f) => f.id === occ.fileId);
    const allPages = fileRec?.pages || [];
    const targetNums =
      occ.sourcePages.length > 0 ? new Set(occ.sourcePages) : new Set(allPages.map((p) => p.pageNumber));
    const filtered = allPages.filter((p) => targetNums.has(p.pageNumber));
    setInspectModal({
      occurrence: occ,
      pages: filtered.length > 0 ? filtered : allPages.slice(0, 3),
    });
  };

  const handleGenerateFolha = () => {
    const built = buildStructuredAlteracaoFromBiOccurrences({
      military,
      occurrences,
      semester,
    });
    const label =
      selectedCount > 0
        ? `Alteração gerada de Boletins (${selectedCount} ocorrência${selectedCount > 1 ? 's' : ''})`
        : `Alteração gerada (${built.semestre} — Sem Alteração)`;
    onSendToEditor({
      structuredDoc: built.structuredDoc,
      headerExtract: built.headerExtract,
      semestre: built.semestre,
      periodo: built.periodo,
      closingDateIso: built.closingDateIso,
      summaryLabel: label,
    });
  };

  const highlightTerms = useMemo(() => {
    const tokens = [
      military.nomeCompleto,
      military.nomeGuerra,
      ...military.nomeCompleto.split(/\s+/).filter((w) => w.length >= 4),
    ];
    return tokens;
  }, [military.nomeCompleto, military.nomeGuerra]);

  const renderOccurrenceCard = (occ: BiOccurrenceItem) => {
    const isPendingReview = occ.matchConfidence === 'conferir';
    const refPreview = formatBiReferencePrefix(occ.bulletinDay, occ.bulletinNumber);
    const listLineCount = occ.personnelListText
      ? occ.personnelListText.split(/\r?\n/).filter((l) => l.trim().length > 0).length
      : 0;

    return (
      <div
        key={occ.id}
        className={`rounded-xl border p-4 space-y-3 transition-colors ${
          isPendingReview
            ? 'border-[#C9A961]/55 bg-[#1C1910]/70'
            : occ.selected
              ? 'border-[#2D5A43]/60 bg-[#0D1611]/75'
              : 'border-white/[0.08] bg-[#0B110E]/50 opacity-75'
        }`}
      >
        {/* Top bar: Checkbox + Origin meta + Actions */}
        <div className="flex flex-wrap items-start justify-between gap-2.5">
          <label className="flex items-start gap-2.5 cursor-pointer select-none min-w-0 flex-1">
            <input
              type="checkbox"
              checked={occ.selected}
              onChange={(e) => updateOccurrence(occ.id, { selected: e.target.checked })}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#C9A961] cursor-pointer"
            />
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <span className="font-mono font-semibold text-[#E5C17B]">{refPreview}</span>
                {occ.bulletinMonth && (
                  <span className="text-[11px] font-mono text-[#98A89F]">{occ.bulletinMonth}</span>
                )}
                {occ.sourcePages.length > 0 && (
                  <span className="text-[11px] text-[#8EA196]">
                    Pág. {occ.sourcePages.join(', ')}
                  </span>
                )}
                {occ.bulletinPart && (
                  <span className="text-[11px] text-[#7D9186]">· {occ.bulletinPart}</span>
                )}
              </div>
              <div className="text-[11px] text-[#8EA196] truncate" title={occ.fileName}>
                Origem: {occ.fileName}
              </div>
            </div>
          </label>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => handleInspectOriginal(occ)}
              title="Ver páginas originais do BI"
              className="siscom-btn siscom-btn-secondary !min-h-[32px] !px-2.5 text-[11px]"
            >
              <Eye className="w-3.5 h-3.5 text-[#E5C17B]" />
              <span>Original</span>
            </button>
            <button
              type="button"
              onClick={() => handleCopyText(formatSingleOccurrencePlainText(occ), occ.id)}
              title="Copiar transcrição desta ocorrência"
              className="siscom-btn siscom-btn-secondary !min-h-[32px] !px-2.5 text-[11px]"
            >
              {copiedId === occ.id ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#78C29B]" />
                  <span>Copiado</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-[#83B499]" />
                  <span>Copiar</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Manual conference warning if ambiguous */}
        {isPendingReview && (
          <div className="rounded-lg border border-[#C9A961]/45 bg-[#2A2210]/70 px-3 py-2 flex items-start gap-2 text-xs text-[#F4E0AE]">
            <AlertTriangle className="w-4 h-4 text-[#E5C17B] shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="font-semibold">Conferência manual obrigatória (não atribuída automaticamente)</div>
              <div className="text-[11px] text-[#E6D5AA]">
                {occ.matchReason ||
                  'Identificação parcial no boletim. Confira o trecho original antes de marcar para inclusão.'}
              </div>
              {occ.matchedExcerpt && (
                <div className="text-[11px] font-mono text-[#F4E6C4]/90 pt-0.5">
                  Trecho encontrado: “{occ.matchedExcerpt}”
                </div>
              )}
            </div>
          </div>
        )}

        {/* Editable Metadata Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
          <div className="sm:col-span-5 space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-[#98A89F]">
              Título
            </label>
            <input
              type="text"
              value={occ.title}
              onChange={(e) => updateOccurrence(occ.id, { title: e.target.value })}
              className="siscom-input w-full !min-h-[34px] !px-2.5 text-xs font-semibold"
            />
          </div>
          <div className="sm:col-span-7 space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-[#98A89F]">
              Subtítulo
            </label>
            <input
              type="text"
              value={occ.subtitle}
              onChange={(e) => updateOccurrence(occ.id, { subtitle: e.target.value })}
              placeholder="(Opcional)"
              className="siscom-input w-full !min-h-[34px] !px-2.5 text-xs"
            />
          </div>
          <div className="sm:col-span-2 space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-[#98A89F]">Dia</label>
            <input
              type="number"
              min={1}
              max={31}
              value={occ.bulletinDay ?? ''}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                updateOccurrence(occ.id, {
                  bulletinDay: Number.isFinite(n) && n >= 1 && n <= 31 ? n : null,
                });
              }}
              className="siscom-input w-full !min-h-[34px] !px-2.5 font-mono text-xs"
            />
          </div>
          <div className="sm:col-span-4 space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-[#98A89F]">Mês</label>
            <select
              value={occ.bulletinMonth}
              onChange={(e) => updateOccurrence(occ.id, { bulletinMonth: e.target.value })}
              className="siscom-input w-full !min-h-[34px] !px-2.5 text-xs"
            >
              <option value="">Selecionar mês</option>
              {MONTHS_UPPER.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-3 space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-[#98A89F]">
              Nº do BI
            </label>
            <input
              type="text"
              value={occ.bulletinNumber}
              onChange={(e) => updateOccurrence(occ.id, { bulletinNumber: e.target.value })}
              placeholder="Ex.: 2"
              className="siscom-input w-full !min-h-[34px] !px-2.5 font-mono text-xs"
            />
          </div>
          <div className="sm:col-span-3 space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-[#98A89F]">
              Data do BI
            </label>
            <input
              type="date"
              value={occ.bulletinDateIso}
              onChange={(e) => {
                const iso = e.target.value;
                const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                if (match) {
                  const y = parseInt(match[1], 10);
                  const mIdx = parseInt(match[2], 10) - 1;
                  const d = parseInt(match[3], 10);
                  updateOccurrence(occ.id, {
                    bulletinDateIso: iso,
                    bulletinDay: d,
                    bulletinMonth: MONTHS_UPPER[mIdx] || occ.bulletinMonth,
                    bulletinYear: y,
                  });
                } else {
                  updateOccurrence(occ.id, { bulletinDateIso: iso });
                }
              }}
              className="siscom-input w-full !min-h-[34px] !px-2 text-xs"
            />
          </div>
        </div>

        {/* Editable Verbatim Body Content */}
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label className="block text-[10px] uppercase tracking-wider text-[#98A89F]">
              Conteúdo Integral da Alteração
            </label>
            <span className="text-[10px] text-[#7D9186]">Texto literal preservado</span>
          </div>
          <textarea
            value={occ.contentText}
            onChange={(e) => updateOccurrence(occ.id, { contentText: e.target.value })}
            rows={Math.min(10, Math.max(3, Math.ceil(occ.contentText.length / 95) + 1))}
            className="siscom-input w-full !py-2 !px-3 text-xs leading-relaxed resize-y font-serif"
          />
        </div>

        {/* Optional Long Personnel List Toggle + Expandable Editor */}
        {occ.personnelListText && (
          <div className="rounded-lg border border-white/[0.08] bg-[#0A110E]/65 p-2.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-[#DCE5DF] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={occ.includePersonnelList}
                  onChange={(e) =>
                    updateOccurrence(occ.id, { includePersonnelList: e.target.checked })
                  }
                  className="h-3.5 w-3.5 accent-[#C9A961] cursor-pointer"
                />
                <ListChecks className="w-3.5 h-3.5 text-[#E5C17B]" />
                <span>
                  Incluir lista completa de militares ({listLineCount} linha
                  {listLineCount !== 1 ? 's' : ''})
                </span>
              </label>
              <span className="text-[10px] text-[#8EA196]">
                {occ.includePersonnelList ? 'Será incluída na folha' : 'Oculta (padrão Folha 26.1)'}
              </span>
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer text-[11px] text-[#98A89F] hover:text-[#E5C17B] select-none">
                Visualizar / editar lista extraída
              </summary>
              <textarea
                value={occ.personnelListText}
                onChange={(e) => updateOccurrence(occ.id, { personnelListText: e.target.value })}
                rows={6}
                className="siscom-input mt-2 w-full !py-2 !px-2.5 font-mono text-[11px] leading-relaxed resize-y"
              />
            </details>
          </div>
        )}

        {/* Optional "Em consequência" Toggle */}
        {occ.emConsequenciaText && (
          <div className="rounded-lg border border-white/[0.08] bg-[#0A110E]/65 p-2.5 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-[#DCE5DF] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={occ.includeEmConsequencia}
                  onChange={(e) =>
                    updateOccurrence(occ.id, { includeEmConsequencia: e.target.checked })
                  }
                  className="h-3.5 w-3.5 accent-[#C9A961] cursor-pointer"
                />
                <span>Incluir bloco “Em consequência”</span>
              </label>
              <span className="text-[10px] text-[#8EA196]">
                {occ.includeEmConsequencia ? 'Será incluído' : 'Oculto (padrão Folha 26.1)'}
              </span>
            </div>
            <p className="text-[11px] text-[#98A89F] leading-snug pl-5 line-clamp-2">
              {occ.emConsequenciaText}
            </p>
          </div>
        )}

        {/* Optional Structured Table Preview + Toggle */}
        {occ.tableRows.length > 0 && (
          <div className="rounded-lg border border-white/[0.08] bg-[#0A110E]/65 p-2.5 space-y-2">
            <label className="flex items-center gap-2 text-xs text-[#DCE5DF] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={occ.includeTable}
                onChange={(e) => updateOccurrence(occ.id, { includeTable: e.target.checked })}
                className="h-3.5 w-3.5 accent-[#C9A961] cursor-pointer"
              />
              <TableIcon className="w-3.5 h-3.5 text-[#83B499]" />
              <span>
                Incluir tabela extraída ({occ.tableRows.length} linha
                {occ.tableRows.length !== 1 ? 's' : ''})
              </span>
            </label>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[11px] text-[#DCE5DF]">
                <tbody>
                  {occ.tableRows.map((row, rIdx) => (
                    <tr key={rIdx} className={rIdx === 0 ? 'bg-white/[0.05] font-semibold' : ''}>
                      {row.map((cell, cIdx) => (
                        <td
                          key={cIdx}
                          className="border border-white/15 px-2 py-1 align-top whitespace-pre-wrap"
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <WorkspaceSplitLayout
        sidebarWidthClass="lg:w-[340px] xl:w-[370px]"
        sidebar={
          <div className="metal-surface lg:bg-transparent lg:border-0 lg:shadow-none rounded-xl lg:rounded-none p-4 sm:p-5 lg:p-1 space-y-5">
            {/* Step 1: Militar Pesquisado */}
            <div className="space-y-3 pb-4 border-b border-white/[0.08]">
              <div className="flex items-center justify-between gap-2">
                <span className="siscom-field-label flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-[#E5C17B]" />
                  <span>1. Militar Pesquisado</span>
                </span>
                {providerStatus && (
                  <span className="text-[10px] font-mono text-[#8EA196]">
                    IA: {providerStatus.provider === 'openai' ? 'OpenAI' : providerStatus.provider === 'gemini' ? 'Gemini' : 'Indisponível'}
                  </span>
                )}
              </div>

              {archivedSuggestions.length > 0 && (
                <div className="space-y-1">
                  <label htmlFor="bi-archived-suggest" className="block text-[11px] text-[#98A89F]">
                    Preenchimento rápido (do seu arquivo)
                  </label>
                  <select
                    id="bi-archived-suggest"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) handleApplySuggestion(e.target.value);
                    }}
                    className="siscom-input w-full !min-h-[36px] !px-2.5 text-xs"
                  >
                    <option value="">Selecionar militar arquivado (opcional)...</option>
                    {archivedSuggestions.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-1">
                <label htmlFor="bi-mil-nome" className="block text-[11px] font-medium text-[#E5C17B]">
                  Nome do militar *
                </label>
                <input
                  id="bi-mil-nome"
                  type="text"
                  value={military.nomeCompleto}
                  onChange={(e) => updateMilitary('nomeCompleto', e.target.value)}
                  placeholder="Ex.: EDSON DA SILVA CARDOSO"
                  className="siscom-input w-full !min-h-[40px] px-3 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label htmlFor="bi-mil-posto" className="block text-[11px] text-[#98A89F]">
                    Posto / Grad.
                  </label>
                  <input
                    id="bi-mil-posto"
                    type="text"
                    value={military.postoGraduacao}
                    onChange={(e) => updateMilitary('postoGraduacao', e.target.value)}
                    placeholder="Ex.: 2º Sgt"
                    className="siscom-input w-full !min-h-[36px] px-2.5 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="bi-mil-guerra" className="block text-[11px] text-[#98A89F]">
                    Nome de guerra
                  </label>
                  <input
                    id="bi-mil-guerra"
                    type="text"
                    value={military.nomeGuerra}
                    onChange={(e) => updateMilitary('nomeGuerra', e.target.value)}
                    placeholder="Ex.: CARDOSO"
                    className="siscom-input w-full !min-h-[36px] px-2.5 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="bi-mil-su" className="block text-[11px] text-[#98A89F]">
                    Subunidade / Cia
                  </label>
                  <input
                    id="bi-mil-su"
                    type="text"
                    value={military.subunidade}
                    onChange={(e) => updateMilitary('subunidade', e.target.value)}
                    placeholder="Ex.: Cia C Ap"
                    className="siscom-input w-full !min-h-[36px] px-2.5 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="bi-mil-idt" className="block text-[11px] text-[#98A89F]">
                    Identidade
                  </label>
                  <input
                    id="bi-mil-idt"
                    type="text"
                    value={military.identidade}
                    onChange={(e) => updateMilitary('identidade', e.target.value)}
                    placeholder="Opcional"
                    className="siscom-input w-full !min-h-[36px] px-2.5 font-mono text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="bi-mil-qms" className="block text-[11px] text-[#98A89F]">
                  QAS / QMS (para o cabeçalho da folha)
                </label>
                <input
                  id="bi-mil-qms"
                  type="text"
                  value={military.qasQms}
                  onChange={(e) => updateMilitary('qasQms', e.target.value)}
                  placeholder="Ex.: Infantaria / QMG 00"
                  className="siscom-input w-full !min-h-[36px] px-2.5 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="space-y-1">
                  <label htmlFor="bi-semestre" className="block text-[11px] text-[#98A89F]">
                    Semestre da Folha
                  </label>
                  <select
                    id="bi-semestre"
                    value={semester.half}
                    onChange={(e) => {
                      semesterTouchedRef.current = true;
                      setSemester((prev) => ({
                        ...prev,
                        half: e.target.value === '2' ? '2' : '1',
                      }));
                    }}
                    className="siscom-input w-full !min-h-[36px] !px-2.5 text-xs"
                  >
                    <option value="1">1º Semestre (Jan–Jun)</option>
                    <option value="2">2º Semestre (Jul–Dez)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="bi-ano" className="block text-[11px] text-[#98A89F]">
                    Ano
                  </label>
                  <input
                    id="bi-ano"
                    type="number"
                    min={2000}
                    max={2100}
                    value={semester.year}
                    onChange={(e) => {
                      semesterTouchedRef.current = true;
                      setSemester((prev) => ({
                        ...prev,
                        year: Math.max(2000, Math.min(2100, Number(e.target.value) || prev.year)),
                      }));
                    }}
                    className="siscom-input w-full !min-h-[36px] !px-2.5 font-mono text-xs"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-[11px] text-[#98A89F] cursor-pointer select-none pt-1">
                <input
                  type="checkbox"
                  checked={includeFirstPart}
                  onChange={(e) => setIncludeFirstPart(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[#C9A961] cursor-pointer"
                />
                <span>Incluir 1ª Parte (Serviços Diários / Escala)</span>
              </label>
            </div>

            {/* Step 2: Importar Boletins Internos */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="siscom-field-label flex items-center gap-1.5">
                  <FileSearch className="w-3.5 h-3.5 text-[#83B499]" />
                  <span>2. Boletins Internos ({queuedFiles.length})</span>
                </span>
                {queuedFiles.length > 0 && !isSearching && (
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="text-[11px] text-[#98A89F] hover:text-white hover:underline cursor-pointer"
                  >
                    Limpar lista
                  </button>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.txt"
                onChange={handleFileChange}
                className="hidden"
              />

              <button
                type="button"
                disabled={isSearching}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDropFiles}
                className="w-full rounded-xl border border-dashed border-[#C8A461]/45 bg-[#121C16]/55 hover:bg-[#1A2820]/65 backdrop-blur-md hover:border-[#C8A461]/75 px-4 py-4 flex flex-col items-center justify-center gap-1.5 text-center transition-all disabled:opacity-50 cursor-pointer"
              >
                <Upload className="w-5 h-5 text-[#E5C17B]" />
                <span className="text-xs font-semibold text-[#F4E6C4]">
                  Importar Boletins Internos (1 ou vários)
                </span>
                <span className="text-[11px] text-[#98A89F]">
                  .pdf (inclusive escaneado com OCR), .docx ou .txt
                </span>
              </button>

              {queuedFiles.length > 0 && (
                <div className="space-y-1.5 max-h-[240px] overflow-y-auto pr-1">
                  {queuedFiles.map((f) => (
                    <div
                      key={f.id}
                      className="siscom-liquid-subcard rounded-lg px-2.5 py-2 flex items-start justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-[#E5C17B] shrink-0" />
                          <span className="font-medium text-[#E8EEEA] truncate" title={f.fileName}>
                            {f.fileName}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[#8EA196]">
                          <span className="font-mono">{formatBytes(f.fileSize)}</span>
                          {f.bulletinNumber && (
                            <span className="font-mono text-[#E5C17B]">BI Nº {f.bulletinNumber}</span>
                          )}
                          {f.status === 'reading' || f.status === 'ocr' || f.status === 'analyzing' ? (
                            <span className="inline-flex items-center gap-1 text-[#E5C17B]">
                              <SiscomSpinner tone="gold" className="w-3 h-3" />
                              <span>{f.progressText || 'Processando...'}</span>
                            </span>
                          ) : f.status === 'done' ? (
                            <span className="text-[#78C29B]">
                              {f.occurrencesCount ?? 0} ocorrência
                              {(f.occurrencesCount ?? 0) !== 1 ? 's' : ''}
                            </span>
                          ) : f.status === 'error' ? (
                            <span className="text-[#E68A8A]">{f.errorMessage || 'Erro'}</span>
                          ) : (
                            <span>Aguardando pesquisa</span>
                          )}
                        </div>
                      </div>
                      {!isSearching && (
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(f.id)}
                          aria-label={`Remover ${f.fileName}`}
                          className="p-1 text-[#8EA196] hover:text-[#E68A8A] transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={isSearching || queuedFiles.length === 0 || !military.nomeCompleto.trim()}
                  onClick={handleStartSearch}
                  className="siscom-btn siscom-btn-primary flex-1 !min-h-[42px] text-xs"
                >
                  {isSearching ? (
                    <>
                      <SiscomSpinner tone="gold" className="w-4 h-4" />
                      <span>Pesquisando...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-[#E5C17B]" />
                      <span>Pesquisar nos Boletins</span>
                    </>
                  )}
                </button>

                {isSearching && (
                  <button
                    type="button"
                    onClick={handleCancelSearch}
                    className="siscom-btn siscom-btn-secondary !min-h-[42px] !px-3 text-xs"
                  >
                    <X className="w-4 h-4" />
                    <span>Parar</span>
                  </button>
                )}
              </div>

              {isSearching && searchStatus && (
                <p className="text-[11px] font-mono text-[#E5C17B] text-center">{searchStatus}</p>
              )}

              <AnimatePresence>
                {notice && (
                  <SiscomAlert tone={notice.tone} onDismiss={() => setNotice(null)}>
                    {notice.text}
                  </SiscomAlert>
                )}
              </AnimatePresence>
            </div>
          </div>
        }
      >
        {/* Main Review Workspace */}
        <div className="w-full max-w-[960px] mx-auto space-y-4 pb-8">
          {/* Top Action & Summary Bar */}
          <div className="metal-surface rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5 min-w-0">
              <h2 className="font-display text-sm sm:text-base font-semibold text-[#F4E6C4] flex items-center gap-2">
                <Search className="w-4 h-4 text-[#E5C17B] shrink-0" />
                <span>Pesquisa Inteligente em Boletins Internos</span>
              </h2>
              <p className="text-xs text-[#98A89F]">
                {military.nomeCompleto.trim() ? (
                  <>
                    Militar:{' '}
                    <strong className="text-[#E8EEEA]">
                      {[military.postoGraduacao, military.nomeCompleto].filter(Boolean).join(' ')}
                    </strong>{' '}
                    · {semesterMeta.semestre}
                  </>
                ) : (
                  'Digite o nome do militar, importe os Boletins Internos e revise cada ocorrência antes de gerar a Folha de Alterações.'
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={occurrences.length === 0}
                onClick={() =>
                  handleCopyText(
                    formatAllSelectedPlainText(occurrences, semester, military.postoGraduacao),
                    'all'
                  )
                }
                className="siscom-btn siscom-btn-secondary !min-h-[38px] !px-3 text-xs disabled:opacity-45"
              >
                {copiedId === 'all' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#78C29B]" />
                    <span>Transcrição copiada</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-[#83B499]" />
                    <span>Copiar Transcrição</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={!military.nomeCompleto.trim() && occurrences.length === 0}
                onClick={handleGenerateFolha}
                className="siscom-btn siscom-btn-gold !min-h-[38px] !px-3.5 text-xs disabled:opacity-45"
              >
                <span>Gerar Folha de Alterações ({selectedCount})</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Empty state before first search */}
          {occurrences.length === 0 && discardedHomonyms.length === 0 && !isSearching && (
            <div className="metal-surface rounded-xl p-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-xl mx-auto bg-[#121E17] border border-[#C9A961]/35 flex items-center justify-center">
                <FileSearch className="w-6 h-6 text-[#E5C17B]" />
              </div>
              <div className="space-y-1 max-w-lg mx-auto">
                <h3 className="text-sm font-semibold text-[#F4E6C4]">
                  Pronto para pesquisar nos Boletins Internos
                </h3>
                <p className="text-xs text-[#98A89F] leading-relaxed">
                  Informe o nome do militar à esquerda, importe um ou vários BIs do semestre e clique
                  em <strong className="text-[#E8EEEA]">Pesquisar nos Boletins</strong>. As
                  alterações serão extraídas na íntegra para sua conferência antes de gerar a folha
                  A4.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 max-w-2xl mx-auto text-left">
                <div className="siscom-liquid-subcard rounded-lg p-3 space-y-1">
                  <div className="text-[11px] font-semibold text-[#E5C17B]">Texto 100% integral</div>
                  <p className="text-[11px] text-[#98A89F] leading-snug">
                    Preserva a redação original do BI, une quebras entre páginas e mantém notas e
                    tabelas.
                  </p>
                </div>
                <div className="siscom-liquid-subcard rounded-lg p-3 space-y-1">
                  <div className="text-[11px] font-semibold text-[#83B499]">Filtro anti-homônimo</div>
                  <p className="text-[11px] text-[#98A89F] leading-snug">
                    Descarta outros militares com sobrenome igual e sinaliza casos duvidosos para
                    conferência.
                  </p>
                </div>
                <div className="siscom-liquid-subcard rounded-lg p-3 space-y-1">
                  <div className="text-[11px] font-semibold text-[#DCE5DF]">Padrão Folha 26.1</div>
                  <p className="text-[11px] text-[#98A89F] leading-snug">
                    Gera no formato <span className="font-mono">- a 5, BI Nº 2:</span> com{' '}
                    <span className="underline">Sem Alteração</span> nos meses vazios.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Pending Manual Review Section */}
          <AnimatePresence>
            {pendingReviewOccurrences.length > 0 && (
              <motion.section
                variants={fadeSlideVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={UI_TRANSITION}
                className="space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2 px-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#E5C17B]">
                    <ShieldAlert className="w-4 h-4" />
                    <span>
                      Requer Conferência Manual ({pendingReviewOccurrences.length})
                    </span>
                  </div>
                  <span className="text-[11px] text-[#98A89F]">
                    Desmarcadas por padrão — marque apenas se confirmar que é o mesmo militar
                  </span>
                </div>
                <div className="space-y-3">
                  {pendingReviewOccurrences.map((occ) => renderOccurrenceCard(occ))}
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          {/* Confirmed Occurrences Section */}
          {confirmedOccurrences.length > 0 && (
            <section className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#78C29B]">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Ocorrências Localizadas ({confirmedOccurrences.length})</span>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() =>
                      setOccurrences((prev) =>
                        prev.map((o) =>
                          o.matchConfidence === 'confirmada' ? { ...o, selected: true } : o
                        )
                      )
                    }
                    className="text-[#E5C17B] hover:underline cursor-pointer"
                  >
                    Marcar confirmadas
                  </button>
                  <span className="text-white/20">·</span>
                  <button
                    type="button"
                    onClick={() =>
                      setOccurrences((prev) => prev.map((o) => ({ ...o, selected: false })))
                    }
                    className="text-[#98A89F] hover:text-white hover:underline cursor-pointer"
                  >
                    Desmarcar todas
                  </button>
                </div>
              </div>
              <div className="space-y-3">
                {confirmedOccurrences.map((occ) => renderOccurrenceCard(occ))}
              </div>
            </section>
          )}

          {/* Months Preview (Sem Alteração) */}
          {(occurrences.length > 0 || queuedFiles.some((f) => f.status === 'done')) && (
            <div className="metal-surface rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-[#DCE5DF]">
                  Resumo do {semesterMeta.semestre} ({semesterMeta.periodo})
                </span>
                <span className="text-[11px] text-[#8EA196]">
                  {emptyMonthsInSemester.length} mês
                  {emptyMonthsInSemester.length !== 1 ? 'es' : ''} como “Sem Alteração”
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-1.5">
                {semesterMeta.months.map((m) => {
                  const count = occurrences.filter(
                    (o) => o.selected && o.bulletinMonth === m
                  ).length;
                  return (
                    <div
                      key={m}
                      className={`rounded-lg border px-2.5 py-1.5 text-center ${
                        count > 0
                          ? 'border-[#2D5A43]/60 bg-[#122219]/75 text-[#E8EEEA]'
                          : 'border-white/[0.07] bg-[#0B110E]/55 text-[#8EA196]'
                      }`}
                    >
                      <div className="text-[10px] font-mono font-semibold">{m.slice(0, 3)}</div>
                      <div className="text-[10px]">
                        {count > 0 ? `${count} item${count > 1 ? 's' : ''}` : 'Sem Alteração'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Discarded Homonyms Audit Trail */}
          {discardedHomonyms.length > 0 && (
            <details className="metal-surface rounded-xl p-3.5 group">
              <summary className="cursor-pointer list-none flex items-center justify-between gap-2 text-xs text-[#98A89F] hover:text-[#E8EEEA] select-none">
                <span>
                  Homônimos e outros militares descartados automaticamente ({discardedHomonyms.length})
                </span>
                <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-3 pt-2.5 border-t border-white/[0.08] space-y-1.5">
                {discardedHomonyms.map((h) => (
                  <div
                    key={h.id}
                    className="rounded-lg bg-[#0A110E]/65 border border-white/[0.06] px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                  >
                    <div className="space-y-0.5">
                      <div className="text-[#DCE5DF] font-medium">
                        {[h.rankFound, h.nameFound].filter(Boolean).join(' ')}
                      </div>
                      <div className="text-[#8EA196]">{h.reason}</div>
                    </div>
                    <div className="font-mono text-[10px] text-[#8EA196]">
                      {h.bulletinNumber ? `BI Nº ${h.bulletinNumber} · ` : ''}Pág. {h.pageNumber}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </WorkspaceSplitLayout>

      {/* Original BI Excerpt Inspection Modal */}
      <SiscomModal
        open={Boolean(inspectModal)}
        onClose={() => setInspectModal(null)}
        title={
          inspectModal
            ? `Trecho Original — ${inspectModal.occurrence.fileName}`
            : 'Trecho Original do BI'
        }
        maxWidthClass="max-w-3xl"
      >
        {inspectModal && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#98A89F]">
              <span>
                {formatBiReferencePrefix(
                  inspectModal.occurrence.bulletinDay,
                  inspectModal.occurrence.bulletinNumber
                )}{' '}
                <strong className="text-[#E8EEEA]">
                  {inspectModal.occurrence.title}
                  {inspectModal.occurrence.subtitle ? ` — ${inspectModal.occurrence.subtitle}` : ''}
                </strong>
              </span>
              <span className="font-mono text-[11px] text-[#E5C17B]">
                Pág. {inspectModal.pages.map((p) => p.pageNumber).join(', ')}
              </span>
            </div>

            <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-1">
              {inspectModal.pages.map((pg) => (
                <div
                  key={pg.pageNumber}
                  className="rounded-lg border border-white/10 bg-[#080D0A] p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between text-[10px] font-mono text-[#E5C17B] border-b border-white/[0.08] pb-1">
                    <span>PÁGINA {pg.pageNumber} DO ARQUIVO</span>
                    {pg.usedOcr && <span>Leitura via OCR</span>}
                  </div>
                  <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[#DCE5DF]">
                    {renderHighlightedText(pg.text, highlightTerms)}
                  </pre>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setInspectModal(null)}
                className="siscom-btn siscom-btn-secondary !min-h-[36px] !px-4 text-xs"
              >
                Fechar conferência
              </button>
            </div>
          </div>
        )}
      </SiscomModal>
    </>
  );
};
