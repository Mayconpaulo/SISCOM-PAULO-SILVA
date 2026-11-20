import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Archive,
  Calendar,
  Download,
  FileUp,
  Plus,
  RotateCcw,
  Trash2,
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
} from './aniversarioCard';
import {
  type AniversarianteEntry,
  MONTHS_PT,
  formatAniversarianteRecipientLine,
  formatBirthdayCardDate,
  inferPortugueseRecipientPrefix,
  parseAniversariantesPdf,
} from './aniversariantesParser';
import { CARTOES_ASSETS } from '../shared/cartoesAssets';
import { getSecureVaultItem, setSecureVaultItem } from '../../../core/privacy/privacyVault';
import { PinchZoomSheetFrame } from '../../../shared/PinchZoomSheetFrame';
import { WorkspaceSplitLayout } from '../../../shared/WorkspaceSplitLayout';
import { stepSlideVariants } from '../../../shared/motion';
import { SiscomAlert, SiscomSegmentedTabs, SiscomSpinner } from '../../../shared/ui';

const ANIV_STORAGE_KEY = 'siscom_aniversario_state_v1';

interface IndividualCardForm {
  prefix: string;
  prefixAuto?: boolean;
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
    prefixAuto: true,
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
    relationPrefix: 'AUTO',
    relationMonth: 'Setembro',
    relationYear: new Date().getFullYear(),
    entries: [],
    selectedEntryId: null,
    sourceFileName: null,
    individual: getDefaultIndividual(),
  };

  try {
    const raw = getSecureVaultItem(ANIV_STORAGE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<StoredAnivState>;
    const entries = Array.isArray(p.entries) ? p.entries : [];
    const savedIndiv = {
      ...getDefaultIndividual(),
      ...(p.individual || {}),
    };
    const isAutoIndiv =
      typeof p.individual?.prefixAuto === 'boolean' ? p.individual.prefixAuto : true;
    return {
      audience: p.audience === 'eterno_comandante' ? 'eterno_comandante' : 'batalhao',
      inputMode: p.inputMode === 'individual' ? 'individual' : 'relacao',
      customBodyText: typeof p.customBodyText === 'string' ? p.customBodyText : null,
      relationPrefix:
        typeof p.relationPrefix === 'string' && p.relationPrefix && p.relationPrefix !== 'AO'
          ? p.relationPrefix
          : 'AUTO',
      relationMonth:
        typeof p.relationMonth === 'string' && p.relationMonth ? p.relationMonth : 'Setembro',
      relationYear:
        typeof p.relationYear === 'number' && p.relationYear > 1990
          ? p.relationYear
          : new Date().getFullYear(),
      entries,
      selectedEntryId:
        typeof p.selectedEntryId === 'string' && entries.some((e) => e.id === p.selectedEntryId)
          ? p.selectedEntryId
          : entries[0]?.id ?? null,
      sourceFileName: typeof p.sourceFileName === 'string' ? p.sourceFileName : null,
      individual: {
        ...savedIndiv,
        prefixAuto: isAutoIndiv,
        prefix: isAutoIndiv ? inferPortugueseRecipientPrefix(savedIndiv.nome) : savedIndiv.prefix,
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
  onSwitchToPesames: () => void;
  externalDownloadSignal?: number;
}

export const AniversarioCardWorkspace: React.FC<AniversarioWorkspaceProps> = ({
  onSwitchToBoasVindas,
  onSwitchToPesames,
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
      setSecureVaultItem(ANIV_STORAGE_KEY, JSON.stringify(payload));
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

  useEffect(() => {
    const handlePurged = () => {
      setAudience('batalhao');
      setInputMode('relacao');
      setCustomBodyText(null);
      setRelationPrefix('AUTO');
      setRelationMonth('Setembro');
      setRelationYear(new Date().getFullYear());
      setEntries([]);
      setSelectedEntryId(null);
      setSourceFileName(null);
      setIndividual(getDefaultIndividual());
      setErrorMsg(null);
    };
    window.addEventListener('siscom:vault-purged', handlePurged);
    return () => window.removeEventListener('siscom:vault-purged', handlePurged);
  }, []);

  const defaultBodyForAudience =
    audience === 'eterno_comandante' ? DEFAULT_ANIV_BODY_ETERNO_CMT : DEFAULT_ANIV_BODY_BATALHAO;
  const activeBodyText = customBodyText ?? defaultBodyForAudience;

  const selectedEntry = useMemo(
    () => entries.find((e) => e.id === selectedEntryId) ?? entries[0] ?? null,
    [entries, selectedEntryId]
  );

  const resolveEntryPrefix = (entry: AniversarianteEntry): string =>
    entry.prefix?.trim() ? entry.prefix : relationPrefix || 'AUTO';

  // Build active card data for live preview and single-card PNG export
  const activeCardData: AniversarioCardData = useMemo(() => {
    if (inputMode === 'individual') {
      const effectivePrefix =
        individual.prefixAuto !== false
          ? inferPortugueseRecipientPrefix(individual.nome)
          : individual.prefix || inferPortugueseRecipientPrefix(individual.nome);
      const recipientLine =
        formatAniversarianteRecipientLine(
          individual.sigla,
          individual.qualificacao,
          individual.nome,
          effectivePrefix
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
        resolveEntryPrefix(selectedEntry)
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
          resolveEntryPrefix(entry)
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
    <WorkspaceSplitLayout
      sidebarWidthClass="lg:w-[405px] xl:w-[435px]"
      sidebar={
        <div className="metal-surface lg:bg-transparent lg:border-0 lg:shadow-none rounded-xl lg:rounded-none p-4 sm:p-5 lg:p-1 space-y-5">
        {/* Card Model Switcher */}
        <div className="space-y-2">
          <span className="siscom-field-label">Modelo</span>

          <div className="siscom-tab-track grid grid-cols-3 gap-1">
            <button
              type="button"
              onClick={onSwitchToBoasVindas}
              className="min-h-[40px] rounded-[7px] text-xs font-medium transition-colors px-1.5 text-[#98A89F] hover:text-[#E4EAE6] whitespace-nowrap"
            >
              Boas-Vindas
            </button>
            <button
              type="button"
              aria-current="page"
              className="min-h-[40px] rounded-[7px] text-xs font-medium transition-all px-1.5 bg-[#2D5A43] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_2px_8px_-2px_rgba(0,0,0,0.5)] whitespace-nowrap"
            >
              Aniversário
            </button>
            <button
              type="button"
              onClick={onSwitchToPesames}
              className="min-h-[40px] rounded-[7px] text-xs font-medium transition-colors px-1.5 text-[#98A89F] hover:text-[#E4EAE6] whitespace-nowrap"
            >
              Pêsames
            </button>
          </div>
        </div>

        {/* Audience Option */}
        <section className="space-y-2 border-t border-white/8 pt-4">
          <span className="siscom-field-label">Destinatário</span>
          <SiscomSegmentedTabs
            layoutId="aniv-audience-tabs"
            ariaLabel="Destinatário do cartão de aniversário"
            value={audience}
            onChange={setAudience}
            options={[
              { value: 'batalhao', label: 'Militares' },
              { value: 'eterno_comandante', label: 'Eterno Cmt' },
            ]}
          />
        </section>

        {/* Mode Switcher */}
        <section className="space-y-3 border-t border-white/8 pt-4">
          <span className="siscom-field-label">Modo</span>
          <SiscomSegmentedTabs
            layoutId="aniv-mode-tabs"
            ariaLabel="Modo de preenchimento"
            value={inputMode}
            onChange={setInputMode}
            options={[
              { value: 'relacao', label: 'Relação (PDF)' },
              { value: 'individual', label: 'Individual' },
            ]}
          />

          <AnimatePresence mode="wait">
            {inputMode === 'relacao' ? (
              <motion.div
                key="aniv-relacao"
                variants={stepSlideVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="space-y-3"
              >
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
                  className="w-full min-h-[44px] rounded-lg border border-dashed border-[#83B499]/45 bg-[#0E1613] hover:bg-[#14201B] disabled:opacity-60 px-3 py-2.5 flex items-center justify-center gap-2 text-xs sm:text-sm font-medium text-[#E4EAE6] transition-all active:scale-[0.985]"
                >
                  {parseProgress ? (
                    <SiscomSpinner className="w-4 h-4" tone="olive" />
                  ) : (
                    <FileUp className="w-4 h-4 text-[#83B499] shrink-0" />
                  )}
                  <span className="truncate">
                    {parseProgress
                      ? 'Lendo PDF...'
                      : sourceFileName
                        ? `Trocar (${sourceFileName})`
                        : 'Enviar PDF da relação'}
                  </span>
                </button>

                {parseProgress && (
                  <div className="rounded-lg bg-[#0C100F] border border-white/8 p-3 space-y-2">
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
                <div className="grid grid-cols-[1fr_76px_118px] gap-2">
                  <label className="space-y-1">
                    <span className="siscom-field-label !text-[11px]">Mês</span>
                    <select
                      value={relationMonth}
                      onChange={(e) => setRelationMonth(e.target.value)}
                      className="siscom-input !min-h-[38px] !px-2 text-xs"
                    >
                      {MONTHS_PT.map((mName) => (
                        <option key={mName} value={mName}>
                          {mName}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="siscom-field-label !text-[11px]">Ano</span>
                    <input
                      type="number"
                      min={2000}
                      max={2100}
                      value={relationYear}
                      onChange={(e) =>
                        setRelationYear(Math.max(2000, parseInt(e.target.value, 10) || 2026))
                      }
                      className="siscom-input !min-h-[38px] !px-2 text-xs font-mono"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="siscom-field-label !text-[11px]">Prefixo</span>
                    <select
                      value={relationPrefix}
                      onChange={(e) => setRelationPrefix(e.target.value)}
                      className="siscom-input !min-h-[38px] !px-2 text-xs"
                    >
                      <option value="AUTO">Auto (AO / A)</option>
                      <option value="AO">Sempre AO</option>
                      <option value="A">Sempre A</option>
                    </select>
                  </label>
                </div>

                {/* Extracted List */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#98A89F]">Lista ({entries.length})</span>
                    <button
                      type="button"
                      onClick={handleAddManualEntry}
                      className="inline-flex items-center gap-1 text-[11px] text-[#83B499] hover:text-[#A8D6BC] transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      Adicionar
                    </button>
                  </div>

                  {entries.length === 0 ? (
                    <p className="rounded-lg bg-[#0C100F] border border-white/8 p-3 text-xs text-[#98A89F]">
                      Envie o PDF mensal da relação.
                    </p>
                  ) : (
                    <div className="max-h-56 overflow-y-auto rounded-lg bg-[#0C100F] border border-white/8 divide-y divide-white/6">
                      {entries.map((entry, idx) => {
                        const isSel = entry.id === selectedEntry?.id;
                        const formatted = formatAniversarianteRecipientLine(
                          entry.sigla,
                          entry.qualificacao,
                          entry.nome,
                          resolveEntryPrefix(entry)
                        );
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => setSelectedEntryId(entry.id)}
                            className={`w-full min-h-[40px] text-left px-3 py-2 flex items-center justify-between gap-2 transition-colors ${
                              isSel ? 'bg-[#1D3B2C]/85 text-white' : 'hover:bg-white/[0.04] text-[#C6D4CC]'
                            }`}
                          >
                            <div className="min-w-0">
                              <span className="block text-xs font-medium truncate">
                                {idx + 1}. {formatted}
                              </span>
                            </div>
                            <span className="shrink-0 font-mono text-[11px] text-[#83B499]">
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
                  <div className="rounded-lg bg-[#0C100F] border border-white/8 p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-[#83B499]">Selecionado</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveEntry(selectedEntry.id)}
                        className="inline-flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300 transition-colors"
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
                          className="siscom-input !min-h-[34px] !px-2 text-xs"
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
                          className="siscom-input !min-h-[34px] !px-2 text-xs"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="block text-[10px] text-[#98A89F]">Dia</span>
                        <input
                          type="text"
                          value={selectedEntry.dia}
                          onChange={(e) => handleUpdateSelectedEntry({ dia: e.target.value })}
                          className="siscom-input !min-h-[34px] !px-2 text-xs font-mono"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-[72px_1fr] gap-2">
                      <label className="block space-y-1">
                        <span className="block text-[10px] text-[#98A89F]">Prefixo</span>
                        <input
                          type="text"
                          value={selectedEntry.prefix ?? ''}
                          onChange={(e) => handleUpdateSelectedEntry({ prefix: e.target.value })}
                          placeholder={inferPortugueseRecipientPrefix(selectedEntry.nome)}
                          className="siscom-input !min-h-[34px] !px-2 text-xs uppercase"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="block text-[10px] text-[#98A89F]">Nome</span>
                        <input
                          type="text"
                          value={selectedEntry.nome}
                          onChange={(e) => handleUpdateSelectedEntry({ nome: e.target.value })}
                          className="siscom-input !min-h-[34px] !px-2 text-xs"
                        />
                      </label>
                    </div>
                  </div>
                )}
              </motion.div>
            ) : (
              /* Individual Mode Inputs */
              <motion.div
                key="aniv-individual"
                variants={stepSlideVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="space-y-3"
              >
                <div className="grid grid-cols-[84px_1fr_1fr] gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <label htmlFor="aniv-indiv-prefix" className="siscom-field-label !text-[11px]">
                        Prefixo
                      </label>
                      {individual.prefixAuto === false && (
                        <button
                          type="button"
                          onClick={() =>
                            setIndividual((prev) => ({
                              ...prev,
                              prefixAuto: true,
                              prefix: inferPortugueseRecipientPrefix(prev.nome),
                            }))
                          }
                          className="text-[10px] text-[#83B499] hover:text-[#A8D6BC]"
                        >
                          Auto
                        </button>
                      )}
                    </div>
                    <input
                      id="aniv-indiv-prefix"
                      type="text"
                      value={individual.prefix}
                      onChange={(e) =>
                        setIndividual((prev) => ({
                          ...prev,
                          prefixAuto: false,
                          prefix: e.target.value,
                        }))
                      }
                      placeholder="AO / A"
                      className="siscom-input !min-h-[38px] !px-2.5 text-xs uppercase"
                    />
                  </div>
                  <label className="space-y-1">
                    <span className="siscom-field-label !text-[11px]">Sigla</span>
                    <input
                      type="text"
                      value={individual.sigla}
                      onChange={(e) =>
                        setIndividual((prev) => ({ ...prev, sigla: e.target.value }))
                      }
                      placeholder="SD, CB, SGT"
                      className="siscom-input !min-h-[38px] !px-2.5 text-xs uppercase"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="siscom-field-label !text-[11px]">Qualificação</span>
                    <input
                      type="text"
                      value={individual.qualificacao}
                      onChange={(e) =>
                        setIndividual((prev) => ({ ...prev, qualificacao: e.target.value }))
                      }
                      placeholder="INF, INT, SAU"
                      className="siscom-input !min-h-[38px] !px-2.5 text-xs uppercase"
                    />
                  </label>
                </div>

                <label className="block space-y-1">
                  <span className="siscom-field-label !text-[11px]">Nome</span>
                  <input
                    type="text"
                    value={individual.nome}
                    onChange={(e) => {
                      const nextNome = e.target.value;
                      setIndividual((prev) => ({
                        ...prev,
                        nome: nextNome,
                        prefix:
                          prev.prefixAuto !== false
                            ? inferPortugueseRecipientPrefix(nextNome)
                            : prev.prefix,
                      }));
                    }}
                    placeholder="JOSUE GAIBA COELHO"
                    className="siscom-input !min-h-[38px] text-xs uppercase"
                  />
                </label>

                <div className="grid grid-cols-[70px_1fr_82px] gap-2">
                  <label className="space-y-1">
                    <span className="siscom-field-label !text-[11px]">Dia</span>
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
                      className="siscom-input !min-h-[38px] !px-2.5 text-xs font-mono"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="siscom-field-label !text-[11px]">Mês</span>
                    <select
                      value={individual.mes}
                      onChange={(e) =>
                        setIndividual((prev) => ({
                          ...prev,
                          mes: e.target.value,
                          customDateOverride: '',
                        }))
                      }
                      className="siscom-input !min-h-[38px] !px-2 text-xs"
                    >
                      {MONTHS_PT.map((mName) => (
                        <option key={mName} value={mName}>
                          {mName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="siscom-field-label !text-[11px]">Ano</span>
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
                      className="siscom-input !min-h-[38px] !px-2 text-xs font-mono"
                    />
                  </label>
                </div>

                <label className="block space-y-1">
                  <span className="flex items-center gap-1 text-[11px] font-medium text-[#98A89F]">
                    <Calendar className="w-3 h-3 text-[#83B499]" />
                    Data livre (opcional)
                  </span>
                  <input
                    type="text"
                    value={individual.customDateOverride}
                    onChange={(e) =>
                      setIndividual((prev) => ({ ...prev, customDateOverride: e.target.value }))
                    }
                    placeholder={formatBirthdayCardDate(individual.dia, individual.mes, individual.ano)}
                    className="siscom-input !min-h-[38px] text-xs"
                  />
                </label>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Editable Body Paragraph */}
        <section className="space-y-2.5 border-t border-white/8 pt-4">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="aniv-texto-input" className="siscom-field-label">
              Texto
            </label>
            {customBodyText !== null && (
              <button
                type="button"
                onClick={() => setCustomBodyText(null)}
                className="inline-flex items-center gap-1 text-[11px] text-[#83B499] hover:text-[#A8D6BC] transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Padrão
              </button>
            )}
          </div>

          <textarea
            id="aniv-texto-input"
            rows={4}
            value={activeBodyText}
            onChange={(e) => setCustomBodyText(e.target.value)}
            className="siscom-input !min-h-[100px] py-2.5 text-xs sm:text-sm leading-relaxed resize-y"
          />
        </section>

        {/* Digital PNG / ZIP Export Actions */}
        <section className="space-y-2.5 border-t border-white/8 pt-4">
          <button
            type="button"
            onClick={handleDownloadCurrentPng}
            disabled={isExportingPng || Boolean(zipProgress)}
            className="siscom-btn siscom-btn-primary w-full text-sm"
          >
            {isExportingPng ? (
              <SiscomSpinner className="w-4 h-4" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span>{isExportingPng ? 'Gerando...' : 'Baixar PNG'}</span>
          </button>

          {inputMode === 'relacao' && entries.length > 0 && (
            <button
              type="button"
              onClick={handleDownloadAllZip}
              disabled={Boolean(zipProgress) || isExportingPng}
              className="siscom-btn siscom-btn-gold w-full text-xs sm:text-sm"
            >
              {zipProgress ? (
                <SiscomSpinner className="w-4 h-4" tone="gold" />
              ) : (
                <Archive className="w-4 h-4" />
              )}
              <span>
                {zipProgress
                  ? `${zipProgress.current} / ${zipProgress.total}...`
                  : `Baixar ZIP (${entries.length})`}
              </span>
            </button>
          )}

          <AnimatePresence>
            {errorMsg && (
              <SiscomAlert tone="error" onDismiss={() => setErrorMsg(null)}>
                {errorMsg}
              </SiscomAlert>
            )}
          </AnimatePresence>
        </section>
        </div>
      }
      bottomBar={
        <div className="w-full flex items-center justify-between gap-2 text-xs text-[#98A89F]">
          <span>
            {audience === 'eterno_comandante' ? 'Eterno Comandante' : 'Militares'}
          </span>
          <span className="font-mono text-[#E5C17B]">{ANIV_W_PX} × {ANIV_H_PX} PNG</span>
        </div>
      }
    >
      <div className="w-full flex flex-col items-center">
        <div className="w-full max-w-[820px]">
          <PinchZoomSheetFrame
            maxWidthClass="max-w-[820px]"
            className="rounded-xl shadow-2xl border border-white/10 bg-white"
          >
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
          </PinchZoomSheetFrame>
        </div>
      </div>
    </WorkspaceSplitLayout>
  );
};
