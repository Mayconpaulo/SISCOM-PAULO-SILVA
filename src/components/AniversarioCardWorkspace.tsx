import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Award,
  Calendar,
  Download,
  FileSpreadsheet,
  FileUp,
  Plus,
  RotateCcw,
  Trash2,
  User,
  Users,
} from 'lucide-react';
import {
  ANIV_H_PX,
  ANIV_METRICS,
  ANIV_W_PX,
  type AniversarioAudience,
  type AniversarioCardData,
  type AniversarioInputMode,
  DEFAULT_ANIV_BODY_BATALHAO,
  DEFAULT_ANIV_BODY_ETERNO_CMT,
  fitAniversarioBodyText,
  generateAniversarioPngBlob,
  generateAniversariosZipBlob,
} from '../lib/aniversarioCard';
import {
  type AniversarianteEntry,
  MONTHS_PT,
  formatAniversarianteRecipientLine,
  formatBirthdayCardDate,
  parseAniversariantesPdf,
} from '../lib/aniversariantesParser';
import { CARTOES_ASSETS } from '../lib/cartoesPdf';

const ANIV_STORAGE_KEY = 'siscom_aniversario_state_v1';

interface IndividualCardForm {
  prefix: string;
  sigla: string;
  qualificacao: string;
  nome: string;
  dia: string;
  mes: string;
  ano: number;
  customDateOverride: string;
}

interface StoredAnivState {
  audience: AniversarioAudience;
  inputMode: AniversarioInputMode;
  customBodyText: string | null;
  relationPrefix: string;
  relationMonth: string;
  relationYear: number;
  entries: AniversarianteEntry[];
  selectedEntryId: string | null;
  sourceFileName: string | null;
  individual: IndividualCardForm;
}

function getDefaultIndividual(): IndividualCardForm {
  const now = new Date();
  return {
    prefix: 'AO',
    sigla: 'SD',
    qualificacao: 'INF',
    nome: 'JOSUE GAIBA COELHO',
    dia: String(now.getDate()),
    mes: MONTHS_PT[now.getMonth()] || 'Setembro',
    ano: now.getFullYear(),
    customDateOverride: '',
  };
}

