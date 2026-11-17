import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  FilePlus2,
  FileText,
  Highlighter,
  Indent,
  Italic,
  List,
  ListOrdered,
  Outdent,
  Printer,
  Redo2,
  Replace,
  RotateCcw,
  Search,
  Strikethrough,
  Trash2,
  Underline,
  Undo2,
} from 'lucide-react';

export interface AlteracaoHeaderData {
  ministerio: string;
  forca: string;
  comandoDivisao: string;
  grandeUnidade: string;
  omCodom: string;
  omExtenso: string;
  tituloDocumento: string;
  guarnicao: string;
  folhaInicial: number;
  nomeCompleto: string;
  nomeGuerra: string;
  postoGraduacao: string;
  qasQms: string;
  identidade: string;
  semestre: string;
  periodo: string;
}

const DEFAULT_HEADER: AlteracaoHeaderData = {
  ministerio: 'MINISTÉRIO DA DEFESA',
  forca: 'EXÉRCITO BRASILEIRO',
  comandoDivisao: 'CML     -     1ª DE',
  grandeUnidade: 'GUEs     -     9ª Bda Inf Mtz',
  omCodom: '1º BI Mec (Es)  -  008326',
  omExtenso: '1º BATALHÃO DE INFANTARIA MECANIZADO (ESCOLA)',
  tituloDocumento: 'FOLHAS DE ALTERAÇÕES',
  guarnicao: 'GUARNIÇÃO DA VILA MILITAR - RJ',
  folhaInicial: 1,
  nomeCompleto: 'ANDRE EMMANUEL RIBEIRO PINTO',
  nomeGuerra: 'EMMANUEL',
  postoGraduacao: '3º Sgt',
  qasQms: 'INTENDÊNCIA',
  identidade: '090593357-8',
  semestre: '1º Semestre de 2023',
  periodo: '01/01/2023 a 30/06/2023',
};

const DEFAULT_PAGE_1_HTML = `<p>1ª PARTE</p>
<p><br></p>
<p>FEVEREIRO:</p>
<p><br></p>
<p><strong>ALTERAÇÕES DE SUBTENENTES E SARGENTOS - Apresentação de Praça</strong></p>
<p><br></p>
<p>- a 14, BI Nº 31 :</p>
<p>O militar nominado a seguir, apresentou-se pronto para o serviço, no dia 13 FEV 23, por ter sido transferido para esta OM, conforme publicado no Aditamento da DCEM 3C ao Boletim do DGP Nº125, de 4 NOV 22.</p>
<p><br></p>
<p><strong>INSTRUÇÃO - Capacitação à VBTP Guarani aos recém egressos</strong></p>
<p><br></p>
<p>- a 23, BI Nº 36 :</p>
<p>O militar nominado a seguir, realizou a Capacitação da VBTP 6x6 Guarani no período de 13 a 16 FEV 23.</p>
<p><br></p>
<p>MARÇO:</p>
<p><br></p>
<p><strong>INSTRUÇÃO - Instrução de Quadros</strong></p>
<p><br></p>
<p>- a 14, BI Nº 49 :</p>
<p>O militar nominado a seguir participou da instrução de quadros versando sobre Garantia da Lei e da Ordem (GLO) / Conduta com Presos, destinada aos integrantes desta OM, no dia 2 MAR 23.</p>`;

const STORAGE_KEY = 'siscom_alteracao_state_v1';

interface StoredAlteracaoState {
  header: AlteracaoHeaderData;
  pagesHtml: string[];
  fontFamily: string;
  fontSizePt: string;
  lineHeight: string;
}

