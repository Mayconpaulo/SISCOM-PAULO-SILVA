import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Copy,
  Download,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Plus,
  Printer,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  computeLandscapeSheetMetrics,
  createDefaultRelacaoDocument,
  generateCsvBlob,
  generateLandscapePdfBlob,
  generateLandscapeWordBlob,
  getResolvedCellText,
  importCsvAsDocument,
  importExtractedTableAsDocument,
  LANDSCAPE_A4_H_MM,
  LANDSCAPE_A4_W_MM,
  type StoredTableDocument,
  type TableColumnDef,
} from './documentoExport';
import { AnimatePresence, motion } from 'motion/react';
import { extractCrachaDocumentData } from './documentoFileParser';
import { getSecureVaultItem, setSecureVaultItem } from '../../core/privacy/privacyVault';
import { fadeSlideVariants, UI_TRANSITION } from '../../shared/motion';
import { WorkspaceSplitLayout } from '../../shared/WorkspaceSplitLayout';
import { SiscomAlert, SiscomSpinner } from '../../shared/ui';
import { logActivity } from '../../core/audit/activityLogger';

const STORAGE_KEY = 'siscom_documentos_vault_v1';

function sanitizeStoredDocument(raw: unknown): StoredTableDocument | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<StoredTableDocument>;
  if (typeof obj.id !== 'string' || !Array.isArray(obj.columns) || obj.columns.length === 0) {
    return null;
  }
  const columns: TableColumnDef[] = obj.columns
    .filter((c): c is TableColumnDef => Boolean(c && typeof c.id === 'string'))
    .map((c, idx) => ({
      id: c.id || `col-${idx}`,
      label: typeof c.label === 'string' ? c.label : `Coluna ${idx + 1}`,
      widthWeight:
        typeof c.widthWeight === 'number' && Number.isFinite(c.widthWeight)
          ? Math.max(2, Math.min(60, c.widthWeight))
          : 10,
      autoNumber: Boolean(c.autoNumber),
      defaultCellText: typeof c.defaultCellText === 'string' ? c.defaultCellText : '',
      align: c.align === 'center' || c.align === 'right' || c.align === 'left' ? c.align : 'left',
    }));

  if (columns.length === 0) return null;

  const cellValues: Record<string, string> = {};
  if (obj.cellValues && typeof obj.cellValues === 'object') {
    Object.entries(obj.cellValues).forEach(([k, v]) => {
      if (typeof v === 'string') cellValues[k] = v;
    });
  }

  return {
    id: obj.id,
    folderName: typeof obj.folderName === 'string' ? obj.folderName : 'Documentos Gerais',
    title: typeof obj.title === 'string' ? obj.title : 'DOCUMENTO A4',
    subtitle: typeof obj.subtitle === 'string' ? obj.subtitle : '',
    orientation: 'landscape',
    rowCount:
      typeof obj.rowCount === 'number' && Number.isFinite(obj.rowCount)
        ? Math.max(1, Math.min(100, Math.floor(obj.rowCount)))
        : 15,
    fontFamily:
      obj.fontFamily === 'Times New Roman' || obj.fontFamily === 'Open Sans' || obj.fontFamily === 'Arial'
        ? obj.fontFamily
        : 'Arial',
    headerBold: typeof obj.headerBold === 'boolean' ? obj.headerBold : true,
    columns,
    cellValues,
    dateText: typeof obj.dateText === 'string' ? obj.dateText : '',
    signatureText: typeof obj.signatureText === 'string' ? obj.signatureText : '',
    signatureLines:
      typeof obj.signatureLines === 'number' && Number.isFinite(obj.signatureLines)
        ? Math.max(1, Math.min(4, Math.floor(obj.signatureLines)))
        : 1,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : new Date().toISOString(),
    isBuiltIn: Boolean(obj.isBuiltIn),
  };
}

function loadVaultDocuments(): StoredTableDocument[] {
  const builtIn = createDefaultRelacaoDocument();
  try {
    const raw = getSecureVaultItem(STORAGE_KEY);
    if (!raw) return [builtIn];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [builtIn];
    const valid = parsed
      .map(sanitizeStoredDocument)
      .filter((d): d is StoredTableDocument => d !== null);
    if (valid.length === 0) return [builtIn];
    if (!valid.some((d) => d.id === builtIn.id)) {
      return [builtIn, ...valid];
    }
    return valid;
  } catch {
    return [builtIn];
  }
}

