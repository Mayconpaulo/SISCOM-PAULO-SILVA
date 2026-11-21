import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Edit3,
  FilePlus2,
  FileText,
  Plus,
  Printer,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { PinchZoomSheetFrame } from '../../shared/PinchZoomSheetFrame';
import { WorkspaceSplitLayout } from '../../shared/WorkspaceSplitLayout';
import { fadeSlideVariants, stepSlideVariants } from '../../shared/motion';
import { SiscomAlert, SiscomSegmentedTabs, SiscomSpinner } from '../../shared/ui';
import {
  COM_SOC_PROVIDENCIA_OPTIONS,
  type ComSocProvidenciaOption,
  createDefaultRelatorioDocument,
  formatRelatorioEventText,
  generateRelatorioPdfBlob,
  generateRelatorioWordBlob,
  type RelatorioDocument,
  type RelatorioEventEntry,
} from './relatorioExport';
import {
  buildRelatorioWeekPeriod,
  findPeriodDaysFromHeader,
  formatDdMmYyyy,
  formatEventDateRange,
  getRelatorioWeekPeriods,
  type RelatorioPeriodDay,
} from './relatorioPeriods';
import { getSecureVaultItem, setSecureVaultItem } from '../../core/privacy/privacyVault';

const STORAGE_KEY = 'siscom_relatorio_state_v1';

// Exact 96-DPI dimensions of an A4 Vertical sheet (210 x 297 mm)
const A4_PX_W = 793.7;
const A4_PX_H = 1122.52;

