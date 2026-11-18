import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Calculator,
  Eraser,
  FilePlus2,
  FileText,
  Highlighter,
  Indent,
  Italic,
  List,
  ListOrdered,
  Maximize2,
  Minus,
  Outdent,
  Plus,
  Printer,
  Redo2,
  Replace,
  RotateCcw,
  Search,
  Strikethrough,
  Trash2,
  Underline,
  Undo2,
  Upload,
  Wand2,
} from 'lucide-react';
import {
  AlteracaoHeaderExtract,
  ParsedAlteracaoSectionItem,
  StructuredAlteracaoDoc,
  applyServiceTimeToPart2Lines,
  calculateServiceTime,
  deriveSemestreAndPeriodo,
  formatAlteracaoHtmlOrText,
  formatAlteracaoLinesToBlocks,
  formatPtBrDateLong,
  renderBlocksFromStructuredDoc,
} from '../lib/alteracaoFormatter';
import { paginateAlteracaoBlocksInDom, readAlteracaoFile } from '../lib/alteracaoFileReader';
import { inferPortugueseContinuacaoArticle } from '../lib/portugueseGender';

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
  generoCont: 'auto' | 'do' | 'da';
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
  nomeCompleto: '',
  nomeGuerra: '',
  generoCont: 'auto',
  postoGraduacao: '',
  qasQms: '',
  identidade: '',
  semestre: '',
  periodo: '',
};

const DEFAULT_PAGE_1_HTML = '<p><br></p>';

const STORAGE_KEY = 'siscom_alteracao_state_v2';

const MM_TO_PX = 96 / 25.4;
const A4_WIDTH_PX = 210 * MM_TO_PX;
const A4_HEIGHT_PX = 297 * MM_TO_PX;

interface StoredAlteracaoState {
  header: AlteracaoHeaderData;
  pagesHtml: string[];
  fontFamily: string;
  fontSizePt: string;
  lineHeight: string;
  structuredDoc?: StructuredAlteracaoDoc | null;
  enabledItemIds?: string[];
  dataPraca?: string;
  dataFinal?: string;
  migratedTo12pt?: boolean;
}

function getTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function loadInitialAlteracaoState(): StoredAlteracaoState {
  const fallback: StoredAlteracaoState = {
    header: { ...DEFAULT_HEADER },
    pagesHtml: [DEFAULT_PAGE_1_HTML],
    fontFamily: 'Times New Roman',
    fontSizePt: '12pt',
    lineHeight: '1.22',
    structuredDoc: null,
    enabledItemIds: [],
    dataPraca: '',
    dataFinal: getTodayIsoDate(),
    migratedTo12pt: true,
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
      generoCont:
        h.generoCont === 'do' || h.generoCont === 'da' || h.generoCont === 'auto'
          ? h.generoCont
          : 'auto',
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

    const storedDoc =
      parsed.structuredDoc && Array.isArray(parsed.structuredDoc.items)
        ? parsed.structuredDoc
        : null;
    const storedEnabled = Array.isArray(parsed.enabledItemIds)
      ? parsed.enabledItemIds.filter((id): id is string => typeof id === 'string')
      : storedDoc
        ? storedDoc.items.map((i) => i.id)
        : [];

    const rawFontSizePt =
      typeof parsed.fontSizePt === 'string' ? parsed.fontSizePt : fallback.fontSizePt;
    const migratedFontSizePt =
      !parsed.migratedTo12pt && rawFontSizePt === '10.5pt' ? '12pt' : rawFontSizePt;

    return {
      header,
      pagesHtml,
      fontFamily: typeof parsed.fontFamily === 'string' ? parsed.fontFamily : fallback.fontFamily,
      fontSizePt: migratedFontSizePt,
      lineHeight: typeof parsed.lineHeight === 'string' ? parsed.lineHeight : fallback.lineHeight,
      structuredDoc: storedDoc,
      enabledItemIds: storedEnabled,
      dataPraca: typeof parsed.dataPraca === 'string' ? parsed.dataPraca : '',
      dataFinal:
        typeof parsed.dataFinal === 'string' && parsed.dataFinal
          ? parsed.dataFinal
          : fallback.dataFinal,
      migratedTo12pt: true,
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
  const [viewportWidth, setViewportWidth] = useState<number>(0);
  const [pinchZoom, setPinchZoom] = useState<number>(1);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [structuredDoc, setStructuredDoc] = useState<StructuredAlteracaoDoc | null>(
    initial.structuredDoc ?? null
  );
  const [enabledItemIds, setEnabledItemIds] = useState<string[]>(
    initial.enabledItemIds ?? []
  );
  const [dataPraca, setDataPraca] = useState<string>(initial.dataPraca ?? '');
  const [dataFinal, setDataFinal] = useState<string>(initial.dataFinal ?? getTodayIsoDate());
  const [isImporting, setIsImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const editorRefs = useRef<(HTMLDivElement | null)[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const page1HeaderRef = useRef<HTMLDivElement | null>(null);
  const contHeaderRef = useRef<HTMLDivElement | null>(null);
  const highlightResetRef = useRef<(() => void) | null>(null);
  const pagesViewportRef = useRef<HTMLDivElement | null>(null);
  const effectiveScaleRef = useRef<number>(1);
  const pinchZoomRef = useRef<number>(1);
  const totalScaleRef = useRef<number>(1);
  const pinchStateRef = useRef<{
    startDist: number;
    startPinch: number;
    ratioX: number;
    relYUnscaled: number;
  } | null>(null);
  const pendingAnchorRef = useRef<{
    ratioX: number;
    midViewportX: number;
    relYUnscaled: number;
    curMidWinY: number;
  } | null>(null);

  const fitScale =
    viewportWidth > 0 ? Math.min(1, Math.max(0.22, (viewportWidth - 4) / A4_WIDTH_PX)) : 1;
  const baseScale = fitScale * (zoom / 100);
  const totalScale = baseScale * pinchZoom;

  effectiveScaleRef.current = totalScale;
  pinchZoomRef.current = pinchZoom;
  totalScaleRef.current = totalScale;

  useEffect(() => {
    const el = pagesViewportRef.current;
    if (!el) return;

    const updateWidth = () => {
      const w = el.clientWidth;
      if (w > 0) setViewportWidth(w);
    };

    updateWidth();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateWidth);
      ro.observe(el);
      return () => ro.disconnect();
    }

    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  useLayoutEffect(() => {
    const pending = pendingAnchorRef.current;
    const viewport = pagesViewportRef.current;
    if (!pending || !viewport) return;
    pendingAnchorRef.current = null;

    const curTotalScale = totalScaleRef.current;
    const scaledW = A4_WIDTH_PX * curTotalScale;
    const maxScrollX = Math.max(0, scaledW - viewport.clientWidth);
    viewport.scrollLeft =
      maxScrollX > 0
        ? Math.min(maxScrollX, Math.max(0, pending.ratioX * scaledW - pending.midViewportX))
        : 0;

    const rect = viewport.getBoundingClientRect();
    const targetWinY = rect.top + pending.relYUnscaled * curTotalScale;
    const deltaY = targetWinY - pending.curMidWinY;
    if (Math.abs(deltaY) > 1) {
      window.scrollBy(0, deltaY);
    }
  }, [totalScale]);

  useEffect(() => {
    const viewport = pagesViewportRef.current;
    if (!viewport) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const rect = viewport.getBoundingClientRect();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
        if (dist <= 0) return;

        const curScale = totalScaleRef.current || 1;
        const scaledW = A4_WIDTH_PX * curScale;
        const leftOffset = Math.max(0, (viewport.clientWidth - scaledW) / 2);
        const midViewportX = (t0.clientX + t1.clientX) / 2 - rect.left;
        const midWinY = (t0.clientY + t1.clientY) / 2;

        pinchStateRef.current = {
          startDist: dist,
          startPinch: pinchZoomRef.current,
          ratioX: Math.min(
            1,
            Math.max(0, (viewport.scrollLeft + midViewportX - leftOffset) / (scaledW || 1))
          ),
          relYUnscaled: (midWinY - rect.top) / curScale,
        };
      } else {
        pinchStateRef.current = null;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchStateRef.current) {
        e.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const curDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
        const start = pinchStateRef.current;
        if (start.startDist <= 0) return;

        const nextPinch = Math.min(3.5, Math.max(1, start.startPinch * (curDist / start.startDist)));
        const midViewportX = (t0.clientX + t1.clientX) / 2 - rect.left;
        const curMidWinY = (t0.clientY + t1.clientY) / 2;

        pendingAnchorRef.current = {
          ratioX: start.ratioX,
          midViewportX,
          relYUnscaled: start.relYUnscaled,
          curMidWinY,
        };
        setPinchZoom(nextPinch);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        pinchStateRef.current = null;
        if (pinchZoomRef.current < 1.05 && pinchZoomRef.current !== 1) {
          setPinchZoom(1);
        }
      }
    };

    viewport.addEventListener('touchstart', handleTouchStart, { passive: true });
    viewport.addEventListener('touchmove', handleTouchMove, { passive: false });
    viewport.addEventListener('touchend', handleTouchEnd, { passive: true });
    viewport.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      viewport.removeEventListener('touchstart', handleTouchStart);
      viewport.removeEventListener('touchmove', handleTouchMove);
      viewport.removeEventListener('touchend', handleTouchEnd);
      viewport.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  useEffect(() => {
    return () => {
      highlightResetRef.current?.();
    };
  }, []);

  const serviceTime = useMemo(
    () => calculateServiceTime(dataPraca, dataFinal),
    [dataPraca, dataFinal]
  );

  const continuacaoArticle = useMemo(
    () => inferPortugueseContinuacaoArticle(header.nomeCompleto, header.generoCont),
    [header.nomeCompleto, header.generoCont]
  );

  const enabledItemIdSet = useMemo(() => new Set(enabledItemIds), [enabledItemIds]);

  const groupedChecklist = useMemo(() => {
    if (!structuredDoc || structuredDoc.items.length === 0) return [];
    const groups: {
      key: string;
      month: string;
      title: string;
      items: ParsedAlteracaoSectionItem[];
    }[] = [];
    const groupMap = new Map<string, (typeof groups)[number]>();

    for (const item of structuredDoc.items) {
      const key = `${item.month}::${item.title.toUpperCase()}`;
      let g = groupMap.get(key);
      if (!g) {
        g = { key, month: item.month, title: item.title, items: [] };
        groupMap.set(key, g);
        groups.push(g);
      }
      g.items.push(item);
    }
    return groups;
  }, [structuredDoc]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          header,
          pagesHtml,
          fontFamily,
          fontSizePt,
          lineHeight,
          structuredDoc,
          enabledItemIds,
          dataPraca,
          dataFinal,
          migratedTo12pt: true,
        })
      );
    } catch {
      // Ignore storage errors cleanly
    }
  }, [
    header,
    pagesHtml,
    fontFamily,
    fontSizePt,
    lineHeight,
    structuredDoc,
    enabledItemIds,
    dataPraca,
    dataFinal,
  ]);

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
      setNotice(`${totalMatches} substituída(s).`);
    } else {
      setNotice('Nada encontrado.');
    }
  };

  const mergeExtractedHeader = (
    current: AlteracaoHeaderData,
    extracted: AlteracaoHeaderExtract,
    monthOrder: readonly string[] = []
  ): AlteracaoHeaderData => {
    const derived = deriveSemestreAndPeriodo(extracted, monthOrder);
    const next: AlteracaoHeaderData = {
      ...current,
      ...(extracted.ministerio ? { ministerio: extracted.ministerio } : {}),
      ...(extracted.forca ? { forca: extracted.forca } : {}),
      ...(extracted.comandoDivisao ? { comandoDivisao: extracted.comandoDivisao } : {}),
      ...(extracted.grandeUnidade ? { grandeUnidade: extracted.grandeUnidade } : {}),
      ...(extracted.omCodom ? { omCodom: extracted.omCodom } : {}),
      ...(extracted.omExtenso ? { omExtenso: extracted.omExtenso } : {}),
      ...(extracted.tituloDocumento ? { tituloDocumento: extracted.tituloDocumento } : {}),
      ...(extracted.guarnicao ? { guarnicao: extracted.guarnicao } : {}),
      ...(extracted.folhaInicial ? { folhaInicial: extracted.folhaInicial } : {}),
      ...(extracted.nomeCompleto ? { nomeCompleto: extracted.nomeCompleto } : {}),
      ...(extracted.nomeGuerra ? { nomeGuerra: extracted.nomeGuerra } : {}),
      ...(extracted.postoGraduacao ? { postoGraduacao: extracted.postoGraduacao } : {}),
      ...(extracted.qasQms ? { qasQms: extracted.qasQms } : {}),
      ...(extracted.identidade ? { identidade: extracted.identidade } : {}),
      ...(derived.semestre ? { semestre: derived.semestre } : {}),
      ...(derived.periodo ? { periodo: derived.periodo } : {}),
    };
    return next;
  };

  const measureAndPaginateBlocks = (
    blocks: ReturnType<typeof formatAlteracaoHtmlOrText>['blocks']
  ) => {
    const scale = effectiveScaleRef.current || 1;
    const p1El = page1HeaderRef.current;
    const contEl = contHeaderRef.current;
    const page1HeaderHeightPx = p1El
      ? p1El.offsetHeight || p1El.getBoundingClientRect().height / scale
      : undefined;
    const contHeaderHeightPx = contEl
      ? contEl.offsetHeight || contEl.getBoundingClientRect().height / scale
      : undefined;

    return paginateAlteracaoBlocksInDom(blocks, {
      fontFamily,
      fontSizePt,
      lineHeight,
      page1HeaderHeightPx,
      contHeaderHeightPx,
    });
  };

  const applyFormattedResult = (
    formatted: ReturnType<typeof formatAlteracaoHtmlOrText>,
    label: string
  ) => {
    const nextHeader = mergeExtractedHeader(
      header,
      formatted.extractedHeader,
      formatted.structuredDoc.monthOrder
    );
    setHeader(nextHeader);
    setStructuredDoc(formatted.structuredDoc);
    const allIds = formatted.structuredDoc.items.map((item) => item.id);
    setEnabledItemIds(allIds);

    const paginated = measureAndPaginateBlocks(formatted.blocks);
    setPagesHtml(paginated);
    setActivePageIndex(0);
    setSyncVersion((v) => v + 1);
    setNotice(`${label} (${paginated.length} folha${paginated.length > 1 ? 's' : ''}).`);
  };

  const applyChecklistSelection = (nextEnabledIds: string[]) => {
    setEnabledItemIds(nextEnabledIds);
    if (!structuredDoc) return;
    const rendered = renderBlocksFromStructuredDoc(structuredDoc, new Set(nextEnabledIds), {
      semestre: header.semestre,
      periodo: header.periodo,
      fillSemesterMonths: true,
    });
    const paginated = measureAndPaginateBlocks(rendered.blocks);
    setPagesHtml(paginated);
    setActivePageIndex((prev) => Math.min(prev, Math.max(0, paginated.length - 1)));
    setSyncVersion((v) => v + 1);
  };

  const handleToggleChecklistItem = (itemId: string) => {
    const exists = enabledItemIdSet.has(itemId);
    const next = exists
      ? enabledItemIds.filter((id) => id !== itemId)
      : [...enabledItemIds, itemId];
    applyChecklistSelection(next);
  };

  const handleToggleChecklistGroup = (groupItems: ParsedAlteracaoSectionItem[]) => {
    const groupIds = groupItems.map((i) => i.id);
    const allChecked = groupIds.every((id) => enabledItemIdSet.has(id));
    if (allChecked) {
      const groupSet = new Set(groupIds);
      applyChecklistSelection(enabledItemIds.filter((id) => !groupSet.has(id)));
    } else {
      const merged = new Set([...enabledItemIds, ...groupIds]);
      applyChecklistSelection(Array.from(merged));
    }
  };

  const handleScrollToChecklistTarget = (
    target:
      | { kind: 'group'; groupKey: string; month: string; title: string }
      | { kind: 'item'; item: ParsedAlteracaoSectionItem }
  ) => {
    const normalizeText = (value: string) =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();

    let foundPageIdx = -1;
    let foundEl: HTMLElement | null = null;

    if (target.kind === 'group') {
      for (let pageIdx = 0; pageIdx < editorRefs.current.length; pageIdx++) {
        const editorEl = editorRefs.current[pageIdx];
        if (!editorEl) continue;
        const directMatch = Array.from(
          editorEl.querySelectorAll<HTMLElement>('[data-alt-group]')
        ).find((el) => el.dataset.altGroup === target.groupKey);
        if (directMatch) {
          foundPageIdx = pageIdx;
          foundEl = directMatch;
          break;
        }
      }

      if (!foundEl) {
        const wantedTitle = normalizeText(target.title);
        const wantedMonth = normalizeText(target.month);
        let sawTargetMonth = false;
        for (let pageIdx = 0; pageIdx < editorRefs.current.length; pageIdx++) {
          const editorEl = editorRefs.current[pageIdx];
          if (!editorEl) continue;
          const nodes = Array.from(editorEl.querySelectorAll<HTMLElement>('p, div'));
          for (const node of nodes) {
            const txt = normalizeText(node.textContent || '');
            if (!txt) continue;
            if (txt === `${wantedMonth}:` || txt === wantedMonth) {
              sawTargetMonth = true;
              continue;
            }
            if (
              txt === wantedTitle &&
              node.querySelector('strong, b') &&
              (sawTargetMonth || foundEl === null)
            ) {
              foundPageIdx = pageIdx;
              foundEl = node;
              if (sawTargetMonth) break;
            }
          }
          if (foundEl && sawTargetMonth) break;
        }
      }
    } else {
      const { item } = target;
      for (let pageIdx = 0; pageIdx < editorRefs.current.length; pageIdx++) {
        const editorEl = editorRefs.current[pageIdx];
        if (!editorEl) continue;
        const directMatch = Array.from(
          editorEl.querySelectorAll<HTMLElement>('[data-alt-item]')
        ).find((el) => el.dataset.altItem === item.id);
        if (directMatch) {
          foundPageIdx = pageIdx;
          foundEl = directMatch;
          break;
        }
      }

      if (!foundEl) {
        const wantedSub = item.subtitle ? normalizeText(item.subtitle) : '';
        const wantedPara =
          item.paragraphs[0] ? normalizeText(item.paragraphs[0].slice(0, 48)) : '';
        const wantedTableCell =
          item.kind === 'table' && item.tableRows?.[0]
            ? normalizeText(
                item.tableRows.flat().find((c) => c.trim().length > 0) || ''
              )
            : '';

        for (let pageIdx = 0; pageIdx < editorRefs.current.length; pageIdx++) {
          const editorEl = editorRefs.current[pageIdx];
          if (!editorEl) continue;
          if (item.kind === 'table' && wantedTableCell) {
            const tbl = Array.from(editorEl.querySelectorAll<HTMLElement>('table')).find(
              (t) => normalizeText(t.textContent || '').includes(wantedTableCell)
            );
            if (tbl) {
              foundPageIdx = pageIdx;
              foundEl = tbl;
              break;
            }
          } else {
            const nodes = Array.from(editorEl.querySelectorAll<HTMLElement>('p, div'));
            const match = nodes.find((n) => {
              const txt = normalizeText(n.textContent || '');
              if (wantedSub && txt === wantedSub) return true;
              if (wantedPara && txt.startsWith(wantedPara)) return true;
              return false;
            });
            if (match) {
              foundPageIdx = pageIdx;
              foundEl = match;
              break;
            }
          }
        }
      }
    }

    if (!foundEl || foundPageIdx < 0) {
      setNotice(
        target.kind === 'group' ? 'Tópico desmarcado na folha.' : 'Item desmarcado na folha.'
      );
      return;
    }

    setActivePageIndex(foundPageIdx);
    foundEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

    highlightResetRef.current?.();
    const targetNode = foundEl;
    const prevBg = targetNode.style.backgroundColor;
    const prevOutline = targetNode.style.outline;
    const prevOutlineOffset = targetNode.style.outlineOffset;
    const prevRadius = targetNode.style.borderRadius;
    const prevTransition = targetNode.style.transition;

    targetNode.style.transition = 'background-color 220ms ease, outline-color 220ms ease';
    targetNode.style.backgroundColor = 'rgba(229, 193, 123, 0.30)';
    targetNode.style.outline = '2px solid #C29B56';
    targetNode.style.outlineOffset = '2px';
    targetNode.style.borderRadius = '3px';

    let cleared = false;
    const restore = () => {
      if (cleared) return;
      cleared = true;
      window.clearTimeout(timerId);
      targetNode.style.backgroundColor = prevBg;
      targetNode.style.outline = prevOutline;
      targetNode.style.outlineOffset = prevOutlineOffset;
      targetNode.style.borderRadius = prevRadius;
      targetNode.style.transition = prevTransition;
      if (highlightResetRef.current === restore) {
        highlightResetRef.current = null;
      }
    };
    const timerId = window.setTimeout(restore, 1400);
    highlightResetRef.current = restore;
  };

  const applyServiceTimeToDocument = (
    pracaIso: string,
    finalIso: string,
    shouldScrollToPart2: boolean
  ) => {
    const calc = calculateServiceTime(pracaIso, finalIso);
    if (!calc) {
      if (shouldScrollToPart2) {
        setNotice('Informe Data de praça e Data final válidas.');
      }
      return;
    }

    const datePtBr = formatPtBrDateLong(finalIso);

    let baseDoc = structuredDoc;
    let activeIdSet = enabledItemIdSet;
    if (!baseDoc) {
      const currentHtmls = pagesHtml.map((html, idx) => editorRefs.current[idx]?.innerHTML ?? html);
      const formatted = formatAlteracaoHtmlOrText(currentHtmls.join('\n'), {
        semestre: header.semestre,
        periodo: header.periodo,
        fillSemesterMonths: true,
      });
      baseDoc = formatted.structuredDoc;
      const allIds = baseDoc.items.map((i) => i.id);
      setEnabledItemIds(allIds);
      activeIdSet = new Set(allIds);
    }

    const updatedPart2 = applyServiceTimeToPart2Lines(baseDoc.part2Lines, calc.formatted, {
      datePtBr,
      guarnicao: header.guarnicao,
    });
    const nextDoc: StructuredAlteracaoDoc = {
      ...baseDoc,
      part2Lines: updatedPart2,
    };

    const rendered = renderBlocksFromStructuredDoc(nextDoc, activeIdSet, {
      semestre: header.semestre,
      periodo: header.periodo,
      fillSemesterMonths: true,
    });
    const paginated = measureAndPaginateBlocks(rendered.blocks);
    setStructuredDoc(nextDoc);
    setPagesHtml(paginated);
    setSyncVersion((v) => v + 1);
    setNotice(`Tempo aplicado na 2ª Parte: ${calc.formatted}.`);

    if (shouldScrollToPart2) {
      window.requestAnimationFrame(() => {
        for (let pageIdx = 0; pageIdx < editorRefs.current.length; pageIdx++) {
          const el = editorRefs.current[pageIdx]?.querySelector<HTMLElement>('[data-alt-part2]');
          if (el) {
            setActivePageIndex(pageIdx);
            el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
            break;
          }
        }
      });
    }
  };

  const handleDateCalculatorChange = (field: 'praca' | 'final', value: string) => {
    const nextPraca = field === 'praca' ? value : dataPraca;
    const nextFinal = field === 'final' ? value : dataFinal;
    if (field === 'praca') setDataPraca(value);
    else setDataFinal(value);

    if (structuredDoc && structuredDoc.part2Lines.length > 0) {
      const calc = calculateServiceTime(nextPraca, nextFinal);
      if (calc) {
        applyServiceTimeToDocument(nextPraca, nextFinal, false);
      }
    }
  };

  const processAlteracaoFile = async (file: File) => {
    setIsImporting(true);
    setNotice(null);
    try {
      const rawLines = await readAlteracaoFile(file);
      if (rawLines.length === 0) {
        setNotice('Arquivo vazio.');
        return;
      }
      const formatted = formatAlteracaoLinesToBlocks(rawLines, {
        fillSemesterMonths: true,
      });
      applyFormattedResult(formatted, 'Alteração importada');
    } catch {
      setNotice('Não foi possível ler o PDF.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleUploadAlteracao = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await processAlteracaoFile(file);
  };

  const handleDropAlteracao = async (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    await processAlteracaoFile(file);
  };

  const handleFormatCurrentBody = () => {
    const currentHtmls = pagesHtml.map((html, idx) => editorRefs.current[idx]?.innerHTML ?? html);
    const combinedHtml = currentHtmls.join('\n');
    const formatted = formatAlteracaoHtmlOrText(combinedHtml, {
      semestre: header.semestre,
      periodo: header.periodo,
      fillSemesterMonths: true,
    });
    applyFormattedResult(formatted, 'Padronizado');
  };

  const handleResetModel = () => {
    setHeader({ ...DEFAULT_HEADER });
    setFontSizePt('12pt');
    setStructuredDoc(null);
    setEnabledItemIds([]);
    setPagesHtml([DEFAULT_PAGE_1_HTML]);
    setActivePageIndex(0);
    setSyncVersion((v) => v + 1);
    setNotice('Folha em branco restaurada.');
  };

  const handleClearBody = () => {
    setStructuredDoc(null);
    setEnabledItemIds([]);
    setPagesHtml(['<p><br></p>']);
    setActivePageIndex(0);
    setSyncVersion((v) => v + 1);
    setNotice('Texto limpo.');
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
              <table style="width:100%; border-collapse:collapse; font-family:'Times New Roman',serif; font-size:12pt; border-bottom:1px solid #000;">
                <tr>
                  <td style="width:52%; padding:4px 6px 2px 6px; text-align:left; vertical-align:top;">
                    <div>${escapeHtml(header.ministerio)}</div>
                    <div>${escapeHtml(header.forca)}</div>
                    <div>${escapeHtml(header.comandoDivisao)}</div>
                    <div>${escapeHtml(header.grandeUnidade)}</div>
                    <div>${escapeHtml(header.omCodom)}</div>
                  </td>
                  <td style="width:48%; padding:4px 6px 2px 6px; text-align:left; vertical-align:top;">
                    <div>${escapeHtml(header.tituloDocumento)}</div>
                    <div>${escapeHtml(header.guarnicao)}</div>
                    <div>FOLHA Nº ${folhaNum}</div>
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding:2px 6px; text-align:left;">
                    <div>NOME: ${nameHtml}</div>
                    <div>POSTO/GRADUAÇÃO: ${escapeHtml(header.postoGraduacao)}</div>
                    <div>QAS/QMS: ${escapeHtml(header.qasQms)}</div>
                  </td>
                </tr>
                <tr>
                  <td style="width:52%; padding:2px 6px 4px 6px; text-align:left; vertical-align:bottom;">IDENTIDADE: ${escapeHtml(header.identidade)}</td>
                  <td style="width:48%; padding:2px 6px 4px 6px; text-align:left; vertical-align:bottom;">
                    <div>${escapeHtml(header.semestre || '\u00A0')}</div>
                    <div>PERÍODO: ${escapeHtml(header.periodo)}</div>
                  </td>
                </tr>
              </table>`
              : `
              <table style="width:100%; border-collapse:collapse; font-family:'Times New Roman',serif; font-size:12pt; border-bottom:1px solid #000;">
                <tr>
                  <td style="width:65%; padding:4px 6px 1px 6px; vertical-align:baseline;">${escapeHtml(header.omExtenso)}</td>
                  <td style="width:35%; padding:4px 6px 1px 6px; text-align:right; vertical-align:baseline;">FOLHA Nº ${folhaNum}</td>
                </tr>
                <tr>
                  <td style="padding:1px 6px; vertical-align:baseline;">Continuação das Folhas de Alterações</td>
                  <td style="padding:1px 6px; text-align:right; vertical-align:baseline;">${escapeHtml(header.semestre)}</td>
                </tr>
                <tr>
                  <td style="padding:1px 6px 4px 6px; vertical-align:bottom;">${continuacaoArticle} ${escapeHtml(header.postoGraduacao)} ${nameHtml}</td>
                  <td style="padding:1px 6px 4px 6px; text-align:right; vertical-align:bottom;">PERÍODO: ${escapeHtml(header.periodo)}</td>
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
    table.alt-doc-table { width: 100%; table-layout: fixed; border-collapse: collapse; }
    table.alt-doc-table th, table.alt-doc-table td { border: 1px solid #000; padding: 2px 4px; vertical-align: top; word-wrap: break-word; }
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
      setNotice('Word (.doc) exportado.');
    } catch {
      setNotice('Erro ao exportar .doc.');
    }
  };

  return (
    <main className="flex-1 max-w-[1440px] w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start print-wrapper">
      {/* Left Sidebar: Upload PDF + Dados do Militar */}
      <section className="no-print lg:col-span-4 metal-surface rounded-xl p-5 space-y-4">
        {/* Top Primary PDF Upload Dropzone */}
        <div className="space-y-2.5 pb-3 border-b border-white/10">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.html,.htm,.txt"
            onChange={handleUploadAlteracao}
            className="hidden"
          />

          <button
            type="button"
            disabled={isImporting}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDropAlteracao}
            className="w-full rounded-xl border border-dashed border-[#C29B56]/45 bg-[#151813] hover:bg-[#1C2019] hover:border-[#C29B56]/75 px-4 py-4 flex flex-col items-center justify-center gap-1.5 text-center transition-colors disabled:opacity-50"
          >
            <Upload className="w-5 h-5 text-[#E5C17B]" />
            <span className="text-xs font-semibold text-[#E5C17B]">
              {isImporting ? 'Lendo documento...' : 'Subir PDF da Alteração'}
            </span>
            <span className="text-[11px] text-[#98A89F]">.pdf, .docx ou .doc</span>
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleFormatCurrentBody}
              title="Padronizar texto e paginar folhas"
              className="min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#C29B56]/35 bg-[#181F1C] hover:bg-[#222B27] px-3 text-xs font-medium text-[#E4EAE6] transition-colors"
            >
              <Wand2 className="w-3.5 h-3.5 text-[#E5C17B]" />
              <span>Formatar</span>
            </button>

            <button
              type="button"
              onClick={handleResetModel}
              title="Restaurar padrão"
              className="min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#181F1C] hover:bg-[#222B27] px-3 text-xs font-medium text-[#C6D4CC] transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#83B499]" />
              <span>Padrão</span>
            </button>
          </div>

          {notice && (
            <p className="text-xs text-[#83B499] bg-[#2D5A43]/15 border border-[#83B499]/25 rounded-lg px-3 py-2">
              {notice}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-[#C6D4CC]">Dados do Militar</span>
        </div>

        {/* Dados do Militar & Período */}
        <div className="space-y-2.5">
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
                Nome de guerra
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
                Posto / Grad.
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
                Folha inicial
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

            <div className="space-y-1">
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

            <div className="space-y-1">
              <label htmlFor="alt-genero" className="block text-[11px] text-[#98A89F]">
                Tratamento (continuação)
              </label>
              <select
                id="alt-genero"
                value={header.generoCont}
                onChange={(e) =>
                  updateHeaderField('generoCont', e.target.value as 'auto' | 'do' | 'da')
                }
                className="w-full min-h-[38px] rounded-lg bg-[#0E1211] border border-white/12 px-2.5 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
              >
                <option value="auto">Auto ({continuacaoArticle})</option>
                <option value="do">do (Masculino)</option>
                <option value="da">da (Feminino)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Cabeçalho da OM */}
        <details className="pt-3 border-t border-white/10 group">
          <summary className="cursor-pointer text-xs font-medium text-[#C6D4CC] hover:text-white select-none">
            Cabeçalho da OM
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

        {/* Títulos, Subtítulos e Tabelas (Filtro interativo) */}
        {groupedChecklist.length > 0 && (
          <div className="pt-3 border-t border-white/10 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#C6D4CC]">
                Tópicos e Tabelas ({enabledItemIds.length}/{structuredDoc?.items.length ?? 0})
              </span>
              <div className="flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() =>
                    applyChecklistSelection(structuredDoc?.items.map((i) => i.id) ?? [])
                  }
                  className="text-[#E5C17B] hover:underline"
                >
                  Todos
                </button>
                <span className="text-white/20">·</span>
                <button
                  type="button"
                  onClick={() => applyChecklistSelection([])}
                  className="text-[#98A89F] hover:text-white hover:underline"
                >
                  Nenhum
                </button>
              </div>
            </div>

            <div className="max-h-[300px] overflow-y-auto pr-1 space-y-2">
              {groupedChecklist.map((group) => {
                const allGroupChecked = group.items.every((i) => enabledItemIdSet.has(i.id));
                return (
                  <div
                    key={group.key}
                    className="rounded-lg border border-white/10 bg-[#0E1211] p-2.5 space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleScrollToChecklistTarget({
                            kind: 'group',
                            groupKey: group.key,
                            month: group.month,
                            title: group.title,
                          })
                        }
                        title="Ir para tópico na folha"
                        className="min-w-0 flex-1 text-left cursor-pointer group/topic"
                      >
                        <span className="inline-block text-[10px] font-mono text-[#E5C17B] mr-1.5">
                          {group.month.slice(0, 3)}
                        </span>
                        <span className="text-[11px] font-semibold text-[#E4EAE6] group-hover/topic:text-[#E5C17B] transition-colors break-words">
                          {group.title}
                        </span>
                      </button>
                      <input
                        type="checkbox"
                        checked={allGroupChecked}
                        onChange={() => handleToggleChecklistGroup(group.items)}
                        aria-label={`Incluir tópico ${group.title}`}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[#C29B56] cursor-pointer"
                      />
                    </div>

                    <div className="space-y-1 pl-2 border-l border-white/10">
                      {group.items.map((item) => {
                        const isChecked = enabledItemIdSet.has(item.id);
                        const itemLabel =
                          item.kind === 'table'
                            ? item.previewLabel
                            : item.subtitle || item.previewLabel;
                        return (
                          <div
                            key={item.id}
                            className="flex items-center justify-between gap-2 py-0.5 text-[11px] text-[#98A89F]"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                handleScrollToChecklistTarget({
                                  kind: 'item',
                                  item,
                                })
                              }
                              title="Ir para item na folha"
                              className="min-w-0 flex-1 text-left truncate cursor-pointer hover:text-[#E5C17B] transition-colors"
                            >
                              {itemLabel}
                            </button>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleChecklistItem(item.id)}
                              aria-label={`Incluir ${itemLabel}`}
                              className="h-3.5 w-3.5 shrink-0 accent-[#2D5A43] cursor-pointer"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Ações de Documento */}
        <div className="pt-3 border-t border-white/10 space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleAddPage}
              className="min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#181F1C] hover:bg-[#222B27] px-3 text-xs font-medium text-[#E4EAE6] transition-colors"
            >
              <FilePlus2 className="w-3.5 h-3.5 text-[#83B499]" />
              <span>+ Folha Nº {String(header.folhaInicial + pagesHtml.length).padStart(2, '0')}</span>
            </button>

            <button
              type="button"
              onClick={handleClearBody}
              className="min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#181F1C] hover:bg-[#222B27] px-3 text-xs font-medium text-[#E4EAE6] transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5 text-[#98A89F]" />
              <span>Limpar</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="min-h-[42px] inline-flex items-center justify-center gap-2 rounded-lg bg-[#2D5A43] hover:bg-[#376C51] px-3 text-xs font-medium text-white transition-colors"
            >
              <Printer className="w-4 h-4" />
              <span>Imprimir / PDF</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadWordDoc}
              className="min-h-[42px] inline-flex items-center justify-center gap-2 rounded-lg border border-white/12 bg-[#181F1C] hover:bg-[#222B27] px-3 text-xs font-medium text-[#E4EAE6] transition-colors"
            >
              <FileText className="w-4 h-4 text-[#83B499]" />
              <span>Word (.doc)</span>
            </button>
          </div>
        </div>
      </section>

      {/* Right Workspace: Word-like Toolbar + Interactive A4 Document */}
      <section className="lg:col-span-8 min-w-0 w-full flex flex-col items-center space-y-4 print-wrapper">
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

            {/* Subir PDF + Formatar + Find & Replace + Zoom */}
            <div className="flex items-center gap-1.5 ml-auto">
              <button
                type="button"
                disabled={isImporting}
                onClick={() => fileInputRef.current?.click()}
                className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded border border-[#C29B56]/45 bg-[#1B1913] hover:bg-[#252118] text-xs font-medium text-[#E5C17B] transition-colors disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{isImporting ? 'Lendo...' : 'Subir PDF'}</span>
              </button>

              <button
                type="button"
                onClick={handleFormatCurrentBody}
                title="Padronizar documento"
                className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded bg-[#0E1211] border border-white/12 text-xs text-[#E4EAE6] hover:border-[#C29B56]/45 transition-colors"
              >
                <Wand2 className="w-3.5 h-3.5 text-[#E5C17B]" />
                <span>Formatar</span>
              </button>

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

          {/* Calculadora de Tempo de Serviço (sempre visível na parte de edição) */}
          <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#E5C17B]">
                <Calculator className="w-3.5 h-3.5" />
                <span>Tempo de Serviço</span>
              </span>

              <label
                htmlFor="alt-data-praca"
                className="inline-flex items-center gap-1.5 text-[11px] text-[#C6D4CC]"
              >
                <span>Data de praça</span>
                <input
                  id="alt-data-praca"
                  type="date"
                  value={dataPraca}
                  onChange={(e) => handleDateCalculatorChange('praca', e.target.value)}
                  className="h-8 rounded bg-[#0E1211] border border-white/12 px-2 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#C29B56]"
                />
              </label>

              <label
                htmlFor="alt-data-final"
                className="inline-flex items-center gap-1.5 text-[11px] text-[#C6D4CC]"
              >
                <span>Data final</span>
                <input
                  id="alt-data-final"
                  type="date"
                  value={dataFinal}
                  onChange={(e) => handleDateCalculatorChange('final', e.target.value)}
                  className="h-8 rounded bg-[#0E1211] border border-white/12 px-2 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#C29B56]"
                />
              </label>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <span className="font-mono text-xs font-semibold text-[#E5C17B]">
                {serviceTime ? serviceTime.formatted : '00 a 00 m 00 d'}
              </span>
              <button
                type="button"
                disabled={!serviceTime}
                onClick={() => applyServiceTimeToDocument(dataPraca, dataFinal, true)}
                className="h-8 rounded-lg border border-[#C29B56]/45 bg-[#1B1913] hover:bg-[#252118] px-2.5 text-xs font-medium text-[#E5C17B] transition-colors disabled:opacity-40"
              >
                Aplicar na 2ª Parte
              </button>
            </div>
          </div>

          {pinchZoom > 1.02 && (
            <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-2 text-xs">
              <span className="text-[#98A89F]">
                Zoom da folha:{' '}
                <span className="font-mono font-semibold text-[#E5C17B]">
                  {Math.round(pinchZoom * 100)}%
                </span>
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setPinchZoom((prev) => {
                      const next = Math.max(1, prev - 0.35);
                      return next < 1.05 ? 1 : next;
                    })
                  }
                  aria-label="Diminuir zoom da folha"
                  className="h-7 w-7 inline-flex items-center justify-center rounded border border-white/12 bg-[#0E1211] hover:bg-white/10 text-[#C6D4CC]"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPinchZoom((prev) => Math.min(3.5, prev + 0.35))}
                  aria-label="Aumentar zoom da folha"
                  className="h-7 w-7 inline-flex items-center justify-center rounded border border-white/12 bg-[#0E1211] hover:bg-white/10 text-[#C6D4CC]"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPinchZoom(1)}
                  className="h-7 px-2.5 inline-flex items-center gap-1 rounded border border-[#C29B56]/45 bg-[#1B1913] hover:bg-[#252118] text-[11px] font-medium text-[#E5C17B]"
                >
                  <Maximize2 className="w-3 h-3" />
                  <span>Folha inteira</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Editable A4 Pages Stack — whole sheet fits mobile width cleanly; pinch-zoom allows full bidirectional pan */}
        <div
          ref={pagesViewportRef}
          style={{
            touchAction: 'pan-x pan-y',
            WebkitOverflowScrolling: 'touch',
          }}
          className="w-full min-w-0 overflow-x-auto pb-6 space-y-6 print-wrapper print-zoom-reset"
        >
          {pagesHtml.map((pageHtml, pageIndex) => {
            const folhaStr = String(header.folhaInicial + pageIndex).padStart(2, '0');
            const isOverflowing = overflowPages[pageIndex];
            const scaledW = Math.round(A4_WIDTH_PX * totalScale);
            const scaledH = Math.round(A4_HEIGHT_PX * totalScale);

            return (
              <div
                key={`alt-page-${pageIndex}`}
                style={{
                  width: `${scaledW}px`,
                  marginLeft: 'auto',
                  marginRight: 'auto',
                }}
                className="print-page-item print-zoom-reset space-y-1.5"
              >
                <div className="no-print w-full flex items-center justify-between gap-2 text-[11px] text-[#98A89F] px-1">
                  <span className="font-mono">
                    Folha Nº {folhaStr}
                  </span>
                  <div className="flex items-center gap-3">
                    {isOverflowing && (
                      <button
                        type="button"
                        onClick={handleAddPage}
                        className="text-[#E5C17B] hover:underline"
                      >
                        Excedeu · + Folha
                      </button>
                    )}
                    {pagesHtml.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemovePage(pageIndex)}
                        className="text-[#98A89F] hover:text-red-300"
                      >
                        Remover
                      </button>
                    )}
                  </div>
                </div>

                {/* Scaled Visual Bounding Box (matches scaled A4 exact height, zero negative clipping) */}
                <div
                  style={{
                    width: `${scaledW}px`,
                    height: `${scaledH}px`,
                  }}
                  className="print-zoom-reset relative overflow-hidden shadow-2xl border border-white/15 bg-white"
                >
                  {/* Actual A4 Page (210mm x 297mm) */}
                  <div
                    style={{
                      width: '210mm',
                      height: '297mm',
                      padding: '13mm 14mm',
                      transform: totalScale !== 1 ? `scale(${totalScale})` : undefined,
                      transformOrigin: 'top left',
                      fontFamily: '"Times New Roman", Times, Georgia, serif',
                    }}
                    className="print-a4-sheet bg-white text-black box-border flex flex-col shrink-0"
                  >
                  {/* Outer document border frame matching screenshot */}
                  <div className="w-full h-full border border-black flex flex-col overflow-hidden">
                    {pageIndex === 0 ? (
                      /* Folha Nº 01 Full Header */
                      <div
                        ref={page1HeaderRef}
                        className="w-full border-b border-black text-[12pt] leading-[1.22] text-left select-none shrink-0"
                      >
                        <div className="grid grid-cols-[52%_48%]">
                          <div className="px-[3mm] pt-[1.2mm] pb-[0.6mm] space-y-[0.35mm]">
                            <div>{header.ministerio}</div>
                            <div>{header.forca}</div>
                            <div className="whitespace-pre-wrap">{header.comandoDivisao}</div>
                            <div className="whitespace-pre-wrap">{header.grandeUnidade}</div>
                            <div className="whitespace-pre-wrap">{header.omCodom}</div>
                          </div>
                          <div className="px-[3mm] pt-[1.2mm] pb-[0.6mm] space-y-[0.35mm] text-left">
                            <div>{header.tituloDocumento}</div>
                            <div>{header.guarnicao}</div>
                            <div>FOLHA Nº {folhaStr}</div>
                          </div>
                        </div>

                        <div className="px-[3mm] py-[0.6mm] space-y-[0.35mm] text-left">
                          <div>
                            NOME: {renderNameWithBoldGuerra(header.nomeCompleto, header.nomeGuerra)}
                          </div>
                          <div>POSTO/GRADUAÇÃO: {header.postoGraduacao}</div>
                          <div>QAS/QMS: {header.qasQms}</div>
                        </div>

                        <div className="pt-[0.6mm] pb-[1.2mm] grid grid-cols-[52%_48%] items-end">
                          <div className="px-[3mm] text-left">IDENTIDADE: {header.identidade}</div>
                          <div className="px-[3mm] text-left space-y-[0.2mm]">
                            <div>{header.semestre || '\u00A0'}</div>
                            <div>PERÍODO: {header.periodo}</div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* Folha Nº 02+ Continuation Header */
                      <div
                        ref={pageIndex === 1 ? contHeaderRef : undefined}
                        className="w-full border-b border-black px-[3mm] py-[1.4mm] text-[12pt] leading-[1.22] space-y-[0.45mm] select-none shrink-0"
                      >
                        <div className="flex items-baseline justify-between gap-4">
                          <div>{header.omExtenso}</div>
                          <div className="text-right shrink-0">FOLHA Nº {folhaStr}</div>
                        </div>
                        <div className="flex items-baseline justify-between gap-4">
                          <div>Continuação das Folhas de Alterações</div>
                          <div className="text-right shrink-0">{header.semestre}</div>
                        </div>
                        <div className="flex items-end justify-between gap-4">
                          <div>
                            {continuacaoArticle} {header.postoGraduacao}{' '}
                            {renderNameWithBoldGuerra(header.nomeCompleto, header.nomeGuerra)}
                          </div>
                          <div className="text-right shrink-0">PERÍODO: {header.periodo}</div>
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
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
};