export interface DocumentosVaultProps {
  externalDownloadSignal?: number;
}

export const DocumentosVault: React.FC<DocumentosVaultProps> = ({ externalDownloadSignal }) => {
  const [documents, setDocuments] = useState<StoredTableDocument[]>(() => loadVaultDocuments());
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(85);
  const [exporting, setExporting] = useState<'pdf' | 'word' | 'csv' | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeDoc = useMemo(
    () => documents.find((d) => d.id === selectedDocId) || null,
    [documents, selectedDocId]
  );

  const [rowCountDraft, setRowCountDraft] = useState<string>('15');

  useEffect(() => {
    if (activeDoc) {
      setRowCountDraft(String(activeDoc.rowCount));
    }
  }, [activeDoc?.id, activeDoc?.rowCount]);

  useEffect(() => {
    try {
      setSecureVaultItem(STORAGE_KEY, JSON.stringify(documents));
    } catch {
      // Ignore quota errors gracefully
    }
  }, [documents]);

  useEffect(() => {
    const handlePurged = () => {
      setDocuments([createDefaultRelacaoDocument()]);
      setSelectedDocId(null);
      setNotice(null);
    };
    window.addEventListener('siscom:vault-purged', handlePurged);
    return () => window.removeEventListener('siscom:vault-purged', handlePurged);
  }, []);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as { siscomDocId?: unknown } | null;
      const nextDocId = typeof state?.siscomDocId === 'string' ? state.siscomDocId : null;
      setSelectedDocId(nextDocId);
      setNotice(null);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const openDocument = (docId: string, nextNotice: string | null = null) => {
    const nextUrl = `${window.location.pathname}${window.location.search}#documentos/${encodeURIComponent(docId)}`;
    window.history.pushState(
      { siscomScreen: 'documentos', siscomDocId: docId, siscomDepth: 2 },
      '',
      nextUrl
    );
    setSelectedDocId(docId);
    setNotice(nextNotice);
  };

  const closeDocumentToFolder = () => {
    setNotice(null);
    const state = window.history.state as { siscomDocId?: unknown } | null;
    if (typeof state?.siscomDocId === 'string') {
      window.history.back();
      return;
    }
    setSelectedDocId(null);
  };

  const updateActiveDoc = (updater: (doc: StoredTableDocument) => StoredTableDocument) => {
    if (!selectedDocId) return;
    setDocuments((prev) =>
      prev.map((d) =>
        d.id === selectedDocId ? { ...updater(d), updatedAt: new Date().toISOString() } : d
      )
    );
  };

  const handleDownloadPdf = async () => {
    if (!activeDoc) return;
    setExporting('pdf');
    setNotice(null);
    try {
      const blob = await generateLandscapePdfBlob(activeDoc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const slug = activeDoc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'documento';
      a.download = `${slug}-a4-horizontal.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice('PDF gerado.');
      void logActivity({
        module: 'documentos',
        action: 'export_pdf',
        summary: `Exportou PDF do documento: ${activeDoc.title}`,
      });
    } catch {
      setNotice('Erro ao gerar PDF.');
    } finally {
      setExporting(null);
    }
  };

  useEffect(() => {
    if (externalDownloadSignal && externalDownloadSignal > 0 && activeDoc) {
      void handleDownloadPdf();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalDownloadSignal]);

  const handleDownloadWord = () => {
    if (!activeDoc) return;
    setExporting('word');
    setNotice(null);
    try {
      const blob = generateLandscapeWordBlob(activeDoc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const slug = activeDoc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'documento';
      a.download = `${slug}.doc`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice('Word (.doc) exportado.');
      void logActivity({
        module: 'documentos',
        action: 'export_word',
        summary: `Exportou Word do documento: ${activeDoc.title}`,
      });
    } catch {
      setNotice('Erro ao gerar .doc.');
    } finally {
      setExporting(null);
    }
  };

  const handleDownloadCsv = () => {
    if (!activeDoc) return;
    setExporting('csv');
    try {
      const blob = generateCsvBlob(activeDoc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const slug = activeDoc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'documento';
      a.download = `${slug}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice('CSV exportado.');
      void logActivity({
        module: 'documentos',
        action: 'export_csv',
        summary: `Exportou CSV do documento: ${activeDoc.title}`,
      });
    } finally {
      setExporting(null);
    }
  };

  const handleCreateNewDoc = () => {
    const newDoc: StoredTableDocument = {
      id: `doc-${Date.now()}`,
      folderName: 'Personalizados',
      title: 'NOVO DOCUMENTO',
      subtitle: '',
      orientation: 'landscape',
      rowCount: 20,
      fontFamily: 'Arial',
      headerBold: true,
      columns: [
        { id: 'nr', label: 'Nr', widthWeight: 6, autoNumber: true, defaultCellText: '', align: 'center' },
        { id: 'col-1', label: 'NOME / DESCRIÇÃO', widthWeight: 32, defaultCellText: '', align: 'left' },
        { id: 'col-2', label: 'OBSERVAÇÃO', widthWeight: 32, defaultCellText: '', align: 'left' },
        { id: 'col-3', label: 'ASSINATURA', widthWeight: 30, defaultCellText: '', align: 'center' },
      ],
      cellValues: {},
      dateText: 'Data ______/________/________',
      signatureText: 'Responsável:',
      signatureLines: 1,
      updatedAt: new Date().toISOString(),
      isBuiltIn: false,
    };
    setDocuments((prev) => [newDoc, ...prev]);
    openDocument(newDoc.id, 'Documento criado.');
  };

  const handleDuplicateDoc = (doc: StoredTableDocument) => {
    const copy: StoredTableDocument = {
      ...doc,
      id: `doc-${Date.now()}`,
      title: `${doc.title} (Cópia)`,
      isBuiltIn: false,
      updatedAt: new Date().toISOString(),
      columns: doc.columns.map((c) => ({ ...c })),
      cellValues: { ...doc.cellValues },
    };
    setDocuments((prev) => [copy, ...prev]);
    openDocument(copy.id, 'Cópia criada.');
  };

  const handleDeleteDoc = (docId: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== docId));
    if (selectedDocId === docId) closeDocumentToFolder();
  };

  const handleImportFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    setIsImporting(true);
    setNotice(null);
    const importedDocs: StoredTableDocument[] = [];
    const failedNames: string[] = [];

    try {
      for (const file of files) {
        const lower = file.name.toLowerCase();
        const isDelimitedText =
          lower.endsWith('.csv') ||
          file.type.toLowerCase() === 'text/csv';

        try {
          if (isDelimitedText) {
            const text = await file.text();
            const csvDoc = importCsvAsDocument(file.name, text);
            if (Object.keys(csvDoc.cellValues).length > 0) {
              importedDocs.push(csvDoc);
            } else {
              const extracted = await extractCrachaDocumentData(file);
              importedDocs.push(importExtractedTableAsDocument(file.name, extracted));
            }
          } else {
            const extracted = await extractCrachaDocumentData(file);
            importedDocs.push(importExtractedTableAsDocument(file.name, extracted));
          }
        } catch (err) {
          const reason = err instanceof Error ? err.message : 'erro de leitura';
          failedNames.push(`${file.name} (${reason})`);
        }
      }

      if (importedDocs.length > 0) {
        setDocuments((prev) => [...importedDocs, ...prev]);
        if (importedDocs.length === 1 && failedNames.length === 0) {
          openDocument(importedDocs[0].id, `"${files[0].name}" importado.`);
        } else {
          const msg = `${importedDocs.length} arquivo(s) importado(s).${
            failedNames.length > 0 ? ` Falhou: ${failedNames.join('; ')}` : ''
          }`;
          setNotice(msg);
        }
      } else if (failedNames.length > 0) {
        setNotice(`Não foi possível importar: ${failedNames.join('; ')}`);
      }
    } finally {
      setIsImporting(false);
    }
  };

  // ==================== FOLDER VIEW ====================
  if (!activeDoc) {
    return (
      <div className="flex-1 min-h-0 w-full lg:overflow-y-auto lg:overscroll-contain">
      <motion.main
        key="docs-folder"
        variants={fadeSlideVariants}
        initial="initial"
        animate="animate"
        transition={UI_TRANSITION}
        className="max-w-6xl w-full mx-auto p-4 sm:p-6 space-y-6"
      >
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!isDraggingFile) setIsDraggingFile(true);
          }}
          onDragLeave={() => setIsDraggingFile(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingFile(false);
            const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
            if (files.length > 0) void handleImportFiles(files);
          }}
          className={`metal-surface rounded-xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 transition-colors duration-200 ${
            isDraggingFile ? 'border-[#C8A461]/70 bg-[#1B2A22]/70' : ''
          }`}
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-[#2D5A43]/22 border border-[#83B499]/25 flex items-center justify-center text-[#83B499] shrink-0">
              <FolderOpen className="w-5 h-5" />
            </div>
            <h2 className="font-display text-base sm:text-lg font-semibold text-[#E8EEEA]">
              Arquivos
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files) : [];
                e.target.value = '';
                if (files.length > 0) void handleImportFiles(files);
              }}
              className="hidden"
            />
            <button
              type="button"
              disabled={isImporting}
              onClick={() => fileInputRef.current?.click()}
              title="Subir documento"
              className="siscom-btn siscom-btn-gold min-h-[40px] px-3.5 text-xs"
            >
              {isImporting ? (
                <SiscomSpinner tone="gold" className="w-3.5 h-3.5" />
              ) : (
                <Upload className="w-3.5 h-3.5 text-[#E5C17B]" />
              )}
              <span>{isImporting ? 'Importando...' : 'Subir documento'}</span>
            </button>
            <button
              type="button"
              onClick={handleCreateNewDoc}
              className="siscom-btn siscom-btn-primary min-h-[40px] px-4 text-xs"
            >
              <FilePlus2 className="w-3.5 h-3.5" />
              <span>Novo</span>
            </button>
          </div>
        </div>

        <AnimatePresence>
          {notice && (
            <SiscomAlert
              tone={
                notice.toLowerCase().includes('erro') || notice.toLowerCase().includes('não foi possível')
                  ? 'error'
                  : 'success'
              }
              onDismiss={() => setNotice(null)}
            >
              {notice}
            </SiscomAlert>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="metal-surface rounded-xl p-5 flex flex-col justify-between gap-4 hover:border-[#4A8A68]/50 transition-colors duration-200"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="w-9 h-9 rounded-lg siscom-liquid-subcard flex items-center justify-center text-[#83B499] shrink-0">
                    <FileSpreadsheet className="w-4 h-4" />
                  </div>
                  <span className="font-mono text-[11px] text-[#83B499]">
                    {doc.rowCount} linhas
                  </span>
                </div>

                <h3 className="font-display text-sm sm:text-base font-semibold text-[#E8EEEA] leading-snug">
                  {doc.title}
                </h3>
              </div>

              <div className="pt-3 border-t border-white/[0.07] flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => openDocument(doc.id)}
                  className="siscom-btn siscom-btn-primary flex-1 min-h-[40px] px-3 text-xs"
                >
                  <span>Abrir</span>
                </button>

                <button
                  type="button"
                  title="Duplicar documento"
                  aria-label={`Duplicar ${doc.title}`}
                  onClick={() => handleDuplicateDoc(doc)}
                  className="siscom-btn siscom-btn-secondary min-h-[40px] min-w-[40px] px-0"
                >
                  <Copy className="w-4 h-4" />
                </button>

                {!doc.isBuiltIn && (
                  <button
                    type="button"
                    title="Excluir documento"
                    aria-label={`Excluir ${doc.title}`}
                    onClick={() => handleDeleteDoc(doc.id)}
                    className="siscom-btn siscom-btn-danger min-h-[40px] min-w-[40px] px-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </motion.main>
      </div>
    );
  }

  // ==================== DOCUMENT EDITOR VIEW ====================
  const metrics = computeLandscapeSheetMetrics(activeDoc);
  const totalWeight =
    activeDoc.columns.reduce((acc, c) => acc + Math.max(1, c.widthWeight), 0) || 1;
  const rowsCount = Math.max(1, Math.min(100, Math.floor(Number(activeDoc.rowCount) || 15)));

  const handleUpdateColumn = (colId: string, patch: Partial<TableColumnDef>) => {
    updateActiveDoc((doc) => ({
      ...doc,
      columns: doc.columns.map((c) => (c.id === colId ? { ...c, ...patch } : c)),
    }));
  };

  const handleAddColumn = () => {
    updateActiveDoc((doc) => ({
      ...doc,
      columns: [
        ...doc.columns,
        {
          id: `col-${Date.now()}`,
          label: 'NOVA COLUNA',
          widthWeight: 10,
          defaultCellText: '',
          align: 'center',
        },
      ],
    }));
  };

  const handleRemoveColumn = (colId: string) => {
    if (activeDoc.columns.length <= 1) return;
    updateActiveDoc((doc) => ({
      ...doc,
      columns: doc.columns.filter((c) => c.id !== colId),
    }));
  };

  const handleRestoreBuiltIn = () => {
    if (!activeDoc.isBuiltIn) return;
    const restored = createDefaultRelacaoDocument();
    updateActiveDoc(() => restored);
    setNotice('Padrão restaurado.');
  };

  return (
    <>
      {/* Ensure browser print dialog opens in A4 Landscape while this view is active */}
      <style>{`@media print { @page { size: A4 landscape; margin: 0; } }`}</style>

      <WorkspaceSplitLayout
        sidebarWidthClass="lg:w-[300px] xl:w-[325px]"
        rightSidebarWidthClass="lg:w-[268px] xl:w-[292px]"
        sidebar={
          <div className="metal-surface lg:bg-transparent lg:border-0 lg:shadow-none rounded-xl lg:rounded-none p-4 sm:p-5 lg:p-1 space-y-5">
        <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] pb-3.5">
          <button
            type="button"
            onClick={closeDocumentToFolder}
            className="siscom-btn siscom-btn-secondary min-h-[38px] px-3 text-xs"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-[#83B499]" />
            <span>Pasta</span>
          </button>

          {activeDoc.isBuiltIn && (
            <button
              type="button"
              onClick={handleRestoreBuiltIn}
              className="siscom-btn siscom-btn-secondary min-h-[38px] px-3 text-[11px]"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#83B499]" />
              <span>Padrão</span>
            </button>
          )}
        </div>

        {/* 1. Linhas */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="doc-row-count" className="siscom-field-label">
              Linhas
            </label>
            <span className="font-mono text-[11px] text-[#83B499]">
              {metrics.rowHMm.toFixed(1)} mm/linha
            </span>
          </div>

          <input
            id="doc-row-count"
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={rowCountDraft}
            onChange={(e) => {
              const raw = e.target.value;
              setRowCountDraft(raw);
              if (raw.trim() === '') return;
              const parsed = Math.floor(Number(raw));
              if (Number.isFinite(parsed) && parsed >= 1) {
                const clamped = Math.max(1, Math.min(100, parsed));
                updateActiveDoc((d) => ({ ...d, rowCount: clamped }));
              }
            }}
            onBlur={() => {
              const parsed = Math.floor(Number(rowCountDraft));
              const clamped = Number.isFinite(parsed)
                ? Math.max(1, Math.min(100, parsed))
                : activeDoc.rowCount;
              updateActiveDoc((d) => ({ ...d, rowCount: clamped }));
              setRowCountDraft(String(clamped));
            }}
            placeholder="1 a 100"
            className="siscom-input w-full min-h-[40px] px-3 font-mono text-sm"
          />

          <AnimatePresence>
            {metrics.isCompressed && (
              <SiscomAlert tone="warning" className="text-[11px]">
                {metrics.resizeNotice}
              </SiscomAlert>
            )}
          </AnimatePresence>
        </div>

        {/* 2. Colunas */}
        <div className="space-y-2.5 pt-4 border-t border-white/[0.07]">
          <div className="flex items-center justify-between gap-2">
            <span className="siscom-field-label">
              Colunas ({activeDoc.columns.length})
            </span>
            <button
              type="button"
              onClick={handleAddColumn}
              className="min-h-[32px] px-2 -mr-2 rounded-md inline-flex items-center gap-1 text-[11px] text-[#83B499] hover:text-[#A8D8BE] hover:bg-white/[0.04] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Coluna</span>
            </button>
          </div>

          <div className="space-y-2">
            {activeDoc.columns.map((col, idx) => (
              <div
                key={col.id}
                className="siscom-liquid-subcard rounded-lg p-3 space-y-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-[#83B499] w-5 shrink-0">
                    {idx + 1}.
                  </span>
                  <input
                    type="text"
                    aria-label={`Nome da coluna ${idx + 1}`}
                    value={col.label}
                    onChange={(e) => handleUpdateColumn(col.id, { label: e.target.value })}
                    className="siscom-input flex-1 min-h-[36px] px-2.5 text-xs"
                  />
                  {activeDoc.columns.length > 1 && (
                    <button
                      type="button"
                      title="Remover coluna"
                      aria-label={`Remover coluna ${col.label}`}
                      onClick={() => handleRemoveColumn(col.id)}
                      className="siscom-btn siscom-btn-danger min-h-[36px] min-w-[36px] px-0 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <label className="flex flex-col gap-1 text-[#98A89F]">
                    <span>Largura</span>
                    <input
                      type="number"
                      min={2}
                      max={60}
                      value={col.widthWeight}
                      onChange={(e) =>
                        handleUpdateColumn(col.id, {
                          widthWeight: Math.max(2, Math.min(60, Number(e.target.value) || 10)),
                        })
                      }
                      className="siscom-input min-h-[34px] px-2 font-mono text-xs"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-[#98A89F]">
                    <span>Alinhamento</span>
                    <select
                      value={col.align || 'left'}
                      onChange={(e) =>
                        handleUpdateColumn(col.id, {
                          align: e.target.value as 'left' | 'center' | 'right',
                        })
                      }
                      className="siscom-input min-h-[34px] px-1.5 text-xs"
                    >
                      <option value="left">Esquerda</option>
                      <option value="center">Centro</option>
                      <option value="right">Direita</option>
                    </select>
                  </label>

                  <label className="flex items-center gap-1.5 text-[#98A89F] pt-4 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={Boolean(col.autoNumber)}
                      onChange={(e) =>
                        handleUpdateColumn(col.id, { autoNumber: e.target.checked })
                      }
                      className="h-4 w-4 accent-[#2D5A43] rounded"
                    />
                    <span>Auto 1..N</span>
                  </label>
                </div>

                {!col.autoNumber && (
                  <input
                    type="text"
                    aria-label={`Texto padrão da coluna ${col.label}`}
                    value={col.defaultCellText}
                    onChange={(e) =>
                      handleUpdateColumn(col.id, { defaultCellText: e.target.value })
                    }
                    placeholder="Texto padrão"
                    className="siscom-input w-full min-h-[34px] px-2.5 text-[11px]"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 4. Exportações */}
        <div className="pt-4 border-t border-white/[0.07] grid grid-cols-2 gap-2.5">
          <button
            type="button"
            disabled={exporting !== null}
            onClick={handleDownloadPdf}
            className="siscom-btn siscom-btn-primary min-h-[42px] px-3 text-xs"
          >
            {exporting === 'pdf' ? (
              <SiscomSpinner tone="light" className="w-3.5 h-3.5" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>{exporting === 'pdf' ? 'Gerando...' : 'PDF'}</span>
          </button>

          <button
            type="button"
            disabled={exporting !== null}
            onClick={handleDownloadWord}
            className="siscom-btn siscom-btn-secondary min-h-[42px] px-3 text-xs"
          >
            {exporting === 'word' ? (
              <SiscomSpinner tone="olive" className="w-3.5 h-3.5" />
            ) : (
              <FileText className="w-3.5 h-3.5 text-[#83B499]" />
            )}
            <span>Word (.doc)</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="siscom-btn siscom-btn-secondary min-h-[42px] px-3 text-xs"
          >
            <Printer className="w-3.5 h-3.5 text-[#83B499]" />
            <span>Imprimir</span>
          </button>

          <button
            type="button"
            disabled={exporting !== null}
            onClick={handleDownloadCsv}
            className="siscom-btn siscom-btn-secondary min-h-[42px] px-3 text-xs"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-[#83B499]" />
            <span>CSV</span>
          </button>
        </div>

        <AnimatePresence>
          {notice && (
            <SiscomAlert
              tone={notice.toLowerCase().includes('erro') ? 'error' : 'success'}
              onDismiss={() => setNotice(null)}
            >
              {notice}
            </SiscomAlert>
          )}
        </AnimatePresence>
          </div>
        }
        rightSidebar={
          <div className="metal-surface lg:bg-transparent lg:border-0 lg:shadow-none rounded-xl lg:rounded-none p-4 sm:p-5 lg:p-1 space-y-4">
            {/* Tipografia & Página */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="siscom-field-label">Texto e Fonte</span>
                <span className="font-mono text-[10px] text-[#E5C17B]">
                  A4 {LANDSCAPE_A4_W_MM}×{LANDSCAPE_A4_H_MM}mm
                </span>
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] text-[#B8B3A6]">Fonte da folha</label>
                <select
                  aria-label="Fonte do documento"
                  value={activeDoc.fontFamily}
                  onChange={(e) =>
                    updateActiveDoc((d) => ({
                      ...d,
                      fontFamily: e.target.value as StoredTableDocument['fontFamily'],
                    }))
                  }
                  className="siscom-input !min-h-[38px] !px-2.5 text-xs"
                >
                  <option value="Arial">Arial</option>
                  <option value="Times New Roman">Times New Roman</option>
                  <option value="Open Sans">Open Sans</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => updateActiveDoc((d) => ({ ...d, headerBold: !d.headerBold }))}
                  className={`siscom-btn !min-h-[38px] !px-2.5 text-xs ${
                    activeDoc.headerBold
                      ? 'siscom-btn-primary'
                      : 'siscom-btn-secondary text-[#B8B3A6]'
                  }`}
                >
                  Negrito
                </button>

                <select
                  aria-label="Zoom da folha A4"
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="siscom-input !min-h-[38px] !px-2 font-mono text-xs"
                >
                  <option value={65}>Zoom 65%</option>
                  <option value={85}>Zoom 85%</option>
                  <option value={100}>Zoom 100%</option>
                </select>
              </div>

              {Object.keys(activeDoc.cellValues).length > 0 && (
                <button
                  type="button"
                  onClick={() => updateActiveDoc((d) => ({ ...d, cellValues: {} }))}
                  className="siscom-btn siscom-btn-secondary w-full !min-h-[36px] text-xs text-[#B8B3A6]"
                >
                  Limpar células preenchidas
                </button>
              )}
            </div>

            {/* Textos da Folha */}
            <div className="space-y-2.5 pt-3.5 border-t border-white/[0.08]">
              <span className="siscom-field-label block">Textos da Página</span>

              <div className="space-y-1">
                <label htmlFor="doc-title" className="block text-[11px] text-[#B8B3A6]">
                  Título
                </label>
                <input
                  id="doc-title"
                  type="text"
                  value={activeDoc.title}
                  onChange={(e) => updateActiveDoc((d) => ({ ...d, title: e.target.value }))}
                  className="siscom-input w-full !min-h-[38px] px-2.5 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="doc-subtitle" className="block text-[11px] text-[#B8B3A6]">
                  Subtítulo
                </label>
                <input
                  id="doc-subtitle"
                  type="text"
                  value={activeDoc.subtitle}
                  onChange={(e) => updateActiveDoc((d) => ({ ...d, subtitle: e.target.value }))}
                  placeholder="Opcional"
                  className="siscom-input w-full !min-h-[38px] px-2.5 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="doc-date" className="block text-[11px] text-[#B8B3A6]">
                  Data
                </label>
                <input
                  id="doc-date"
                  type="text"
                  value={activeDoc.dateText}
                  onChange={(e) => updateActiveDoc((d) => ({ ...d, dateText: e.target.value }))}
                  className="siscom-input w-full !min-h-[38px] px-2.5 text-xs"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1">
                  <label htmlFor="doc-sig" className="block text-[11px] text-[#B8B3A6]">
                    Assinatura
                  </label>
                  <input
                    id="doc-sig"
                    type="text"
                    value={activeDoc.signatureText}
                    onChange={(e) => updateActiveDoc((d) => ({ ...d, signatureText: e.target.value }))}
                    className="siscom-input w-full !min-h-[38px] px-2.5 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="doc-sig-lines" className="block text-[11px] text-[#B8B3A6]">
                    Linhas
                  </label>
                  <input
                    id="doc-sig-lines"
                    type="number"
                    min={1}
                    max={4}
                    value={activeDoc.signatureLines}
                    onChange={(e) =>
                      updateActiveDoc((d) => ({
                        ...d,
                        signatureLines: Math.max(1, Math.min(4, Number(e.target.value) || 1)),
                      }))
                    }
                    className="siscom-input w-full !min-h-[38px] px-2 font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          </div>
        }
      >
        {/* Live A4 Landscape Sheet (297mm x 210mm) */}
        <div className="w-full overflow-x-auto pb-4 flex justify-center print-wrapper">
          <div
            style={{
              width: `${LANDSCAPE_A4_W_MM}mm`,
              height: `${LANDSCAPE_A4_H_MM}mm`,
              padding: `${metrics.padYMm}mm ${metrics.padXMm}mm`,
              transform: zoom !== 100 ? `scale(${zoom / 100})` : undefined,
              transformOrigin: 'top center',
              fontFamily: `"${activeDoc.fontFamily}", Arial, sans-serif`,
            }}
            className="print-a4-landscape bg-white text-black shadow-2xl border border-white/15 box-border flex flex-col justify-between shrink-0"
          >
            {/* Title */}
            <div
              style={{ minHeight: `${metrics.titleHMm}mm` }}
              className="text-center flex flex-col justify-center shrink-0"
            >
              <div
                style={{ fontSize: `${metrics.titleFontPt}pt`, lineHeight: 1.15 }}
                className="font-bold tracking-tight text-black"
              >
                {activeDoc.title}
              </div>
              {activeDoc.subtitle.trim() && (
                <div
                  style={{ fontSize: `${metrics.subtitleFontPt}pt`, lineHeight: 1.15 }}
                  className="text-black"
                >
                  {activeDoc.subtitle}
                </div>
              )}
            </div>

            {/* Table Grid (Strictly sized to fit all N rows cleanly) */}
            <table className="w-full border-collapse table-fixed border border-black shrink-0">
              <thead>
                <tr style={{ height: `${metrics.tableHeaderHMm}mm` }} className="bg-[#F3F4F6]">
                  {activeDoc.columns.map((col) => {
                    const pct = `${((Math.max(1, col.widthWeight) / totalWeight) * 100).toFixed(2)}%`;
                    return (
                      <th
                        key={col.id}
                        style={{
                          width: pct,
                          fontSize: `${metrics.headerFontPt}pt`,
                          fontWeight: activeDoc.headerBold ? 700 : 400,
                        }}
                        className="border border-black px-1 text-center align-middle leading-none overflow-hidden whitespace-nowrap"
                      >
                        {col.label}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rowsCount }, (_, rowIdx) => (
                  <tr key={rowIdx} style={{ height: `${metrics.rowHMm}mm` }}>
                    {activeDoc.columns.map((col) => {
                      const val = getResolvedCellText(activeDoc, rowIdx, col);
                      const cellKey = `${rowIdx}:${col.id}`;
                      const alignClass =
                        col.align === 'center'
                          ? 'text-center'
                          : col.align === 'right'
                          ? 'text-right'
                          : 'text-left';

                      return (
                        <td
                          key={col.id}
                          style={{
                            height: `${metrics.rowHMm}mm`,
                            fontSize: `${metrics.cellFontPt}pt`,
                          }}
                          className="border border-black p-0 align-middle overflow-hidden"
                        >
                          <input
                            type="text"
                            aria-label={`Linha ${rowIdx + 1}, coluna ${col.label}`}
                            value={val.includes('|') ? val.split('|').map((s) => s.trim()).join('   ') : val}
                            onChange={(e) =>
                              updateActiveDoc((d) => ({
                                ...d,
                                cellValues: {
                                  ...d.cellValues,
                                  [cellKey]: e.target.value,
                                },
                              }))
                            }
                            style={{
                              fontSize: `${metrics.cellFontPt}pt`,
                              lineHeight: 1,
                            }}
                            className={`w-full h-full bg-transparent px-1 text-black outline-none focus:bg-[#ECFDF5] ${alignClass}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Footer (Date + Signature) */}
            <div
              style={{
                minHeight: `${metrics.footerHMm}mm`,
                fontSize: `${metrics.footerFontPt}pt`,
              }}
              className="flex flex-col justify-end pt-1 shrink-0 text-black"
            >
              {activeDoc.dateText.trim() && (
                <div className="text-center leading-tight">{activeDoc.dateText}</div>
              )}

              <div
                style={{
                  marginTop: activeDoc.dateText.trim() ? `${metrics.dateToSigGapMm}mm` : '1.5mm',
                  gap: '2.2mm',
                }}
                className="flex flex-col"
              >
                {Array.from(
                  { length: Math.max(1, Math.min(4, Number(activeDoc.signatureLines) || 1)) },
                  (_, sIdx) => (
                    <div key={sIdx} className="flex items-end gap-2 leading-tight">
                      {activeDoc.signatureText.trim() && (
                        <span className="shrink-0">{activeDoc.signatureText}</span>
                      )}
                      <span className="flex-1 border-b border-black mb-[1px]" />
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </WorkspaceSplitLayout>
    </>
  );
};
