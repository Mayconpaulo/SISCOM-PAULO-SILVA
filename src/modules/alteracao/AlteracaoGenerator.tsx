import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Building2,
  Calculator,
  ChevronDown,
  Eraser,
  FilePlus2,
  FileSearch,
  FileText,
  FolderOpen,
  Highlighter,
  Indent,
  Italic,
  List,
  ListChecks,
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
  User,
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
} from './alteracaoFormatter';
import { paginateAlteracaoBlocksInDom, readAlteracaoFile } from './alteracaoFileReader';
import {
  LiveCaretBookmark,
  applyChecklistDeltaToLivePages,
  applyPart2UpdatesSurgicallyToPages,
  captureEditorHtmlWithCaretMarker,
  detectLivePresentItemIds,
  reflowLiveEditedPages,
  restoreCaretBookmarkInEditors,
  tryHandleLinkedBoundaryKey,
} from './alteracaoLiveReflow';
import { AlteracaoArchivePanel } from './AlteracaoArchivePanel';
import {
  AlteracaoArchiveDocRecord,
  parseStructuredDocJson,
} from './alteracaoArchiveService';
import { BiSmartSearchSendPayload, BiSmartSearchView } from './BiSmartSearchView';
import { inferPortugueseContinuacaoArticle } from '../../shared/portugueseGender';
import { WorkspaceSplitLayout } from '../../shared/WorkspaceSplitLayout';
import {
  TabletRibbonButton,
  TabletRibbonDivider,
  TabletRibbonGroup,
  TabletRibbonIconButton,
  TabletRibbonRow,
} from '../../shared/TabletRibbonPrimitives';
import {
  sanitizeAlteracaoHtml,
  sanitizeCssFontFamily,
  sanitizeCssFontSizePt,
  sanitizeCssLineHeight,
} from '../../shared/htmlSanitizer';
import { AnimatePresence, motion } from 'motion/react';
import { getSecureVaultItem, setSecureVaultItem } from '../../core/privacy/privacyVault';
import { fadeSlideVariants, UI_TRANSITION } from '../../shared/motion';
import { SiscomAlert, SiscomSpinner } from '../../shared/ui';

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
    const raw = getSecureVaultItem(STORAGE_KEY);
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
        ? parsed.pagesHtml.map((p) => sanitizeAlteracaoHtml(p))
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
    const migratedFontSizePt = sanitizeCssFontSizePt(
      !parsed.migratedTo12pt && rawFontSizePt === '10.5pt' ? '12pt' : rawFontSizePt,
      fallback.fontSizePt
    );

    return {
      header,
      pagesHtml,
      fontFamily: sanitizeCssFontFamily(
        typeof parsed.fontFamily === 'string' ? parsed.fontFamily : fallback.fontFamily,
        fallback.fontFamily
      ),
      fontSizePt: migratedFontSizePt,
      lineHeight: sanitizeCssLineHeight(
        typeof parsed.lineHeight === 'string' ? parsed.lineHeight : fallback.lineHeight,
        fallback.lineHeight
      ),
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
  onTriggerReflow: (immediate: boolean) => void;
  onBoundaryKey: (key: 'Backspace' | 'Delete') => boolean;
}

const ALT_DATA_ATTRS = [
  'data-alt-item',
  'data-alt-group',
  'data-alt-month',
  'data-alt-sem-alt',
  'data-alt-part2',
  'data-alt-comportamento',
] as const;

function findTopBlockInEditor(editorEl: HTMLDivElement, node: Node | null): HTMLElement | null {
  let cur: Node | null = node;
  while (cur && cur !== editorEl) {
    if (cur.parentNode === editorEl && cur.nodeType === Node.ELEMENT_NODE) {
      return cur as HTMLElement;
    }
    cur = cur.parentNode;
  }
  return null;
}

