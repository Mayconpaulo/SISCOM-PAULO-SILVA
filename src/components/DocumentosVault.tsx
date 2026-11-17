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
  LANDSCAPE_A4_H_MM,
  LANDSCAPE_A4_W_MM,
  type StoredTableDocument,
  type TableColumnDef,
} from '../lib/documentoExport';

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
    const raw = localStorage.getItem(STORAGE_KEY);
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
  const [notice, setNotice] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeDoc = useMemo(
    () => documents.find((d) => d.id === selectedDocId) || null,
    [documents, selectedDocId]
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(documents));
    } catch {
      // Ignore quota errors gracefully
    }
  }, [documents]);

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
      setNotice('PDF A4 horizontal (1 página) gerado com sucesso.');
    } catch {
      setNotice('Não foi possível gerar o PDF. Utilize Imprimir A4 como alternativa imediata.');
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
      setNotice('Arquivo Word (.doc) em A4 horizontal exportado.');
    } catch {
      setNotice('Não foi possível gerar o .doc. Use Baixar PDF ou Imprimir A4.');
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
      setNotice('Planilha .csv exportada.');
    } finally {
      setExporting(null);
    }
  };

  const handleCreateNewDoc = () => {
    const newDoc: StoredTableDocument = {
      id: `doc-${Date.now()}`,
      folderName: 'Documentos Personalizados',
      title: 'NOVO CONTROLE / RELAÇÃO',
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
    setSelectedDocId(newDoc.id);
    setNotice('Novo documento A4 horizontal criado na pasta.');
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
    setSelectedDocId(copy.id);
    setNotice('Cópia criada na pasta de documentos.');
  };

  const handleDeleteDoc = (docId: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== docId));
    if (selectedDocId === docId) setSelectedDocId(null);
  };

  const handleImportCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const imported = importCsvAsDocument(file.name, text);
        setDocuments((prev) => [imported, ...prev]);
        setSelectedDocId(imported.id);
        setNotice(`Arquivo "${file.name}" importado e salvo na pasta.`);
      } catch {
        setNotice('Não foi possível ler o arquivo CSV.');
      }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  // ==================== FOLDER VIEW ====================
  if (!activeDoc) {
    return (
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 space-y-6">
        <div className="metal-surface rounded-xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-lg bg-[#2D5A43]/25 border border-[#83B499]/30 flex items-center justify-center text-[#83B499] shrink-0">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-lg sm:text-xl font-semibold text-[#E4EAE6]">
                Pasta de Documentos
              </h2>
              <p className="text-xs sm:text-sm text-[#98A89F]">
                Armazenamento local com modelos prontos, editáveis como planilha/Word em folha A4 horizontal.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleImportCsvFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[40px] inline-flex items-center gap-2 rounded-lg border border-white/12 bg-[#181F1C] hover:bg-[#222B27] px-3.5 text-xs font-medium text-[#E4EAE6] transition-colors"
            >
              <Upload className="w-4 h-4 text-[#83B499]" />
              <span>Importar CSV</span>
            </button>
            <button
              type="button"
              onClick={handleCreateNewDoc}
              className="min-h-[40px] inline-flex items-center gap-2 rounded-lg bg-[#2D5A43] hover:bg-[#376C51] px-3.5 text-xs font-medium text-white transition-colors"
            >
              <FilePlus2 className="w-4 h-4" />
              <span>Novo Documento</span>
            </button>
          </div>
        </div>

        {notice && (
          <p className="text-xs text-[#83B499] bg-[#2D5A43]/15 border border-[#83B499]/25 rounded-lg px-3.5 py-2.5">
            {notice}
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="metal-surface rounded-xl p-5 flex flex-col justify-between gap-4 hover:border-[#3C7557] transition-colors"
            >
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="w-10 h-10 rounded-lg bg-[#0E1211] border border-white/10 flex items-center justify-center text-[#83B499] shrink-0">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <span className="font-mono text-[11px] text-[#83B499]">
                    A4 Horizontal · {doc.rowCount} linhas
                  </span>
                </div>

                <div className="space-y-1">
                  <span className="block text-[11px] text-[#98A89F]">{doc.folderName}</span>
                  <h3 className="font-display text-sm sm:text-base font-semibold text-[#E4EAE6] leading-snug">
                    {doc.title}
                  </h3>
                  <p className="text-xs text-[#98A89F]">
                    {doc.columns.length} colunas ({doc.columns.map((c) => c.label).slice(0, 4).join(', ')}
                    {doc.columns.length > 4 ? '...' : ''})
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDocId(doc.id);
                    setNotice(null);
                  }}
                  className="flex-1 min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2D5A43] hover:bg-[#376C51] px-3 text-xs font-medium text-white transition-colors"
                >
                  <span>Abrir / Editar</span>
                </button>

                <button
                  type="button"
                  title="Duplicar documento"
                  onClick={() => handleDuplicateDoc(doc)}
                  className="min-h-[38px] min-w-[38px] inline-flex items-center justify-center rounded-lg border border-white/12 bg-[#181F1C] hover:bg-[#222B27] text-[#C6D4CC] transition-colors"
                >
                  <Copy className="w-4 h-4" />
                </button>

                {!doc.isBuiltIn && (
                  <button
                    type="button"
                    title="Excluir documento"
                    onClick={() => handleDeleteDoc(doc.id)}
                    className="min-h-[38px] min-w-[38px] inline-flex items-center justify-center rounded-lg border border-white/12 bg-[#181F1C] hover:bg-[#2B1B1B] text-[#98A89F] hover:text-red-300 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </main>
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
    setNotice('Modelo original da Relação de Entrada e Saída restaurado.');
  };

  return (
    <main className="flex-1 max-w-[1440px] w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start print-wrapper">
      {/* Ensure browser print dialog opens in A4 Landscape while this view is active */}
      <style>{`@media print { @page { size: A4 landscape; margin: 0; } }`}</style>

      {/* Left Control Panel */}
      <section className="no-print lg:col-span-4 metal-surface rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3.5">
          <button
            type="button"
            onClick={() => {
              setSelectedDocId(null);
              setNotice(null);
            }}
            className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-[#181F1C] hover:bg-[#222B27] px-3 text-xs font-medium text-[#E4EAE6] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-[#83B499]" />
            <span>Voltar à Pasta</span>
          </button>

          {activeDoc.isBuiltIn && (
            <button
              type="button"
              onClick={handleRestoreBuiltIn}
              className="min-h-[36px] inline-flex items-center gap-1 rounded-lg border border-white/12 bg-[#181F1C] hover:bg-[#222B27] px-2.5 text-[11px] text-[#C6D4CC] transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#83B499]" />
              <span>Restaurar</span>
            </button>
          )}
        </div>

        {/* 1. Quantidade de Linhas + Auto-resize Alert */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="doc-row-count" className="text-xs font-medium text-[#C6D4CC]">
              Quantidade de linhas (Folha A4 Horizontal)
            </label>
            <span className="font-mono text-[11px] text-[#83B499]">
              {metrics.rowHMm.toFixed(1)} mm/linha
            </span>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="doc-row-count"
              type="number"
              min={1}
              max={100}
              value={activeDoc.rowCount}
              onChange={(e) =>
                updateActiveDoc((d) => ({
                  ...d,
                  rowCount: Math.max(1, Math.min(100, Number(e.target.value) || 1)),
                }))
              }
              className="w-24 min-h-[40px] rounded-lg bg-[#0E1211] border border-white/12 px-3 font-mono text-sm text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
            />
            <div className="flex-1 grid grid-cols-4 gap-1">
              {[15, 25, 35, 50].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => updateActiveDoc((d) => ({ ...d, rowCount: preset }))}
                  className={`min-h-[40px] rounded-lg border font-mono text-xs transition-colors ${
                    rowsCount === preset
                      ? 'bg-[#2D5A43] border-[#376C51] text-white'
                      : 'bg-[#0E1211] border-white/10 text-[#98A89F] hover:text-[#E4EAE6]'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <p
            className={`text-[11px] rounded-lg px-3 py-2 border ${
              metrics.isCompressed
                ? 'text-[#E5C17B] bg-[#3B2E17]/40 border-[#E5C17B]/25'
                : 'text-[#83B499] bg-[#2D5A43]/15 border-[#83B499]/25'
            }`}
          >
            {metrics.resizeNotice}
          </p>
        </div>

        {/* 2. Cabeçalho Superior e Rodapé (Data e Assinatura) */}
        <div className="space-y-2.5 pt-3 border-t border-white/10">
          <span className="block text-xs font-medium text-[#C6D4CC]">
            Cabeçalho Superior e Rodapé
          </span>

          <div className="space-y-1">
            <label htmlFor="doc-title" className="block text-[11px] text-[#98A89F]">
              Título em cima
            </label>
            <input
              id="doc-title"
              type="text"
              value={activeDoc.title}
              onChange={(e) => updateActiveDoc((d) => ({ ...d, title: e.target.value }))}
              className="w-full min-h-[38px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="doc-subtitle" className="block text-[11px] text-[#98A89F]">
              Subtítulo superior (opcional)
            </label>
            <input
              id="doc-subtitle"
              type="text"
              value={activeDoc.subtitle}
              onChange={(e) => updateActiveDoc((d) => ({ ...d, subtitle: e.target.value }))}
              placeholder="Ex.: 1º BI Mec (Es) — Seção de Relações Públicas"
              className="w-full min-h-[36px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] placeholder:text-[#697870] focus:outline-none focus:border-[#7FB095]"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="doc-date" className="block text-[11px] text-[#98A89F]">
              Texto da data (embaixo)
            </label>
            <input
              id="doc-date"
              type="text"
              value={activeDoc.dateText}
              onChange={(e) => updateActiveDoc((d) => ({ ...d, dateText: e.target.value }))}
              className="w-full min-h-[36px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-1">
              <label htmlFor="doc-sig" className="block text-[11px] text-[#98A89F]">
                Assinatura / Apoio (embaixo)
              </label>
              <input
                id="doc-sig"
                type="text"
                value={activeDoc.signatureText}
                onChange={(e) => updateActiveDoc((d) => ({ ...d, signatureText: e.target.value }))}
                className="w-full min-h-[36px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="doc-sig-lines" className="block text-[11px] text-[#98A89F]">
                Linhas ass.
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
                className="w-full min-h-[36px] rounded-lg bg-[#0E1211] border border-white/12 px-2.5 font-mono text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
              />
            </div>
          </div>
        </div>

        {/* 3. Colunas Editáveis */}
        <div className="space-y-2.5 pt-3 border-t border-white/10">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[#C6D4CC]">
              Colunas da tabela ({activeDoc.columns.length})
            </span>
            <button
              type="button"
              onClick={handleAddColumn}
              className="inline-flex items-center gap-1 text-[11px] text-[#83B499] hover:text-[#A3D4B9] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Adicionar coluna</span>
            </button>
          </div>

          <div className="space-y-2 max-h-[290px] overflow-y-auto pr-1">
            {activeDoc.columns.map((col, idx) => (
              <div
                key={col.id}
                className="rounded-lg bg-[#0E1211] border border-white/10 p-2.5 space-y-2"
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
                    className="flex-1 min-h-[34px] rounded bg-[#121715] border border-white/12 px-2.5 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
                  />
                  {activeDoc.columns.length > 1 && (
                    <button
                      type="button"
                      title="Remover coluna"
                      onClick={() => handleRemoveColumn(col.id)}
                      className="h-[34px] w-[34px] inline-flex items-center justify-center rounded border border-white/10 text-[#98A89F] hover:text-red-300 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                  <label className="flex flex-col gap-0.5 text-[#98A89F]">
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
                      className="h-7 rounded bg-[#121715] border border-white/12 px-2 font-mono text-[#E4EAE6]"
                    />
                  </label>

                  <label className="flex flex-col gap-0.5 text-[#98A89F]">
                    <span>Alinhamento</span>
                    <select
                      value={col.align || 'left'}
                      onChange={(e) =>
                        handleUpdateColumn(col.id, {
                          align: e.target.value as 'left' | 'center' | 'right',
                        })
                      }
                      className="h-7 rounded bg-[#121715] border border-white/12 px-1.5 text-[#E4EAE6]"
                    >
                      <option value="left">Esquerda</option>
                      <option value="center">Centro</option>
                      <option value="right">Direita</option>
                    </select>
                  </label>

                  <label className="flex items-center gap-1.5 text-[#98A89F] pt-3.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(col.autoNumber)}
                      onChange={(e) =>
                        handleUpdateColumn(col.id, { autoNumber: e.target.checked })
                      }
                      className="h-3.5 w-3.5 accent-[#2D5A43]"
                    />
                    <span>Auto 1..N</span>
                  </label>
                </div>

                {!col.autoNumber && (
                  <input
                    type="text"
                    aria-label={`Texto padrão das linhas da coluna ${col.label}`}
                    value={col.defaultCellText}
                    onChange={(e) =>
                      handleUpdateColumn(col.id, { defaultCellText: e.target.value })
                    }
                    placeholder="Texto padrão em todas as linhas (opcional; use | para dividir)"
                    className="w-full h-7 rounded bg-[#121715] border border-white/12 px-2 text-[11px] text-[#C6D4CC] placeholder:text-[#697870]"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 4. Exportações */}
        <div className="pt-3 border-t border-white/10 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={exporting !== null}
            onClick={handleDownloadPdf}
            className="min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2D5A43] hover:bg-[#376C51] disabled:opacity-50 px-3 text-xs font-medium text-white transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{exporting === 'pdf' ? 'Gerando...' : 'Baixar PDF'}</span>
          </button>

          <button
            type="button"
            disabled={exporting !== null}
            onClick={handleDownloadWord}
            className="min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#181F1C] hover:bg-[#222B27] disabled:opacity-50 px-3 text-xs font-medium text-[#E4EAE6] transition-colors"
          >
            <FileText className="w-3.5 h-3.5 text-[#83B499]" />
            <span>Baixar Word (.doc)</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#181F1C] hover:bg-[#222B27] px-3 text-xs font-medium text-[#E4EAE6] transition-colors"
          >
            <Printer className="w-3.5 h-3.5 text-[#83B499]" />
            <span>Imprimir A4</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadCsv}
            className="min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#181F1C] hover:bg-[#222B27] px-3 text-xs font-medium text-[#E4EAE6] transition-colors"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-[#83B499]" />
            <span>Baixar CSV</span>
          </button>
        </div>

        {notice && (
          <p className="text-xs text-[#83B499] bg-[#2D5A43]/15 border border-[#83B499]/25 rounded-lg px-3 py-2">
            {notice}
          </p>
        )}
      </section>

      {/* Right Workspace: Toolbar + Interactive A4 Landscape Sheet */}
      <section className="lg:col-span-8 flex flex-col items-center space-y-3 print-wrapper">
        {/* Compact Style Toolbar */}
        <div className="no-print w-full metal-surface rounded-xl px-3 py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Fonte do documento"
              value={activeDoc.fontFamily}
              onChange={(e) =>
                updateActiveDoc((d) => ({
                  ...d,
                  fontFamily: e.target.value as StoredTableDocument['fontFamily'],
                }))
              }
              className="h-8 rounded bg-[#0E1211] border border-white/12 px-2 text-xs text-[#E4EAE6]"
            >
              <option value="Arial">Arial</option>
              <option value="Times New Roman">Times New Roman</option>
              <option value="Open Sans">Open Sans</option>
            </select>

            <button
              type="button"
              onClick={() => updateActiveDoc((d) => ({ ...d, headerBold: !d.headerBold }))}
              className={`h-8 px-2.5 rounded border text-xs font-medium transition-colors ${
                activeDoc.headerBold
                  ? 'bg-[#2D5A43] border-[#376C51] text-white'
                  : 'bg-[#0E1211] border-white/12 text-[#98A89F]'
              }`}
            >
              Cabeçalho Negrito
            </button>

            {Object.keys(activeDoc.cellValues).length > 0 && (
              <button
                type="button"
                onClick={() => updateActiveDoc((d) => ({ ...d, cellValues: {} }))}
                className="h-8 px-2.5 rounded border border-white/12 bg-[#0E1211] text-xs text-[#98A89F] hover:text-[#E4EAE6]"
              >
                Limpar células digitadas
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-[#98A89F]">
            <span className="hidden sm:inline">Clique em qualquer célula para editar</span>
            <select
              aria-label="Zoom da folha A4"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="h-8 rounded bg-[#0E1211] border border-white/12 px-2 font-mono text-xs text-[#E4EAE6]"
            >
              <option value={65}>65%</option>
              <option value={85}>85%</option>
              <option value={100}>100%</option>
            </select>
          </div>
        </div>

        {/* Live A4 Landscape Sheet (297mm x 210mm) */}
        <div className="w-full overflow-x-auto pb-6 flex justify-center print-wrapper">
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
      </section>
    </main>
  );
};