interface StoredRelatorioState {
  reports: RelatorioDocument[];
  activeId: string;
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
    id: typeof obj.id === 'string' && obj.id ? obj.id : `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    dataPeriodo: typeof obj.dataPeriodo === 'string' ? obj.dataPeriodo : '',
    evento: typeof obj.evento === 'string' ? obj.evento : '',
    providencias,
    observacao: typeof obj.observacao === 'string' ? obj.observacao : '',
  };
}

function sanitizeRelatorioDocument(raw: unknown): RelatorioDocument | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<RelatorioDocument>;
  const base = createDefaultRelatorioDocument();
  const vtr = obj.vtrDisponibilidade;

  return {
    id: typeof obj.id === 'string' && obj.id ? obj.id : base.id,
    title: typeof obj.title === 'string' && obj.title ? obj.title : base.title,
    periodoCabecalho:
      typeof obj.periodoCabecalho === 'string' ? obj.periodoCabecalho : base.periodoCabecalho,
    preparoEmprego: typeof obj.preparoEmprego === 'string' ? obj.preparoEmprego : base.preparoEmprego,
    estadoSanitario: typeof obj.estadoSanitario === 'string' ? obj.estadoSanitario : base.estadoSanitario,
    problemasDisciplinares:
      typeof obj.problemasDisciplinares === 'string'
        ? obj.problemasDisciplinares
        : base.problemasDisciplinares,
    generosAlimenticios:
      typeof obj.generosAlimenticios === 'string' ? obj.generosAlimenticios : base.generosAlimenticios,
    vtrDisponibilidade: vtr
      ? {
          om: typeof vtr.om === 'string' ? vtr.om : base.vtrDisponibilidade.om,
          motocicletasExistente:
            typeof vtr.motocicletasExistente === 'string'
              ? vtr.motocicletasExistente
              : base.vtrDisponibilidade.motocicletasExistente,
          motocicletasDisponivel:
            typeof vtr.motocicletasDisponivel === 'string'
              ? vtr.motocicletasDisponivel
              : base.vtrDisponibilidade.motocicletasDisponivel,
          vtrOpExistente:
            typeof vtr.vtrOpExistente === 'string'
              ? vtr.vtrOpExistente
              : base.vtrDisponibilidade.vtrOpExistente,
          vtrOpDisponivel:
            typeof vtr.vtrOpDisponivel === 'string'
              ? vtr.vtrOpDisponivel
              : base.vtrDisponibilidade.vtrOpDisponivel,
          vtrAdmExistente:
            typeof vtr.vtrAdmExistente === 'string'
              ? vtr.vtrAdmExistente
              : base.vtrDisponibilidade.vtrAdmExistente,
          vtrAdmDisponivel:
            typeof vtr.vtrAdmDisponivel === 'string'
              ? vtr.vtrAdmDisponivel
              : base.vtrDisponibilidade.vtrAdmDisponivel,
          vtrBldExistente:
            typeof vtr.vtrBldExistente === 'string'
              ? vtr.vtrBldExistente
              : base.vtrDisponibilidade.vtrBldExistente,
          vtrBldDisponivel:
            typeof vtr.vtrBldDisponivel === 'string'
              ? vtr.vtrBldDisponivel
              : base.vtrDisponibilidade.vtrBldDisponivel,
          obusMrtExistente:
            typeof vtr.obusMrtExistente === 'string'
              ? vtr.obusMrtExistente
              : base.vtrDisponibilidade.obusMrtExistente,
          obusMrtDisponivel:
            typeof vtr.obusMrtDisponivel === 'string'
              ? vtr.obusMrtDisponivel
              : base.vtrDisponibilidade.obusMrtDisponivel,
        }
      : base.vtrDisponibilidade,
    marcaModeloRows:
      Array.isArray(obj.marcaModeloRows) && obj.marcaModeloRows.length > 0
        ? obj.marcaModeloRows.map((r, i) => ({
            marcaModelo:
              typeof r?.marcaModelo === 'string'
                ? r.marcaModelo
                : base.marcaModeloRows[i]?.marcaModelo || '',
            disponiveis: typeof r?.disponiveis === 'string' ? r.disponiveis : '0',
            indisponiveis: typeof r?.indisponiveis === 'string' ? r.indisponiveis : '0',
            isTotal: Boolean(r?.isTotal),
          }))
        : base.marcaModeloRows,
    execucaoFinanceiraRows:
      Array.isArray(obj.execucaoFinanceiraRows) && obj.execucaoFinanceiraRows.length > 0
        ? obj.execucaoFinanceiraRows.map((fr) => ({
            contaContabil: typeof fr?.contaContabil === 'string' ? fr.contaContabil : '',
            empenhado2026: typeof fr?.empenhado2026 === 'string' ? fr.empenhado2026 : '',
            liquidado2026: typeof fr?.liquidado2026 === 'string' ? fr.liquidado2026 : '',
            rp2025Inscrito: typeof fr?.rp2025Inscrito === 'string' ? fr.rp2025Inscrito : '',
            rp2025Liquidado: typeof fr?.rp2025Liquidado === 'string' ? fr.rp2025Liquidado : '',
            rp2024Inscrito: typeof fr?.rp2024Inscrito === 'string' ? fr.rp2024Inscrito : '',
            rp2024Liquidado: typeof fr?.rp2024Liquidado === 'string' ? fr.rp2024Liquidado : '',
          }))
        : base.execucaoFinanceiraRows,
    diversosEventos: Array.isArray(obj.diversosEventos)
      ? obj.diversosEventos.map(sanitizeEventEntry).filter((e): e is RelatorioEventEntry => e !== null)
      : [],
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : new Date().toISOString(),
  };
}

function loadInitialRelatorioState(): StoredRelatorioState {
  const initialDoc = createDefaultRelatorioDocument({ id: 'rel-inicial' });
  try {
    const raw = getSecureVaultItem(STORAGE_KEY);
    if (!raw) return { reports: [initialDoc], activeId: initialDoc.id };
    const parsed = JSON.parse(raw) as Partial<StoredRelatorioState>;
    const validReports = Array.isArray(parsed.reports)
      ? parsed.reports
          .map(sanitizeRelatorioDocument)
          .filter((d): d is RelatorioDocument => d !== null)
      : [];
    if (validReports.length === 0) {
      return { reports: [initialDoc], activeId: initialDoc.id };
    }
    const activeId =
      typeof parsed.activeId === 'string' && validReports.some((r) => r.id === parsed.activeId)
        ? parsed.activeId
        : validReports[0].id;
    return { reports: validReports, activeId };
  } catch {
    return { reports: [initialDoc], activeId: initialDoc.id };
  }
}

type WizardStepId = 'period' | 'date' | 'event' | 'providencias';

interface WizardStepMeta {
  id: WizardStepId;
  shortLabel: string;
}

const NEW_REPORT_STEPS: readonly WizardStepMeta[] = [
  { id: 'period', shortLabel: 'Período' },
  { id: 'date', shortLabel: 'Data' },
  { id: 'event', shortLabel: 'Evento' },
  { id: 'providencias', shortLabel: 'Providências' },
];

const EVENT_ONLY_STEPS: readonly WizardStepMeta[] = [
  { id: 'date', shortLabel: 'Data' },
  { id: 'event', shortLabel: 'Evento' },
  { id: 'providencias', shortLabel: 'Providências' },
];

const WEEK_WINDOW_SIZE = 6;

export const RelatorioGenerator: React.FC = () => {
  const [state, setState] = useState<StoredRelatorioState>(() => loadInitialRelatorioState());

  const activeDoc = useMemo(
    () => state.reports.find((r) => r.id === state.activeId) || state.reports[0],
    [state]
  );

  const currentWeekDefault = useMemo(() => buildRelatorioWeekPeriod(0), []);

  // Step-by-step wizard state: auto-open if active report has no events yet
  const [wizardOpen, setWizardOpen] = useState<boolean>(
    () => (activeDoc?.diversosEventos.length ?? 0) === 0
  );
  const [wizardMode, setWizardMode] = useState<'new-report' | 'add-event' | 'edit-event'>(() =>
    (activeDoc?.diversosEventos.length ?? 0) === 0 ? 'new-report' : 'add-event'
  );
  const [wizardStep, setWizardStep] = useState<WizardStepId>(() =>
    (activeDoc?.diversosEventos.length ?? 0) === 0 ? 'period' : 'date'
  );
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  // Friday→Thursday period selector state
  const [weekWindowStartOffset, setWeekWindowStartOffset] = useState<number>(-1);
  const [newReportPeriodo, setNewReportPeriodo] = useState<string>(
    () => activeDoc?.periodoCabecalho || currentWeekDefault.headerLabel
  );
  const [showCustomPeriodInput, setShowCustomPeriodInput] = useState<boolean>(false);
  const [quickPeriodPickerOpen, setQuickPeriodPickerOpen] = useState<boolean>(false);

  // Event day selection helper state (single day vs multi-day range within the Fri→Thu week)
  const [dateSelectionMode, setDateSelectionMode] = useState<'single' | 'range'>('single');
  const [rangeStartDay, setRangeStartDay] = useState<RelatorioPeriodDay | null>(null);

  // The 3 event fields
  const [qDataPeriodo, setQDataPeriodo] = useState<string>('');
  const [qEvento, setQEvento] = useState<string>('');
  const [qProvidencias, setQProvidencias] = useState<ComSocProvidenciaOption[]>([]);
  const [qObservacao, setQObservacao] = useState<string>('');

  const [showAdvancedModel, setShowAdvancedModel] = useState<boolean>(false);
  const [exporting, setExporting] = useState<'pdf' | 'word' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const visibleWeekPeriods = useMemo(
    () => getRelatorioWeekPeriods(weekWindowStartOffset, WEEK_WINDOW_SIZE),
    [weekWindowStartOffset]
  );

  // Active Friday→Thursday period's 7 clickable days for the Date step
  const activePeriodHeaderForDays =
    wizardMode === 'new-report' ? newReportPeriodo : activeDoc?.periodoCabecalho || currentWeekDefault.headerLabel;

  const activePeriodDays = useMemo(
    () => findPeriodDaysFromHeader(activePeriodHeaderForDays),
    [activePeriodHeaderForDays]
  );

  const wizardSteps = wizardMode === 'new-report' ? NEW_REPORT_STEPS : EVENT_ONLY_STEPS;
  const activeStepIndex = Math.max(
    0,
    wizardSteps.findIndex((s) => s.id === wizardStep)
  );

  // Responsive scale measurement so the fixed 210x297mm portrait sheet renders crisply at any viewport width
  const sheetHostRef = useRef<HTMLDivElement | null>(null);
  const [hostWidthPx, setHostWidthPx] = useState<number>(680);

  useEffect(() => {
    const el = sheetHostRef.current;
    if (!el) return;
    const update = () => {
      if (el.clientWidth > 0) setHostWidthPx(el.clientWidth);
    };
    update();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    try {
      setSecureVaultItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore quota errors
    }
  }, [state]);

  useEffect(() => {
    const handlePurged = () => {
      const fresh = createDefaultRelatorioDocument({ id: 'rel-inicial' });
      setState({ reports: [fresh], activeId: fresh.id });
      setWizardOpen(true);
      setWizardMode('new-report');
      setWizardStep('period');
      setNewReportPeriodo(fresh.periodoCabecalho);
      setWeekWindowStartOffset(-1);
      setShowCustomPeriodInput(false);
      setQuickPeriodPickerOpen(false);
      setEditingEventId(null);
      setRangeStartDay(null);
      setDateSelectionMode('single');
      setQDataPeriodo('');
      setQEvento('');
      setQProvidencias([]);
      setQObservacao('');
      setNotice(null);
    };
    window.addEventListener('siscom:vault-purged', handlePurged);
    return () => window.removeEventListener('siscom:vault-purged', handlePurged);
  }, []);

  const updateActiveReport = (updater: (doc: RelatorioDocument) => RelatorioDocument) => {
    setState((prev) => ({
      ...prev,
      reports: prev.reports.map((r) =>
        r.id === prev.activeId ? { ...updater(r), updatedAt: new Date().toISOString() } : r
      ),
    }));
  };

  const resetWizardFields = () => {
    setQDataPeriodo('');
    setQEvento('');
    setQProvidencias([]);
    setQObservacao('');
    setEditingEventId(null);
    setRangeStartDay(null);
    setDateSelectionMode('single');
    setFormError(null);
  };

  const handleStartNewReport = () => {
    resetWizardFields();
    setWeekWindowStartOffset(-1);
    setNewReportPeriodo(currentWeekDefault.headerLabel);
    setShowCustomPeriodInput(false);
    setQuickPeriodPickerOpen(false);
    setWizardMode('new-report');
    setWizardStep('period');
    setWizardOpen(true);
    setNotice(null);
  };

  const handleStartAddEvent = () => {
    resetWizardFields();
    setQuickPeriodPickerOpen(false);
    setWizardMode('add-event');
    setWizardStep('date');
    setWizardOpen(true);
    setNotice(null);
  };

  const handleEditEvent = (entry: RelatorioEventEntry) => {
    setEditingEventId(entry.id);
    setQDataPeriodo(entry.dataPeriodo);
    setQEvento(entry.evento);
    setQProvidencias([...entry.providencias]);
    setQObservacao(entry.observacao || '');
    setRangeStartDay(null);
    setDateSelectionMode('single');
    setQuickPeriodPickerOpen(false);
    setWizardMode('edit-event');
    setWizardStep('date');
    setWizardOpen(true);
    setFormError(null);
    setNotice(null);
  };

  const toggleProvidencia = (opt: ComSocProvidenciaOption) => {
    setQProvidencias((prev) =>
      prev.includes(opt) ? prev.filter((item) => item !== opt) : [...prev, opt]
    );
  };

  const handlePickPeriodInWizard = (headerLabel: string) => {
    setNewReportPeriodo(headerLabel);
    setFormError(null);
    // Keep live preview synced immediately when starting on an empty report
    if (activeDoc && activeDoc.diversosEventos.length === 0) {
      updateActiveReport((doc) => ({
        ...doc,
        periodoCabecalho: headerLabel,
        title: `Relatório Semanal – ${headerLabel}`,
      }));
    }
  };

  const handlePickPeriodForActiveReport = (headerLabel: string) => {
    updateActiveReport((doc) => ({
      ...doc,
      periodoCabecalho: headerLabel,
      title: `Relatório Semanal – ${headerLabel}`,
    }));
    setNewReportPeriodo(headerLabel);
    setQuickPeriodPickerOpen(false);
    setNotice(`Período atualizado para ${headerLabel}.`);
  };

  const handleDayButtonClick = (day: RelatorioPeriodDay) => {
    setFormError(null);
    if (dateSelectionMode === 'single') {
      setRangeStartDay(null);
      setQDataPeriodo(day.fullDate);
      return;
    }

    if (!rangeStartDay) {
      setRangeStartDay(day);
      setQDataPeriodo(day.fullDate);
      return;
    }

    if (rangeStartDay.iso === day.iso) {
      setRangeStartDay(null);
      setQDataPeriodo(day.fullDate);
      return;
    }

    setQDataPeriodo(formatEventDateRange(rangeStartDay.date, day.date));
    setRangeStartDay(null);
  };

  const validateStep = (step: WizardStepId): string | null => {
    if (step === 'period') {
      if (!newReportPeriodo.trim()) {
        return 'Selecione um período (sexta a quinta) para o relatório.';
      }
      return null;
    }
    if (step === 'date') {
      if (!qDataPeriodo.trim()) {
        return 'Selecione ou informe a data em que o evento aconteceu.';
      }
      return null;
    }
    if (step === 'event') {
      if (!qEvento.trim()) {
        return 'Descreva qual foi o evento.';
      }
      return null;
    }
    if (step === 'providencias') {
      if (qProvidencias.length === 0 && !qObservacao.trim()) {
        return 'Selecione ao menos uma providência da Seção de Comunicação Social.';
      }
      return null;
    }
    return null;
  };

  const handleNextStep = () => {
    const err = validateStep(wizardStep);
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    const nextIdx = activeStepIndex + 1;
    if (nextIdx < wizardSteps.length) {
      setWizardStep(wizardSteps[nextIdx].id);
    }
  };

  const handlePrevStep = () => {
    setFormError(null);
    const prevIdx = activeStepIndex - 1;
    if (prevIdx >= 0) {
      setWizardStep(wizardSteps[prevIdx].id);
    }
  };

  const handleJumpToStep = (targetIdx: number) => {
    if (targetIdx === activeStepIndex) return;
    if (targetIdx < activeStepIndex) {
      setFormError(null);
      setWizardStep(wizardSteps[targetIdx].id);
      return;
    }
    // Validate intermediate steps before jumping forward
    for (let i = activeStepIndex; i < targetIdx; i++) {
      const err = validateStep(wizardSteps[i].id);
      if (err) {
        setFormError(err);
        return;
      }
    }
    setFormError(null);
    setWizardStep(wizardSteps[targetIdx].id);
  };

  const handleFinalizeWizard = (addAnotherAfter = false) => {
    for (const step of wizardSteps) {
      const err = validateStep(step.id);
      if (err) {
        setFormError(err);
        setWizardStep(step.id);
        return;
      }
    }

    setFormError(null);

    const newEntry: RelatorioEventEntry = {
      id: editingEventId || `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      dataPeriodo: qDataPeriodo.trim(),
      evento: qEvento.trim(),
      providencias: [...qProvidencias],
      observacao: qObservacao.trim(),
    };

    if (wizardMode === 'new-report') {
      const shouldReuseEmptyCurrent = activeDoc && activeDoc.diversosEventos.length === 0;
      const periodoClean = newReportPeriodo.trim() || currentWeekDefault.headerLabel;

      if (shouldReuseEmptyCurrent) {
        updateActiveReport((doc) => ({
          ...doc,
          periodoCabecalho: periodoClean,
          title: `Relatório Semanal – ${periodoClean}`,
          diversosEventos: [newEntry],
        }));
      } else {
        const created = createDefaultRelatorioDocument({
          periodoCabecalho: periodoClean,
          diversosEventos: [newEntry],
        });
        setState((prev) => ({
          reports: [created, ...prev.reports],
          activeId: created.id,
        }));
      }
      setNotice('Evento adicionado em 5. Diversos.');
      resetWizardFields();
      if (addAnotherAfter) {
        setWizardMode('add-event');
        setWizardStep('date');
      } else {
        setWizardOpen(false);
      }
      return;
    }

    if (wizardMode === 'edit-event' && editingEventId) {
      updateActiveReport((doc) => ({
        ...doc,
        diversosEventos: doc.diversosEventos.map((ev) =>
          ev.id === editingEventId ? newEntry : ev
        ),
      }));
      setNotice('Evento atualizado em 5. Diversos.');
      resetWizardFields();
      setWizardOpen(false);
      return;
    }

    // add-event mode
    updateActiveReport((doc) => ({
      ...doc,
      diversosEventos: [...doc.diversosEventos, newEntry],
    }));
    setNotice('Evento adicionado em 5. Diversos.');
    resetWizardFields();
    if (addAnotherAfter) {
      setWizardStep('date');
    } else {
      setWizardOpen(false);
    }
  };

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeStepIndex < wizardSteps.length - 1) {
      handleNextStep();
    } else {
      handleFinalizeWizard(false);
    }
  };

  const handleRemoveEvent = (id: string) => {
    updateActiveReport((doc) => ({
      ...doc,
      diversosEventos: doc.diversosEventos.filter((ev) => ev.id !== id),
    }));
    if (editingEventId === id) {
      resetWizardFields();
      setWizardOpen(false);
    }
  };

  const handleMoveEvent = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (!activeDoc || target < 0 || target >= activeDoc.diversosEventos.length) return;
    updateActiveReport((doc) => {
      const copy = [...doc.diversosEventos];
      const [item] = copy.splice(idx, 1);
      copy.splice(target, 0, item);
      return { ...doc, diversosEventos: copy };
    });
  };

  const handleDeleteCurrentReport = () => {
    if (state.reports.length <= 1) {
      const fresh = createDefaultRelatorioDocument({ id: activeDoc.id });
      setState({ reports: [fresh], activeId: fresh.id });
      setWizardMode('new-report');
      setWizardStep('period');
      setNewReportPeriodo(fresh.periodoCabecalho);
      setWizardOpen(true);
      resetWizardFields();
      setNotice('Relatório limpo.');
      return;
    }
    const remaining = state.reports.filter((r) => r.id !== activeDoc.id);
    setState({
      reports: remaining,
      activeId: remaining[0].id,
    });
    const isEmpty = remaining[0].diversosEventos.length === 0;
    setWizardMode(isEmpty ? 'new-report' : 'add-event');
    setWizardStep(isEmpty ? 'period' : 'date');
    setNewReportPeriodo(remaining[0].periodoCabecalho);
    setWizardOpen(isEmpty);
    setNotice('Relatório removido.');
  };

  const handleDownloadPdf = async () => {
    if (!activeDoc) return;
    setExporting('pdf');
    setNotice(null);
    try {
      const blob = await generateRelatorioPdfBlob(activeDoc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const slug =
        activeDoc.periodoCabecalho
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'semanal';
      a.download = `relatorio-1bimec-${slug}-vertical.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice('PDF A4 vertical gerado.');
    } catch {
      setNotice('Erro ao gerar PDF.');
    } finally {
      setExporting(null);
    }
  };

  const handleDownloadWord = async () => {
    if (!activeDoc) return;
    setExporting('word');
    setNotice(null);
    try {
      const blob = await generateRelatorioWordBlob(activeDoc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const slug =
        activeDoc.periodoCabecalho
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'semanal';
      a.download = `relatorio-1bimec-${slug}-vertical.doc`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice('Word (.doc) A4 vertical exportado.');
    } catch {
      setNotice('Erro ao gerar .doc.');
    } finally {
      setExporting(null);
    }
  };

  const sheetScale = Math.min(1, Math.max(0.28, hostWidthPx / A4_PX_W));
  const scaledHeightPx = Math.round(A4_PX_H * sheetScale);

  const vtr = activeDoc.vtrDisponibilidade;

  return (
    <WorkspaceSplitLayout
      sidebarWidthClass="lg:w-[420px] xl:w-[450px]"
      sidebar={
        <div className="space-y-4">
        {/* Saved Reports Switcher + Primary Actions */}
        <section className="metal-surface rounded-xl p-4 sm:p-5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div>
              <h2 className="font-display text-sm font-semibold text-[#F4E6C4] tracking-tight">
                Relatório Semanal
              </h2>
              <p className="text-[11px] text-[#98A89F]">
                Formato A4 vertical (210 × 297 mm)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleStartNewReport}
                className="siscom-btn siscom-btn-primary !min-h-[36px] !px-3 text-xs"
              >
                <FilePlus2 className="w-3.5 h-3.5" />
                <span>Novo relatório</span>
              </button>
              <button
                type="button"
                onClick={handleStartAddEvent}
                className="siscom-btn siscom-btn-gold !min-h-[36px] !px-3 text-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Adicionar evento</span>
              </button>
            </div>
          </div>

          {state.reports.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                aria-label="Selecionar relatório salvo"
                value={activeDoc.id}
                onChange={(e) => {
                  const nextId = e.target.value;
                  const target = state.reports.find((r) => r.id === nextId);
                  setState((prev) => ({ ...prev, activeId: nextId }));
                  const isEmpty = (target?.diversosEventos.length ?? 0) === 0;
                  setWizardMode(isEmpty ? 'new-report' : 'add-event');
                  setWizardStep(isEmpty ? 'period' : 'date');
                  setNewReportPeriodo(target?.periodoCabecalho || currentWeekDefault.headerLabel);
                  setWizardOpen(isEmpty);
                  setQuickPeriodPickerOpen(false);
                  resetWizardFields();
                }}
                className="siscom-input flex-1 !min-h-[40px] !py-1.5 text-xs"
              >
                {state.reports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.periodoCabecalho || r.title} ({r.diversosEventos.length} evento
                    {r.diversosEventos.length === 1 ? '' : 's'})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleDeleteCurrentReport}
                title="Limpar ou remover este relatório"
                aria-label="Limpar ou remover este relatório"
                className="siscom-btn siscom-btn-danger !min-h-[40px] !w-10 !px-0 shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Active Friday→Thursday Period Bar (quick switch anytime) */}
          <div className="siscom-liquid-subcard rounded-lg p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="block text-[10px] uppercase tracking-wider text-[#98A89F]">
                  Período (Sexta a Quinta)
                </span>
                <span className="block text-xs font-semibold text-[#F4E6C4] truncate mt-0.5">
                  {activeDoc.periodoCabecalho || currentWeekDefault.headerLabel}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setQuickPeriodPickerOpen((v) => !v)}
                className="siscom-btn siscom-btn-gold !min-h-[34px] !px-2.5 text-[11px] shrink-0"
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>{quickPeriodPickerOpen ? 'Fechar' : 'Trocar'}</span>
              </button>
            </div>

            <AnimatePresence initial={false}>
              {quickPeriodPickerOpen && (
                <motion.div
                  key="quick-period-picker"
                  variants={fadeSlideVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="pt-2.5 border-t border-white/8 space-y-2"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => setWeekWindowStartOffset((o) => o - 4)}
                      className="siscom-btn siscom-btn-secondary !min-h-[32px] !px-2.5 text-[11px]"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>Anteriores</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setWeekWindowStartOffset(-1)}
                      className="siscom-btn siscom-btn-gold !min-h-[32px] !px-2.5 text-[11px]"
                    >
                      Atual
                    </button>
                    <button
                      type="button"
                      onClick={() => setWeekWindowStartOffset((o) => o + 4)}
                      className="siscom-btn siscom-btn-secondary !min-h-[32px] !px-2.5 text-[11px]"
                    >
                      <span>Próximas</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    {visibleWeekPeriods.map((period) => {
                      const selected = activeDoc.periodoCabecalho === period.headerLabel;
                      return (
                        <button
                          key={period.id}
                          type="button"
                          onClick={() => handlePickPeriodForActiveReport(period.headerLabel)}
                          className={`p-2.5 rounded-lg border text-left transition-all active:scale-[0.98] ${
                            selected
                              ? 'bg-[#2D5A43]/42 border-[#83B499] text-[#F4E6C4]'
                              : 'bg-[#0A110E]/48 backdrop-blur-md border-white/12 text-[#C6D4CC] hover:border-[#C29B56]/45'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[10px] font-medium text-[#E5C17B]">
                              {period.relativeTag}
                            </span>
                            {selected && <Check className="w-3 h-3 text-[#83B499] shrink-0" />}
                          </div>
                          <div className="text-[11px] font-semibold text-[#E4EAE6] mt-0.5">
                            {period.weekdayRange}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Export Buttons */}
          <div className="grid grid-cols-3 gap-2 pt-0.5">
            <button
              type="button"
              disabled={exporting !== null}
              onClick={handleDownloadPdf}
              className="siscom-btn siscom-btn-primary !min-h-[40px] !px-2.5 text-xs"
            >
              {exporting === 'pdf' ? (
                <SiscomSpinner className="w-3.5 h-3.5" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>{exporting === 'pdf' ? 'Gerando...' : 'PDF'}</span>
            </button>
            <button
              type="button"
              disabled={exporting !== null}
              onClick={handleDownloadWord}
              className="siscom-btn siscom-btn-gold !min-h-[40px] !px-2.5 text-xs"
            >
              {exporting === 'word' ? (
                <SiscomSpinner className="w-3.5 h-3.5" tone="gold" />
              ) : (
                <FileText className="w-3.5 h-3.5" />
              )}
              <span>{exporting === 'word' ? 'Gerando...' : 'Word (.doc)'}</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="siscom-btn siscom-btn-secondary !min-h-[40px] !px-2.5 text-xs"
            >
              <Printer className="w-3.5 h-3.5 text-[#83B499]" />
              <span>Imprimir</span>
            </button>
          </div>

          <AnimatePresence>
            {notice && (
              <SiscomAlert
                tone={notice.startsWith('Erro') ? 'error' : 'success'}
                onDismiss={() => setNotice(null)}
              >
                {notice}
              </SiscomAlert>
            )}
          </AnimatePresence>
        </section>

        {/* Guided Step-by-Step Creation Wizard */}
        <AnimatePresence initial={false}>
          {wizardOpen && (
            <motion.section
              key="relatorio-wizard"
              variants={fadeSlideVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="metal-elevated rounded-xl p-4 sm:p-5 border border-[#C29B56]/30 space-y-4"
            >
              <div className="flex items-start justify-between gap-2 border-b border-white/8 pb-3">
                <div>
                  <h3 className="font-display text-sm font-semibold text-[#F4E6C4]">
                    {wizardMode === 'new-report'
                      ? 'Criar Relatório por Etapas'
                      : wizardMode === 'edit-event'
                        ? 'Editar Evento por Etapas'
                        : 'Adicionar Evento por Etapas'}
                  </h3>
                  <p className="text-[11px] text-[#98A89F] mt-0.5">
                    Etapa {activeStepIndex + 1} de {wizardSteps.length} — preenchimento em 5. Diversos
                  </p>
                </div>
                {activeDoc.diversosEventos.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      resetWizardFields();
                      setWizardOpen(false);
                    }}
                    aria-label="Fechar formulário"
                    className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-[#98A89F] hover:text-white hover:bg-white/8 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Stepper Progress Bar */}
              <nav
                aria-label="Etapas do relatório"
                className="grid gap-1.5"
                style={{ gridTemplateColumns: `repeat(${wizardSteps.length}, minmax(0, 1fr))` }}
              >
                {wizardSteps.map((step, idx) => {
                  const isActive = idx === activeStepIndex;
                  const isDone = idx < activeStepIndex;
                  return (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() => handleJumpToStep(idx)}
                      className={`min-h-[46px] rounded-lg px-2.5 py-1.5 border text-left transition-all active:scale-[0.98] flex flex-col justify-center gap-0.5 ${
                        isActive
                          ? 'bg-[#241E12]/65 backdrop-blur-md border-[#C29B56]/75 text-[#F4E6C4]'
                          : isDone
                            ? 'bg-[#2D5A43]/28 backdrop-blur-md border-[#83B499]/45 text-[#B4D8C5] hover:border-[#83B499]/70'
                            : 'bg-[#0A110E]/45 backdrop-blur-md border-white/10 text-[#98A89F] hover:border-white/22'
                      }`}
                    >
                      <span className="flex items-center justify-between text-[10px] font-mono">
                        <span>{idx + 1}</span>
                        {isDone && <Check className="w-3 h-3 text-[#83B499]" />}
                      </span>
                      <span className="text-[11px] font-medium truncate">{step.shortLabel}</span>
                    </button>
                  );
                })}
              </nav>

              <form onSubmit={handleSubmitForm} className="space-y-4">
                <AnimatePresence mode="wait">
                  {/* STEP: PERIOD (Friday to Thursday) */}
                  {wizardStep === 'period' && (
                    <motion.div
                      key="step-period"
                      variants={stepSlideVariants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      className="space-y-3"
                    >
                  <div>
                    <h4 className="text-xs font-semibold text-[#F4E6C4]">
                      Escolha a semana do relatório (Sexta a Quinta)
                    </h4>
                    <p className="text-[11px] text-[#98A89F] mt-0.5">
                      Clique no período desejado. Cada semana vai de sexta-feira até quinta-feira da semana seguinte.
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => setWeekWindowStartOffset((o) => o - 4)}
                      className="siscom-btn siscom-btn-secondary !min-h-[34px] !px-2.5 text-[11px]"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>Anteriores</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setWeekWindowStartOffset(-1)}
                      className="siscom-btn siscom-btn-gold !min-h-[34px] !px-2.5 text-[11px]"
                    >
                      Semana atual
                    </button>
                    <button
                      type="button"
                      onClick={() => setWeekWindowStartOffset((o) => o + 4)}
                      className="siscom-btn siscom-btn-secondary !min-h-[34px] !px-2.5 text-[11px]"
                    >
                      <span>Próximas</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {visibleWeekPeriods.map((period) => {
                      const selected = newReportPeriodo === period.headerLabel;
                      return (
                        <button
                          key={period.id}
                          type="button"
                          onClick={() => handlePickPeriodInWizard(period.headerLabel)}
                          aria-pressed={selected}
                          className={`p-3 rounded-lg border text-left transition-all active:scale-[0.98] space-y-1 ${
                            selected
                              ? 'bg-[#2D5A43]/42 border-[#83B499] text-[#F4E6C4]'
                              : 'bg-[#0A110E]/48 backdrop-blur-md border-white/12 text-[#C6D4CC] hover:border-[#C29B56]/50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span
                              className={`text-[10px] font-medium uppercase tracking-wide ${
                                period.weekOffset === 0
                                  ? 'text-[#83B499]'
                                  : selected
                                    ? 'text-[#E5C17B]'
                                    : 'text-[#98A89F]'
                              }`}
                            >
                              {period.relativeTag}
                            </span>
                            {selected && <Check className="w-3.5 h-3.5 text-[#83B499] shrink-0" />}
                          </div>
                          <div className="text-xs font-semibold text-[#E4EAE6]">
                            {period.weekdayRange}
                          </div>
                          <div className="text-[10px] font-mono text-[#98A89F] truncate">
                            {period.headerLabel}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowCustomPeriodInput((v) => !v)}
                      className="text-[11px] text-[#98A89F] hover:text-[#E5C17B] underline underline-offset-2 transition-colors"
                    >
                      {showCustomPeriodInput
                        ? 'Ocultar edição manual do período'
                        : 'Precisa de outro texto de período? Editar manualmente'}
                    </button>
                    {showCustomPeriodInput && (
                      <input
                        id="rel-periodo-cab"
                        type="text"
                        value={newReportPeriodo}
                        onChange={(e) => handlePickPeriodInWizard(e.target.value)}
                        placeholder="ex: 14 A 20 AGOSTO 26"
                        className="siscom-input mt-2 !min-h-[40px] text-xs"
                      />
                    )}
                  </div>
                </motion.div>
              )}

              {/* STEP: EVENT DATE (7 clickable days from Friday to Thursday) */}
              {wizardStep === 'date' && (
                <motion.div
                  key="step-date"
                  variants={stepSlideVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="space-y-3"
                >
                  <div className="siscom-liquid-subcard rounded-lg px-3 py-2 flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-[#98A89F]">Semana selecionada:</span>
                    <span className="font-semibold text-[#E5C17B] truncate">
                      {activePeriodHeaderForDays}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label htmlFor="rel-q-data" className="block text-xs font-semibold text-[#F4E6C4]">
                      Quando aconteceu o evento?
                    </label>
                    <SiscomSegmentedTabs
                      layoutId="relatorio-date-mode"
                      size="sm"
                      ariaLabel="Tipo de data do evento"
                      value={dateSelectionMode}
                      onChange={(mode) => {
                        setDateSelectionMode(mode);
                        setRangeStartDay(null);
                      }}
                      options={[
                        { value: 'single', label: '1 dia' },
                        { value: 'range', label: 'Vários dias' },
                      ]}
                    />
                  </div>

                  {dateSelectionMode === 'range' && (
                    <p className="text-[11px] text-[#E5C17B]">
                      {rangeStartDay
                        ? `Início: ${rangeStartDay.weekdayShort} ${rangeStartDay.dayMonth}. Agora clique no dia final.`
                        : 'Clique no primeiro dia e depois no último dia do evento.'}
                    </p>
                  )}

                  {/* 7 Clickable Days of the Selected Friday→Thursday Period */}
                  <div className="grid grid-cols-4 gap-1.5">
                    {activePeriodDays.map((day) => {
                      const isPicked =
                        qDataPeriodo === day.fullDate || rangeStartDay?.iso === day.iso;
                      return (
                        <button
                          key={day.iso}
                          type="button"
                          onClick={() => handleDayButtonClick(day)}
                          className={`min-h-[48px] py-2 px-1.5 rounded-lg border text-center transition-all active:scale-[0.97] ${
                            isPicked
                              ? 'bg-[#2D5A43]/45 border-[#83B499] text-[#F4E6C4]'
                              : 'bg-[#0A110E]/48 backdrop-blur-md border-white/12 text-[#C6D4CC] hover:border-[#C29B56]/50'
                          }`}
                        >
                          <span className="block text-[10px] uppercase text-[#98A89F]">
                            {day.weekdayShort}
                          </span>
                          <span className="block text-xs font-semibold text-[#E4EAE6] mt-0.5">
                            {day.dayMonth}
                          </span>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => {
                        setRangeStartDay(null);
                        if (activePeriodDays.length >= 7) {
                          setQDataPeriodo(
                            formatEventDateRange(
                              activePeriodDays[0].date,
                              activePeriodDays[6].date
                            )
                          );
                        }
                      }}
                      className="min-h-[48px] py-2 px-1.5 rounded-lg border border-[#C29B56]/40 bg-[#241E12]/60 hover:bg-[#2F2717]/70 backdrop-blur-md text-center transition-all active:scale-[0.97]"
                    >
                      <span className="block text-[10px] uppercase text-[#E5C17B]">
                        Sex→Qui
                      </span>
                      <span className="block text-[11px] font-semibold text-[#F4E6C4] mt-0.5">
                        Semana toda
                      </span>
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-[#98A89F]">
                        Data preenchida (editável)
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setRangeStartDay(null);
                          setQDataPeriodo(formatDdMmYyyy(new Date()));
                        }}
                        className="inline-flex items-center gap-1 text-[11px] text-[#E5C17B] hover:underline"
                      >
                        <Calendar className="w-3 h-3" />
                        <span>Hoje</span>
                      </button>
                    </div>
                    <input
                      id="rel-q-data"
                      type="text"
                      value={qDataPeriodo}
                      onChange={(e) => {
                        setRangeStartDay(null);
                        setQDataPeriodo(e.target.value);
                      }}
                      placeholder="ex: 20/08/2026 ou 18 a 20/08/2026"
                      className="siscom-input !min-h-[40px] text-xs"
                    />
                  </div>
                </motion.div>
              )}

              {/* STEP: EVENT DESCRIPTION */}
              {wizardStep === 'event' && (
                <motion.div
                  key="step-event"
                  variants={stepSlideVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="space-y-3"
                >
                  <div className="siscom-liquid-subcard rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <span className="text-[#98A89F]">Data do evento:</span>
                    <span className="font-semibold text-[#83B499]">{qDataPeriodo}</span>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="rel-q-evento" className="block text-xs font-semibold text-[#F4E6C4]">
                      Qual foi o evento?
                    </label>
                    <textarea
                      id="rel-q-evento"
                      rows={3}
                      autoFocus
                      value={qEvento}
                      onChange={(e) => setQEvento(e.target.value)}
                      placeholder="ex: Visita de 20 alunos da escola Patrono Duque de Caxias"
                      className="siscom-input !min-h-[84px] py-2.5 text-xs resize-y"
                    />
                  </div>
                </motion.div>
              )}

              {/* STEP: COM SOC PROVIDÊNCIAS + LIVE PREVIEW */}
              {wizardStep === 'providencias' && (
                <motion.div
                  key="step-providencias"
                  variants={stepSlideVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="space-y-3"
                >
                  <div className="siscom-liquid-subcard rounded-lg px-3 py-2 space-y-0.5 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#98A89F]">Data:</span>
                      <span className="font-semibold text-[#83B499]">{qDataPeriodo}</span>
                    </div>
                    <p className="text-[#C6D4CC] truncate" title={qEvento}>
                      <span className="text-[#98A89F]">Evento: </span>
                      {qEvento}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <span className="block text-xs font-semibold text-[#F4E6C4]">
                      Providências da Seção de Comunicação Social
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      {COM_SOC_PROVIDENCIA_OPTIONS.map((opt) => {
                        const selected = qProvidencias.includes(opt);
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => toggleProvidencia(opt)}
                            aria-pressed={selected}
                            className={`min-h-[42px] px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center justify-between gap-1.5 transition-all active:scale-[0.98] text-left ${
                              selected
                                ? 'bg-[#2D5A43]/42 border-[#83B499] text-[#F4E6C4]'
                                : 'bg-[#0A110E]/48 backdrop-blur-md border-white/12 text-[#C6D4CC] hover:border-[#C29B56]/45'
                            }`}
                          >
                            <span>{opt}</span>
                            {selected && <Check className="w-3.5 h-3.5 text-[#83B499] shrink-0" />}
                          </button>
                        );
                      })}
                    </div>

                    <input
                      type="text"
                      aria-label="Observação complementar opcional"
                      value={qObservacao}
                      onChange={(e) => setQObservacao(e.target.value)}
                      placeholder="Complemento opcional (ex: palestra, visita às instalações...)"
                      className="siscom-input !min-h-[40px] text-xs"
                    />
                  </div>

                  {/* Formatted Line Preview */}
                  {(qProvidencias.length > 0 || qObservacao.trim()) && (
                    <div className="rounded-lg bg-[#16271F]/55 backdrop-blur-md border border-[#83B499]/32 p-3 space-y-1">
                      <span className="block text-[10px] uppercase tracking-wider text-[#83B499]">
                        Como ficará em 5. Diversos
                      </span>
                      <p className="text-xs text-[#E4EAE6] leading-relaxed">
                        {formatRelatorioEventText({
                          id: 'preview',
                          dataPeriodo: qDataPeriodo,
                          evento: qEvento,
                          providencias: qProvidencias,
                          observacao: qObservacao,
                        })}
                      </p>
                    </div>
                  )}
                </motion.div>
              )}
                </AnimatePresence>

                <AnimatePresence>
                  {formError && <SiscomAlert tone="error">{formError}</SiscomAlert>}
                </AnimatePresence>

                {/* Step Navigation Footer */}
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/8">
                  {activeStepIndex > 0 && (
                    <button
                      type="button"
                      onClick={handlePrevStep}
                      className="siscom-btn siscom-btn-secondary !min-h-[42px] !px-3.5 text-xs"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Voltar</span>
                    </button>
                  )}

                  {activeStepIndex < wizardSteps.length - 1 ? (
                    <button
                      type="submit"
                      className="siscom-btn siscom-btn-primary flex-1 !min-h-[42px] text-xs"
                    >
                      <span>Avançar</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <>
                      <button
                        type="submit"
                        className="siscom-btn siscom-btn-primary flex-1 !min-h-[42px] text-xs"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>
                          {wizardMode === 'edit-event' ? 'Salvar alterações' : 'Concluir e salvar'}
                        </span>
                      </button>
                      {wizardMode !== 'edit-event' && (
                        <button
                          type="button"
                          onClick={() => handleFinalizeWizard(true)}
                          className="siscom-btn siscom-btn-gold !min-h-[42px] !px-3.5 text-xs"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Salvar e +1</span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </form>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Added Events in 5. Diversos */}
        <section className="metal-surface rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2 border-b border-white/8 pb-2.5">
            <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-[#E5C17B]">
              5. Diversos ({activeDoc.diversosEventos.length})
            </h3>
            {!wizardOpen && (
              <button
                type="button"
                onClick={handleStartAddEvent}
                className="text-xs text-[#83B499] hover:text-[#B4D8C5] inline-flex items-center gap-1 font-medium transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Incluir evento</span>
              </button>
            )}
          </div>

          {activeDoc.diversosEventos.length === 0 ? (
            <p className="text-xs text-[#98A89F] leading-relaxed">
              Nenhum evento adicionado ainda. Responda às etapas acima para preencher o item 5. Diversos.
            </p>
          ) : (
            <ul className="space-y-2">
              {activeDoc.diversosEventos.map((ev, idx) => (
                <li
                  key={ev.id}
                  className="siscom-liquid-subcard rounded-lg p-3 space-y-2"
                >
                  <p className="text-xs text-[#E4EAE6] leading-relaxed">
                    {formatRelatorioEventText(ev)}
                  </p>
                  <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-white/6">
                    <span className="text-[10px] font-mono text-[#98A89F] truncate">
                      {ev.providencias.join(' · ') || 'Sem marcação'}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleMoveEvent(idx, -1)}
                        title="Mover para cima"
                        aria-label="Mover para cima"
                        className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-md text-[#98A89F] hover:text-white hover:bg-white/6 disabled:opacity-30 transition-colors"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === activeDoc.diversosEventos.length - 1}
                        onClick={() => handleMoveEvent(idx, 1)}
                        title="Mover para baixo"
                        aria-label="Mover para baixo"
                        className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-md text-[#98A89F] hover:text-white hover:bg-white/6 disabled:opacity-30 transition-colors"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEditEvent(ev)}
                        title="Editar evento"
                        aria-label="Editar evento"
                        className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-md text-[#E5C17B] hover:bg-white/8 transition-colors"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveEvent(ev.id)}
                        title="Remover evento"
                        aria-label="Remover evento"
                        className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-md text-[#98A89F] hover:text-red-300 hover:bg-red-950/40 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Optional Fixed Template Overrides (Collapsed by default so template stays intact) */}
        <section className="metal-surface rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAdvancedModel((v) => !v)}
            className="w-full min-h-[44px] px-4 py-3 flex items-center justify-between gap-2 text-xs font-medium text-[#C6D4CC] hover:text-white transition-colors"
          >
            <span>Ajustar período / campos do modelo (opcional)</span>
            {showAdvancedModel ? (
              <ChevronUp className="w-4 h-4 text-[#98A89F]" />
            ) : (
              <ChevronDown className="w-4 h-4 text-[#98A89F]" />
            )}
          </button>

          <AnimatePresence initial={false}>
            {showAdvancedModel && (
              <motion.div
                key="advanced-model"
                variants={fadeSlideVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="px-4 pb-4 pt-3 border-t border-white/8 space-y-3"
              >
                <div className="space-y-1.5">
                  <label htmlFor="adv-periodo" className="siscom-field-label !text-[11px]">
                    Período no cabeçalho (Relatório Semanal do 1º BIMec (Es) – ...)
                  </label>
                  <input
                    id="adv-periodo"
                    type="text"
                    value={activeDoc.periodoCabecalho}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateActiveReport((doc) => ({
                        ...doc,
                        periodoCabecalho: val,
                        title: `Relatório Semanal – ${val}`,
                      }));
                    }}
                    className="siscom-input !min-h-[38px] text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label htmlFor="adv-1" className="siscom-field-label !text-[11px]">
                      1. Preparo e Emprego
                    </label>
                    <input
                      id="adv-1"
                      type="text"
                      value={activeDoc.preparoEmprego}
                      onChange={(e) =>
                        updateActiveReport((doc) => ({ ...doc, preparoEmprego: e.target.value }))
                      }
                      className="siscom-input !min-h-[38px] text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="adv-2" className="siscom-field-label !text-[11px]">
                      2. Estado Sanitário
                    </label>
                    <input
                      id="adv-2"
                      type="text"
                      value={activeDoc.estadoSanitario}
                      onChange={(e) =>
                        updateActiveReport((doc) => ({ ...doc, estadoSanitario: e.target.value }))
                      }
                      className="siscom-input !min-h-[38px] text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="adv-3" className="siscom-field-label !text-[11px]">
                      3. Problemas Disciplinares
                    </label>
                    <input
                      id="adv-3"
                      type="text"
                      value={activeDoc.problemasDisciplinares}
                      onChange={(e) =>
                        updateActiveReport((doc) => ({
                          ...doc,
                          problemasDisciplinares: e.target.value,
                        }))
                      }
                      className="siscom-input !min-h-[38px] text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="adv-412" className="siscom-field-label !text-[11px]">
                      4.1.2. Gêneros Alimentícios
                    </label>
                    <input
                      id="adv-412"
                      type="text"
                      value={activeDoc.generosAlimenticios}
                      onChange={(e) =>
                        updateActiveReport((doc) => ({
                          ...doc,
                          generosAlimenticios: e.target.value,
                        }))
                      }
                      className="siscom-input !min-h-[38px] text-xs"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const fresh = createDefaultRelatorioDocument({
                      id: activeDoc.id,
                      diversosEventos: activeDoc.diversosEventos,
                    });
                    updateActiveReport(() => fresh);
                    setNotice('Campos do modelo restaurados.');
                  }}
                  className="siscom-btn siscom-btn-secondary !min-h-[38px] text-xs"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restaurar padrão do modelo</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
        </div>
      }
      bottomBar={
        <div className="w-full flex items-center justify-between gap-2 text-xs text-[#98A89F]">
          <span>Pré-visualização do Relatório</span>
          <span className="font-mono text-[#E5C17B]">A4 Vertical · 210 × 297 mm</span>
        </div>
      }
    >
      <div className="w-full flex flex-col items-center print-wrapper">
        <div className="w-full max-w-[740px]">
          <PinchZoomSheetFrame
            maxWidthClass="max-w-[740px]"
            className="rounded-xl shadow-2xl border border-white/10 bg-white"
          >
            <div
              ref={sheetHostRef}
              style={{ height: `${scaledHeightPx}px` }}
              className="w-full relative print-zoom-reset print-wrapper overflow-hidden bg-white"
            >
              <div
                style={{
                  width: `${A4_PX_W}px`,
                  minHeight: `${A4_PX_H}px`,
                  transform: `scale(${sheetScale})`,
                  transformOrigin: 'top left',
                  fontFamily: '"Times New Roman", Times, serif',
                }}
                className="print-a4-sheet bg-white text-black px-[11mm] py-[10mm] box-border select-text"
              >
                {/* Coat of Arms + Institutional Header */}
                <div className="flex flex-col items-center text-center mb-[3mm]">
                  <img
                    src="/assets/cartoes/brasao_republica.png"
                    alt="Brasão da República"
                    className="h-[15.5mm] w-auto object-contain mb-[2mm]"
                    style={{ filter: 'grayscale(100%) contrast(1.2)' }}
                  />
                  <div className="font-bold text-[10.5pt] leading-[1.22] text-black">
                    <div>MINISTÉRIO DA DEFESA</div>
                    <div>EXÉRCITO BRASILEIRO</div>
                    <div>1º BATALHÃO DE INFANTARIA MECANIZADO (ESCOLA)</div>
                    <div>REGIMENTO SAMPAIO</div>
                  </div>
                </div>

                {/* Faithful Institutional Table */}
                <table className="w-full border-collapse table-fixed text-black border border-black">
                  <colgroup>
                    <col style={{ width: '18mm' }} />
                    <col style={{ width: '28mm' }} />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                  </colgroup>
                  <tbody>
                    {/* Banner Row */}
                    <tr>
                      <td
                        colSpan={12}
                        className="border border-black bg-[#C8C8C8] text-center font-bold text-[11.5pt] py-[1.6mm] px-[2mm]"
                      >
                        Relatório Semanal do 1º BIMec (Es) –{' '}
                        {activeDoc.periodoCabecalho || currentWeekDefault.headerLabel}
                      </td>
                    </tr>

                    {/* 1. Preparo e Emprego */}
                    <tr>
                      <td
                        rowSpan={2}
                        className="border border-black bg-[#D9D9D9] text-center text-[9.5pt] align-middle"
                      >
                        1.
                      </td>
                      <td
                        colSpan={11}
                        className="border border-black text-center font-bold text-[9.5pt] py-[0.8mm]"
                      >
                        Preparo e Emprego
                      </td>
                    </tr>
                    <tr>
                      <td
                        colSpan={11}
                        className="border border-black text-center text-[9.5pt] py-[0.8mm]"
                      >
                        {activeDoc.preparoEmprego || 'S/A'}
                      </td>
                    </tr>

                    {/* 2. Estado Sanitário */}
                    <tr>
                      <td
                        rowSpan={2}
                        className="border border-black bg-[#D9D9D9] text-center text-[9.5pt] align-middle"
                      >
                        2.
                      </td>
                      <td
                        colSpan={11}
                        className="border border-black text-center font-bold text-[9.5pt] py-[0.8mm]"
                      >
                        Estado Sanitário
                      </td>
                    </tr>
                    <tr>
                      <td
                        colSpan={11}
                        className="border border-black text-center text-[9.5pt] py-[0.8mm]"
                      >
                        {activeDoc.estadoSanitario || 'S/A'}
                      </td>
                    </tr>

                    {/* 3. Problemas Disciplinares / Justiça */}
                    <tr>
                      <td
                        rowSpan={2}
                        className="border border-black bg-[#D9D9D9] text-center text-[9.5pt] align-middle"
                      >
                        3.
                      </td>
                      <td
                        colSpan={11}
                        className="border border-black text-center font-bold text-[9.5pt] py-[0.8mm]"
                      >
                        Problemas Disciplinares / Justiça
                      </td>
                    </tr>
                    <tr>
                      <td
                        colSpan={11}
                        className="border border-black text-center text-[9.5pt] py-[0.8mm]"
                      >
                        {activeDoc.problemasDisciplinares || 'S/A'}
                      </td>
                    </tr>

                    {/* 4. Assuntos Administrativos */}
                    <tr>
                      <td className="border border-black bg-[#D9D9D9] text-center text-[9.5pt] align-middle py-[0.8mm]">
                        4.
                      </td>
                      <td
                        colSpan={11}
                        className="border border-black text-center font-bold text-[9.5pt] py-[0.8mm]"
                      >
                        Assuntos Administrativos
                      </td>
                    </tr>

                    {/* 4.1. Logística */}
                    <tr>
                      <td className="border border-black bg-[#D9D9D9] text-center text-[9.5pt] align-middle py-[0.8mm]">
                        4.1.
                      </td>
                      <td
                        colSpan={11}
                        className="border border-black text-center font-bold text-[9.5pt] py-[0.8mm]"
                      >
                        Logística
                      </td>
                    </tr>

                    {/* 4.1.2. Gêneros Alimentícios */}
                    <tr>
                      <td
                        rowSpan={2}
                        className="border border-black bg-[#D9D9D9] text-center text-[9.5pt] align-middle"
                      >
                        4.1.2.
                      </td>
                      <td
                        colSpan={11}
                        className="border border-black text-center font-bold text-[9.5pt] py-[0.8mm]"
                      >
                        Gêneros Alimentícios
                      </td>
                    </tr>
                    <tr>
                      <td
                        colSpan={11}
                        className="border border-black text-center text-[9.5pt] py-[0.8mm]"
                      >
                        {activeDoc.generosAlimenticios || 'S/A'}
                      </td>
                    </tr>

                    {/* 4.2. Disponibilidade de Vtr e Obus / Mtr */}
                    <tr>
                      <td
                        rowSpan={4 + activeDoc.marcaModeloRows.length + 1}
                        className="border border-black bg-[#D9D9D9] text-center text-[9.5pt] align-middle"
                      >
                        4.2.
                      </td>
                      <td
                        colSpan={11}
                        className="border border-black text-center font-bold text-[9.5pt] py-[0.9mm]"
                      >
                        Disponibilidade de Vtr e Obus / Mtr
                      </td>
                    </tr>
                    <tr>
                      <td rowSpan={2} className="border border-black text-center text-[8pt] align-middle">
                        OM
                      </td>
                      <td colSpan={2} className="border border-black text-center text-[8pt] py-[0.7mm]">
                        Motocicletas
                      </td>
                      <td colSpan={2} className="border border-black text-center text-[8pt] py-[0.7mm]">
                        Vtr Op
                      </td>
                      <td colSpan={2} className="border border-black text-center text-[8pt] py-[0.7mm]">
                        Vtr Adm
                      </td>
                      <td colSpan={2} className="border border-black text-center text-[8pt] py-[0.7mm]">
                        Vtr Bld
                      </td>
                      <td colSpan={2} className="border border-black text-center text-[8pt] py-[0.7mm]">
                        Obus/Mrt
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-black text-center text-[7pt] py-[0.6mm]">Existente</td>
                      <td className="border border-black text-center text-[7pt] py-[0.6mm]">Disponível</td>
                      <td className="border border-black text-center text-[7pt] py-[0.6mm]">Existente</td>
                      <td className="border border-black text-center text-[7pt] py-[0.6mm]">Disponível</td>
                      <td className="border border-black text-center text-[7pt] py-[0.6mm]">Existente</td>
                      <td className="border border-black text-center text-[7pt] py-[0.6mm]">Disponível</td>
                      <td className="border border-black text-center text-[7pt] py-[0.6mm]">Existente</td>
                      <td className="border border-black text-center text-[7pt] py-[0.6mm]">Disponível</td>
                      <td className="border border-black text-center text-[7pt] py-[0.6mm]">Existente</td>
                      <td className="border border-black text-center text-[7pt] py-[0.6mm]">Disponível</td>
                    </tr>
                    <tr>
                      <td className="border border-black text-center text-[8pt] py-[1mm]">{vtr.om}</td>
                      <td className="border border-black text-center text-[8pt] py-[1mm]">
                        {vtr.motocicletasExistente}
                      </td>
                      <td className="border border-black text-center text-[8pt] py-[1mm]">
                        {vtr.motocicletasDisponivel}
                      </td>
                      <td className="border border-black text-center text-[8pt] py-[1mm]">
                        {vtr.vtrOpExistente}
                      </td>
                      <td className="border border-black text-center text-[8pt] py-[1mm]">
                        {vtr.vtrOpDisponivel}
                      </td>
                      <td className="border border-black text-center text-[8pt] py-[1mm]">
                        {vtr.vtrAdmExistente}
                      </td>
                      <td className="border border-black text-center text-[8pt] py-[1mm]">
                        {vtr.vtrAdmDisponivel}
                      </td>
                      <td className="border border-black text-center text-[8pt] py-[1mm]">
                        {vtr.vtrBldExistente}
                      </td>
                      <td className="border border-black text-center text-[8pt] py-[1mm]">
                        {vtr.vtrBldDisponivel}
                      </td>
                      <td className="border border-black text-center text-[8pt] py-[1mm]">
                        {vtr.obusMrtExistente}
                      </td>
                      <td className="border border-black text-center text-[8pt] py-[1mm]">
                        {vtr.obusMrtDisponivel}
                      </td>
                    </tr>

                    {/* Sub-table 2: Marca/Modelo */}
                    <tr>
                      <td colSpan={4} className="border border-black text-center text-[8pt] py-[0.7mm]">
                        Marca/Modelo
                      </td>
                      <td colSpan={4} className="border border-black text-center text-[8pt] py-[0.7mm]">
                        Vtr Operacionais Disponíveis
                      </td>
                      <td colSpan={3} className="border border-black text-center text-[8pt] py-[0.7mm]">
                        Vtr Operacionais Indisponíveis
                      </td>
                    </tr>
                    {activeDoc.marcaModeloRows.map((mr, i) => (
                      <tr key={`${mr.marcaModelo}-${i}`}>
                        <td
                          colSpan={4}
                          className={`border border-black text-center text-[8pt] py-[0.65mm] ${
                            mr.isTotal ? 'font-bold' : ''
                          }`}
                        >
                          {mr.marcaModelo}
                        </td>
                        <td
                          colSpan={4}
                          className={`border border-black text-center text-[8pt] py-[0.65mm] ${
                            mr.isTotal ? 'font-bold' : ''
                          }`}
                        >
                          {mr.disponiveis}
                        </td>
                        <td
                          colSpan={3}
                          className={`border border-black text-center text-[8pt] py-[0.65mm] ${
                            mr.isTotal ? 'font-bold' : ''
                          }`}
                        >
                          {mr.indisponiveis}
                        </td>
                      </tr>
                    ))}

                    {/* 4.3 Execução Financeira */}
                    <tr>
                      <td
                        rowSpan={3 + activeDoc.execucaoFinanceiraRows.length}
                        className="border border-black bg-[#D9D9D9] text-center text-[9.5pt] align-middle"
                      >
                        4.3
                      </td>
                      <td
                        colSpan={11}
                        className="border border-black text-center font-bold text-[9.5pt] py-[0.8mm]"
                      >
                        Execução Financeira
                      </td>
                    </tr>
                    <tr>
                      <td
                        colSpan={5}
                        rowSpan={2}
                        className="border border-black text-center text-[8pt] align-middle"
                      >
                        Conta Contábil – 1º BI Mec (Es)
                      </td>
                      <td colSpan={2} className="border border-black text-center text-[8pt] py-[0.7mm]">
                        2026
                      </td>
                      <td colSpan={2} className="border border-black text-center text-[8pt] py-[0.7mm]">
                        RP (2025)
                      </td>
                      <td colSpan={2} className="border border-black text-center text-[8pt] py-[0.7mm]">
                        RP (até 2024)
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-black text-center text-[7pt] py-[0.6mm]">Empenhado</td>
                      <td className="border border-black text-center text-[7pt] py-[0.6mm]">Liquidado</td>
                      <td className="border border-black text-center text-[7pt] py-[0.6mm]">Inscrito</td>
                      <td className="border border-black text-center text-[7pt] py-[0.6mm]">Liquidado</td>
                      <td className="border border-black text-center text-[7pt] py-[0.6mm]">Inscrito</td>
                      <td className="border border-black text-center text-[7pt] py-[0.6mm]">Liquidado</td>
                    </tr>
                    {activeDoc.execucaoFinanceiraRows.map((fr, idx) => (
                      <tr key={`fin-${idx}`}>
                        <td
                          colSpan={5}
                          className="border border-black text-center text-[8pt] h-[4.8mm] px-[1mm]"
                        >
                          {fr.contaContabil || '\u00a0'}
                        </td>
                        <td className="border border-black text-center text-[8pt] h-[4.8mm]">
                          {fr.empenhado2026 || '\u00a0'}
                        </td>
                        <td className="border border-black text-center text-[8pt] h-[4.8mm]">
                          {fr.liquidado2026 || '\u00a0'}
                        </td>
                        <td className="border border-black text-center text-[8pt] h-[4.8mm]">
                          {fr.rp2025Inscrito || '\u00a0'}
                        </td>
                        <td className="border border-black text-center text-[8pt] h-[4.8mm]">
                          {fr.rp2025Liquidado || '\u00a0'}
                        </td>
                        <td className="border border-black text-center text-[8pt] h-[4.8mm]">
                          {fr.rp2024Inscrito || '\u00a0'}
                        </td>
                        <td className="border border-black text-center text-[8pt] h-[4.8mm]">
                          {fr.rp2024Liquidado || '\u00a0'}
                        </td>
                      </tr>
                    ))}

                    {/* 5. Diversos */}
                    <tr>
                      <td
                        rowSpan={2}
                        className="border border-black bg-[#D9D9D9] text-center text-[9.5pt] align-middle"
                      >
                        5.
                      </td>
                      <td
                        colSpan={11}
                        className="border border-black text-center font-bold text-[9.5pt] py-[0.8mm]"
                      >
                        Diversos
                      </td>
                    </tr>
                    <tr>
                      <td
                        colSpan={11}
                        className="border border-black text-left align-top px-[3mm] py-[2.2mm] min-h-[12mm]"
                      >
                        {activeDoc.diversosEventos.length === 0 ? (
                          <p className="text-[9.3pt] text-center text-black/60 italic">
                            (Aguardando eventos da Seção de Comunicação Social)
                          </p>
                        ) : (
                          <div className="space-y-[2mm]">
                            {activeDoc.diversosEventos.map((ev) => (
                              <p
                                key={ev.id}
                                className="text-[9.3pt] leading-[1.32] text-black m-0"
                              >
                                {formatRelatorioEventText(ev)}
                              </p>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </PinchZoomSheetFrame>
        </div>
      </div>
    </WorkspaceSplitLayout>
  );
};