function loadInitialAnivState(): StoredAnivState {
  const fallback: StoredAnivState = {
    audience: 'batalhao',
    inputMode: 'relacao',
    customBodyText: null,
    relationPrefix: 'AO',
    relationMonth: 'Setembro',
    relationYear: new Date().getFullYear(),
    entries: [],
    selectedEntryId: null,
    sourceFileName: null,
    individual: getDefaultIndividual(),
  };

  try {
    const raw = localStorage.getItem(ANIV_STORAGE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<StoredAnivState>;
    const entries = Array.isArray(p.entries) ? p.entries : [];
    return {
      audience: p.audience === 'eterno_comandante' ? 'eterno_comandante' : 'batalhao',
      inputMode: p.inputMode === 'individual' ? 'individual' : 'relacao',
      customBodyText: typeof p.customBodyText === 'string' ? p.customBodyText : null,
      relationPrefix: typeof p.relationPrefix === 'string' && p.relationPrefix ? p.relationPrefix : 'AO',
      relationMonth: typeof p.relationMonth === 'string' && p.relationMonth ? p.relationMonth : 'Setembro',
      relationYear: typeof p.relationYear === 'number' && p.relationYear > 1990 ? p.relationYear : new Date().getFullYear(),
      entries,
      selectedEntryId:
        typeof p.selectedEntryId === 'string' && entries.some((e) => e.id === p.selectedEntryId)
          ? p.selectedEntryId
          : entries[0]?.id ?? null,
      sourceFileName: typeof p.sourceFileName === 'string' ? p.sourceFileName : null,
      individual: {
        ...getDefaultIndividual(),
        ...(p.individual || {}),
      },
    };
  } catch {
    return fallback;
  }
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface AniversarioWorkspaceProps {
  onSwitchToBoasVindas: () => void;
  externalDownloadSignal?: number;
}

export const AniversarioCardWorkspace: React.FC<AniversarioWorkspaceProps> = ({
  onSwitchToBoasVindas,
  externalDownloadSignal = 0,
}) => {
  const [initial] = useState<StoredAnivState>(() => loadInitialAnivState());
  const [audience, setAudience] = useState<AniversarioAudience>(initial.audience);
  const [inputMode, setInputMode] = useState<AniversarioInputMode>(initial.inputMode);
  const [customBodyText, setCustomBodyText] = useState<string | null>(initial.customBodyText);

  const [relationPrefix, setRelationPrefix] = useState(initial.relationPrefix);
  const [relationMonth, setRelationMonth] = useState(initial.relationMonth);
  const [relationYear, setRelationYear] = useState(initial.relationYear);
  const [entries, setEntries] = useState<AniversarianteEntry[]>(initial.entries);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(initial.selectedEntryId);
  const [sourceFileName, setSourceFileName] = useState<string | null>(initial.sourceFileName);

  const [individual, setIndividual] = useState<IndividualCardForm>(initial.individual);

  const [parseProgress, setParseProgress] = useState<{ pct: number; label: string } | null>(null);
  const [isExportingPng, setIsExportingPng] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ current: number; total: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const payload: StoredAnivState = {
        audience,
        inputMode,
        customBodyText,
        relationPrefix,
        relationMonth,
        relationYear,
        entries,
        selectedEntryId,
        sourceFileName,
        individual,
      };
      localStorage.setItem(ANIV_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota errors
    }
  }, [
    audience,
    inputMode,
    customBodyText,
    relationPrefix,
    relationMonth,
    relationYear,
    entries,
    selectedEntryId,
    sourceFileName,
    individual,
  ]);

  const defaultBodyForAudience =
    audience === 'eterno_comandante' ? DEFAULT_ANIV_BODY_ETERNO_CMT : DEFAULT_ANIV_BODY_BATALHAO;
  const activeBodyText = customBodyText ?? defaultBodyForAudience;

  const selectedEntry = useMemo(
    () => entries.find((e) => e.id === selectedEntryId) ?? entries[0] ?? null,
    [entries, selectedEntryId]
  );

  // Build active card data for live preview and single-card PNG export
  const activeCardData: AniversarioCardData = useMemo(() => {
    if (inputMode === 'individual') {
      const recipientLine =
        formatAniversarianteRecipientLine(
          individual.sigla,
          individual.qualificacao,
          individual.nome,
          individual.prefix || 'AO'
        ) || 'AO MILITAR DO BATALHÃO';
      const dateLine = individual.customDateOverride.trim()
        ? individual.customDateOverride.trim()
        : formatBirthdayCardDate(individual.dia, individual.mes, individual.ano);
      return {
        recipientLine,
        bodyText: activeBodyText,
        dateLine,
      };
    }

    if (selectedEntry) {
      const recipientLine = formatAniversarianteRecipientLine(
        selectedEntry.sigla,
        selectedEntry.qualificacao,
        selectedEntry.nome,
        relationPrefix || 'AO'
      );
      const dateLine = formatBirthdayCardDate(selectedEntry.dia, relationMonth, relationYear);
      return {
        recipientLine,
        bodyText: activeBodyText,
        dateLine,
      };
    }

    // Visual example preview before uploading PDF
    return {
      recipientLine:
        audience === 'eterno_comandante'
          ? 'AO ETERNO COMANDANTE DO 1º BI MEC (ES)'
          : 'AO SD LUCIANO DA FONSECA PINHEIRO',
      bodyText: activeBodyText,
      dateLine: formatBirthdayCardDate('1', relationMonth, relationYear),
    };
  }, [
    inputMode,
    individual,
    activeBodyText,
    selectedEntry,
    relationPrefix,
    relationMonth,
    relationYear,
    audience,
  ]);

  // SVG Layout computations matching renderAniversarioCardCanvas
  const fittedBody = useMemo(() => fitAniversarioBodyText(activeCardData.bodyText), [activeCardData.bodyText]);

  const recipientFontMetrics = useMemo(() => {
    const text = activeCardData.recipientLine.trim();
    const baseSize = ANIV_METRICS.recipientSize;
    const baseTracking = ANIV_METRICS.recipientTracking;
    const approxW = text.length * baseSize * 0.66 + Math.max(0, text.length - 1) * baseTracking;
    if (approxW > ANIV_METRICS.recipientMaxW && approxW > 0) {
      const ratio = ANIV_METRICS.recipientMaxW / approxW;
      return {
        fontSize: Math.max(baseSize * 0.52, baseSize * ratio),
        tracking: baseTracking * ratio,
      };
    }
    return { fontSize: baseSize, tracking: baseTracking };
  }, [activeCardData.recipientLine]);

  const dateFontSize = useMemo(() => {
    const approxW = activeCardData.dateLine.length * ANIV_METRICS.dateSize * 0.48;
    if (approxW > ANIV_METRICS.dateMaxW && approxW > 0) {
      return Math.max(20, ANIV_METRICS.dateSize * (ANIV_METRICS.dateMaxW / approxW));
    }
    return ANIV_METRICS.dateSize;
  }, [activeCardData.dateLine]);

  const handleUploadPdf = async (file: File) => {
    setErrorMsg(null);
    setParseProgress({ pct: 2, label: 'Preparando leitura do PDF...' });
    try {
      const res = await parseAniversariantesPdf(file, (pct, label) => {
        setParseProgress({ pct, label });
      });
      if (res.entries.length === 0) {
        setErrorMsg(
          'Nenhum militar foi encontrado na tabela deste PDF. Verifique se o documento possui o formato padrão da relação de aniversariantes.'
        );
      } else {
        setEntries(res.entries);
        setSelectedEntryId(res.entries[0].id);
        setRelationMonth(res.monthName);
        setRelationYear(res.year);
        setSourceFileName(file.name);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Não foi possível ler o PDF da relação de aniversariantes.'
      );
    } finally {
      setParseProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleUpdateSelectedEntry = (patch: Partial<AniversarianteEntry>) => {
    if (!selectedEntry) return;
    setEntries((prev) =>
      prev.map((item) => (item.id === selectedEntry.id ? { ...item, ...patch } : item))
    );
  };

  const handleAddManualEntry = () => {
    const newId = `aniv-manual-${Date.now()}`;
    const nextEntry: AniversarianteEntry = {
      id: newId,
      sigla: 'SD',
      qualificacao: 'INF',
      nome: 'NOVO MILITAR',
      dia: '1',
      mes: relationMonth,
    };
    setEntries((prev) => [nextEntry, ...prev]);
    setSelectedEntryId(newId);
  };

  const handleRemoveEntry = (id: string) => {
    setEntries((prev) => {
      const next = prev.filter((item) => item.id !== id);
      if (selectedEntryId === id) {
        setSelectedEntryId(next[0]?.id ?? null);
      }
      return next;
    });
  };

  const handleDownloadCurrentPng = async () => {
    setErrorMsg(null);
    setIsExportingPng(true);
    try {
      const blob = await generateAniversarioPngBlob(activeCardData);
      const rawName = activeCardData.recipientLine
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 60);
      triggerBlobDownload(blob, `cartao-aniversario-${rawName || 'militar'}.png`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao exportar PNG.');
    } finally {
      setIsExportingPng(false);
    }
  };

  const handleDownloadAllZip = async () => {
    if (entries.length === 0) return;
    setErrorMsg(null);
    setZipProgress({ current: 0, total: entries.length });
    try {
      const items = entries.map((entry) => {
        const recipientLine = formatAniversarianteRecipientLine(
          entry.sigla,
          entry.qualificacao,
          entry.nome,
          relationPrefix || 'AO'
        );
        return {
          filenameBase: `${recipientLine}_dia_${entry.dia}`,
          card: {
            recipientLine,
            bodyText: activeBodyText,
            dateLine: formatBirthdayCardDate(entry.dia, relationMonth, relationYear),
          },
        };
      });
      const zipBlob = await generateAniversariosZipBlob(items, (current, total) => {
        setZipProgress({ current, total });
      });
      triggerBlobDownload(
        zipBlob,
        `cartoes-aniversariantes-${relationMonth.toLowerCase()}-${relationYear}.zip`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao gerar arquivo ZIP.');
    } finally {
      setZipProgress(null);
    }
  };

  useEffect(() => {
    if (externalDownloadSignal > 0) {
      void handleDownloadCurrentPng();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalDownloadSignal]);

  const m = ANIV_METRICS;

  return (
    <main className="max-w-[1440px] mx-auto w-full px-4 sm:px-6 py-5 grid grid-cols-1 lg:grid-cols-[430px_1fr] gap-6 items-start">
      {/* Left Configuration Panel */}
      <aside className="no-print bg-[#121715] border border-white/10 rounded-xl p-4 sm:p-5 space-y-5">
        {/* Card Model Switcher */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-[#E4EAE6]">Modelo de Cartão</h2>
            <span className="font-mono text-[11px] text-[#83B499]">Digital · {ANIV_W_PX}×{ANIV_H_PX} px</span>
          </div>

          <div className="grid grid-cols-2 gap-2 p-1 rounded-lg bg-[#0B0E0D] border border-white/10">
            <button
              type="button"
              onClick={onSwitchToBoasVindas}
              className="min-h-[38px] rounded-md text-xs sm:text-sm font-medium transition-colors px-2 text-[#98A89F] hover:text-[#E4EAE6]"
            >
              Boas-Vindas
            </button>
            <button
              type="button"
              className="min-h-[38px] rounded-md text-xs sm:text-sm font-medium transition-colors px-2 bg-[#2D5A43] text-white"
            >
              Aniversário
            </button>
          </div>
        </div>

        {/* 1. Audience Option (Militares do Batalhão vs Eterno Comandante) */}
        <section className="space-y-2.5 border-t border-white/10 pt-4">
          <span className="block text-xs font-semibold uppercase tracking-wider text-[#98A89F]">
            1. Destinatário do Texto
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setAudience('batalhao')}
              className={`min-h-[40px] rounded-lg border px-2.5 text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${
                audience === 'batalhao'
                  ? 'bg-[#2D5A43] border-[#83B499]/60 text-white'
                  : 'bg-[#0B0E0D] border-white/10 text-[#98A89F] hover:text-[#E4EAE6]'
              }`}
            >
              <Users className="w-3.5 h-3.5 shrink-0" />
              <span>Militares do Batalhão</span>
            </button>
            <button
              type="button"
              onClick={() => setAudience('eterno_comandante')}
              className={`min-h-[40px] rounded-lg border px-2.5 text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${
                audience === 'eterno_comandante'
                  ? 'bg-[#2D5A43] border-[#83B499]/60 text-white'
                  : 'bg-[#0B0E0D] border-white/10 text-[#98A89F] hover:text-[#E4EAE6]'
              }`}
            >
              <Award className="w-3.5 h-3.5 shrink-0" />
              <span>Eterno Comandante</span>
            </button>
          </div>
        </section>

        {/* 2. Mode Switcher (Por Relação PDF vs Individual) */}
        <section className="space-y-3 border-t border-white/10 pt-4">
          <span className="block text-xs font-semibold uppercase tracking-wider text-[#98A89F]">
            2. Modo de Preenchimento
          </span>
          <div className="grid grid-cols-2 gap-2 p-1 rounded-lg bg-[#0B0E0D] border border-white/10">
            <button
              type="button"
              onClick={() => setInputMode('relacao')}
              className={`min-h-[36px] rounded-md text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${
                inputMode === 'relacao'
                  ? 'bg-[#1D3B2C] text-[#E4EAE6] border border-[#83B499]/40'
                  : 'text-[#98A89F] hover:text-[#E4EAE6]'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Por Relação (PDF)</span>
            </button>
            <button
              type="button"
              onClick={() => setInputMode('individual')}
              className={`min-h-[36px] rounded-md text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${
                inputMode === 'individual'
                  ? 'bg-[#1D3B2C] text-[#E4EAE6] border border-[#83B499]/40'
                  : 'text-[#98A89F] hover:text-[#E4EAE6]'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>Individual</span>
            </button>
          </div>

          {inputMode === 'relacao' ? (
            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUploadPdf(file);
                }}
              />

              <button
                type="button"
                disabled={Boolean(parseProgress)}
                onClick={() => fileInputRef.current?.click()}
                className="w-full min-h-[44px] rounded-lg border border-dashed border-[#83B499]/50 bg-[#0E1613] hover:bg-[#14201B] disabled:opacity-60 px-3 py-2.5 flex items-center justify-center gap-2 text-xs sm:text-sm font-medium text-[#E4EAE6] transition-colors"
              >
                <FileUp className="w-4 h-4 text-[#83B499] shrink-0" />
                <span>
                  {parseProgress
                    ? 'Processando relação...'
                    : sourceFileName
                      ? `Trocar PDF (${sourceFileName})`
                      : 'Enviar Relação de Aniversariantes (PDF)'}
                </span>
              </button>

              {parseProgress && (
                <div className="rounded-lg bg-[#0B0E0D] border border-white/10 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#C6D4CC]">{parseProgress.label}</span>
                    <span className="font-mono text-[#83B499]">{parseProgress.pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-[#2D5A43] transition-all duration-200"
                      style={{ width: `${parseProgress.pct}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Month, Year & Prefix controls */}
              <div className="grid grid-cols-[1fr_92px_68px] gap-2">
                <label className="space-y-1">
                  <span className="block text-[11px] text-[#98A89F]">Mês</span>
                  <select
                    value={relationMonth}
                    onChange={(e) => setRelationMonth(e.target.value)}
                    className="w-full h-9 rounded-lg bg-[#0B0E0D] border border-white/12 px-2 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#83B499]"
                  >
                    {MONTHS_PT.map((mName) => (
                      <option key={mName} value={mName}>
                        {mName}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] text-[#98A89F]">Ano</span>
                  <input
                    type="number"
                    min={2000}
                    max={2100}
                    value={relationYear}
                    onChange={(e) =>
                      setRelationYear(Math.max(2000, parseInt(e.target.value, 10) || 2026))
                    }
                    className="w-full h-9 rounded-lg bg-[#0B0E0D] border border-white/12 px-2 text-xs font-mono text-[#E4EAE6] focus:outline-none focus:border-[#83B499]"
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] text-[#98A89F]">Prefixo</span>
                  <input
                    type="text"
                    value={relationPrefix}
                    onChange={(e) => setRelationPrefix(e.target.value)}
                    className="w-full h-9 rounded-lg bg-[#0B0E0D] border border-white/12 px-2 text-xs font-mono uppercase text-[#E4EAE6] focus:outline-none focus:border-[#83B499]"
                  />
                </label>
              </div>

              {/* Extracted List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#98A89F]">
                    Militares ({entries.length})
                  </span>
                  <button
                    type="button"
                    onClick={handleAddManualEntry}
                    className="inline-flex items-center gap-1 text-[11px] text-[#83B499] hover:text-[#A8D6BC]"
                  >
                    <Plus className="w-3 h-3" />
                    Adicionar
                  </button>
                </div>

                {entries.length === 0 ? (
                  <p className="rounded-lg bg-[#0B0E0D] border border-white/8 p-3 text-xs text-[#98A89F] leading-relaxed">
                    Envie o PDF mensal da relação. A tabela será lida automaticamente aplicando a
                    regra de <strong className="text-[#E4EAE6]">SD + RS / RSCT</strong> sem
                    qualificação e <strong className="text-[#E4EAE6]">SD + INF / INT / SAU</strong>{' '}
                    com qualificação.
                  </p>
                ) : (
                  <div className="max-h-56 overflow-y-auto rounded-lg bg-[#0B0E0D] border border-white/10 divide-y divide-white/8">
                    {entries.map((entry, idx) => {
                      const isSel = entry.id === selectedEntry?.id;
                      const formatted = formatAniversarianteRecipientLine(
                        entry.sigla,
                        entry.qualificacao,
                        entry.nome,
                        relationPrefix || 'AO'
                      );
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => setSelectedEntryId(entry.id)}
                          className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 transition-colors ${
                            isSel ? 'bg-[#1D3B2C]/80 text-white' : 'hover:bg-white/5 text-[#C6D4CC]'
                          }`}
                        >
                          <div className="min-w-0">
                            <span className="block text-xs font-medium truncate">
                              {idx + 1}. {formatted}
                            </span>
                          </div>
                          <span className="shrink-0 font-mono text-[11px] px-1.5 py-0.5 rounded bg-black/30 text-[#83B499]">
                            Dia {entry.dia.padStart(2, '0')}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Selected Row Quick Editor */}
              {selectedEntry && (
                <div className="rounded-lg bg-[#0B0E0D] border border-white/10 p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#83B499]">
                      Editar Militar Selecionado
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveEntry(selectedEntry.id)}
                      className="inline-flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="w-3 h-3" />
                      Remover
                    </button>
                  </div>

                  <div className="grid grid-cols-[84px_1fr_64px] gap-2">
                    <label className="space-y-1">
                      <span className="block text-[10px] text-[#98A89F]">Sigla</span>
                      <input
                        type="text"
                        value={selectedEntry.sigla}
                        onChange={(e) => handleUpdateSelectedEntry({ sigla: e.target.value })}
                        className="w-full h-8 rounded bg-[#121715] border border-white/12 px-2 text-xs text-[#E4EAE6]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[10px] text-[#98A89F]">Qualificação</span>
                      <input
                        type="text"
                        value={selectedEntry.qualificacao}
                        onChange={(e) =>
                          handleUpdateSelectedEntry({ qualificacao: e.target.value })
                        }
                        placeholder="Vazio p/ RS"
                        className="w-full h-8 rounded bg-[#121715] border border-white/12 px-2 text-xs text-[#E4EAE6]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[10px] text-[#98A89F]">Dia</span>
                      <input
                        type="text"
                        value={selectedEntry.dia}
                        onChange={(e) => handleUpdateSelectedEntry({ dia: e.target.value })}
                        className="w-full h-8 rounded bg-[#121715] border border-white/12 px-2 text-xs font-mono text-[#E4EAE6]"
                      />
                    </label>
                  </div>

                  <label className="block space-y-1">
                    <span className="block text-[10px] text-[#98A89F]">Nome Completo</span>
                    <input
                      type="text"
                      value={selectedEntry.nome}
                      onChange={(e) => handleUpdateSelectedEntry({ nome: e.target.value })}
                      className="w-full h-8 rounded bg-[#121715] border border-white/12 px-2 text-xs text-[#E4EAE6]"
                    />
                  </label>
                </div>
              )}
            </div>
          ) : (
            /* Individual Mode Inputs */
            <div className="space-y-3">
              <div className="grid grid-cols-[68px_1fr_1fr] gap-2">
                <label className="space-y-1">
                  <span className="block text-[11px] text-[#98A89F]">Prefixo</span>
                  <input
                    type="text"
                    value={individual.prefix}
                    onChange={(e) =>
                      setIndividual((prev) => ({ ...prev, prefix: e.target.value }))
                    }
                    placeholder="AO"
                    className="w-full h-9 rounded-lg bg-[#0B0E0D] border border-white/12 px-2.5 text-xs uppercase text-[#E4EAE6] focus:outline-none focus:border-[#83B499]"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-[11px] text-[#98A89F]">Graduação / Sigla</span>
                  <input
                    type="text"
                    value={individual.sigla}
                    onChange={(e) =>
                      setIndividual((prev) => ({ ...prev, sigla: e.target.value }))
                    }
                    placeholder="SD, CB, 3º SGT, TC"
                    className="w-full h-9 rounded-lg bg-[#0B0E0D] border border-white/12 px-2.5 text-xs uppercase text-[#E4EAE6] focus:outline-none focus:border-[#83B499]"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-[11px] text-[#98A89F]">Qualificação</span>
                  <input
                    type="text"
                    value={individual.qualificacao}
                    onChange={(e) =>
                      setIndividual((prev) => ({ ...prev, qualificacao: e.target.value }))
                    }
                    placeholder="INF, INT, SAU..."
                    className="w-full h-9 rounded-lg bg-[#0B0E0D] border border-white/12 px-2.5 text-xs uppercase text-[#E4EAE6] focus:outline-none focus:border-[#83B499]"
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="block text-[11px] text-[#98A89F]">Nome Completo</span>
                <input
                  type="text"
                  value={individual.nome}
                  onChange={(e) => setIndividual((prev) => ({ ...prev, nome: e.target.value }))}
                  placeholder="EX.: JOSUE GAIBA COELHO"
                  className="w-full h-9 rounded-lg bg-[#0B0E0D] border border-white/12 px-3 text-xs uppercase text-[#E4EAE6] focus:outline-none focus:border-[#83B499]"
                />
              </label>

              <p className="text-[11px] text-[#83B49F]">
                Prévia da linha: <strong className="text-[#E4EAE6]">{activeCardData.recipientLine}</strong>
              </p>

              <div className="grid grid-cols-[70px_1fr_82px] gap-2">
                <label className="space-y-1">
                  <span className="block text-[11px] text-[#98A89F]">Dia</span>
                  <input
                    type="text"
                    value={individual.dia}
                    onChange={(e) =>
                      setIndividual((prev) => ({
                        ...prev,
                        dia: e.target.value,
                        customDateOverride: '',
                      }))
                    }
                    className="w-full h-9 rounded-lg bg-[#0B0E0D] border border-white/12 px-2.5 text-xs font-mono text-[#E4EAE6]"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-[11px] text-[#98A89F]">Mês</span>
                  <select
                    value={individual.mes}
                    onChange={(e) =>
                      setIndividual((prev) => ({
                        ...prev,
                        mes: e.target.value,
                        customDateOverride: '',
                      }))
                    }
                    className="w-full h-9 rounded-lg bg-[#0B0E0D] border border-white/12 px-2 text-xs text-[#E4EAE6]"
                  >
                    {MONTHS_PT.map((mName) => (
                      <option key={mName} value={mName}>
                        {mName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="block text-[11px] text-[#98A89F]">Ano</span>
                  <input
                    type="number"
                    min={2000}
                    max={2100}
                    value={individual.ano}
                    onChange={(e) =>
                      setIndividual((prev) => ({
                        ...prev,
                        ano: Math.max(2000, parseInt(e.target.value, 10) || 2026),
                        customDateOverride: '',
                      }))
                    }
                    className="w-full h-9 rounded-lg bg-[#0B0E0D] border border-white/12 px-2 text-xs font-mono text-[#E4EAE6]"
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="flex items-center gap-1 text-[11px] text-[#98A89F]">
                  <Calendar className="w-3 h-3 text-[#83B499]" />
                  Data personalizada (opcional)
                </span>
                <input
                  type="text"
                  value={individual.customDateOverride}
                  onChange={(e) =>
                    setIndividual((prev) => ({ ...prev, customDateOverride: e.target.value }))
                  }
                  placeholder={formatBirthdayCardDate(individual.dia, individual.mes, individual.ano)}
                  className="w-full h-9 rounded-lg bg-[#0B0E0D] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#83B499]"
                />
              </label>
            </div>
          )}
        </section>

        {/* 3. Editable Body Paragraph */}
        <section className="space-y-2.5 border-t border-white/10 pt-4">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="aniv-texto-input"
              className="text-xs font-semibold uppercase tracking-wider text-[#98A89F]"
            >
              3. Texto do Cartão
            </label>
            {customBodyText !== null && (
              <button
                type="button"
                onClick={() => setCustomBodyText(null)}
                className="inline-flex items-center gap-1 text-[11px] text-[#83B499] hover:text-[#A8D6BC]"
              >
                <RotateCcw className="w-3 h-3" />
                Restaurar padrão
              </button>
            )}
          </div>

          <textarea
            id="aniv-texto-input"
            rows={4}
            value={activeBodyText}
            onChange={(e) => setCustomBodyText(e.target.value)}
            className="w-full rounded-lg bg-[#0B0E0D] border border-white/12 p-3 text-xs sm:text-sm text-[#E4EAE6] leading-relaxed focus:outline-none focus:border-[#83B499] resize-y"
          />
        </section>

        {/* 4. Digital PNG / ZIP Export Actions */}
        <section className="space-y-2.5 border-t border-white/10 pt-4">
          <button
            type="button"
            onClick={handleDownloadCurrentPng}
            disabled={isExportingPng || Boolean(zipProgress)}
            className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 rounded-lg bg-[#2D5A43] hover:bg-[#376C51] disabled:opacity-60 px-4 text-sm font-medium text-white transition-colors"
          >
            <Download className="w-4 h-4" />
            {isExportingPng ? 'Gerando PNG...' : 'Baixar Cartão Atual (PNG)'}
          </button>

          {inputMode === 'relacao' && entries.length > 0 && (
            <button
              type="button"
              onClick={handleDownloadAllZip}
              disabled={Boolean(zipProgress) || isExportingPng}
              className="w-full min-h-[40px] inline-flex items-center justify-center gap-2 rounded-lg border border-[#83B499]/40 bg-[#161D1A] hover:bg-[#1E2824] disabled:opacity-60 px-4 text-xs sm:text-sm font-medium text-[#E4EAE6] transition-colors"
            >
              <Archive className="w-4 h-4 text-[#83B499]" />
              {zipProgress
                ? `Gerando ${zipProgress.current} de ${zipProgress.total}...`
                : `Baixar Todos em ZIP (${entries.length} cartões)`}
            </button>
          )}

          {errorMsg && (
            <p className="text-xs text-red-400 bg-red-950/40 border border-red-500/30 rounded-lg p-2.5">
              {errorMsg}
            </p>
          )}
        </section>
      </aside>

      {/* Right Digital Card Preview (1600 x 1135) */}
      <section className="flex flex-col items-center">
        <div className="w-full max-w-[820px]">
          <div className="no-print flex items-center justify-between text-xs text-[#98A89F] mb-2.5 px-1">
            <span>
              Cartão Digital de Aniversário · {audience === 'eterno_comandante' ? 'Eterno Comandante' : 'Militares do Batalhão'}
            </span>
            <span className="font-mono text-[#83B499]">Formato Digital · {ANIV_W_PX} × {ANIV_H_PX} px (PNG)</span>
          </div>

          <div className="rounded-xl overflow-hidden shadow-2xl border border-white/10 bg-white">
            <svg
              viewBox={`0 0 ${ANIV_W_PX} ${ANIV_H_PX}`}
              className="w-full h-auto bg-white block select-none"
              role="img"
              aria-label={`Pré-visualização do cartão de aniversário para ${activeCardData.recipientLine}`}
            >
              <rect x={0} y={0} width={ANIV_W_PX} height={ANIV_H_PX} fill="#FFFFFF" />

              {/* Outer blue frame (#4A94FA) */}
              <rect
                x={m.blueBorder / 2}
                y={m.blueBorder / 2}
                width={ANIV_W_PX - m.blueBorder}
                height={ANIV_H_PX - m.blueBorder}
                fill="none"
                stroke="#4A94FA"
                strokeWidth={m.blueBorder}
              />

              {/* Inner red frame (#FC2902) touching outer blue directly */}
              <rect
                x={m.blueBorder + m.redBorder / 2}
                y={m.blueBorder + m.redBorder / 2}
                width={ANIV_W_PX - (m.blueBorder + m.redBorder / 2) * 2}
                height={ANIV_H_PX - (m.blueBorder + m.redBorder / 2) * 2}
                fill="none"
                stroke="#FC2902"
                strokeWidth={m.redBorder}
              />

              {/* Background Watermark */}
              <image
                href={CARTOES_ASSETS.marcaDagua}
                x={m.innerLeft}
                y={m.innerTop + 30}
                width={m.innerW}
                height={m.innerH - 30}
                opacity={0.45}
                preserveAspectRatio="none"
              />

              {/* Top-left & Top-right Patches */}
              <image
                href={CARTOES_ASSETS.distintivo1BiMec}
                x={m.leftPatch.x}
                y={m.leftPatch.y}
                width={m.leftPatch.w}
                height={m.leftPatch.h}
              />
              <image
                href={CARTOES_ASSETS.distintivoFeb}
                x={m.rightPatch.x}
                y={m.rightPatch.y}
                width={m.rightPatch.w}
                height={m.rightPatch.h}
              />

              {/* Centered Wide-Tracked Recipient Line */}
              <text
                x={ANIV_W_PX / 2}
                y={m.recipientY}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#111111"
                fontFamily="'Times New Roman', Georgia, serif"
                fontWeight={400}
                fontSize={recipientFontMetrics.fontSize}
                letterSpacing={recipientFontMetrics.tracking}
              >
                {activeCardData.recipientLine}
              </text>

              {/* Justified Italic Body Lines */}
              {fittedBody.lines.map((line, idx) => (
                <g key={idx}>
                  {line.words.map((word, wIdx) => (
                    <text
                      key={wIdx}
                      x={m.bodyX + word.xOffsetMm}
                      y={m.bodyY + idx * fittedBody.lineHeightPx}
                      textAnchor="start"
                      dominantBaseline="hanging"
                      fill="#111111"
                      fontFamily="'Open Sans', 'Plus Jakarta Sans', Arial, sans-serif"
                      fontStyle="italic"
                      fontWeight={400}
                      fontSize={fittedBody.fontSizePx}
                    >
                      {word.text}
                    </text>
                  ))}
                </g>
              ))}

              {/* Centered Serif Date */}
              <text
                x={ANIV_W_PX / 2}
                y={m.dateY}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#111111"
                fontFamily="'Times New Roman', Georgia, serif"
                fontWeight={400}
                fontSize={dateFontSize}
              >
                {activeCardData.dateLine}
              </text>

              {/* Handwritten Signature & Commander Info */}
              <image
                href={CARTOES_ASSETS.assinaturaCmt}
                x={m.sigBox.x}
                y={m.sigBox.y}
                width={m.sigBox.w}
                height={m.sigBox.h}
              />

              <text
                x={ANIV_W_PX / 2}
                y={m.cmdNameY}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#000000"
                fontFamily="'Times New Roman', Georgia, serif"
                fontWeight={700}
                fontSize={m.cmdNameSize}
              >
                ALEX FERREIRA GOMES JÚNIOR - TC
              </text>
              <text
                x={ANIV_W_PX / 2}
                y={m.cmdTitleY}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#000000"
                fontFamily="'Times New Roman', Georgia, serif"
                fontWeight={400}
                fontSize={m.cmdTitleSize}
              >
                Comandante do 1º Batalhão de Infantaria Mecanizado (Escola)
              </text>
            </svg>
          </div>
        </div>
      </section>
    </main>
  );
};