function loadInitialAlteracaoState(): StoredAlteracaoState {
  const fallback: StoredAlteracaoState = {
    header: { ...DEFAULT_HEADER },
    pagesHtml: [DEFAULT_PAGE_1_HTML],
    fontFamily: 'Times New Roman',
    fontSizePt: '10.5pt',
    lineHeight: '1.22',
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredAlteracaoState>;
    const h = (parsed.header || {}) as Partial<AlteracaoHeaderData>;
    const header: AlteracaoHeaderData = {
      ministerio: typeof h.ministerio === 'string' ? h.ministerio : DEFAULT_HEADER.ministerio,
      forca: typeof h.forca === 'string' ? h.forca : DEFAULT_HEADER.forca,
      comandoDivisao:
        typeof h.comandoDivisao === 'string' ? h.comandoDivisao : DEFAULT_HEADER.comandoDivisao,
      grandeUnidade:
        typeof h.grandeUnidade === 'string' ? h.grandeUnidade : DEFAULT_HEADER.grandeUnidade,
      omCodom: typeof h.omCodom === 'string' ? h.omCodom : DEFAULT_HEADER.omCodom,
      omExtenso: typeof h.omExtenso === 'string' ? h.omExtenso : DEFAULT_HEADER.omExtenso,
      tituloDocumento:
        typeof h.tituloDocumento === 'string' ? h.tituloDocumento : DEFAULT_HEADER.tituloDocumento,
      guarnicao: typeof h.guarnicao === 'string' ? h.guarnicao : DEFAULT_HEADER.guarnicao,
      folhaInicial:
        typeof h.folhaInicial === 'number' && Number.isFinite(h.folhaInicial)
          ? Math.max(1, Math.floor(h.folhaInicial))
          : DEFAULT_HEADER.folhaInicial,
      nomeCompleto:
        typeof h.nomeCompleto === 'string' ? h.nomeCompleto : DEFAULT_HEADER.nomeCompleto,
      nomeGuerra: typeof h.nomeGuerra === 'string' ? h.nomeGuerra : DEFAULT_HEADER.nomeGuerra,
      postoGraduacao:
        typeof h.postoGraduacao === 'string' ? h.postoGraduacao : DEFAULT_HEADER.postoGraduacao,
      qasQms: typeof h.qasQms === 'string' ? h.qasQms : DEFAULT_HEADER.qasQms,
      identidade: typeof h.identidade === 'string' ? h.identidade : DEFAULT_HEADER.identidade,
      semestre: typeof h.semestre === 'string' ? h.semestre : DEFAULT_HEADER.semestre,
      periodo: typeof h.periodo === 'string' ? h.periodo : DEFAULT_HEADER.periodo,
    };

    const pagesHtml =
      Array.isArray(parsed.pagesHtml) &&
      parsed.pagesHtml.length > 0 &&
      parsed.pagesHtml.every((p) => typeof p === 'string')
        ? parsed.pagesHtml
        : [DEFAULT_PAGE_1_HTML];

    return {
      header,
      pagesHtml,
      fontFamily: typeof parsed.fontFamily === 'string' ? parsed.fontFamily : fallback.fontFamily,
      fontSizePt: typeof parsed.fontSizePt === 'string' ? parsed.fontSizePt : fallback.fontSizePt,
      lineHeight: typeof parsed.lineHeight === 'string' ? parsed.lineHeight : fallback.lineHeight,
    };
  } catch {
    return fallback;
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatNameWithBoldGuerraHtml(nomeCompleto: string, nomeGuerra: string): string {
  const full = nomeCompleto || '';
  const guerra = nomeGuerra.trim();
  if (!guerra) return escapeHtml(full);
  const idx = full.toUpperCase().indexOf(guerra.toUpperCase());
  if (idx === -1) return escapeHtml(full);
  const before = escapeHtml(full.slice(0, idx));
  const match = escapeHtml(full.slice(idx, idx + guerra.length));
  const after = escapeHtml(full.slice(idx + guerra.length));
  return `${before}<strong>${match}</strong>${after}`;
}

function renderNameWithBoldGuerra(nomeCompleto: string, nomeGuerra: string): React.ReactNode {
  const guerra = nomeGuerra.trim();
  if (!guerra) return nomeCompleto;
  const idx = nomeCompleto.toUpperCase().indexOf(guerra.toUpperCase());
  if (idx === -1) return nomeCompleto;
  return (
    <>
      {nomeCompleto.slice(0, idx)}
      <strong style={{ fontWeight: 700 }}>{nomeCompleto.slice(idx, idx + guerra.length)}</strong>
      {nomeCompleto.slice(idx + guerra.length)}
    </>
  );
}

interface EditablePageBodyProps {
  initialHtml: string;
  syncVersion: number;
  fontFamily: string;
  fontSizePt: string;
  lineHeight: string;
  editorRef: (el: HTMLDivElement | null) => void;
  onFocus: () => void;
  onChangeHtml: (html: string, overflows: boolean) => void;
}

const EditablePageBody: React.FC<EditablePageBodyProps> = ({
  initialHtml,
  syncVersion,
  fontFamily,
  fontSizePt,
  lineHeight,
  editorRef,
  onFocus,
  onChangeHtml,
}) => {
  const localRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    if (el.innerHTML !== initialHtml) {
      el.innerHTML = initialHtml;
    }
    const overflows = el.scrollHeight > el.clientHeight + 2;
    onChangeHtml(el.innerHTML, overflows);
    // Sync only on explicit external reload/replace version changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncVersion]);

  const handleInput = () => {
    const el = localRef.current;
    if (!el) return;
    const overflows = el.scrollHeight > el.clientHeight + 2;
    onChangeHtml(el.innerHTML, overflows);
  };

  return (
    <div
      ref={(el) => {
        localRef.current = el;
        editorRef(el);
      }}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      onFocus={onFocus}
      onInput={handleInput}
      style={{
        fontFamily: `"${fontFamily}", "Times New Roman", Times, serif`,
        fontSize: fontSizePt,
        lineHeight,
      }}
      className="alteracao-editor flex-1 w-full px-[4mm] py-[3.5mm] text-black outline-none overflow-hidden focus:bg-[#FCFDFC]"
    />
  );
};

export interface AlteracaoGeneratorProps {
  externalPrintSignal?: number;
}

export const AlteracaoGenerator: React.FC<AlteracaoGeneratorProps> = ({ externalPrintSignal }) => {
  const initial = useMemo(() => loadInitialAlteracaoState(), []);
  const [header, setHeader] = useState<AlteracaoHeaderData>(initial.header);
  const [pagesHtml, setPagesHtml] = useState<string[]>(initial.pagesHtml);
  const [syncVersion, setSyncVersion] = useState(0);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [overflowPages, setOverflowPages] = useState<Record<number, boolean>>({});
  const [fontFamily, setFontFamily] = useState(initial.fontFamily);
  const [fontSizePt, setFontSizePt] = useState(initial.fontSizePt);
  const [lineHeight, setLineHeight] = useState(initial.lineHeight);
  const [textColor, setTextColor] = useState('#000000');
  const [highlightColor, setHighlightColor] = useState('#FEF08A');
  const [zoom, setZoom] = useState<number>(100);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const editorRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ header, pagesHtml, fontFamily, fontSizePt, lineHeight })
      );
    } catch {
      // Ignore storage errors cleanly
    }
  }, [header, pagesHtml, fontFamily, fontSizePt, lineHeight]);

  useEffect(() => {
    if (externalPrintSignal && externalPrintSignal > 0) {
      window.print();
    }
  }, [externalPrintSignal]);

  const updateHeaderField = <K extends keyof AlteracaoHeaderData>(
    field: K,
    value: AlteracaoHeaderData[K]
  ) => {
    setHeader((prev) => ({ ...prev, [field]: value }));
  };

  const focusActiveEditor = (): HTMLDivElement | null => {
    const target = editorRefs.current[activePageIndex] || editorRefs.current[0] || null;
    if (target && document.activeElement !== target) {
      target.focus();
    }
    return target;
  };

  const syncPageFromDom = (idx: number) => {
    const el = editorRefs.current[idx];
    if (!el) return;
    const html = el.innerHTML;
    const overflows = el.scrollHeight > el.clientHeight + 2;
    setPagesHtml((prev) => prev.map((p, i) => (i === idx ? html : p)));
    setOverflowPages((prev) => ({ ...prev, [idx]: overflows }));
  };

  const runFormatCommand = (command: string, value?: string) => {
    focusActiveEditor();
    try {
      document.execCommand(command, false, value);
      syncPageFromDom(activePageIndex);
    } catch {
      setNotice('Não foi possível aplicar esta formatação no navegador atual.');
    }
  };

  const applySelectionFontSize = (ptValue: string) => {
    setFontSizePt(ptValue);
    const target = focusActiveEditor();
    if (!target) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    if (!target.contains(range.commonAncestorContainer)) return;

    try {
      const span = document.createElement('span');
      span.style.fontSize = ptValue;
      span.appendChild(range.extractContents());
      range.insertNode(span);
      selection.removeAllRanges();
      const after = document.createRange();
      after.selectNodeContents(span);
      selection.addRange(after);
      syncPageFromDom(activePageIndex);
    } catch {
      // Fall back to base editor fontSizePt already updated above
    }
  };

  const applySelectionFontFamily = (family: string) => {
    setFontFamily(family);
    runFormatCommand('fontName', family);
  };

  const handleAddPage = () => {
    setPagesHtml((prev) => [...prev, '<p><br></p>']);
    const nextIdx = pagesHtml.length;
    setActivePageIndex(nextIdx);
    setSyncVersion((v) => v + 1);
    setNotice(`Folha Nº ${String(header.folhaInicial + nextIdx).padStart(2, '0')} adicionada.`);
  };

  const handleRemovePage = (idx: number) => {
    if (pagesHtml.length <= 1) return;
    setPagesHtml((prev) => prev.filter((_, i) => i !== idx));
    setActivePageIndex((prevIdx) => Math.max(0, Math.min(prevIdx, pagesHtml.length - 2)));
    setSyncVersion((v) => v + 1);
  };

  const handleReplaceAll = () => {
    const q = findQuery.trim();
    if (!q) return;
    let totalMatches = 0;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');

    const nextPages = pagesHtml.map((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const walker = document.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.textContent || '';
        const matches = text.match(regex);
        if (matches) {
          totalMatches += matches.length;
          node.textContent = text.replace(regex, replaceQuery);
        }
      }
      return doc.body.innerHTML;
    });

    if (totalMatches > 0) {
      setPagesHtml(nextPages);
      setSyncVersion((v) => v + 1);
      setNotice(`${totalMatches} ocorrência(s) substituída(s).`);
    } else {
      setNotice('Nenhuma ocorrência encontrada para o termo informado.');
    }
  };

  const handleResetModel = () => {
    setHeader({ ...DEFAULT_HEADER });
    setPagesHtml([DEFAULT_PAGE_1_HTML]);
    setActivePageIndex(0);
    setSyncVersion((v) => v + 1);
    setNotice('Modelo padrão das Folhas de Alterações restaurado.');
  };

  const handleClearBody = () => {
    setPagesHtml(['<p><br></p>']);
    setActivePageIndex(0);
    setSyncVersion((v) => v + 1);
    setNotice('Corpo do texto limpo. Cabeçalho mantido.');
  };

  const handleDownloadWordDoc = () => {
    try {
      const nameHtml = formatNameWithBoldGuerraHtml(header.nomeCompleto, header.nomeGuerra);
      const pageBlocks = pagesHtml
        .map((bodyHtml, idx) => {
          const folhaNum = String(header.folhaInicial + idx).padStart(2, '0');
          const headerTableHtml =
            idx === 0
              ? `
              <table style="width:100%; border-collapse:collapse; font-family:'Times New Roman',serif; font-size:10.5pt;">
                <tr>
                  <td style="width:52%; border-bottom:1px solid #000; border-right:1px solid #000; padding:1px 6px;">${escapeHtml(header.ministerio)}</td>
                  <td style="width:48%; border-bottom:1px solid #000; padding:1px 6px; text-align:center;">${escapeHtml(header.tituloDocumento)}</td>
                </tr>
                <tr>
                  <td style="border-bottom:1px solid #000; border-right:1px solid #000; padding:1px 6px;">${escapeHtml(header.forca)}</td>
                  <td style="border-bottom:1px solid #000; padding:1px 6px; text-align:center;">${escapeHtml(header.guarnicao)}</td>
                </tr>
                <tr>
                  <td style="border-bottom:1px solid #000; border-right:1px solid #000; padding:1px 6px;">${escapeHtml(header.comandoDivisao)}</td>
                  <td style="border-bottom:1px solid #000; padding:1px 6px; text-align:center;">FOLHA Nº ${folhaNum}</td>
                </tr>
                <tr>
                  <td style="border-bottom:1px solid #000; border-right:1px solid #000; padding:1px 6px;">${escapeHtml(header.grandeUnidade)}</td>
                  <td style="border-bottom:1px solid #000; padding:1px 6px;">&nbsp;</td>
                </tr>
                <tr>
                  <td style="border-bottom:1px solid #000; border-right:1px solid #000; padding:1px 6px;">${escapeHtml(header.omCodom)}</td>
                  <td style="border-bottom:1px solid #000; padding:1px 6px;">&nbsp;</td>
                </tr>
                <tr>
                  <td style="border-bottom:1px solid #000; border-right:1px solid #000; padding:1px 6px;">&nbsp;</td>
                  <td style="border-bottom:1px solid #000; padding:1px 6px;">&nbsp;</td>
                </tr>
                <tr>
                  <td colspan="2" style="border-bottom:1px solid #000; padding:4px 6px;">
                    <div>NOME: ${nameHtml}</div>
                    <div>POSTO/GRADUAÇÃO: ${escapeHtml(header.postoGraduacao)}</div>
                    <div>QAS/QMS: ${escapeHtml(header.qasQms)}</div>
                  </td>
                </tr>
                <tr>
                  <td style="border-bottom:1px solid #000; padding:4px 6px; vertical-align:top;">IDENTIDADE: ${escapeHtml(header.identidade)}</td>
                  <td style="border-bottom:1px solid #000; padding:4px 6px; text-align:right;">
                    <div>${escapeHtml(header.semestre)}</div>
                    <div>PERÍODO: ${escapeHtml(header.periodo)}</div>
                  </td>
                </tr>
              </table>`
              : `
              <table style="width:100%; border-collapse:collapse; font-family:'Times New Roman',serif; font-size:10.5pt; border-bottom:1px solid #000;">
                <tr>
                  <td style="width:62%; padding:4px 6px; vertical-align:top;">
                    <div>${escapeHtml(header.omExtenso)}</div>
                    <div>Continuação das Folhas de Alterações</div>
                    <div>do ${escapeHtml(header.postoGraduacao)} ${nameHtml}</div>
                  </td>
                  <td style="width:38%; padding:4px 6px; text-align:right; vertical-align:top;">
                    <div>FOLHA Nº ${folhaNum}</div>
                    <div>&nbsp;</div>
                    <div>${escapeHtml(header.semestre)}</div>
                    <div>PERÍODO: ${escapeHtml(header.periodo)}</div>
                  </td>
                </tr>
              </table>`;

          const pageBreakStyle = idx > 0 ? 'page-break-before:always;' : '';
          return `
            <div style="${pageBreakStyle} border:1px solid #000; padding:0; min-height:252mm;">
              ${headerTableHtml}
              <div style="padding:10px 12px; font-family:'${fontFamily}', 'Times New Roman', serif; font-size:${fontSizePt}; line-height:${lineHeight};">
                ${bodyHtml}
              </div>
            </div>`;
        })
        .join('\n');

      const docHtml = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8" />
  <title>Folhas de Alterações - ${escapeHtml(header.nomeGuerra || header.nomeCompleto)}</title>
  <style>
    @page { size: A4; margin: 15mm 14mm; }
    body { font-family: 'Times New Roman', serif; color: #000; margin: 0; }
    p { margin: 0; }
  </style>
</head>
<body>${pageBlocks}</body>
</html>`;

      const blob = new Blob(['\ufeff', docHtml], { type: 'application/msword;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const slug = (header.nomeGuerra || 'militar').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      a.download = `alteracao-${slug}.doc`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice('Arquivo Word (.doc) exportado com cabeçalho e formatação.');
    } catch {
      setNotice('Não foi possível exportar o .doc. Use Imprimir / Salvar PDF como alternativa.');
    }
  };

  return (
    <main className="flex-1 max-w-[1440px] w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start print-wrapper">
      {/* Left Sidebar: Cabeçalho & Dados do Militar */}
      <section className="no-print lg:col-span-4 metal-surface rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-2 border-b border-white/10 pb-3.5">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#E4EAE6]">
              Folhas de Alterações
            </h2>
            <p className="text-xs text-[#98A89F]">
              Etapa 1: Cabeçalho oficial do modelo + editor estilo Word em folha A4.
            </p>
          </div>
          <button
            type="button"
            onClick={handleResetModel}
            title="Restaurar modelo padrão"
            className="min-h-[34px] inline-flex items-center gap-1 rounded-lg border border-white/12 bg-[#181F1C] hover:bg-[#222B27] px-2.5 text-[11px] text-[#C6D4CC] transition-colors shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#83B499]" />
            <span>Modelo</span>
          </button>
        </div>

        {/* Dados do Militar & Período */}
        <div className="space-y-2.5">
          <span className="block text-xs font-medium text-[#C6D4CC]">
            Identificação do Militar e Período
          </span>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="sm:col-span-2 space-y-1">
              <label htmlFor="alt-nome" className="block text-[11px] text-[#98A89F]">
                Nome completo
              </label>
              <input
                id="alt-nome"
                type="text"
                value={header.nomeCompleto}
                onChange={(e) => updateHeaderField('nomeCompleto', e.target.value)}
                className="w-full min-h-[38px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="alt-guerra" className="block text-[11px] text-[#98A89F]">
                Nome de guerra (negrito)
              </label>
              <input
                id="alt-guerra"
                type="text"
                value={header.nomeGuerra}
                onChange={(e) => updateHeaderField('nomeGuerra', e.target.value)}
                className="w-full min-h-[38px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="alt-posto" className="block text-[11px] text-[#98A89F]">
                Posto / Graduação
              </label>
              <input
                id="alt-posto"
                type="text"
                value={header.postoGraduacao}
                onChange={(e) => updateHeaderField('postoGraduacao', e.target.value)}
                className="w-full min-h-[38px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="alt-qas" className="block text-[11px] text-[#98A89F]">
                QAS / QMS
              </label>
              <input
                id="alt-qas"
                type="text"
                value={header.qasQms}
                onChange={(e) => updateHeaderField('qasQms', e.target.value)}
                className="w-full min-h-[38px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="alt-idt" className="block text-[11px] text-[#98A89F]">
                Identidade
              </label>
              <input
                id="alt-idt"
                type="text"
                value={header.identidade}
                onChange={(e) => updateHeaderField('identidade', e.target.value)}
                className="w-full min-h-[38px] rounded-lg bg-[#0E1211] border border-white/12 px-3 font-mono text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="alt-semestre" className="block text-[11px] text-[#98A89F]">
                Semestre
              </label>
              <input
                id="alt-semestre"
                type="text"
                value={header.semestre}
                onChange={(e) => updateHeaderField('semestre', e.target.value)}
                className="w-full min-h-[38px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="alt-folha" className="block text-[11px] text-[#98A89F]">
                Folha inicial Nº
              </label>
              <input
                id="alt-folha"
                type="number"
                min={1}
                max={999}
                value={header.folhaInicial}
                onChange={(e) =>
                  updateHeaderField('folhaInicial', Math.max(1, Number(e.target.value) || 1))
                }
                className="w-full min-h-[38px] rounded-lg bg-[#0E1211] border border-white/12 px-3 font-mono text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
              />
            </div>

            <div className="sm:col-span-2 space-y-1">
              <label htmlFor="alt-periodo" className="block text-[11px] text-[#98A89F]">
                Período
              </label>
              <input
                id="alt-periodo"
                type="text"
                value={header.periodo}
                onChange={(e) => updateHeaderField('periodo', e.target.value)}
                className="w-full min-h-[38px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
              />
            </div>
          </div>
        </div>

        {/* Cabeçalho da OM */}
        <details className="pt-3 border-t border-white/10 group">
          <summary className="cursor-pointer text-xs font-medium text-[#C6D4CC] hover:text-white select-none">
            Dados do Cabeçalho da OM (clique para editar)
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-2">
            <input
              type="text"
              aria-label="Ministério"
              value={header.ministerio}
              onChange={(e) => updateHeaderField('ministerio', e.target.value)}
              placeholder="MINISTÉRIO DA DEFESA"
              className="w-full min-h-[36px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
            />
            <input
              type="text"
              aria-label="Força"
              value={header.forca}
              onChange={(e) => updateHeaderField('forca', e.target.value)}
              placeholder="EXÉRCITO BRASILEIRO"
              className="w-full min-h-[36px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
            />
            <input
              type="text"
              aria-label="Comando e DE"
              value={header.comandoDivisao}
              onChange={(e) => updateHeaderField('comandoDivisao', e.target.value)}
              placeholder="CML - 1ª DE"
              className="w-full min-h-[36px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
            />
            <input
              type="text"
              aria-label="Grande Unidade"
              value={header.grandeUnidade}
              onChange={(e) => updateHeaderField('grandeUnidade', e.target.value)}
              placeholder="GUEs - 9ª Bda Inf Mtz"
              className="w-full min-h-[36px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
            />
            <input
              type="text"
              aria-label="OM e Codom"
              value={header.omCodom}
              onChange={(e) => updateHeaderField('omCodom', e.target.value)}
              placeholder="1º BI Mec (Es) - 008326"
              className="w-full min-h-[36px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
            />
            <input
              type="text"
              aria-label="OM por extenso (Folhas de continuação)"
              value={header.omExtenso}
              onChange={(e) => updateHeaderField('omExtenso', e.target.value)}
              placeholder="1º BATALHÃO DE INFANTARIA MECANIZADO (ESCOLA)"
              className="w-full min-h-[36px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
            />
            <input
              type="text"
              aria-label="Título do documento"
              value={header.tituloDocumento}
              onChange={(e) => updateHeaderField('tituloDocumento', e.target.value)}
              placeholder="FOLHAS DE ALTERAÇÕES"
              className="w-full min-h-[36px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
            />
            <input
              type="text"
              aria-label="Guarnição"
              value={header.guarnicao}
              onChange={(e) => updateHeaderField('guarnicao', e.target.value)}
              placeholder="GUARNIÇÃO DA VILA MILITAR - RJ"
              className="w-full min-h-[36px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
            />
          </div>
        </details>

        {/* Ações de Documento */}
        <div className="pt-3 border-t border-white/10 space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleAddPage}
              className="min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#181F1C] hover:bg-[#222B27] px-3 text-xs font-medium text-[#E4EAE6] transition-colors"
            >
              <FilePlus2 className="w-3.5 h-3.5 text-[#83B499]" />
              <span>Nova Folha (Nº {String(header.folhaInicial + pagesHtml.length).padStart(2, '0')})</span>
            </button>

            <button
              type="button"
              onClick={handleClearBody}
              className="min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#181F1C] hover:bg-[#222B27] px-3 text-xs font-medium text-[#E4EAE6] transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5 text-[#98A89F]" />
              <span>Limpar texto</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="min-h-[42px] inline-flex items-center justify-center gap-2 rounded-lg bg-[#2D5A43] hover:bg-[#376C51] px-3 text-xs font-medium text-white transition-colors"
            >
              <Printer className="w-4 h-4" />
              <span>Imprimir / Salvar PDF</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadWordDoc}
              className="min-h-[42px] inline-flex items-center justify-center gap-2 rounded-lg border border-white/12 bg-[#181F1C] hover:bg-[#222B27] px-3 text-xs font-medium text-[#E4EAE6] transition-colors"
            >
              <FileText className="w-4 h-4 text-[#83B499]" />
              <span>Baixar Word (.doc)</span>
            </button>
          </div>
        </div>

        {notice && (
          <p className="text-xs text-[#83B499] bg-[#2D5A43]/15 border border-[#83B499]/25 rounded-lg px-3 py-2">
            {notice}
          </p>
        )}
      </section>

      {/* Right Workspace: Word-like Toolbar + Interactive A4 Document */}
      <section className="lg:col-span-8 flex flex-col items-center space-y-4 print-wrapper">
        {/* Word-like Ribbon Toolbar */}
        <div className="no-print w-full metal-surface rounded-xl p-2.5 space-y-2 sticky top-2 z-20">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Undo / Redo */}
            <div className="flex items-center gap-0.5 pr-2 border-r border-white/10">
              <button
                type="button"
                title="Desfazer (Ctrl+Z)"
                onMouseDown={(e) => {
                  e.preventDefault();
                  runFormatCommand('undo');
                }}
                className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-white/10 text-[#C6D4CC]"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                title="Refazer (Ctrl+Y)"
                onMouseDown={(e) => {
                  e.preventDefault();
                  runFormatCommand('redo');
                }}
                className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-white/10 text-[#C6D4CC]"
              >
                <Redo2 className="w-4 h-4" />
              </button>
            </div>

            {/* Font Family & Size */}
            <div className="flex items-center gap-1.5 pr-2 border-r border-white/10">
              <select
                aria-label="Fonte do texto"
                value={fontFamily}
                onChange={(e) => applySelectionFontFamily(e.target.value)}
                className="h-8 rounded bg-[#0E1211] border border-white/12 px-2 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
              >
                <option value="Times New Roman">Times New Roman</option>
                <option value="Georgia">Georgia</option>
                <option value="Arial">Arial</option>
                <option value="Open Sans">Open Sans</option>
              </select>

              <select
                aria-label="Tamanho da fonte"
                value={fontSizePt}
                onChange={(e) => applySelectionFontSize(e.target.value)}
                className="h-8 rounded bg-[#0E1211] border border-white/12 px-2 font-mono text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
              >
                <option value="9pt">9 pt</option>
                <option value="10pt">10 pt</option>
                <option value="10.5pt">10.5 pt</option>
                <option value="11pt">11 pt</option>
                <option value="12pt">12 pt</option>
                <option value="14pt">14 pt</option>
                <option value="16pt">16 pt</option>
              </select>

              <select
                aria-label="Espaçamento entre linhas"
                value={lineHeight}
                onChange={(e) => setLineHeight(e.target.value)}
                title="Espaçamento entre linhas"
                className="h-8 rounded bg-[#0E1211] border border-white/12 px-2 font-mono text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
              >
                <option value="1.05">1.0</option>
                <option value="1.22">1.15</option>
                <option value="1.35">1.3</option>
                <option value="1.5">1.5</option>
              </select>
            </div>

            {/* Bold / Italic / Underline / Strike / Clear */}
            <div className="flex items-center gap-0.5 pr-2 border-r border-white/10">
              <button
                type="button"
                title="Negrito (Ctrl+B)"
                onMouseDown={(e) => {
                  e.preventDefault();
                  runFormatCommand('bold');
                }}
                className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-white/10 text-[#E4EAE6]"
              >
                <Bold className="w-4 h-4" />
              </button>
              <button
                type="button"
                title="Itálico (Ctrl+I)"
                onMouseDown={(e) => {
                  e.preventDefault();
                  runFormatCommand('italic');
                }}
                className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-white/10 text-[#E4EAE6]"
              >
                <Italic className="w-4 h-4" />
              </button>
              <button
                type="button"
                title="Sublinhado (Ctrl+U)"
                onMouseDown={(e) => {
                  e.preventDefault();
                  runFormatCommand('underline');
                }}
                className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-white/10 text-[#E4EAE6]"
              >
                <Underline className="w-4 h-4" />
              </button>
              <button
                type="button"
                title="Tachado"
                onMouseDown={(e) => {
                  e.preventDefault();
                  runFormatCommand('strikeThrough');
                }}
                className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-white/10 text-[#E4EAE6]"
              >
                <Strikethrough className="w-4 h-4" />
              </button>
              <button
                type="button"
                title="Limpar formatação da seleção"
                onMouseDown={(e) => {
                  e.preventDefault();
                  runFormatCommand('removeFormat');
                }}
                className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-white/10 text-[#98A89F]"
              >
                <Eraser className="w-4 h-4" />
              </button>
            </div>

            {/* Colors */}
            <div className="flex items-center gap-1 pr-2 border-r border-white/10">
              <label
                title="Cor do texto"
                className="h-8 px-1.5 inline-flex items-center gap-1 rounded hover:bg-white/10 cursor-pointer"
              >
                <span className="text-xs font-bold text-[#E4EAE6] border-b-2" style={{ borderColor: textColor }}>
                  A
                </span>
                <input
                  type="color"
                  aria-label="Cor do texto"
                  value={textColor}
                  onChange={(e) => {
                    setTextColor(e.target.value);
                    runFormatCommand('foreColor', e.target.value);
                  }}
                  className="w-4 h-4 bg-transparent border-0 cursor-pointer p-0"
                />
              </label>

              <label
                title="Realce / Marca-texto"
                className="h-8 px-1.5 inline-flex items-center gap-1 rounded hover:bg-white/10 cursor-pointer"
              >
                <Highlighter className="w-3.5 h-3.5 text-[#E4EAE6]" />
                <input
                  type="color"
                  aria-label="Cor de realce"
                  value={highlightColor}
                  onChange={(e) => {
                    setHighlightColor(e.target.value);
                    runFormatCommand('hiliteColor', e.target.value);
                  }}
                  className="w-4 h-4 bg-transparent border-0 cursor-pointer p-0"
                />
              </label>
            </div>

            {/* Alignment */}
            <div className="flex items-center gap-0.5 pr-2 border-r border-white/10">
              <button
                type="button"
                title="Alinhar à esquerda"
                onMouseDown={(e) => {
                  e.preventDefault();
                  runFormatCommand('justifyLeft');
                }}
                className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-white/10 text-[#C6D4CC]"
              >
                <AlignLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                title="Centralizar"
                onMouseDown={(e) => {
                  e.preventDefault();
                  runFormatCommand('justifyCenter');
                }}
                className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-white/10 text-[#C6D4CC]"
              >
                <AlignCenter className="w-4 h-4" />
              </button>
              <button
                type="button"
                title="Alinhar à direita"
                onMouseDown={(e) => {
                  e.preventDefault();
                  runFormatCommand('justifyRight');
                }}
                className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-white/10 text-[#C6D4CC]"
              >
                <AlignRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                title="Justificar"
                onMouseDown={(e) => {
                  e.preventDefault();
                  runFormatCommand('justifyFull');
                }}
                className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-white/10 text-[#C6D4CC]"
              >
                <AlignJustify className="w-4 h-4" />
              </button>
            </div>

            {/* Lists & Indent */}
            <div className="flex items-center gap-0.5 pr-2 border-r border-white/10">
              <button
                type="button"
                title="Lista com marcadores"
                onMouseDown={(e) => {
                  e.preventDefault();
                  runFormatCommand('insertUnorderedList');
                }}
                className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-white/10 text-[#C6D4CC]"
              >
                <List className="w-4 h-4" />
              </button>
              <button
                type="button"
                title="Lista numerada"
                onMouseDown={(e) => {
                  e.preventDefault();
                  runFormatCommand('insertOrderedList');
                }}
                className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-white/10 text-[#C6D4CC]"
              >
                <ListOrdered className="w-4 h-4" />
              </button>
              <button
                type="button"
                title="Diminuir recuo"
                onMouseDown={(e) => {
                  e.preventDefault();
                  runFormatCommand('outdent');
                }}
                className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-white/10 text-[#C6D4CC]"
              >
                <Outdent className="w-4 h-4" />
              </button>
              <button
                type="button"
                title="Aumentar recuo"
                onMouseDown={(e) => {
                  e.preventDefault();
                  runFormatCommand('indent');
                }}
                className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-white/10 text-[#C6D4CC]"
              >
                <Indent className="w-4 h-4" />
              </button>
            </div>

            {/* Find & Replace + Zoom */}
            <div className="flex items-center gap-1.5 ml-auto">
              <button
                type="button"
                onClick={() => setShowFindReplace((v) => !v)}
                className={`h-8 px-2.5 inline-flex items-center gap-1.5 rounded text-xs transition-colors ${
                  showFindReplace
                    ? 'bg-[#2D5A43] text-white'
                    : 'bg-[#0E1211] border border-white/12 text-[#C6D4CC] hover:text-white'
                }`}
              >
                <Search className="w-3.5 h-3.5" />
                <span>Localizar</span>
              </button>

              <select
                aria-label="Zoom da folha"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="h-8 rounded bg-[#0E1211] border border-white/12 px-2 font-mono text-xs text-[#E4EAE6] focus:outline-none"
              >
                <option value={75}>75%</option>
                <option value={90}>90%</option>
                <option value={100}>100%</option>
              </select>
            </div>
          </div>

          {showFindReplace && (
            <div className="pt-2 border-t border-white/10 flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                placeholder="Localizar texto..."
                className="flex-1 min-w-[140px] h-8 rounded bg-[#0E1211] border border-white/12 px-2.5 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
              />
              <input
                type="text"
                value={replaceQuery}
                onChange={(e) => setReplaceQuery(e.target.value)}
                placeholder="Substituir por..."
                className="flex-1 min-w-[140px] h-8 rounded bg-[#0E1211] border border-white/12 px-2.5 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
              />
              <button
                type="button"
                onClick={handleReplaceAll}
                className="h-8 px-3 inline-flex items-center gap-1.5 rounded bg-[#2D5A43] hover:bg-[#376C51] text-xs font-medium text-white transition-colors"
              >
                <Replace className="w-3.5 h-3.5" />
                <span>Substituir tudo</span>
              </button>
            </div>
          )}
        </div>

        {/* Editable A4 Pages Stack */}
        <div className="w-full overflow-x-auto pb-6 flex flex-col items-center gap-6 print-wrapper">
          {pagesHtml.map((pageHtml, pageIndex) => {
            const folhaStr = String(header.folhaInicial + pageIndex).padStart(2, '0');
            const isOverflowing = overflowPages[pageIndex];

            return (
              <div
                key={`alt-page-${pageIndex}`}
                className="print-page-item flex flex-col items-center gap-1.5"
              >
                <div className="no-print w-full flex items-center justify-between gap-2 text-[11px] text-[#98A89F] px-1">
                  <span className="font-mono">
                    Folha Nº {folhaStr} · Clique no documento abaixo para editar como no Word
                  </span>
                  <div className="flex items-center gap-3">
                    {isOverflowing && (
                      <button
                        type="button"
                        onClick={handleAddPage}
                        className="text-[#E5C17B] hover:underline"
                      >
                        Texto excedeu esta folha · + Nova Folha
                      </button>
                    )}
                    {pagesHtml.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemovePage(pageIndex)}
                        className="text-[#98A89F] hover:text-red-300"
                      >
                        Remover folha
                      </button>
                    )}
                  </div>
                </div>

                {/* Actual A4 Page (210mm x 297mm) */}
                <div
                  style={{
                    width: '210mm',
                    height: '297mm',
                    padding: '13mm 14mm',
                    transform: zoom !== 100 ? `scale(${zoom / 100})` : undefined,
                    transformOrigin: 'top center',
                    fontFamily: '"Times New Roman", Times, Georgia, serif',
                  }}
                  className="print-a4-sheet bg-white text-black shadow-2xl border border-white/15 box-border flex flex-col shrink-0"
                >
                  {/* Outer document border frame matching screenshot */}
                  <div className="w-full h-full border border-black flex flex-col overflow-hidden">
                    {pageIndex === 0 ? (
                      /* Folha Nº 01 Full Header */
                      <div className="w-full text-[10.5pt] leading-[1.2] select-none shrink-0">
                        <table className="w-full border-collapse table-fixed text-black">
                          <tbody>
                            <tr>
                              <td className="w-[52%] border-b border-r border-black px-[3mm] py-[0.4mm]">
                                {header.ministerio}
                              </td>
                              <td className="w-[48%] border-b border-black px-[3mm] py-[0.4mm] text-center">
                                {header.tituloDocumento}
                              </td>
                            </tr>
                            <tr>
                              <td className="border-b border-r border-black px-[3mm] py-[0.4mm]">
                                {header.forca}
                              </td>
                              <td className="border-b border-black px-[3mm] py-[0.4mm] text-center">
                                {header.guarnicao}
                              </td>
                            </tr>
                            <tr>
                              <td className="border-b border-r border-black px-[3mm] py-[0.4mm] whitespace-pre-wrap">
                                {header.comandoDivisao}
                              </td>
                              <td className="border-b border-black px-[3mm] py-[0.4mm] text-center">
                                FOLHA Nº {folhaStr}
                              </td>
                            </tr>
                            <tr>
                              <td className="border-b border-r border-black px-[3mm] py-[0.4mm] whitespace-pre-wrap">
                                {header.grandeUnidade}
                              </td>
                              <td className="border-b border-black px-[3mm] py-[0.4mm]">&nbsp;</td>
                            </tr>
                            <tr>
                              <td className="border-b border-r border-black px-[3mm] py-[0.4mm] whitespace-pre-wrap">
                                {header.omCodom}
                              </td>
                              <td className="border-b border-black px-[3mm] py-[0.4mm]">&nbsp;</td>
                            </tr>
                            <tr>
                              <td className="border-b border-r border-black px-[3mm] py-[0.4mm]">
                                &nbsp;
                              </td>
                              <td className="border-b border-black px-[3mm] py-[0.4mm]">&nbsp;</td>
                            </tr>
                          </tbody>
                        </table>

                        <div className="border-b border-black px-[3mm] py-[1.2mm] space-y-[0.4mm]">
                          <div>
                            NOME: {renderNameWithBoldGuerra(header.nomeCompleto, header.nomeGuerra)}
                          </div>
                          <div>POSTO/GRADUAÇÃO: {header.postoGraduacao}</div>
                          <div>QAS/QMS: {header.qasQms}</div>
                        </div>

                        <div className="border-b border-black px-[3mm] py-[1mm] flex items-start justify-between gap-4">
                          <div>IDENTIDADE: {header.identidade}</div>
                          <div className="text-right">
                            <div>{header.semestre}</div>
                            <div>PERÍODO: {header.periodo}</div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* Folha Nº 02+ Continuation Header */
                      <div className="w-full border-b border-black px-[3mm] py-[1.5mm] text-[10.5pt] leading-[1.2] flex items-start justify-between gap-4 select-none shrink-0">
                        <div>
                          <div>{header.omExtenso}</div>
                          <div>Continuação das Folhas de Alterações</div>
                          <div>
                            do {header.postoGraduacao}{' '}
                            {renderNameWithBoldGuerra(header.nomeCompleto, header.nomeGuerra)}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div>FOLHA Nº {folhaStr}</div>
                          <div>&nbsp;</div>
                          <div>{header.semestre}</div>
                          <div>PERÍODO: {header.periodo}</div>
                        </div>
                      </div>
                    )}

                    {/* Editable Rich-Text Word-like Body */}
                    <EditablePageBody
                      initialHtml={pageHtml}
                      syncVersion={syncVersion}
                      fontFamily={fontFamily}
                      fontSizePt={fontSizePt}
                      lineHeight={lineHeight}
                      editorRef={(el) => {
                        editorRefs.current[pageIndex] = el;
                      }}
                      onFocus={() => setActivePageIndex(pageIndex)}
                      onChangeHtml={(html, overflows) => {
                        setPagesHtml((prev) => {
                          if (prev[pageIndex] === html) return prev;
                          const next = [...prev];
                          next[pageIndex] = html;
                          return next;
                        });
                        setOverflowPages((prev) =>
                          prev[pageIndex] === overflows ? prev : { ...prev, [pageIndex]: overflows }
                        );
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
};