function stripAltDataAttrs(el: HTMLElement): void {
  for (const attr of ALT_DATA_ATTRS) {
    if (el.hasAttribute(attr)) {
      el.removeAttribute(attr);
    }
  }
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
  onTriggerReflow,
  onBoundaryKey,
}) => {
  const localRef = useRef<HTMLDivElement | null>(null);
  const isComposingRef = useRef(false);
  const enterSourceBlockRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const el = localRef.current;
    if (!el) return;
    const safeHtml = sanitizeAlteracaoHtml(initialHtml);
    if (el.innerHTML !== safeHtml) {
      el.innerHTML = safeHtml;
    }
    const overflows = el.scrollHeight > el.clientHeight + 2;
    onChangeHtml(el.innerHTML, overflows);
    // Sync only on explicit external reload/replace version changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncVersion]);

  const cleanupClonedAltAttrs = (editorEl: HTMLDivElement) => {
    // 1) Never leave data-alt-* attributes on blank spacer lines created by Enter
    for (const child of Array.from(editorEl.children)) {
      const htmlChild = child as HTMLElement;
      if (htmlChild.tagName === 'TABLE' || htmlChild.querySelector('table')) continue;
      const txt = (htmlChild.textContent || '').replace(/\u00a0/g, '').trim();
      if (txt.length === 0) {
        stripAltDataAttrs(htmlChild);
      }
    }

    // 2) If Enter split a block into a new element, strip browser-cloned data-alt-* attrs
    //    from the newly created element so pushing/moving it never drags the preceding BI block
    const prevBlock = enterSourceBlockRef.current;
    enterSourceBlockRef.current = null;
    if (!prevBlock) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const activeBlock = findTopBlockInEditor(editorEl, sel.getRangeAt(0).startContainer);
    if (activeBlock && activeBlock !== prevBlock && activeBlock.tagName !== 'TABLE') {
      const clonedItem =
        activeBlock.getAttribute('data-alt-item') &&
        activeBlock.getAttribute('data-alt-item') === prevBlock.getAttribute('data-alt-item');
      const clonedGroup =
        activeBlock.getAttribute('data-alt-group') &&
        activeBlock.getAttribute('data-alt-group') === prevBlock.getAttribute('data-alt-group');
      const clonedMonth =
        activeBlock.getAttribute('data-alt-month') &&
        activeBlock.getAttribute('data-alt-month') === prevBlock.getAttribute('data-alt-month');
      const clonedPart2 =
        activeBlock.hasAttribute('data-alt-part2') && prevBlock.hasAttribute('data-alt-part2');
      if (clonedItem || clonedGroup || clonedMonth || clonedPart2) {
        stripAltDataAttrs(activeBlock);
      }
    }
  };

  const handleInput = (forceImmediate = false) => {
    const el = localRef.current;
    if (!el) return;
    cleanupClonedAltAttrs(el);
    const overflows = el.scrollHeight > el.clientHeight + 2;
    onChangeHtml(el.innerHTML, overflows);
    if (!isComposingRef.current) {
      onTriggerReflow(forceImmediate || overflows);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposingRef.current) {
      const el = localRef.current;
      const sel = window.getSelection();
      enterSourceBlockRef.current =
        el && sel && sel.rangeCount > 0
          ? findTopBlockInEditor(el, sel.getRangeAt(0).startContainer)
          : null;
      return;
    }

    if (
      (e.key === 'Backspace' || e.key === 'Delete') &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !isComposingRef.current
    ) {
      if (onBoundaryKey(e.key)) {
        e.preventDefault();
      }
    }
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
      onInput={() => handleInput(false)}
      onCompositionStart={() => {
        isComposingRef.current = true;
      }}
      onCompositionEnd={() => {
        isComposingRef.current = false;
        handleInput(true);
      }}
      onPaste={() => {
        window.requestAnimationFrame(() => handleInput(true));
      }}
      onCut={() => {
        window.requestAnimationFrame(() => handleInput(true));
      }}
      onKeyDown={handleKeyDown}
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
  const [tabletPanel, setTabletPanel] = useState<
    'arquivo' | 'militar' | 'cabecalho' | 'topicos' | 'localizar' | 'tempo' | null
  >(null);
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
  const [updateClosingDateWithCalc, setUpdateClosingDateWithCalc] = useState(false);
  const [alteracaoMode, setAlteracaoMode] = useState<'formatar' | 'gerar'>('formatar');
  const [isImporting, setIsImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeArchivedDoc, setActiveArchivedDoc] = useState<{
    id: string | null;
    title: string;
    folderId: string;
  }>({ id: null, title: '', folderId: '' });

  const editorRefs = useRef<(HTMLDivElement | null)[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const page1HeaderRef = useRef<HTMLDivElement | null>(null);
  const contHeaderRef = useRef<HTMLDivElement | null>(null);
  const highlightResetRef = useRef<(() => void) | null>(null);
  const pagesViewportRef = useRef<HTMLDivElement | null>(null);
  const pendingCaretRef = useRef<LiveCaretBookmark | null>(null);
  const reflowTimerRef = useRef<number | null>(null);
  const pagesHtmlRef = useRef<string[]>(pagesHtml);
  const fontStyleRef = useRef({ fontFamily, fontSizePt, lineHeight });
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

  pagesHtmlRef.current = pagesHtml;
  fontStyleRef.current = { fontFamily, fontSizePt, lineHeight };

  const fitScale =
    viewportWidth > 0 ? Math.min(1, Math.max(0.22, (viewportWidth - 4) / A4_WIDTH_PX)) : 1;
  const baseScale = fitScale * (zoom / 100);
  const totalScale = baseScale * pinchZoom;

  effectiveScaleRef.current = totalScale;
  pinchZoomRef.current = pinchZoom;
  totalScaleRef.current = totalScale;

  // Keep "Tópicos e Tabelas" checkboxes live-synced with manual deletions/edits in the A4 sheets
  useEffect(() => {
    if (!structuredDoc || structuredDoc.items.length === 0) return;
    const timer = window.setTimeout(() => {
      const livePages = pagesHtmlRef.current.map(
        (html, idx) => editorRefs.current[idx]?.innerHTML ?? html
      );
      const presentIds = detectLivePresentItemIds(livePages, structuredDoc);
      setEnabledItemIds((prev) => {
        if (prev.length === presentIds.length) {
          const prevSet = new Set(prev);
          if (presentIds.every((id) => prevSet.has(id))) {
            return prev;
          }
        }
        return presentIds;
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [pagesHtml, structuredDoc]);

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

  useLayoutEffect(() => {
    editorRefs.current.length = pagesHtml.length;
    const pending = pendingCaretRef.current;
    if (!pending) return;
    pendingCaretRef.current = null;
    restoreCaretBookmarkInEditors(editorRefs.current, pending);
  }, [syncVersion, pagesHtml.length]);

  useEffect(() => {
    return () => {
      highlightResetRef.current?.();
      if (reflowTimerRef.current !== null) {
        window.clearTimeout(reflowTimerRef.current);
      }
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
      setSecureVaultItem(
        STORAGE_KEY,
        JSON.stringify({
          header,
          pagesHtml: pagesHtml.map((p) => sanitizeAlteracaoHtml(p)),
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
    const handlePurged = () => {
      setHeader({ ...DEFAULT_HEADER });
      setStructuredDoc(null);
      setEnabledItemIds([]);
      setPagesHtml([DEFAULT_PAGE_1_HTML]);
      setDataPraca('');
      setDataFinal(getTodayIsoDate());
      setFontFamily('Times New Roman');
      setFontSizePt('12pt');
      setLineHeight('1.22');
      setActivePageIndex(0);
      setSyncVersion((v) => v + 1);
      setNotice(null);
    };
    window.addEventListener('siscom:vault-purged', handlePurged);
    return () => window.removeEventListener('siscom:vault-purged', handlePurged);
  }, []);

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

  const getLivePaginateOptions = (overrideStyle?: {
    fontFamily?: string;
    fontSizePt?: string;
    lineHeight?: string;
  }) => {
    const scale = effectiveScaleRef.current || 1;
    const p1El = page1HeaderRef.current;
    const contEl = contHeaderRef.current;
    const page1HeaderHeightPx = p1El
      ? p1El.offsetHeight || p1El.getBoundingClientRect().height / scale
      : undefined;
    const contHeaderHeightPx = contEl
      ? contEl.offsetHeight || contEl.getBoundingClientRect().height / scale
      : undefined;

    const paddingVPx = 7 * MM_TO_PX;
    const editor0 = editorRefs.current[0];
    const editor1 = editorRefs.current[1];
    const page1ContentHeightPx =
      editor0 && editor0.clientHeight > 160 ? editor0.clientHeight - paddingVPx : undefined;
    const contContentHeightPx =
      editor1 && editor1.clientHeight > 200 ? editor1.clientHeight - paddingVPx : undefined;
    const editorWidthPx =
      editor0 && editor0.clientWidth > 200 ? editor0.clientWidth : undefined;

    return {
      fontFamily: overrideStyle?.fontFamily ?? fontStyleRef.current.fontFamily,
      fontSizePt: overrideStyle?.fontSizePt ?? fontStyleRef.current.fontSizePt,
      lineHeight: overrideStyle?.lineHeight ?? fontStyleRef.current.lineHeight,
      page1HeaderHeightPx,
      contHeaderHeightPx,
      page1ContentHeightPx,
      contContentHeightPx,
      editorWidthPx,
    };
  };

  const runLiveLinkedReflow = (
    editedPageIndex: number,
    opts?: {
      forceApply?: boolean;
      overrideStyle?: { fontFamily?: string; fontSizePt?: string; lineHeight?: string };
      overridePages?: string[];
    }
  ) => {
    const basePages =
      opts?.overridePages ??
      pagesHtmlRef.current.map((html, idx) => editorRefs.current[idx]?.innerHTML ?? html);

    const activeEditor = editorRefs.current[editedPageIndex] ?? null;
    const hasDomOverflow = editorRefs.current.some(
      (el) => Boolean(el && el.scrollHeight > el.clientHeight + 2)
    );
    const result = reflowLiveEditedPages({
      livePagesHtml: basePages,
      paginateOptions: getLivePaginateOptions(opts?.overrideStyle),
      activePageIndex: editedPageIndex,
      captureActiveMarkerHtml:
        activeEditor && document.activeElement === activeEditor
          ? () => captureEditorHtmlWithCaretMarker(activeEditor)
          : undefined,
      hasDomOverflow,
      forceApply: opts?.forceApply,
    });

    if (!result.changed) return;

    const sanitizedPages = result.pagesHtml.map((p) => sanitizeAlteracaoHtml(p));
    pendingCaretRef.current = result.caret;
    pagesHtmlRef.current = sanitizedPages;
    setPagesHtml(sanitizedPages);
    setActivePageIndex((prev) =>
      result.caret
        ? Math.min(result.caret.pageIndex, Math.max(0, sanitizedPages.length - 1))
        : Math.min(prev, Math.max(0, sanitizedPages.length - 1))
    );
    setSyncVersion((v) => v + 1);
  };

  const scheduleLiveReflow = (
    editedPageIndex: number,
    immediate: boolean,
    overrideStyle?: { fontFamily?: string; fontSizePt?: string; lineHeight?: string }
  ) => {
    if (reflowTimerRef.current !== null) {
      window.clearTimeout(reflowTimerRef.current);
      reflowTimerRef.current = null;
    }
    const delay = immediate ? 16 : 90;
    reflowTimerRef.current = window.setTimeout(() => {
      reflowTimerRef.current = null;
      runLiveLinkedReflow(editedPageIndex, { overrideStyle });
    }, delay);
  };

  const handleLinkedBoundaryKey = (pageIndex: number, key: 'Backspace' | 'Delete'): boolean => {
    const livePagesHtml = pagesHtmlRef.current.map(
      (html, idx) => editorRefs.current[idx]?.innerHTML ?? html
    );
    const outcome = tryHandleLinkedBoundaryKey({
      key,
      pageIndex,
      editors: editorRefs.current,
      livePagesHtml,
      paginateOptions: getLivePaginateOptions(),
    });
    if (!outcome.handled) return false;

    if (reflowTimerRef.current !== null) {
      window.clearTimeout(reflowTimerRef.current);
      reflowTimerRef.current = null;
    }

    const sanitizedPages = outcome.pagesHtml.map((p) => sanitizeAlteracaoHtml(p));
    pendingCaretRef.current = outcome.caret;
    pagesHtmlRef.current = sanitizedPages;
    setPagesHtml(sanitizedPages);
    setActivePageIndex((prev) =>
      outcome.caret
        ? Math.min(outcome.caret.pageIndex, Math.max(0, sanitizedPages.length - 1))
        : Math.min(prev, Math.max(0, sanitizedPages.length - 1))
    );
    setSyncVersion((v) => v + 1);
    return true;
  };

  const syncPageFromDom = (idx: number) => {
    const el = editorRefs.current[idx];
    if (!el) return;
    const html = sanitizeAlteracaoHtml(el.innerHTML);
    const overflows = el.scrollHeight > el.clientHeight + 2;
    setPagesHtml((prev) => prev.map((p, i) => (i === idx ? html : p)));
    setOverflowPages((prev) => ({ ...prev, [idx]: overflows }));
  };

  const runFormatCommand = (command: string, value?: string) => {
    focusActiveEditor();
    try {
      document.execCommand(command, false, value);
      syncPageFromDom(activePageIndex);
      scheduleLiveReflow(activePageIndex, true);
    } catch {
      setNotice('Não foi possível aplicar esta formatação no navegador atual.');
    }
  };

  const applySelectionFontSize = (ptValue: string) => {
    const safePt = sanitizeCssFontSizePt(ptValue, '12pt');
    setFontSizePt(safePt);
    const target = focusActiveEditor();
    const selection = window.getSelection();
    if (target && selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      const range = selection.getRangeAt(0);
      if (target.contains(range.commonAncestorContainer)) {
        try {
          const span = document.createElement('span');
          span.style.fontSize = safePt;
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
      }
    }
    scheduleLiveReflow(activePageIndex, true, { fontSizePt: safePt });
  };

  const applySelectionFontFamily = (family: string) => {
    const safeFamily = sanitizeCssFontFamily(family, 'Times New Roman');
    setFontFamily(safeFamily);
    runFormatCommand('fontName', safeFamily);
    scheduleLiveReflow(activePageIndex, true, { fontFamily: safeFamily });
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

    const livePages = pagesHtml.map((html, idx) => editorRefs.current[idx]?.innerHTML ?? html);
    const replacedPages = livePages.map((html) => {
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
      return sanitizeAlteracaoHtml(doc.body.innerHTML);
    });

    if (totalMatches > 0) {
      const reflowResult = reflowLiveEditedPages({
        livePagesHtml: replacedPages,
        paginateOptions: getLivePaginateOptions(),
        forceApply: true,
      });
      const finalPages = reflowResult.pagesHtml.map((p) => sanitizeAlteracaoHtml(p));
      setPagesHtml(finalPages);
      setActivePageIndex((prev) => Math.min(prev, Math.max(0, finalPages.length - 1)));
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
      ...(derived.semestre
        ? { semestre: derived.semestre }
        : current.semestre
          ? {}
          : {}),
      ...(derived.periodo
        ? { periodo: derived.periodo }
        : current.periodo
          ? {}
          : {}),
    };
    return next;
  };

  const measureAndPaginateBlocks = (
    blocks: ReturnType<typeof formatAlteracaoHtmlOrText>['blocks']
  ) => {
    return paginateAlteracaoBlocksInDom(blocks, getLivePaginateOptions());
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

    const paginated = measureAndPaginateBlocks(formatted.blocks).map((p) =>
      sanitizeAlteracaoHtml(p)
    );
    setPagesHtml(paginated);
    setActivePageIndex(0);
    setSyncVersion((v) => v + 1);
    setNotice(`${label} (${paginated.length} folha${paginated.length > 1 ? 's' : ''}).`);
  };

  const applyChecklistSelection = (nextEnabledIds: string[]) => {
    const prevSet = new Set(enabledItemIds);
    const nextSet = new Set(nextEnabledIds);
    setEnabledItemIds(nextEnabledIds);
    if (!structuredDoc) return;

    const livePagesHtml = pagesHtml.map(
      (html, idx) => editorRefs.current[idx]?.innerHTML ?? html
    );

    const updatedPages = applyChecklistDeltaToLivePages({
      livePagesHtml,
      structuredDoc,
      prevEnabledIds: prevSet,
      nextEnabledIds: nextSet,
      paginateOptions: getLivePaginateOptions(),
    }).map((p) => sanitizeAlteracaoHtml(p));

    setPagesHtml(updatedPages);
    setActivePageIndex((prev) => Math.min(prev, Math.max(0, updatedPages.length - 1)));
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

  /**
   * Isolated service-time updater: surgically modifies ONLY the service-time lines inside 2ª PARTE
   * (and optionally the closing date line) directly on the live edited sheets.
   * NEVER rebuilds the document or touches manual edits in 1ª PARTE.
   */
  const applyServiceTimeToDocument = (
    pracaIso: string,
    finalIso: string,
    shouldScrollToPart2: boolean,
    alsoUpdateClosingDate = updateClosingDateWithCalc
  ) => {
    const calc = calculateServiceTime(pracaIso, finalIso);
    if (!calc) {
      if (shouldScrollToPart2) {
        setNotice('Informe Data de praça e Data final válidas.');
      }
      return;
    }

    const closingDatePtBr = alsoUpdateClosingDate ? formatPtBrDateLong(finalIso) : undefined;
    const livePagesHtml = pagesHtml.map(
      (html, idx) => editorRefs.current[idx]?.innerHTML ?? html
    );

    const surgical = applyPart2UpdatesSurgicallyToPages({
      livePagesHtml,
      serviceTimeFormatted: calc.formatted,
      closingDatePtBr,
      guarnicao: header.guarnicao,
      paginateOptions: getLivePaginateOptions(),
    });

    const sanitizedPages = surgical.pagesHtml.map((p) => sanitizeAlteracaoHtml(p));
    setPagesHtml(sanitizedPages);
    setSyncVersion((v) => v + 1);

    // Keep structuredDoc.part2Lines metadata quietly in sync WITHOUT rebuilding the sheet
    if (structuredDoc) {
      const updatedPart2 = applyServiceTimeToPart2Lines(
        structuredDoc.part2Lines,
        calc.formatted,
        {
          datePtBr: closingDatePtBr,
          guarnicao: header.guarnicao,
          updateClosingDate: alsoUpdateClosingDate,
        }
      );
      setStructuredDoc((prev) => (prev ? { ...prev, part2Lines: updatedPart2 } : prev));
    }

    setNotice(`Tempo aplicado na 2ª Parte: ${calc.formatted} (texto acima preservado).`);

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
    if (field === 'praca') setDataPraca(value);
    else setDataFinal(value);
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
      setActiveArchivedDoc({ id: null, title: '', folderId: '' });
      applyFormattedResult(formatted, 'Alteração importada e formatada');
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'Não foi possível ler o arquivo enviado.';
      setNotice(msg);
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

  const getArchiveSnapshot = () => {
    const livePagesHtml = pagesHtml.map(
      (html, idx) => editorRefs.current[idx]?.innerHTML ?? html
    );
    return {
      header,
      pagesHtml: livePagesHtml,
      fontFamily,
      fontSizePt,
      lineHeight,
      dataPraca,
      dataFinal,
      enabledItemIds,
      structuredDoc,
    };
  };

  const suggestedArchiveTitle = useMemo(() => {
    const person = [header.postoGraduacao.trim(), header.nomeGuerra.trim() || header.nomeCompleto.trim()]
      .filter(Boolean)
      .join(' ');
    const period = header.semestre.trim() || header.periodo.trim();
    if (person && period) return `${person} — ${period}`;
    if (person) return person;
    if (period) return `Alteração — ${period}`;
    return 'Nova Alteração';
  }, [header.postoGraduacao, header.nomeGuerra, header.nomeCompleto, header.semestre, header.periodo]);

  const handleOpenArchivedDoc = (docItem: AlteracaoArchiveDocRecord) => {
    const restoredStructured = parseStructuredDocJson(docItem.structuredDocJson);
    const restoredPages =
      docItem.pagesHtml.length > 0
        ? docItem.pagesHtml.map((p) => sanitizeAlteracaoHtml(p))
        : [DEFAULT_PAGE_1_HTML];
    const restoredEnabled =
      docItem.enabledItemIds.length > 0
        ? docItem.enabledItemIds
        : restoredStructured
          ? restoredStructured.items.map((i) => i.id)
          : [];

    setHeader({ ...docItem.header });
    setFontFamily(sanitizeCssFontFamily(docItem.fontFamily));
    setFontSizePt(sanitizeCssFontSizePt(docItem.fontSizePt));
    setLineHeight(sanitizeCssLineHeight(docItem.lineHeight));
    setDataPraca(docItem.dataPraca || '');
    setDataFinal(docItem.dataFinal || getTodayIsoDate());
    setStructuredDoc(restoredStructured);
    setEnabledItemIds(restoredEnabled);
    setPagesHtml(restoredPages);
    setActivePageIndex(0);
    setSyncVersion((v) => v + 1);
    setActiveArchivedDoc({
      id: docItem.id,
      title: docItem.title,
      folderId: docItem.folderId,
    });
    setNotice(`Alteração "${docItem.title}" carregada para edição.`);
  };

  const handleBatchUpdatedDocs = (updatedDocs: AlteracaoArchiveDocRecord[]) => {
    if (!activeArchivedDoc.id) return;
    const match = updatedDocs.find((d) => d.id === activeArchivedDoc.id);
    if (!match) return;
    const restoredStructured = parseStructuredDocJson(match.structuredDocJson);
    const restoredPages =
      match.pagesHtml.length > 0
        ? match.pagesHtml.map((p) => sanitizeAlteracaoHtml(p))
        : pagesHtml;
    setHeader({ ...match.header });
    setDataPraca(match.dataPraca || '');
    setDataFinal(match.dataFinal || dataFinal);
    if (restoredStructured) {
      setStructuredDoc(restoredStructured);
    }
    setPagesHtml(restoredPages);
    setSyncVersion((v) => v + 1);
  };

  const handleResetModel = () => {
    setHeader({ ...DEFAULT_HEADER });
    setFontSizePt('12pt');
    setStructuredDoc(null);
    setEnabledItemIds([]);
    setPagesHtml([DEFAULT_PAGE_1_HTML]);
    setActivePageIndex(0);
    setActiveArchivedDoc({ id: null, title: '', folderId: '' });
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

          const safeFontFamily = sanitizeCssFontFamily(fontFamily);
          const safeFontSizePt = sanitizeCssFontSizePt(fontSizePt);
          const safeLineHeight = sanitizeCssLineHeight(lineHeight);
          const safeBodyHtml = sanitizeAlteracaoHtml(bodyHtml);
          const pageBreakStyle = idx > 0 ? 'page-break-before:always;' : '';
          return `
            <div style="${pageBreakStyle} border:1px solid #000; padding:0; min-height:252mm;">
              ${headerTableHtml}
              <div style="padding:10px 12px; font-family:'${safeFontFamily}', 'Times New Roman', serif; font-size:${safeFontSizePt}; line-height:${safeLineHeight};">
                ${safeBodyHtml}
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

  const handleSendBiToEditor = (payload: BiSmartSearchSendPayload) => {
    const rendered = renderBlocksFromStructuredDoc(payload.structuredDoc, undefined, {
      semestre: payload.semestre,
      periodo: payload.periodo,
      fillSemesterMonths: true,
      preferOptionSemester: true,
    });
    const nextHeader = mergeExtractedHeader(
      {
        ...DEFAULT_HEADER,
        ministerio: header.ministerio,
        forca: header.forca,
        comandoDivisao: header.comandoDivisao,
        grandeUnidade: header.grandeUnidade,
        omCodom: header.omCodom,
        omExtenso: header.omExtenso,
        tituloDocumento: header.tituloDocumento,
        guarnicao: header.guarnicao,
      },
      payload.headerExtract,
      payload.structuredDoc.monthOrder
    );

    const prevName = header.nomeCompleto.trim().toUpperCase();
    const nextName = nextHeader.nomeCompleto.trim().toUpperCase();
    if (nextName && prevName && nextName !== prevName) {
      setDataPraca('');
    }
    if (payload.closingDateIso) {
      setDataFinal(payload.closingDateIso);
    }

    const initialPaginated = paginateAlteracaoBlocksInDom(rendered.blocks, {
      fontFamily: fontStyleRef.current.fontFamily,
      fontSizePt: fontStyleRef.current.fontSizePt,
      lineHeight: fontStyleRef.current.lineHeight,
    }).map((p) => sanitizeAlteracaoHtml(p));

    setActiveArchivedDoc({ id: null, title: '', folderId: '' });
    setHeader(nextHeader);
    setStructuredDoc(payload.structuredDoc);
    setEnabledItemIds(payload.structuredDoc.items.map((item) => item.id));
    setPagesHtml(initialPaginated);
    setActivePageIndex(0);
    setSyncVersion((v) => v + 1);
    setAlteracaoMode('formatar');
    setNotice(
      `${payload.summaryLabel} (${initialPaginated.length} folha${initialPaginated.length > 1 ? 's' : ''}).`
    );

    // Once the Formatar A4 canvas becomes visible, re-measure with live DOM header/editor heights
    // so pagination matches Formatar Alteração pixel-for-pixel.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (pagesViewportRef.current) {
          setViewportWidth(pagesViewportRef.current.clientWidth);
        }
        const livePaginated = paginateAlteracaoBlocksInDom(
          rendered.blocks,
          getLivePaginateOptions()
        ).map((p) => sanitizeAlteracaoHtml(p));
        setPagesHtml(livePaginated);
        setSyncVersion((v) => v + 1);
        setNotice(
          `${payload.summaryLabel} (${livePaginated.length} folha${livePaginated.length > 1 ? 's' : ''}).`
        );
      });
    });
  };

  return (
    <div className="workspace-split-container print-wrapper flex-1 flex flex-col min-h-0 lg:overflow-hidden">
      {/* Mode Switcher: Formatar (existing) vs Gerar de Boletins (new) */}
      <div className="no-print shrink-0 px-3.5 sm:px-6 py-2 border-b border-white/[0.08] bg-[#0B120E]/75 backdrop-blur-md flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Modo do módulo Alterações"
          className="inline-flex items-center rounded-lg border border-white/10 bg-[#080D0A]/80 p-1 gap-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={alteracaoMode === 'formatar'}
            onClick={() => setAlteracaoMode('formatar')}
            className={`relative inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              alteracaoMode === 'formatar'
                ? 'text-[#F4E6C4]'
                : 'text-[#98A89F] hover:text-[#E8EEEA]'
            }`}
          >
            {alteracaoMode === 'formatar' && (
              <motion.span
                layoutId="alteracao-mode-tab-bg"
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0 rounded-md bg-[#2D5A43]/85 border border-[#C9A961]/45 shadow-sm"
              />
            )}
            <FileText className="relative z-10 w-3.5 h-3.5" />
            <span className="relative z-10">Formatar Alteração</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={alteracaoMode === 'gerar'}
            onClick={() => setAlteracaoMode('gerar')}
            className={`relative inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              alteracaoMode === 'gerar'
                ? 'text-[#F4E6C4]'
                : 'text-[#98A89F] hover:text-[#E8EEEA]'
            }`}
          >
            {alteracaoMode === 'gerar' && (
              <motion.span
                layoutId="alteracao-mode-tab-bg"
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0 rounded-md bg-[#2D5A43]/85 border border-[#C9A961]/45 shadow-sm"
              />
            )}
            <FileSearch className="relative z-10 w-3.5 h-3.5 text-[#E5C17B]" />
            <span className="relative z-10">Gerar de Boletins</span>
          </button>
        </div>
      </div>

      {/* Keep BiSmartSearchView mounted while switching tabs so uploaded BIs & review cards are preserved */}
      <div
        className={
          alteracaoMode === 'gerar'
            ? 'no-print flex-1 flex flex-col min-h-0 lg:overflow-hidden'
            : 'hidden no-print'
        }
      >
        <BiSmartSearchView onSendToEditor={handleSendBiToEditor} />
      </div>

      <div
        className={
          alteracaoMode === 'formatar'
            ? 'workspace-split-container print-wrapper flex-1 flex flex-col min-h-0 lg:overflow-hidden'
            : 'hidden'
        }
      >
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.html,.htm,.txt"
        onChange={handleUploadAlteracao}
        className="hidden"
      />
      <WorkspaceSplitLayout
      sidebarWidthClass="lg:w-[305px] xl:w-[335px]"
      rightSidebarWidthClass="lg:w-[268px] xl:w-[292px]"
      tabletTopBar={
        <TabletRibbonRow>
          <TabletRibbonGroup>
            <TabletRibbonButton
              variant="gold"
              disabled={isImporting}
              icon={
                isImporting ? (
                  <SiscomSpinner tone="gold" className="w-3.5 h-3.5" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )
              }
              onClick={() => fileInputRef.current?.click()}
            >
              {isImporting ? 'Lendo...' : 'Importar'}
            </TabletRibbonButton>

            <TabletRibbonButton
              icon={<RotateCcw className="w-3.5 h-3.5 text-[#83B499]" />}
              onClick={handleResetModel}
            >
              Nova Folha
            </TabletRibbonButton>
          </TabletRibbonGroup>

          <TabletRibbonDivider />

          <TabletRibbonGroup>
            <TabletRibbonButton
              icon={<FolderOpen className="w-3.5 h-3.5 text-[#E5C17B]" />}
              chevron
              open={tabletPanel === 'arquivo'}
              onClick={() => setTabletPanel((p) => (p === 'arquivo' ? null : 'arquivo'))}
            >
              Arquivo
            </TabletRibbonButton>

            <TabletRibbonButton
              icon={<User className="w-3.5 h-3.5 text-[#83B499]" />}
              chevron
              open={tabletPanel === 'militar'}
              onClick={() => setTabletPanel((p) => (p === 'militar' ? null : 'militar'))}
            >
              {header.nomeGuerra.trim() ? header.nomeGuerra.trim() : 'Militar'}
            </TabletRibbonButton>

            <TabletRibbonButton
              icon={<Building2 className="w-3.5 h-3.5 text-[#98A89F]" />}
              chevron
              open={tabletPanel === 'cabecalho'}
              onClick={() => setTabletPanel((p) => (p === 'cabecalho' ? null : 'cabecalho'))}
            >
              Cabeçalho
            </TabletRibbonButton>

            {groupedChecklist.length > 0 && (
              <TabletRibbonButton
                icon={<ListChecks className="w-3.5 h-3.5 text-[#E5C17B]" />}
                badge={`${enabledItemIds.length}/${structuredDoc?.items.length ?? 0}`}
                chevron
                open={tabletPanel === 'topicos'}
                onClick={() => setTabletPanel((p) => (p === 'topicos' ? null : 'topicos'))}
              >
                Tópicos
              </TabletRibbonButton>
            )}
          </TabletRibbonGroup>

          <TabletRibbonDivider />

          <TabletRibbonGroup>
            <TabletRibbonButton
              icon={<FilePlus2 className="w-3.5 h-3.5 text-[#83B499]" />}
              onClick={handleAddPage}
            >
              + Fl. {String(header.folhaInicial + pagesHtml.length).padStart(2, '0')}
            </TabletRibbonButton>

            <TabletRibbonButton
              icon={<Trash2 className="w-3.5 h-3.5 text-[#98A89F]" />}
              onClick={handleClearBody}
            >
              Limpar
            </TabletRibbonButton>
          </TabletRibbonGroup>

          <TabletRibbonDivider />

          <TabletRibbonGroup>
            <TabletRibbonButton
              variant="primary"
              icon={<Printer className="w-3.5 h-3.5" />}
              onClick={() => window.print()}
            >
              PDF / Imprimir
            </TabletRibbonButton>

            <TabletRibbonButton
              icon={<FileText className="w-3.5 h-3.5 text-[#83B499]" />}
              onClick={handleDownloadWordDoc}
            >
              Word
            </TabletRibbonButton>
          </TabletRibbonGroup>
        </TabletRibbonRow>
      }
      tabletBottomBar={
        <TabletRibbonRow>
          <TabletRibbonGroup>
            <TabletRibbonIconButton
              title="Desfazer"
              aria-label="Desfazer"
              onMouseDown={(e) => {
                e.preventDefault();
                runFormatCommand('undo');
              }}
            >
              <Undo2 className="w-4 h-4" />
            </TabletRibbonIconButton>
            <TabletRibbonIconButton
              title="Refazer"
              aria-label="Refazer"
              onMouseDown={(e) => {
                e.preventDefault();
                runFormatCommand('redo');
              }}
            >
              <Redo2 className="w-4 h-4" />
            </TabletRibbonIconButton>
          </TabletRibbonGroup>

          <TabletRibbonDivider />

          <TabletRibbonGroup>
            <select
              aria-label="Fonte do texto"
              value={fontFamily}
              onChange={(e) => applySelectionFontFamily(e.target.value)}
              className="siscom-input !w-[144px] !min-h-[40px] !px-2.5 text-xs shrink-0"
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
              className="siscom-input !w-[76px] !min-h-[40px] !px-2 font-mono text-xs shrink-0"
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
              onChange={(e) => {
                const nextLh = sanitizeCssLineHeight(e.target.value, '1.22');
                setLineHeight(nextLh);
                scheduleLiveReflow(activePageIndex, true, { lineHeight: nextLh });
              }}
              className="siscom-input !w-[72px] !min-h-[40px] !px-2 font-mono text-xs shrink-0"
            >
              <option value="1.05">1.0</option>
              <option value="1.22">1.15</option>
              <option value="1.35">1.3</option>
              <option value="1.5">1.5</option>
            </select>
          </TabletRibbonGroup>

          <TabletRibbonDivider />

          <TabletRibbonGroup>
            <TabletRibbonIconButton
              title="Negrito"
              aria-label="Negrito"
              onMouseDown={(e) => {
                e.preventDefault();
                runFormatCommand('bold');
              }}
            >
              <Bold className="w-4 h-4" />
            </TabletRibbonIconButton>
            <TabletRibbonIconButton
              title="Itálico"
              aria-label="Itálico"
              onMouseDown={(e) => {
                e.preventDefault();
                runFormatCommand('italic');
              }}
            >
              <Italic className="w-4 h-4" />
            </TabletRibbonIconButton>
            <TabletRibbonIconButton
              title="Sublinhado"
              aria-label="Sublinhado"
              onMouseDown={(e) => {
                e.preventDefault();
                runFormatCommand('underline');
              }}
            >
              <Underline className="w-4 h-4" />
            </TabletRibbonIconButton>
            <TabletRibbonIconButton
              title="Tachado"
              aria-label="Tachado"
              onMouseDown={(e) => {
                e.preventDefault();
                runFormatCommand('strikeThrough');
              }}
            >
              <Strikethrough className="w-4 h-4" />
            </TabletRibbonIconButton>
            <TabletRibbonIconButton
              title="Limpar formatação"
              aria-label="Limpar formatação"
              onMouseDown={(e) => {
                e.preventDefault();
                runFormatCommand('removeFormat');
              }}
            >
              <Eraser className="w-4 h-4" />
            </TabletRibbonIconButton>

            <label
              title="Cor do texto"
              className="h-10 px-2.5 inline-flex items-center gap-1.5 rounded-xl border border-white/[0.12] bg-white/[0.06] cursor-pointer shrink-0"
            >
              <span className="text-xs font-bold border-b-2 leading-none" style={{ borderColor: textColor }}>
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
              title="Realce"
              className="h-10 px-2.5 inline-flex items-center gap-1.5 rounded-xl border border-white/[0.12] bg-white/[0.06] cursor-pointer shrink-0"
            >
              <Highlighter className="w-3.5 h-3.5 text-[#E5C17B]" />
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
          </TabletRibbonGroup>

          <TabletRibbonDivider />

          <TabletRibbonGroup>
            <TabletRibbonIconButton
              title="Alinhar à esquerda"
              aria-label="Alinhar à esquerda"
              onMouseDown={(e) => {
                e.preventDefault();
                runFormatCommand('justifyLeft');
              }}
            >
              <AlignLeft className="w-4 h-4" />
            </TabletRibbonIconButton>
            <TabletRibbonIconButton
              title="Centralizar"
              aria-label="Centralizar"
              onMouseDown={(e) => {
                e.preventDefault();
                runFormatCommand('justifyCenter');
              }}
            >
              <AlignCenter className="w-4 h-4" />
            </TabletRibbonIconButton>
            <TabletRibbonIconButton
              title="Alinhar à direita"
              aria-label="Alinhar à direita"
              onMouseDown={(e) => {
                e.preventDefault();
                runFormatCommand('justifyRight');
              }}
            >
              <AlignRight className="w-4 h-4" />
            </TabletRibbonIconButton>
            <TabletRibbonIconButton
              title="Justificar"
              aria-label="Justificar"
              onMouseDown={(e) => {
                e.preventDefault();
                runFormatCommand('justifyFull');
              }}
            >
              <AlignJustify className="w-4 h-4" />
            </TabletRibbonIconButton>
            <TabletRibbonIconButton
              title="Lista com marcadores"
              aria-label="Lista com marcadores"
              onMouseDown={(e) => {
                e.preventDefault();
                runFormatCommand('insertUnorderedList');
              }}
            >
              <List className="w-4 h-4" />
            </TabletRibbonIconButton>
            <TabletRibbonIconButton
              title="Lista numerada"
              aria-label="Lista numerada"
              onMouseDown={(e) => {
                e.preventDefault();
                runFormatCommand('insertOrderedList');
              }}
            >
              <ListOrdered className="w-4 h-4" />
            </TabletRibbonIconButton>
            <TabletRibbonIconButton
              title="Diminuir recuo"
              aria-label="Diminuir recuo"
              onMouseDown={(e) => {
                e.preventDefault();
                runFormatCommand('outdent');
              }}
            >
              <Outdent className="w-4 h-4" />
            </TabletRibbonIconButton>
            <TabletRibbonIconButton
              title="Aumentar recuo"
              aria-label="Aumentar recuo"
              onMouseDown={(e) => {
                e.preventDefault();
                runFormatCommand('indent');
              }}
            >
              <Indent className="w-4 h-4" />
            </TabletRibbonIconButton>
          </TabletRibbonGroup>

          <TabletRibbonDivider />

          <TabletRibbonGroup>
            <TabletRibbonButton
              icon={<Search className="w-3.5 h-3.5" />}
              chevron
              open={tabletPanel === 'localizar'}
              onClick={() => setTabletPanel((p) => (p === 'localizar' ? null : 'localizar'))}
            >
              Localizar
            </TabletRibbonButton>

            <select
              aria-label="Zoom da folha"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="siscom-input !w-[98px] !min-h-[40px] !px-2 font-mono text-xs shrink-0"
            >
              <option value={75}>Zoom 75%</option>
              <option value={90}>Zoom 90%</option>
              <option value={100}>Zoom 100%</option>
            </select>

            <TabletRibbonButton
              variant="gold"
              icon={<Calculator className="w-3.5 h-3.5" />}
              badge={serviceTime ? serviceTime.formatted : undefined}
              chevron
              open={tabletPanel === 'tempo'}
              onClick={() => setTabletPanel((p) => (p === 'tempo' ? null : 'tempo'))}
            >
              Tempo
            </TabletRibbonButton>
          </TabletRibbonGroup>
        </TabletRibbonRow>
      }
      tabletDrawer={
        tabletPanel === 'arquivo'
          ? {
              position: 'top',
              title: 'Arquivo da Conta',
              onClose: () => setTabletPanel(null),
              content: (
                <AlteracaoArchivePanel
                  activeDocId={activeArchivedDoc.id}
                  activeDocTitle={activeArchivedDoc.title}
                  activeDocFolderId={activeArchivedDoc.folderId}
                  suggestedTitle={suggestedArchiveTitle}
                  getCurrentSnapshot={getArchiveSnapshot}
                  onOpenArchivedDoc={(rec) => {
                    handleOpenArchivedDoc(rec);
                    setTabletPanel(null);
                  }}
                  onActiveDocChange={setActiveArchivedDoc}
                  onBatchUpdatedDocs={handleBatchUpdatedDocs}
                  onNotify={setNotice}
                />
              ),
            }
          : tabletPanel === 'militar'
            ? {
                position: 'top',
                title: 'Dados do Militar',
                onClose: () => setTabletPanel(null),
                content: (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="block text-[11px] font-medium text-[#E5C17B]">Nome de guerra</label>
                      <input
                        type="text"
                        value={header.nomeGuerra}
                        onChange={(e) => updateHeaderField('nomeGuerra', e.target.value)}
                        placeholder="Ex.: CARDOSO"
                        className="siscom-input !min-h-[40px] px-3 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[11px] font-medium text-[#E5C17B]">QAS / QMS</label>
                      <input
                        type="text"
                        value={header.qasQms}
                        onChange={(e) => updateHeaderField('qasQms', e.target.value)}
                        placeholder="Ex.: Infantaria"
                        className="siscom-input !min-h-[40px] px-3 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[11px] text-[#98A89F]">Posto / Grad.</label>
                      <input
                        type="text"
                        value={header.postoGraduacao}
                        onChange={(e) => updateHeaderField('postoGraduacao', e.target.value)}
                        className="siscom-input !min-h-[40px] px-3 text-xs"
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <label className="block text-[11px] text-[#98A89F]">Nome completo</label>
                      <input
                        type="text"
                        value={header.nomeCompleto}
                        onChange={(e) => updateHeaderField('nomeCompleto', e.target.value)}
                        className="siscom-input !min-h-[40px] px-3 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[11px] text-[#98A89F]">Identidade</label>
                      <input
                        type="text"
                        value={header.identidade}
                        onChange={(e) => updateHeaderField('identidade', e.target.value)}
                        className="siscom-input !min-h-[40px] px-3 font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[11px] text-[#98A89F]">Semestre</label>
                      <input
                        type="text"
                        value={header.semestre}
                        onChange={(e) => updateHeaderField('semestre', e.target.value)}
                        className="siscom-input !min-h-[40px] px-3 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[11px] text-[#98A89F]">Período</label>
                      <input
                        type="text"
                        value={header.periodo}
                        onChange={(e) => updateHeaderField('periodo', e.target.value)}
                        className="siscom-input !min-h-[40px] px-3 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[11px] text-[#98A89F]">Folha inicial</label>
                      <input
                        type="number"
                        min={1}
                        max={999}
                        value={header.folhaInicial}
                        onChange={(e) =>
                          updateHeaderField('folhaInicial', Math.max(1, Number(e.target.value) || 1))
                        }
                        className="siscom-input !min-h-[40px] px-3 font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[11px] text-[#98A89F]">Tratamento</label>
                      <select
                        value={header.generoCont}
                        onChange={(e) =>
                          updateHeaderField('generoCont', e.target.value as 'auto' | 'do' | 'da')
                        }
                        className="siscom-input !min-h-[40px] px-2.5 text-xs"
                      >
                        <option value="auto">Auto ({continuacaoArticle})</option>
                        <option value="do">do (Masculino)</option>
                        <option value="da">da (Feminino)</option>
                      </select>
                    </div>
                  </div>
                ),
              }
            : tabletPanel === 'cabecalho'
              ? {
                  position: 'top',
                  title: 'Cabeçalho da OM',
                  onClose: () => setTabletPanel(null),
                  content: (
                    <div className="grid grid-cols-2 gap-2.5">
                      <input
                        type="text"
                        aria-label="Ministério"
                        value={header.ministerio}
                        onChange={(e) => updateHeaderField('ministerio', e.target.value)}
                        placeholder="MINISTÉRIO DA DEFESA"
                        className="siscom-input !min-h-[38px] px-3 text-xs"
                      />
                      <input
                        type="text"
                        aria-label="Força"
                        value={header.forca}
                        onChange={(e) => updateHeaderField('forca', e.target.value)}
                        placeholder="EXÉRCITO BRASILEIRO"
                        className="siscom-input !min-h-[38px] px-3 text-xs"
                      />
                      <input
                        type="text"
                        aria-label="Comando e DE"
                        value={header.comandoDivisao}
                        onChange={(e) => updateHeaderField('comandoDivisao', e.target.value)}
                        placeholder="CML - 1ª DE"
                        className="siscom-input !min-h-[38px] px-3 text-xs"
                      />
                      <input
                        type="text"
                        aria-label="Grande Unidade"
                        value={header.grandeUnidade}
                        onChange={(e) => updateHeaderField('grandeUnidade', e.target.value)}
                        placeholder="GUEs - 9ª Bda Inf Mtz"
                        className="siscom-input !min-h-[38px] px-3 text-xs"
                      />
                      <input
                        type="text"
                        aria-label="OM e Codom"
                        value={header.omCodom}
                        onChange={(e) => updateHeaderField('omCodom', e.target.value)}
                        placeholder="1º BI Mec (Es) - 008326"
                        className="siscom-input !min-h-[38px] px-3 text-xs"
                      />
                      <input
                        type="text"
                        aria-label="OM por extenso"
                        value={header.omExtenso}
                        onChange={(e) => updateHeaderField('omExtenso', e.target.value)}
                        placeholder="1º BATALHÃO DE INFANTARIA MECANIZADO (ESCOLA)"
                        className="siscom-input !min-h-[38px] px-3 text-xs"
                      />
                      <input
                        type="text"
                        aria-label="Título do documento"
                        value={header.tituloDocumento}
                        onChange={(e) => updateHeaderField('tituloDocumento', e.target.value)}
                        placeholder="FOLHAS DE ALTERAÇÕES"
                        className="siscom-input !min-h-[38px] px-3 text-xs"
                      />
                      <input
                        type="text"
                        aria-label="Guarnição"
                        value={header.guarnicao}
                        onChange={(e) => updateHeaderField('guarnicao', e.target.value)}
                        placeholder="GUARNIÇÃO DA VILA MILITAR - RJ"
                        className="siscom-input !min-h-[38px] px-3 text-xs"
                      />
                    </div>
                  ),
                }
              : tabletPanel === 'topicos' && groupedChecklist.length > 0
                ? {
                    position: 'top',
                    title: `Tópicos e Tabelas (${enabledItemIds.length}/${structuredDoc?.items.length ?? 0})`,
                    onClose: () => setTabletPanel(null),
                    headerActions: (
                      <div className="flex items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() =>
                            applyChecklistSelection(structuredDoc?.items.map((i) => i.id) ?? [])
                          }
                          className="text-[#E5C17B] hover:underline cursor-pointer"
                        >
                          Todos
                        </button>
                        <span className="text-white/20">·</span>
                        <button
                          type="button"
                          onClick={() => applyChecklistSelection([])}
                          className="text-[#98A89F] hover:text-white hover:underline cursor-pointer"
                        >
                          Nenhum
                        </button>
                      </div>
                    ),
                    content: (
                      <div className="grid grid-cols-2 gap-2.5">
                        {groupedChecklist.map((group) => {
                          const allGroupChecked = group.items.every((i) => enabledItemIdSet.has(i.id));
                          const someGroupChecked = group.items.some((i) => enabledItemIdSet.has(i.id));
                          return (
                            <div
                              key={group.key}
                              className="siscom-liquid-subcard rounded-lg p-2.5 space-y-1.5"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleScrollToChecklistTarget({
                                      kind: 'group',
                                      groupKey: group.key,
                                      month: group.month,
                                      title: group.title,
                                    });
                                    setTabletPanel(null);
                                  }}
                                  className="min-w-0 flex-1 text-left cursor-pointer"
                                >
                                  <span className="inline-block text-[10px] font-mono text-[#E5C17B] mr-1.5">
                                    {group.month.slice(0, 3)}
                                  </span>
                                  <span className="text-xs font-semibold text-[#E8EEEA]">
                                    {group.title}
                                  </span>
                                </button>
                                <input
                                  type="checkbox"
                                  ref={(el) => {
                                    if (el) {
                                      el.indeterminate = someGroupChecked && !allGroupChecked;
                                    }
                                  }}
                                  checked={allGroupChecked}
                                  onChange={() => handleToggleChecklistGroup(group.items)}
                                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#C8A461] cursor-pointer"
                                />
                              </div>
                              <div className="space-y-1 pl-2 border-l border-white/[0.08]">
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
                                        onClick={() => {
                                          handleScrollToChecklistTarget({ kind: 'item', item });
                                          setTabletPanel(null);
                                        }}
                                        className="min-w-0 flex-1 text-left truncate hover:text-[#E5C17B] cursor-pointer"
                                      >
                                        {itemLabel}
                                      </button>
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => handleToggleChecklistItem(item.id)}
                                        className="h-4 w-4 shrink-0 accent-[#2D5A43] cursor-pointer"
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ),
                  }
                : tabletPanel === 'localizar'
                  ? {
                      position: 'bottom',
                      title: 'Localizar e Substituir',
                      onClose: () => setTabletPanel(null),
                      content: (
                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2.5 items-center">
                          <input
                            type="text"
                            value={findQuery}
                            onChange={(e) => setFindQuery(e.target.value)}
                            placeholder="Localizar texto..."
                            className="siscom-input !min-h-[40px] px-3 text-xs"
                          />
                          <input
                            type="text"
                            value={replaceQuery}
                            onChange={(e) => setReplaceQuery(e.target.value)}
                            placeholder="Substituir por..."
                            className="siscom-input !min-h-[40px] px-3 text-xs"
                          />
                          <button
                            type="button"
                            onClick={handleReplaceAll}
                            className="siscom-btn siscom-btn-primary !min-h-[40px] px-4 text-xs"
                          >
                            <Replace className="w-3.5 h-3.5" />
                            <span>Substituir tudo</span>
                          </button>
                        </div>
                      ),
                    }
                  : tabletPanel === 'tempo'
                    ? {
                        position: 'bottom',
                        title: `Tempo de Serviço · ${serviceTime ? serviceTime.formatted : '00 a 00 m 00 d'}`,
                        onClose: () => setTabletPanel(null),
                        content: (
                          <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                            <label className="block space-y-1">
                              <span className="block text-[11px] text-[#B8B3A6]">Data de praça</span>
                              <input
                                type="date"
                                value={dataPraca}
                                onChange={(e) => handleDateCalculatorChange('praca', e.target.value)}
                                className="siscom-input !min-h-[40px] px-2.5 text-xs"
                              />
                            </label>
                            <label className="block space-y-1">
                              <span className="block text-[11px] text-[#B8B3A6]">Data final</span>
                              <input
                                type="date"
                                value={dataFinal}
                                onChange={(e) => handleDateCalculatorChange('final', e.target.value)}
                                className="siscom-input !min-h-[40px] px-2.5 text-xs"
                              />
                            </label>
                            <button
                              type="button"
                              disabled={!serviceTime}
                              onClick={() => {
                                applyServiceTimeToDocument(
                                  dataPraca,
                                  dataFinal,
                                  true,
                                  updateClosingDateWithCalc
                                );
                                setTabletPanel(null);
                              }}
                              className="siscom-btn siscom-btn-gold !min-h-[40px] px-4 text-xs col-span-2 sm:col-span-1"
                            >
                              Aplicar na 2ª Parte
                            </button>
                            <label className="col-span-2 sm:col-span-3 flex items-center gap-2 text-xs text-[#B8C6BE] cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={updateClosingDateWithCalc}
                                onChange={(e) => setUpdateClosingDateWithCalc(e.target.checked)}
                                className="h-4 w-4 accent-[#C8A461] cursor-pointer"
                              />
                              <span>Atualizar também a data do fecho</span>
                            </label>
                          </div>
                        ),
                      }
                    : null
      }
      sidebar={
        <div className="metal-surface lg:bg-transparent lg:border-0 lg:shadow-none rounded-xl lg:rounded-none p-4 sm:p-5 lg:p-1 space-y-5">
        {/* Top Primary PDF Upload Dropzone */}
        <div className="space-y-3 pb-4 border-b border-white/[0.07]">

          <button
            type="button"
            disabled={isImporting}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDropAlteracao}
            className="w-full rounded-xl border border-dashed border-[#C8A461]/45 bg-[#121C16]/55 hover:bg-[#1A2820]/65 backdrop-blur-md hover:border-[#C8A461]/75 px-4 py-4 flex flex-col items-center justify-center gap-1.5 text-center transition-all duration-180 active:scale-[0.99] disabled:opacity-55 cursor-pointer"
          >
            {isImporting ? (
              <SiscomSpinner tone="gold" className="w-5 h-5" />
            ) : (
              <Upload className="w-5 h-5 text-[#E5C17B]" />
            )}
            <span className="text-xs font-semibold text-[#F4E6C4]">
              {isImporting ? 'Lendo documento...' : 'Importar Alteração'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleResetModel}
            title="Nova folha em branco no padrão"
            className="siscom-btn siscom-btn-secondary w-full min-h-[40px] px-3 text-xs"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#83B499]" />
            <span>Nova Folha Padrão</span>
          </button>

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
        </div>

        {/* Arquivo na Conta (Pastas, Subpastas e Alterações Editáveis) */}
        <AlteracaoArchivePanel
          activeDocId={activeArchivedDoc.id}
          activeDocTitle={activeArchivedDoc.title}
          activeDocFolderId={activeArchivedDoc.folderId}
          suggestedTitle={suggestedArchiveTitle}
          getCurrentSnapshot={getArchiveSnapshot}
          onOpenArchivedDoc={handleOpenArchivedDoc}
          onActiveDocChange={setActiveArchivedDoc}
          onBatchUpdatedDocs={handleBatchUpdatedDocs}
          onNotify={setNotice}
        />

        <div className="flex items-center justify-between gap-2">
          <span className="siscom-field-label">Dados do Militar</span>
        </div>

        {/* Dados do Militar: Nome de guerra & QAS/QMS sempre abertos; demais campos compactos */}
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <label htmlFor="alt-guerra" className="block text-[11px] font-medium text-[#E5C17B]">
                Nome de guerra
              </label>
              <input
                id="alt-guerra"
                type="text"
                value={header.nomeGuerra}
                onChange={(e) => updateHeaderField('nomeGuerra', e.target.value)}
                placeholder="Ex.: CARDOSO"
                className="siscom-input w-full min-h-[40px] px-3 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="alt-qas" className="block text-[11px] font-medium text-[#E5C17B]">
                QAS / QMS
              </label>
              <input
                id="alt-qas"
                type="text"
                value={header.qasQms}
                onChange={(e) => updateHeaderField('qasQms', e.target.value)}
                placeholder="Ex.: Infantaria"
                className="siscom-input w-full min-h-[40px] px-3 text-xs"
              />
            </div>
          </div>

          <details className="rounded-lg border border-white/[0.08] bg-[#0B130F]/55 group/militar">
            <summary className="cursor-pointer px-3 py-2 flex items-center justify-between gap-2 select-none list-none hover:bg-white/[0.03] rounded-lg transition-colors">
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="text-[11px] font-medium text-[#DCE5DF] truncate">
                  {[header.postoGraduacao, header.nomeCompleto].filter(Boolean).join(' · ') ||
                    'Mais dados'}
                </div>
                <div className="text-[10px] text-[#8EA196] truncate">
                  {[
                    header.identidade ? `Idt ${header.identidade}` : '',
                    header.semestre || header.periodo,
                    `Fl. ${String(header.folhaInicial).padStart(2, '0')}`,
                  ]
                    .filter(Boolean)
                    .join(' • ')}
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-[10px] text-[#98A89F] shrink-0 group-open/militar:text-[#E5C17B]">
                <span>Editar</span>
                <ChevronDown className="w-3.5 h-3.5 transition-transform group-open/militar:rotate-180" />
              </span>
            </summary>

            <div className="px-3 pb-3 pt-2 border-t border-white/[0.07] grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="sm:col-span-2 space-y-1">
                <label htmlFor="alt-nome" className="block text-[11px] text-[#98A89F]">
                  Nome completo
                </label>
                <input
                  id="alt-nome"
                  type="text"
                  value={header.nomeCompleto}
                  onChange={(e) => updateHeaderField('nomeCompleto', e.target.value)}
                  className="siscom-input w-full min-h-[38px] px-3 text-xs"
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
                  className="siscom-input w-full min-h-[38px] px-3 text-xs"
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
                  className="siscom-input w-full min-h-[38px] px-3 font-mono text-xs"
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
                  className="siscom-input w-full min-h-[38px] px-3 text-xs"
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
                  className="siscom-input w-full min-h-[38px] px-3 font-mono text-xs"
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
                  className="siscom-input w-full min-h-[38px] px-3 text-xs"
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
                  className="siscom-input w-full min-h-[38px] px-2.5 text-xs"
                >
                  <option value="auto">Auto ({continuacaoArticle})</option>
                  <option value="do">do (Masculino)</option>
                  <option value="da">da (Feminino)</option>
                </select>
              </div>
            </div>
          </details>
        </div>

        {/* Cabeçalho da OM */}
        <details className="pt-4 border-t border-white/[0.07] group">
          <summary className="cursor-pointer py-1 text-xs font-medium text-[#C6D4CC] hover:text-white select-none transition-colors">
            Cabeçalho da OM
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-2">
            <input
              type="text"
              aria-label="Ministério"
              value={header.ministerio}
              onChange={(e) => updateHeaderField('ministerio', e.target.value)}
              placeholder="MINISTÉRIO DA DEFESA"
              className="siscom-input w-full min-h-[38px] px-3 text-xs"
            />
            <input
              type="text"
              aria-label="Força"
              value={header.forca}
              onChange={(e) => updateHeaderField('forca', e.target.value)}
              placeholder="EXÉRCITO BRASILEIRO"
              className="siscom-input w-full min-h-[38px] px-3 text-xs"
            />
            <input
              type="text"
              aria-label="Comando e DE"
              value={header.comandoDivisao}
              onChange={(e) => updateHeaderField('comandoDivisao', e.target.value)}
              placeholder="CML - 1ª DE"
              className="siscom-input w-full min-h-[38px] px-3 text-xs"
            />
            <input
              type="text"
              aria-label="Grande Unidade"
              value={header.grandeUnidade}
              onChange={(e) => updateHeaderField('grandeUnidade', e.target.value)}
              placeholder="GUEs - 9ª Bda Inf Mtz"
              className="siscom-input w-full min-h-[38px] px-3 text-xs"
            />
            <input
              type="text"
              aria-label="OM e Codom"
              value={header.omCodom}
              onChange={(e) => updateHeaderField('omCodom', e.target.value)}
              placeholder="1º BI Mec (Es) - 008326"
              className="siscom-input w-full min-h-[38px] px-3 text-xs"
            />
            <input
              type="text"
              aria-label="OM por extenso (Folhas de continuação)"
              value={header.omExtenso}
              onChange={(e) => updateHeaderField('omExtenso', e.target.value)}
              placeholder="1º BATALHÃO DE INFANTARIA MECANIZADO (ESCOLA)"
              className="siscom-input w-full min-h-[38px] px-3 text-xs"
            />
            <input
              type="text"
              aria-label="Título do documento"
              value={header.tituloDocumento}
              onChange={(e) => updateHeaderField('tituloDocumento', e.target.value)}
              placeholder="FOLHAS DE ALTERAÇÕES"
              className="siscom-input w-full min-h-[38px] px-3 text-xs"
            />
            <input
              type="text"
              aria-label="Guarnição"
              value={header.guarnicao}
              onChange={(e) => updateHeaderField('guarnicao', e.target.value)}
              placeholder="GUARNIÇÃO DA VILA MILITAR - RJ"
              className="siscom-input w-full min-h-[38px] px-3 text-xs"
            />
          </div>
        </details>

        {/* Títulos, Subtítulos e Tabelas (Filtro interativo) */}
        {groupedChecklist.length > 0 && (
          <div className="pt-4 border-t border-white/[0.07] space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="siscom-field-label">
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

            <div className="space-y-2">
              {groupedChecklist.map((group) => {
                const allGroupChecked = group.items.every((i) => enabledItemIdSet.has(i.id));
                const someGroupChecked = group.items.some((i) => enabledItemIdSet.has(i.id));
                return (
                  <div
                    key={group.key}
                    className="siscom-liquid-subcard rounded-lg p-2.5 space-y-1.5"
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
                        className="min-w-0 flex-1 text-left cursor-pointer group/topic py-0.5"
                      >
                        <span className="inline-block text-[10px] font-mono text-[#E5C17B] mr-1.5">
                          {group.month.slice(0, 3)}
                        </span>
                        <span className="text-[11px] font-semibold text-[#E8EEEA] group-hover/topic:text-[#E5C17B] transition-colors break-words">
                          {group.title}
                        </span>
                      </button>
                      <input
                        type="checkbox"
                        ref={(el) => {
                          if (el) {
                            el.indeterminate = someGroupChecked && !allGroupChecked;
                          }
                        }}
                        checked={allGroupChecked}
                        onChange={() => handleToggleChecklistGroup(group.items)}
                        aria-label={`Incluir tópico ${group.title}`}
                        className="mt-1 h-4 w-4 shrink-0 accent-[#C8A461] cursor-pointer"
                      />
                    </div>

                    <div className="space-y-1 pl-2 border-l border-white/[0.08]">
                      {group.items.map((item) => {
                        const isChecked = enabledItemIdSet.has(item.id);
                        const itemLabel =
                          item.kind === 'table'
                            ? item.previewLabel
                            : item.subtitle || item.previewLabel;
                        return (
                          <div
                            key={item.id}
                            className="flex items-center justify-between gap-2 py-1 text-[11px] text-[#98A89F]"
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
                              className="h-4 w-4 shrink-0 accent-[#2D5A43] cursor-pointer"
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
        <div className="pt-4 border-t border-white/[0.07] space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={handleAddPage}
              className="siscom-btn siscom-btn-secondary min-h-[40px] px-3 text-xs"
            >
              <FilePlus2 className="w-3.5 h-3.5 text-[#83B499]" />
              <span>+ Folha Nº {String(header.folhaInicial + pagesHtml.length).padStart(2, '0')}</span>
            </button>

            <button
              type="button"
              onClick={handleClearBody}
              className="siscom-btn siscom-btn-secondary min-h-[40px] px-3 text-xs"
            >
              <Trash2 className="w-3.5 h-3.5 text-[#98A89F]" />
              <span>Limpar</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => window.print()}
              className="siscom-btn siscom-btn-primary min-h-[42px] px-3 text-xs"
            >
              <Printer className="w-4 h-4" />
              <span>Imprimir / PDF</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadWordDoc}
              className="siscom-btn siscom-btn-secondary min-h-[42px] px-3 text-xs"
            >
              <FileText className="w-4 h-4 text-[#83B499]" />
              <span>Word (.doc)</span>
            </button>
          </div>
        </div>
        </div>
      }
      rightSidebar={
        <div className="metal-surface lg:bg-transparent lg:border-0 lg:shadow-none rounded-xl lg:rounded-none p-4 sm:p-5 lg:p-1 space-y-4">
          {/* Header + Undo/Redo */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="siscom-field-label">Texto e Estilo</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title="Desfazer (Ctrl+Z)"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    runFormatCommand('undo');
                  }}
                  className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#0A110E]/45 hover:bg-white/[0.1] active:scale-[0.94] text-[#C6D4CC] transition-all cursor-pointer"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  title="Refazer (Ctrl+Y)"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    runFormatCommand('redo');
                  }}
                  className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#0A110E]/45 hover:bg-white/[0.1] active:scale-[0.94] text-[#C6D4CC] transition-all cursor-pointer"
                >
                  <Redo2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Font Family */}
            <div className="space-y-1">
              <label className="block text-[11px] text-[#B8B3A6]">Fonte</label>
              <select
                aria-label="Fonte do texto"
                value={fontFamily}
                onChange={(e) => applySelectionFontFamily(e.target.value)}
                className="siscom-input !min-h-[38px] !px-2.5 text-xs"
              >
                <option value="Times New Roman">Times New Roman</option>
                <option value="Georgia">Georgia</option>
                <option value="Arial">Arial</option>
                <option value="Open Sans">Open Sans</option>
              </select>
            </div>

            {/* Size & Line Height */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="block text-[11px] text-[#B8B3A6]">Tamanho</label>
                <select
                  aria-label="Tamanho da fonte"
                  value={fontSizePt}
                  onChange={(e) => applySelectionFontSize(e.target.value)}
                  className="siscom-input !min-h-[38px] !px-2 font-mono text-xs"
                >
                  <option value="9pt">9 pt</option>
                  <option value="10pt">10 pt</option>
                  <option value="10.5pt">10.5 pt</option>
                  <option value="11pt">11 pt</option>
                  <option value="12pt">12 pt</option>
                  <option value="14pt">14 pt</option>
                  <option value="16pt">16 pt</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] text-[#B8B3A6]">Entrelinhas</label>
                <select
                  aria-label="Espaçamento entre linhas"
                  value={lineHeight}
                  onChange={(e) => {
                    const nextLh = sanitizeCssLineHeight(e.target.value, '1.22');
                    setLineHeight(nextLh);
                    scheduleLiveReflow(activePageIndex, true, { lineHeight: nextLh });
                  }}
                  title="Espaçamento entre linhas"
                  className="siscom-input !min-h-[38px] !px-2 font-mono text-xs"
                >
                  <option value="1.05">1.0</option>
                  <option value="1.22">1.15</option>
                  <option value="1.35">1.3</option>
                  <option value="1.5">1.5</option>
                </select>
              </div>
            </div>
          </div>

          {/* Bold / Italic / Underline / Strike / Clear */}
          <div className="space-y-2 pt-3 border-t border-white/[0.08]">
            <span className="siscom-field-label">Formatação</span>
            <div className="grid grid-cols-5 gap-1.5">
              <button
                type="button"
                title="Negrito (Ctrl+B)"
                onMouseDown={(e) => {
                  e.preventDefault();
                  runFormatCommand('bold');
                }}
                className="h-9 inline-flex items-center justify-center rounded-lg border border-white/12 bg-[#0A110E]/48 hover:bg-white/[0.1] hover:border-[#C9A961]/45 active:scale-[0.95] text-[#E8EEEA] transition-all cursor-pointer"
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
                className="h-9 inline-flex items-center justify-center rounded-lg border border-white/12 bg-[#0A110E]/48 hover:bg-white/[0.1] hover:border-[#C9A961]/45 active:scale-[0.95] text-[#E8EEEA] transition-all cursor-pointer"
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
                className="h-9 inline-flex items-center justify-center rounded-lg border border-white/12 bg-[#0A110E]/48 hover:bg-white/[0.1] hover:border-[#C9A961]/45 active:scale-[0.95] text-[#E8EEEA] transition-all cursor-pointer"
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
                className="h-9 inline-flex items-center justify-center rounded-lg border border-white/12 bg-[#0A110E]/48 hover:bg-white/[0.1] hover:border-[#C9A961]/45 active:scale-[0.95] text-[#E8EEEA] transition-all cursor-pointer"
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
                className="h-9 inline-flex items-center justify-center rounded-lg border border-white/12 bg-[#0A110E]/48 hover:bg-white/[0.1] hover:border-white/25 active:scale-[0.95] text-[#B8B3A6] transition-all cursor-pointer"
              >
                <Eraser className="w-4 h-4" />
              </button>
            </div>

            {/* Colors */}
            <div className="grid grid-cols-2 gap-1.5">
              <label
                title="Cor do texto"
                className="siscom-liquid-subcard h-9 px-2.5 inline-flex items-center justify-between gap-1.5 rounded-lg hover:border-white/25 cursor-pointer transition-colors"
              >
                <span className="inline-flex items-center gap-1.5 text-[11px] text-[#E8EEEA]">
                  <span className="font-bold border-b-2 leading-none" style={{ borderColor: textColor }}>
                    A
                  </span>
                  <span>Cor</span>
                </span>
                <input
                  type="color"
                  aria-label="Cor do texto"
                  value={textColor}
                  onChange={(e) => {
                    setTextColor(e.target.value);
                    runFormatCommand('foreColor', e.target.value);
                  }}
                  className="w-5 h-5 bg-transparent border-0 cursor-pointer p-0"
                />
              </label>

              <label
                title="Realce / Marca-texto"
                className="siscom-liquid-subcard h-9 px-2.5 inline-flex items-center justify-between gap-1.5 rounded-lg hover:border-white/25 cursor-pointer transition-colors"
              >
                <span className="inline-flex items-center gap-1.5 text-[11px] text-[#E8EEEA]">
                  <Highlighter className="w-3.5 h-3.5 text-[#E5C17B]" />
                  <span>Realce</span>
                </span>
                <input
                  type="color"
                  aria-label="Cor de realce"
                  value={highlightColor}
                  onChange={(e) => {
                    setHighlightColor(e.target.value);
                    runFormatCommand('hiliteColor', e.target.value);
                  }}
                  className="w-5 h-5 bg-transparent border-0 cursor-pointer p-0"
                />
              </label>
            </div>
          </div>

          {/* Alignment & Lists */}
          <div className="space-y-2 pt-3 border-t border-white/[0.08]">
            <span className="siscom-field-label">Parágrafo e Listas</span>
            <div className="grid grid-cols-4 gap-1.5">
              <button
                type="button"
                title="Alinhar à esquerda"
                onMouseDown={(e) => {
                  e.preventDefault();
                  runFormatCommand('justifyLeft');
                }}
                className="h-9 inline-flex items-center justify-center rounded-lg border border-white/12 bg-[#0A110E]/48 hover:bg-white/[0.1] active:scale-[0.95] text-[#C6D4CC] transition-all cursor-pointer"
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
                className="h-9 inline-flex items-center justify-center rounded-lg border border-white/12 bg-[#0A110E]/48 hover:bg-white/[0.1] active:scale-[0.95] text-[#C6D4CC] transition-all cursor-pointer"
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
                className="h-9 inline-flex items-center justify-center rounded-lg border border-white/12 bg-[#0A110E]/48 hover:bg-white/[0.1] active:scale-[0.95] text-[#C6D4CC] transition-all cursor-pointer"
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
                className="h-9 inline-flex items-center justify-center rounded-lg border border-white/12 bg-[#0A110E]/48 hover:bg-white/[0.1] active:scale-[0.95] text-[#C6D4CC] transition-all cursor-pointer"
              >
                <AlignJustify className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              <button
                type="button"
                title="Lista com marcadores"
                onMouseDown={(e) => {
                  e.preventDefault();
                  runFormatCommand('insertUnorderedList');
                }}
                className="h-9 inline-flex items-center justify-center rounded-lg border border-white/12 bg-[#0A110E]/48 hover:bg-white/[0.1] active:scale-[0.95] text-[#C6D4CC] transition-all cursor-pointer"
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
                className="h-9 inline-flex items-center justify-center rounded-lg border border-white/12 bg-[#0A110E]/48 hover:bg-white/[0.1] active:scale-[0.95] text-[#C6D4CC] transition-all cursor-pointer"
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
                className="h-9 inline-flex items-center justify-center rounded-lg border border-white/12 bg-[#0A110E]/48 hover:bg-white/[0.1] active:scale-[0.95] text-[#C6D4CC] transition-all cursor-pointer"
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
                className="h-9 inline-flex items-center justify-center rounded-lg border border-white/12 bg-[#0A110E]/48 hover:bg-white/[0.1] active:scale-[0.95] text-[#C6D4CC] transition-all cursor-pointer"
              >
                <Indent className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Localizar & Zoom */}
          <div className="space-y-2.5 pt-3 border-t border-white/[0.08]">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setShowFindReplace((v) => !v)}
                className={`siscom-btn !min-h-[38px] !px-2.5 text-xs ${
                  showFindReplace
                    ? 'siscom-btn-primary'
                    : 'siscom-btn-secondary text-[#C6D4CC]'
                }`}
              >
                <Search className="w-3.5 h-3.5" />
                <span>Localizar</span>
              </button>

              <select
                aria-label="Zoom da folha"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="siscom-input !min-h-[38px] !px-2.5 font-mono text-xs"
              >
                <option value={75}>Zoom 75%</option>
                <option value={90}>Zoom 90%</option>
                <option value={100}>Zoom 100%</option>
              </select>
            </div>

            <AnimatePresence>
              {showFindReplace && (
                <motion.div
                  key="alt-find-replace"
                  variants={fadeSlideVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={UI_TRANSITION}
                  className="siscom-liquid-subcard rounded-lg p-2.5 space-y-2"
                >
                  <input
                    type="text"
                    value={findQuery}
                    onChange={(e) => setFindQuery(e.target.value)}
                    placeholder="Localizar texto..."
                    className="siscom-input !min-h-[36px] !px-2.5 text-xs"
                  />
                  <input
                    type="text"
                    value={replaceQuery}
                    onChange={(e) => setReplaceQuery(e.target.value)}
                    placeholder="Substituir por..."
                    className="siscom-input !min-h-[36px] !px-2.5 text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleReplaceAll}
                    className="siscom-btn siscom-btn-primary w-full !min-h-[36px] text-xs"
                  >
                    <Replace className="w-3.5 h-3.5" />
                    <span>Substituir tudo</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {pinchZoom > 1.02 && (
                <motion.div
                  key="alt-pinch-zoom"
                  variants={fadeSlideVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={UI_TRANSITION}
                  className="siscom-liquid-subcard rounded-lg p-2.5 flex items-center justify-between gap-2 text-xs"
                >
                  <span className="font-mono font-semibold text-[#E5C17B]">
                    {Math.round(pinchZoom * 100)}%
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
                      className="siscom-btn siscom-btn-secondary !min-h-[30px] !w-[30px] !px-0"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPinchZoom((prev) => Math.min(3.5, prev + 0.35))}
                      aria-label="Aumentar zoom da folha"
                      className="siscom-btn siscom-btn-secondary !min-h-[30px] !w-[30px] !px-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPinchZoom(1)}
                      className="siscom-btn siscom-btn-gold !min-h-[30px] !px-2 text-[11px]"
                    >
                      <Maximize2 className="w-3 h-3" />
                      <span>100%</span>
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Calculadora de Tempo de Serviço */}
          <div className="space-y-2.5 pt-3 border-t border-white/[0.08]">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#E5C17B]">
                <Calculator className="w-3.5 h-3.5" />
                <span>Tempo de Serviço</span>
              </span>
              <span className="font-mono text-[11px] font-semibold text-[#E5C17B]">
                {serviceTime ? serviceTime.formatted : '00 a 00 m 00 d'}
              </span>
            </div>

            <div className="space-y-2">
              <label htmlFor="alt-data-praca" className="block space-y-1">
                <span className="block text-[11px] text-[#B8B3A6]">Data de praça</span>
                <input
                  id="alt-data-praca"
                  type="date"
                  value={dataPraca}
                  onChange={(e) => handleDateCalculatorChange('praca', e.target.value)}
                  className="siscom-input !min-h-[36px] !px-2.5 text-xs"
                />
              </label>

              <label htmlFor="alt-data-final" className="block space-y-1">
                <span className="block text-[11px] text-[#B8B3A6]">Data final</span>
                <input
                  id="alt-data-final"
                  type="date"
                  value={dataFinal}
                  onChange={(e) => handleDateCalculatorChange('final', e.target.value)}
                  className="siscom-input !min-h-[36px] !px-2.5 text-xs"
                />
              </label>
            </div>

            <label className="flex items-center gap-2 text-[11px] text-[#B8C6BE] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={updateClosingDateWithCalc}
                onChange={(e) => setUpdateClosingDateWithCalc(e.target.checked)}
                className="h-3.5 w-3.5 accent-[#C8A461] cursor-pointer"
              />
              <span>Atualizar também a data do fecho</span>
            </label>

            <button
              type="button"
              disabled={!serviceTime}
              onClick={() =>
                applyServiceTimeToDocument(dataPraca, dataFinal, true, updateClosingDateWithCalc)
              }
              className="siscom-btn siscom-btn-gold w-full !min-h-[38px] text-xs"
            >
              Aplicar na 2ª Parte
            </button>
          </div>
        </div>
      }
    >
      {/* Editable A4 Pages Stack — whole sheet fits mobile width cleanly; pinch-zoom allows full bidirectional pan */}
      <div
        ref={pagesViewportRef}
        style={{
          touchAction: 'pan-x pan-y',
          WebkitOverflowScrolling: 'touch',
        }}
        className="w-full min-w-0 overflow-x-auto pb-4 space-y-6 print-wrapper print-zoom-reset"
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
                      onTriggerReflow={(immediate) => scheduleLiveReflow(pageIndex, immediate)}
                      onBoundaryKey={(key) => handleLinkedBoundaryKey(pageIndex, key)}
                    />
                  </div>
                  </div>
                </div>
              </div>
            );
          })}
      </div>
    </WorkspaceSplitLayout>
      </div>
    </div>
  );
};
