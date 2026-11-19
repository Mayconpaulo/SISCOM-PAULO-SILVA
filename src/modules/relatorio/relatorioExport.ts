import { buildRelatorioWeekPeriod } from './relatorioPeriods';

export type ComSocProvidenciaOption =
  | 'Foto'
  | 'Foto e vídeo'
  | 'Espaço cultural'
  | 'Relações públicas'
  | 'Drone';

export const COM_SOC_PROVIDENCIA_OPTIONS: ComSocProvidenciaOption[] = [
  'Foto',
  'Foto e vídeo',
  'Espaço cultural',
  'Relações públicas',
  'Drone',
];

const PROVIDENCIA_PHRASES: Record<ComSocProvidenciaOption, string> = {
  Foto: 'cobertura fotográfica (Foto)',
  'Foto e vídeo': 'cobertura fotográfica e audiovisual (Foto e vídeo)',
  'Espaço cultural': 'atendimento no Espaço Cultural',
  'Relações públicas': 'apoio de Relações Públicas',
  Drone: 'captação de imagens com Drone',
};

export interface RelatorioEventEntry {
  id: string;
  dataPeriodo: string;
  evento: string;
  providencias: ComSocProvidenciaOption[];
  observacao?: string;
}

export interface RelatorioVtrDisponibilidade {
  om: string;
  motocicletasExistente: string;
  motocicletasDisponivel: string;
  vtrOpExistente: string;
  vtrOpDisponivel: string;
  vtrAdmExistente: string;
  vtrAdmDisponivel: string;
  vtrBldExistente: string;
  vtrBldDisponivel: string;
  obusMrtExistente: string;
  obusMrtDisponivel: string;
}

export interface RelatorioMarcaModeloRow {
  marcaModelo: string;
  disponiveis: string;
  indisponiveis: string;
  isTotal?: boolean;
}

export interface RelatorioExecucaoFinanceiraRow {
  contaContabil: string;
  empenhado2026: string;
  liquidado2026: string;
  rp2025Inscrito: string;
  rp2025Liquidado: string;
  rp2024Inscrito: string;
  rp2024Liquidado: string;
}

export interface RelatorioDocument {
  id: string;
  title: string;
  periodoCabecalho: string;
  preparoEmprego: string;
  estadoSanitario: string;
  problemasDisciplinares: string;
  generosAlimenticios: string;
  vtrDisponibilidade: RelatorioVtrDisponibilidade;
  marcaModeloRows: RelatorioMarcaModeloRow[];
  execucaoFinanceiraRows: RelatorioExecucaoFinanceiraRow[];
  diversosEventos: RelatorioEventEntry[];
  updatedAt: string;
}

export const PORTRAIT_A4_W_MM = 210;
export const PORTRAIT_A4_H_MM = 297;

export const DEFAULT_VTR_DISPONIBILIDADE: RelatorioVtrDisponibilidade = {
  om: '1º BI Mec (Es)',
  motocicletasExistente: '6',
  motocicletasDisponivel: '0%',
  vtrOpExistente: '33',
  vtrOpDisponivel: '33,00%',
  vtrAdmExistente: '09',
  vtrAdmDisponivel: '36,36%',
  vtrBldExistente: '39',
  vtrBldDisponivel: '58,97%',
  obusMrtExistente: '23',
  obusMrtDisponivel: '78,26%',
};

export const DEFAULT_MARCA_MODELO_ROWS: RelatorioMarcaModeloRow[] = [
  { marcaModelo: 'Atego 5/Ton', disponiveis: '5', indisponiveis: '7' },
  { marcaModelo: 'Worker 5/Ton', disponiveis: '1', indisponiveis: '1' },
  { marcaModelo: 'Caminhão Caçamba', disponiveis: '0', indisponiveis: '1' },
  { marcaModelo: 'Cisterna 15.000L', disponiveis: '0', indisponiveis: '1' },
  { marcaModelo: 'Marruá', disponiveis: '3', indisponiveis: '4' },
  { marcaModelo: 'Land Rover', disponiveis: '1', indisponiveis: '5' },
  { marcaModelo: 'Hilux', disponiveis: '1', indisponiveis: '0' },
  { marcaModelo: 'Hilux Ambulância', disponiveis: '0', indisponiveis: '3' },
  { marcaModelo: 'Total', disponiveis: '11', indisponiveis: '22', isTotal: true },
];

export const DEFAULT_EXECUCAO_FINANCEIRA_ROWS: RelatorioExecucaoFinanceiraRow[] = [
  {
    contaContabil: '',
    empenhado2026: '',
    liquidado2026: '',
    rp2025Inscrito: '',
    rp2025Liquidado: '',
    rp2024Inscrito: '',
    rp2024Liquidado: '',
  },
  {
    contaContabil: '',
    empenhado2026: '',
    liquidado2026: '',
    rp2025Inscrito: '',
    rp2025Liquidado: '',
    rp2024Inscrito: '',
    rp2024Liquidado: '',
  },
];

export function createDefaultRelatorioDocument(
  overrides?: Partial<Pick<RelatorioDocument, 'id' | 'title' | 'periodoCabecalho' | 'diversosEventos'>>
): RelatorioDocument {
  const periodo = overrides?.periodoCabecalho ?? buildRelatorioWeekPeriod(0).headerLabel;
  return {
    id: overrides?.id ?? `rel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: overrides?.title ?? `Relatório Semanal – ${periodo}`,
    periodoCabecalho: periodo,
    preparoEmprego: 'S/A',
    estadoSanitario: 'S/A',
    problemasDisciplinares: 'S/A',
    generosAlimenticios: 'S/A',
    vtrDisponibilidade: { ...DEFAULT_VTR_DISPONIBILIDADE },
    marcaModeloRows: DEFAULT_MARCA_MODELO_ROWS.map((r) => ({ ...r })),
    execucaoFinanceiraRows: DEFAULT_EXECUCAO_FINANCEIRA_ROWS.map((r) => ({ ...r })),
    diversosEventos: overrides?.diversosEventos ? overrides.diversosEventos.map((e) => ({ ...e })) : [],
    updatedAt: new Date().toISOString(),
  };
}

function joinListPtBr(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} e ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

export function formatRelatorioEventText(entry: RelatorioEventEntry): string {
  const datePart = entry.dataPeriodo.trim();
  const eventRaw = entry.evento.trim().replace(/[.\s]+$/, '');
  const obsRaw = (entry.observacao || '').trim();

  const providenciasPhrases = entry.providencias.map((p) => PROVIDENCIA_PHRASES[p] || p);
  const provText =
    providenciasPhrases.length > 0
      ? `Providências da Seção de Comunicação Social: ${joinListPtBr(providenciasPhrases)}.`
      : '';

  const parts: string[] = [];
  if (datePart && eventRaw) {
    parts.push(`${datePart} - ${eventRaw}.`);
  } else if (datePart) {
    parts.push(`${datePart} -`);
  } else if (eventRaw) {
    parts.push(`${eventRaw}.`);
  }

  if (provText) {
    parts.push(provText);
  }
  if (obsRaw) {
    parts.push(obsRaw.endsWith('.') ? obsRaw : `${obsRaw}.`);
  }

  return parts.join(' ');
}

let cachedGrayscaleCrestCanvas: HTMLCanvasElement | null = null;
let cachedGrayscaleCrestDataUrl: string | null = null;

async function getGrayscaleBrasao(): Promise<{
  canvas: HTMLCanvasElement;
  dataUrl: string;
} | null> {
  if (cachedGrayscaleCrestCanvas && cachedGrayscaleCrestDataUrl) {
    return {
      canvas: cachedGrayscaleCrestCanvas,
      dataUrl: cachedGrayscaleCrestDataUrl,
    };
  }
  if (typeof document === 'undefined') return null;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = img.naturalWidth || 220;
        const h = img.naturalHeight || 220;
        const off = document.createElement('canvas');
        off.width = w;
        off.height = h;
        const ctx = off.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] === 0) continue;
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          // Crisp institutional B&W engraving contrast
          const adjusted = Math.max(0, Math.min(255, (lum - 128) * 1.18 + 112));
          d[i] = adjusted;
          d[i + 1] = adjusted;
          d[i + 2] = adjusted;
        }
        ctx.putImageData(imgData, 0, 0);
        cachedGrayscaleCrestCanvas = off;
        cachedGrayscaleCrestDataUrl = off.toDataURL('image/png');
        resolve({
          canvas: off,
          dataUrl: cachedGrayscaleCrestDataUrl,
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = '/assets/cartoes/brasao_republica.png';
  });
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidthPx: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidthPx) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

function fitTextSingleLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidthPx: number,
  startPx: number,
  bold: boolean
): number {
  let px = startPx;
  const minPx = Math.max(10, startPx * 0.58);
  while (px > minPx) {
    ctx.font = `${bold ? 700 : 400} ${px}px "Times New Roman", Times, serif`;
    if (ctx.measureText(text).width <= maxWidthPx) return px;
    px -= 0.75;
  }
  return minPx;
}

function drawCellTextCentered(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fontPx: number,
  bold = false
) {
  const px = fitTextSingleLine(ctx, text, Math.max(10, w - 12), fontPx, bold);
  ctx.font = `${bold ? 700 : 400} ${px}px "Times New Roman", Times, serif`;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2);
}

/**
 * Renders the Relatório onto one or more 300-DPI A4 Vertical (Portrait) canvases (2480 x 3508 px).
 * Preserves the exact institutional template layout rotated/proportioned cleanly to A4 Vertical.
 */
export async function renderRelatorioPortraitCanvases(
  doc: RelatorioDocument
): Promise<HTMLCanvasElement[]> {
  if (typeof document !== 'undefined' && document.fonts) {
    await document.fonts.ready;
  }

  const DPI = 300;
  const mmToPx = (mm: number) => (mm * DPI) / 25.4;
  const ptToPx = (pt: number) => (pt * DPI) / 72;

  const PAGE_W = 2480; // 210mm
  const PAGE_H = 3508; // 297mm
  const MARGIN_X = mmToPx(11);
  const MARGIN_TOP = mmToPx(10);
  const MARGIN_BOTTOM = mmToPx(10);
  const TOTAL_W = PAGE_W - MARGIN_X * 2; // 188mm
  const MAX_Y = PAGE_H - MARGIN_BOTTOM;

  const IDX_W = mmToPx(18); // left gray column
  const BODY_X = MARGIN_X + IDX_W;
  const BODY_W = TOTAL_W - IDX_W; // 170mm

  const crest = await getGrayscaleBrasao();
  const pages: HTMLCanvasElement[] = [];

  const createPageCanvas = (): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } => {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Contexto gráfico indisponível.');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    pages.push(canvas);
    return { canvas, ctx };
  };

  const { ctx } = createPageCanvas();
  let curY = MARGIN_TOP;

  // Institutional Top Header (Brasão da República + 4 centered lines)
  if (crest) {
    const crestH = mmToPx(15.5);
    const ratio = crest.canvas.width / Math.max(1, crest.canvas.height);
    const crestW = crestH * ratio;
    ctx.drawImage(crest.canvas, PAGE_W / 2 - crestW / 2, curY, crestW, crestH);
    curY += crestH + mmToPx(2.2);
  }

  const orgLines = [
    'MINISTÉRIO DA DEFESA',
    'EXÉRCITO BRASILEIRO',
    '1º BATALHÃO DE INFANTARIA MECANIZADO (ESCOLA)',
    'REGIMENTO SAMPAIO',
  ];
  const orgLinePx = ptToPx(10.5);
  const orgStep = mmToPx(4.6);
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  orgLines.forEach((line) => {
    const px = fitTextSingleLine(ctx, line, TOTAL_W, orgLinePx, true);
    ctx.font = `700 ${px}px "Times New Roman", Times, serif`;
    ctx.fillText(line, PAGE_W / 2, curY + orgStep / 2);
    curY += orgStep;
  });

  curY += mmToPx(3.0);

  const lineThickness = mmToPx(0.28);
  const drawBorderRect = (
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    fill?: string
  ) => {
    if (fill) {
      c.fillStyle = fill;
      c.fillRect(x, y, w, h);
    }
    c.strokeStyle = '#000000';
    c.lineWidth = lineThickness;
    c.strokeRect(x, y, w, h);
  };

  const GRAY_BANNER = '#C8C8C8';
  const GRAY_INDEX = '#D9D9D9';

  // Top Title Banner Row
  const bannerH = mmToPx(8.2);
  drawBorderRect(ctx, MARGIN_X, curY, TOTAL_W, bannerH, GRAY_BANNER);
  const bannerTitle = `Relatório Semanal do 1º BIMec (Es) – ${doc.periodoCabecalho.trim() || buildRelatorioWeekPeriod(0).headerLabel}`;
  drawCellTextCentered(ctx, bannerTitle, MARGIN_X, curY, TOTAL_W, bannerH, ptToPx(12), true);
  curY += bannerH;

  // Helper for two-row numbered sections (1., 2., 3., 4.1.2.)
  const rowH = mmToPx(5.3);
  const stdFont = ptToPx(9.5);
  const smallFont = ptToPx(8.3);

  const drawSimpleSection = (idxLabel: string, headerText: string, valueText: string) => {
    const totalH = rowH * 2;
    drawBorderRect(ctx, MARGIN_X, curY, IDX_W, totalH, GRAY_INDEX);
    drawCellTextCentered(ctx, idxLabel, MARGIN_X, curY, IDX_W, totalH, stdFont, false);

    drawBorderRect(ctx, BODY_X, curY, BODY_W, rowH);
    drawCellTextCentered(ctx, headerText, BODY_X, curY, BODY_W, rowH, stdFont, true);

    drawBorderRect(ctx, BODY_X, curY + rowH, BODY_W, rowH);
    drawCellTextCentered(ctx, valueText || 'S/A', BODY_X, curY + rowH, BODY_W, rowH, stdFont, false);

    curY += totalH;
  };

  const drawSingleRowSection = (idxLabel: string, headerText: string) => {
    drawBorderRect(ctx, MARGIN_X, curY, IDX_W, rowH, GRAY_INDEX);
    drawCellTextCentered(ctx, idxLabel, MARGIN_X, curY, IDX_W, rowH, stdFont, false);

    drawBorderRect(ctx, BODY_X, curY, BODY_W, rowH);
    drawCellTextCentered(ctx, headerText, BODY_X, curY, BODY_W, rowH, stdFont, true);
    curY += rowH;
  };

  drawSimpleSection('1.', 'Preparo e Emprego', doc.preparoEmprego);
  drawSimpleSection('2.', 'Estado Sanitário', doc.estadoSanitario);
  drawSimpleSection('3.', 'Problemas Disciplinares / Justiça', doc.problemasDisciplinares);
  drawSingleRowSection('4.', 'Assuntos Administrativos');
  drawSingleRowSection('4.1.', 'Logística');
  drawSimpleSection('4.1.2.', 'Gêneros Alimentícios', doc.generosAlimenticios);

  // 4.2. Disponibilidade de Vtr e Obus / Mtr + Sub-table 1 + Sub-table 2
  const vtrHdrH = mmToPx(5.6);
  const vtrSubH1 = mmToPx(5.1);
  const vtrSubH2 = mmToPx(5.1);
  const vtrDataH = mmToPx(6.2);
  const mmRowH = mmToPx(5.0);
  const marcaRows = doc.marcaModeloRows;
  const total42H =
    vtrHdrH + vtrSubH1 + vtrSubH2 + vtrDataH + (1 + marcaRows.length) * mmRowH;

  drawBorderRect(ctx, MARGIN_X, curY, IDX_W, total42H, GRAY_INDEX);
  drawCellTextCentered(ctx, '4.2.', MARGIN_X, curY, IDX_W, total42H, stdFont, false);

  // 4.2 Header
  drawBorderRect(ctx, BODY_X, curY, BODY_W, vtrHdrH);
  drawCellTextCentered(
    ctx,
    'Disponibilidade de Vtr e Obus / Mtr',
    BODY_X,
    curY,
    BODY_W,
    vtrHdrH,
    stdFont,
    true
  );
  curY += vtrHdrH;

  // Sub-table 1 (OM + 5 vehicle categories)
  const omW = mmToPx(28);
  const pairW = (BODY_W - omW) / 5;
  const halfW = pairW / 2;

  const vtrCategories: Array<{ label: string; exist: string; disp: string }> = [
    {
      label: 'Motocicletas',
      exist: doc.vtrDisponibilidade.motocicletasExistente,
      disp: doc.vtrDisponibilidade.motocicletasDisponivel,
    },
    {
      label: 'Vtr Op',
      exist: doc.vtrDisponibilidade.vtrOpExistente,
      disp: doc.vtrDisponibilidade.vtrOpDisponivel,
    },
    {
      label: 'Vtr Adm',
      exist: doc.vtrDisponibilidade.vtrAdmExistente,
      disp: doc.vtrDisponibilidade.vtrAdmDisponivel,
    },
    {
      label: 'Vtr Bld',
      exist: doc.vtrDisponibilidade.vtrBldExistente,
      disp: doc.vtrDisponibilidade.vtrBldDisponivel,
    },
    {
      label: 'Obus/Mrt',
      exist: doc.vtrDisponibilidade.obusMrtExistente,
      disp: doc.vtrDisponibilidade.obusMrtDisponivel,
    },
  ];

  // OM cell spanning vtrSubH1 + vtrSubH2
  drawBorderRect(ctx, BODY_X, curY, omW, vtrSubH1 + vtrSubH2);
  drawCellTextCentered(ctx, 'OM', BODY_X, curY, omW, vtrSubH1 + vtrSubH2, smallFont, false);

  vtrCategories.forEach((cat, idx) => {
    const cx = BODY_X + omW + idx * pairW;
    drawBorderRect(ctx, cx, curY, pairW, vtrSubH1);
    drawCellTextCentered(ctx, cat.label, cx, curY, pairW, vtrSubH1, smallFont, false);

    drawBorderRect(ctx, cx, curY + vtrSubH1, halfW, vtrSubH2);
    drawCellTextCentered(ctx, 'Existente', cx, curY + vtrSubH1, halfW, vtrSubH2, ptToPx(7.4), false);

    drawBorderRect(ctx, cx + halfW, curY + vtrSubH1, halfW, vtrSubH2);
    drawCellTextCentered(
      ctx,
      'Disponível',
      cx + halfW,
      curY + vtrSubH1,
      halfW,
      vtrSubH2,
      ptToPx(7.4),
      false
    );
  });
  curY += vtrSubH1 + vtrSubH2;

  // Sub-table 1 values row
  drawBorderRect(ctx, BODY_X, curY, omW, vtrDataH);
  drawCellTextCentered(ctx, doc.vtrDisponibilidade.om, BODY_X, curY, omW, vtrDataH, smallFont, false);
  vtrCategories.forEach((cat, idx) => {
    const cx = BODY_X + omW + idx * pairW;
    drawBorderRect(ctx, cx, curY, halfW, vtrDataH);
    drawCellTextCentered(ctx, cat.exist, cx, curY, halfW, vtrDataH, smallFont, false);

    drawBorderRect(ctx, cx + halfW, curY, halfW, vtrDataH);
    drawCellTextCentered(ctx, cat.disp, cx + halfW, curY, halfW, vtrDataH, smallFont, false);
  });
  curY += vtrDataH;

  // Sub-table 2 (Marca/Modelo - 3 balanced columns)
  const mmColW = BODY_W / 3;
  drawBorderRect(ctx, BODY_X, curY, mmColW, mmRowH);
  drawCellTextCentered(ctx, 'Marca/Modelo', BODY_X, curY, mmColW, mmRowH, smallFont, false);
  drawBorderRect(ctx, BODY_X + mmColW, curY, mmColW, mmRowH);
  drawCellTextCentered(
    ctx,
    'Vtr Operacionais Disponíveis',
    BODY_X + mmColW,
    curY,
    mmColW,
    mmRowH,
    smallFont,
    false
  );
  drawBorderRect(ctx, BODY_X + mmColW * 2, curY, mmColW, mmRowH);
  drawCellTextCentered(
    ctx,
    'Vtr Operacionais Indisponíveis',
    BODY_X + mmColW * 2,
    curY,
    mmColW,
    mmRowH,
    smallFont,
    false
  );
  curY += mmRowH;

  marcaRows.forEach((mr) => {
    drawBorderRect(ctx, BODY_X, curY, mmColW, mmRowH);
    drawCellTextCentered(ctx, mr.marcaModelo, BODY_X, curY, mmColW, mmRowH, smallFont, Boolean(mr.isTotal));
    drawBorderRect(ctx, BODY_X + mmColW, curY, mmColW, mmRowH);
    drawCellTextCentered(
      ctx,
      mr.disponiveis,
      BODY_X + mmColW,
      curY,
      mmColW,
      mmRowH,
      smallFont,
      Boolean(mr.isTotal)
    );
    drawBorderRect(ctx, BODY_X + mmColW * 2, curY, mmColW, mmRowH);
    drawCellTextCentered(
      ctx,
      mr.indisponiveis,
      BODY_X + mmColW * 2,
      curY,
      mmColW,
      mmRowH,
      smallFont,
      Boolean(mr.isTotal)
    );
    curY += mmRowH;
  });

  // 4.3 Execução Financeira
  const finRows = doc.execucaoFinanceiraRows.length > 0 ? doc.execucaoFinanceiraRows : DEFAULT_EXECUCAO_FINANCEIRA_ROWS;
  const finHdrH = mmToPx(5.4);
  const finSubH1 = mmToPx(5.1);
  const finSubH2 = mmToPx(5.1);
  const finRowH = mmToPx(5.0);
  const total43H = finHdrH + finSubH1 + finSubH2 + finRows.length * finRowH;

  drawBorderRect(ctx, MARGIN_X, curY, IDX_W, total43H, GRAY_INDEX);
  drawCellTextCentered(ctx, '4.3', MARGIN_X, curY, IDX_W, total43H, stdFont, false);

  drawBorderRect(ctx, BODY_X, curY, BODY_W, finHdrH);
  drawCellTextCentered(ctx, 'Execução Financeira', BODY_X, curY, BODY_W, finHdrH, stdFont, true);
  curY += finHdrH;

  const contaW = BODY_W * 0.4;
  const finPairW = (BODY_W - contaW) / 3;
  const finHalfW = finPairW / 2;

  drawBorderRect(ctx, BODY_X, curY, contaW, finSubH1 + finSubH2);
  drawCellTextCentered(
    ctx,
    'Conta Contábil – 1º BI Mec (Es)',
    BODY_X,
    curY,
    contaW,
    finSubH1 + finSubH2,
    smallFont,
    false
  );

  const finGroups = [
    { label: '2026', left: 'Empenhado', right: 'Liquidado' },
    { label: 'RP (2025)', left: 'Inscrito', right: 'Liquidado' },
    { label: 'RP (até 2024)', left: 'Inscrito', right: 'Liquidado' },
  ];
  finGroups.forEach((g, idx) => {
    const gx = BODY_X + contaW + idx * finPairW;
    drawBorderRect(ctx, gx, curY, finPairW, finSubH1);
    drawCellTextCentered(ctx, g.label, gx, curY, finPairW, finSubH1, smallFont, false);

    drawBorderRect(ctx, gx, curY + finSubH1, finHalfW, finSubH2);
    drawCellTextCentered(ctx, g.left, gx, curY + finSubH1, finHalfW, finSubH2, ptToPx(7.6), false);

    drawBorderRect(ctx, gx + finHalfW, curY + finSubH1, finHalfW, finSubH2);
    drawCellTextCentered(ctx, g.right, gx + finHalfW, curY + finSubH1, finHalfW, finSubH2, ptToPx(7.6), false);
  });
  curY += finSubH1 + finSubH2;

  finRows.forEach((fr) => {
    drawBorderRect(ctx, BODY_X, curY, contaW, finRowH);
    if (fr.contaContabil.trim()) {
      drawCellTextCentered(ctx, fr.contaContabil, BODY_X, curY, contaW, finRowH, smallFont, false);
    }
    const vals = [
      fr.empenhado2026,
      fr.liquidado2026,
      fr.rp2025Inscrito,
      fr.rp2025Liquidado,
      fr.rp2024Inscrito,
      fr.rp2024Liquidado,
    ];
    vals.forEach((v, idx) => {
      const vx = BODY_X + contaW + idx * finHalfW;
      drawBorderRect(ctx, vx, curY, finHalfW, finRowH);
      if (v.trim()) {
        drawCellTextCentered(ctx, v, vx, curY, finHalfW, finRowH, smallFont, false);
      }
    });
    curY += finRowH;
  });

  // 5. Diversos (can paginate onto extra Portrait A4 pages if many events exist)
  const diversosTexts =
    doc.diversosEventos.length > 0
      ? doc.diversosEventos.map((e) => formatRelatorioEventText(e))
      : ['S/A'];

  const textFontPx = ptToPx(9.4);
  const lineH = mmToPx(4.4);
  const padX = mmToPx(3.5);
  const padY = mmToPx(2.8);
  ctx.font = `400 ${textFontPx}px "Times New Roman", Times, serif`;

  interface DiversosLine {
    text: string;
    gapBefore: number;
  }
  const allWrappedLines: DiversosLine[] = [];
  diversosTexts.forEach((entryText, eIdx) => {
    const wrapped = wrapTextLines(ctx, entryText, BODY_W - padX * 2);
    wrapped.forEach((line, lIdx) => {
      allWrappedLines.push({
        text: line,
        gapBefore: eIdx > 0 && lIdx === 0 ? mmToPx(2.0) : 0,
      });
    });
  });

  // If header + at least 2 lines wouldn't fit on page 1, push section 5. to a fresh Portrait A4 page
  let activeCtx = ctx;
  const divHdrH = mmToPx(5.5);
  if (curY + divHdrH + padY * 2 + lineH > MAX_Y) {
    const next = createPageCanvas();
    activeCtx = next.ctx;
    curY = MARGIN_TOP;
  }

  let lineCursor = 0;
  let isContinuation = false;

  while (lineCursor < allWrappedLines.length) {
    const startPageY = curY;
    const headerHeight = isContinuation ? 0 : divHdrH;
    const availForLines = MAX_Y - curY - headerHeight - padY * 2;
    let usedLinesH = 0;
    const pageLines: Array<{ text: string; yOffset: number }> = [];

    while (lineCursor < allWrappedLines.length) {
      const item = allWrappedLines[lineCursor];
      const extraGap = pageLines.length === 0 ? 0 : item.gapBefore;
      if (usedLinesH + extraGap + lineH > availForLines && pageLines.length > 0) {
        break;
      }
      usedLinesH += extraGap;
      pageLines.push({ text: item.text, yOffset: usedLinesH });
      usedLinesH += lineH;
      lineCursor++;
    }

    const contentBoxH = Math.max(mmToPx(11), usedLinesH + padY * 2);
    const totalSectionH = headerHeight + contentBoxH;

    drawBorderRect(activeCtx, MARGIN_X, startPageY, IDX_W, totalSectionH, GRAY_INDEX);
    drawCellTextCentered(
      activeCtx,
      isContinuation ? '5. (cont.)' : '5.',
      MARGIN_X,
      startPageY,
      IDX_W,
      totalSectionH,
      stdFont,
      false
    );

    if (!isContinuation) {
      drawBorderRect(activeCtx, BODY_X, startPageY, BODY_W, divHdrH);
      drawCellTextCentered(activeCtx, 'Diversos', BODY_X, startPageY, BODY_W, divHdrH, stdFont, true);
    }

    const boxTopY = startPageY + headerHeight;
    drawBorderRect(activeCtx, BODY_X, boxTopY, BODY_W, contentBoxH);
    activeCtx.fillStyle = '#000000';
    activeCtx.font = `400 ${textFontPx}px "Times New Roman", Times, serif`;
    activeCtx.textAlign = 'left';
    activeCtx.textBaseline = 'top';

    pageLines.forEach((pl) => {
      activeCtx.fillText(pl.text, BODY_X + padX, boxTopY + padY + pl.yOffset);
    });

    if (lineCursor < allWrappedLines.length) {
      const next = createPageCanvas();
      activeCtx = next.ctx;
      curY = MARGIN_TOP;
      isContinuation = true;
    }
  }

  return pages;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generates an A4 Vertical (Portrait) PDF (595.2756 x 841.8898 pt), supporting 1 or multiple pages.
 */
export async function generateRelatorioPdfBlob(doc: RelatorioDocument): Promise<Blob> {
  const canvases = await renderRelatorioPortraitCanvases(doc);
  const pageCount = canvases.length;

  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let bytePos = 0;

  const pushStr = (s: string) => {
    const b = encoder.encode(s);
    chunks.push(b);
    bytePos += b.length;
  };
  const pushBytes = (b: Uint8Array) => {
    chunks.push(b);
    bytePos += b.length;
  };

  pushStr('%PDF-1.4\n');

  // Object 1: Catalog, Object 2: Pages
  offsets.push(bytePos);
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  const pageObjIds = canvases.map((_, idx) => 3 + idx * 3);
  offsets.push(bytePos);
  pushStr(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj\n`
  );

  for (let i = 0; i < canvases.length; i++) {
    const canvas = canvases[i];
    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.96);
    const jpegBytes = base64ToBytes(jpegDataUrl.split(',')[1]);

    const pageId = 3 + i * 3;
    const imgId = pageId + 1;
    const contentId = pageId + 2;

    // Page object (595.2756 x 841.8898 pt = A4 Portrait)
    offsets.push(bytePos);
    pushStr(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.2756 841.8898] /Resources << /XObject << /Im${i} ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`
    );

    // Image XObject
    offsets.push(bytePos);
    pushStr(
      `${imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
    );
    pushBytes(jpegBytes);
    pushStr('\nendstream\nendobj\n');

    // Content Stream
    const stream = `q\n595.2756 0 0 841.8898 0 0 cm\n/Im${i} Do\nQ\n`;
    offsets.push(bytePos);
    pushStr(`${contentId} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`);
  }

  const xrefStart = bytePos;
  pushStr(`xref\n0 ${offsets.length}\n`);
  pushStr('0000000000 65535 f \n');
  for (let i = 1; i < offsets.length; i++) {
    pushStr(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  pushStr(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Generates an A4 Vertical (Portrait) Microsoft Word (.doc) document faithful to the PDF model.
 */
export async function generateRelatorioWordBlob(doc: RelatorioDocument): Promise<Blob> {
  const crest = await getGrayscaleBrasao();
  const crestHtml = crest
    ? `<div style="text-align:center; margin-bottom:4pt;"><img src="${crest.dataUrl}" width="54" height="58" style="width:15mm; height:auto;" /></div>`
    : '';

  const v = doc.vtrDisponibilidade;
  const marcaRowsHtml = doc.marcaModeloRows
    .map(
      (mr) => `<tr>
        <td colspan="4" style="border:1px solid #000; text-align:center; font-size:8pt; padding:1.5pt 2pt;${
          mr.isTotal ? ' font-weight:bold;' : ''
        }">${escapeHtml(mr.marcaModelo)}</td>
        <td colspan="4" style="border:1px solid #000; text-align:center; font-size:8pt; padding:1.5pt 2pt;${
          mr.isTotal ? ' font-weight:bold;' : ''
        }">${escapeHtml(mr.disponiveis)}</td>
        <td colspan="3" style="border:1px solid #000; text-align:center; font-size:8pt; padding:1.5pt 2pt;${
          mr.isTotal ? ' font-weight:bold;' : ''
        }">${escapeHtml(mr.indisponiveis)}</td>
      </tr>`
    )
    .join('');

  const finRows =
    doc.execucaoFinanceiraRows.length > 0
      ? doc.execucaoFinanceiraRows
      : DEFAULT_EXECUCAO_FINANCEIRA_ROWS;
  const finRowsHtml = finRows
    .map(
      (fr) => `<tr>
        <td colspan="5" style="border:1px solid #000; height:14pt; text-align:center; font-size:8pt; padding:1.5pt 2pt;">${escapeHtml(
          fr.contaContabil || '\u00a0'
        )}</td>
        <td style="border:1px solid #000; text-align:center; font-size:8pt; padding:1.5pt 2pt;">${escapeHtml(
          fr.empenhado2026 || '\u00a0'
        )}</td>
        <td style="border:1px solid #000; text-align:center; font-size:8pt; padding:1.5pt 2pt;">${escapeHtml(
          fr.liquidado2026 || '\u00a0'
        )}</td>
        <td style="border:1px solid #000; text-align:center; font-size:8pt; padding:1.5pt 2pt;">${escapeHtml(
          fr.rp2025Inscrito || '\u00a0'
        )}</td>
        <td style="border:1px solid #000; text-align:center; font-size:8pt; padding:1.5pt 2pt;">${escapeHtml(
          fr.rp2025Liquidado || '\u00a0'
        )}</td>
        <td style="border:1px solid #000; text-align:center; font-size:8pt; padding:1.5pt 2pt;">${escapeHtml(
          fr.rp2024Inscrito || '\u00a0'
        )}</td>
        <td style="border:1px solid #000; text-align:center; font-size:8pt; padding:1.5pt 2pt;">${escapeHtml(
          fr.rp2024Liquidado || '\u00a0'
        )}</td>
      </tr>`
    )
    .join('');

  const diversosHtml =
    doc.diversosEventos.length > 0
      ? doc.diversosEventos
          .map(
            (ev, idx) =>
              `<p style="margin:${idx === 0 ? '0' : '4pt'} 0 0 0; font-size:9.5pt; line-height:1.25;">${escapeHtml(
                formatRelatorioEventText(ev)
              )}</p>`
          )
          .join('')
      : `<p style="margin:0; font-size:9.5pt; text-align:center;">S/A</p>`;

  const marcaRowSpan = 1 + doc.marcaModeloRows.length;
  const total42RowSpan = 1 + 3 + marcaRowSpan;
  const total43RowSpan = 1 + 2 + finRows.length;

  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(doc.title)}</title>
  <style>
    @page Section1 { size: 210mm 297mm; mso-page-orientation: portrait; margin: 10mm 11mm; }
    div.Section1 { page: Section1; }
    body { font-family: 'Times New Roman', Times, serif; color: #000; margin: 0; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  </style>
</head>
<body>
  <div class="Section1">
    ${crestHtml}
    <div style="text-align:center; font-weight:bold; font-size:10.5pt; line-height:1.22; margin-bottom:8pt;">
      MINISTÉRIO DA DEFESA<br/>
      EXÉRCITO BRASILEIRO<br/>
      1º BATALHÃO DE INFANTARIA MECANIZADO (ESCOLA)<br/>
      REGIMENTO SAMPAIO
    </div>
    <table>
      <colgroup>
        <col style="width:18mm;" />
        <col style="width:28mm;" />
        <col /><col /><col /><col /><col /><col /><col /><col /><col /><col />
      </colgroup>
      <tr>
        <td colspan="12" style="border:1px solid #000; background:#C8C8C8; text-align:center; font-weight:bold; font-size:11.5pt; padding:4pt;">
          Relatório Semanal do 1º BIMec (Es) – ${escapeHtml(doc.periodoCabecalho || buildRelatorioWeekPeriod(0).headerLabel)}
        </td>
      </tr>
      <tr>
        <td rowspan="2" style="border:1px solid #000; background:#D9D9D9; text-align:center; font-size:9.5pt; vertical-align:middle;">1.</td>
        <td colspan="11" style="border:1px solid #000; text-align:center; font-weight:bold; font-size:9.5pt; padding:2pt;">Preparo e Emprego</td>
      </tr>
      <tr>
        <td colspan="11" style="border:1px solid #000; text-align:center; font-size:9.5pt; padding:2pt;">${escapeHtml(doc.preparoEmprego || 'S/A')}</td>
      </tr>
      <tr>
        <td rowspan="2" style="border:1px solid #000; background:#D9D9D9; text-align:center; font-size:9.5pt; vertical-align:middle;">2.</td>
        <td colspan="11" style="border:1px solid #000; text-align:center; font-weight:bold; font-size:9.5pt; padding:2pt;">Estado Sanitário</td>
      </tr>
      <tr>
        <td colspan="11" style="border:1px solid #000; text-align:center; font-size:9.5pt; padding:2pt;">${escapeHtml(doc.estadoSanitario || 'S/A')}</td>
      </tr>
      <tr>
        <td rowspan="2" style="border:1px solid #000; background:#D9D9D9; text-align:center; font-size:9.5pt; vertical-align:middle;">3.</td>
        <td colspan="11" style="border:1px solid #000; text-align:center; font-weight:bold; font-size:9.5pt; padding:2pt;">Problemas Disciplinares / Justiça</td>
      </tr>
      <tr>
        <td colspan="11" style="border:1px solid #000; text-align:center; font-size:9.5pt; padding:2pt;">${escapeHtml(doc.problemasDisciplinares || 'S/A')}</td>
      </tr>
      <tr>
        <td style="border:1px solid #000; background:#D9D9D9; text-align:center; font-size:9.5pt; vertical-align:middle;">4.</td>
        <td colspan="11" style="border:1px solid #000; text-align:center; font-weight:bold; font-size:9.5pt; padding:2pt;">Assuntos Administrativos</td>
      </tr>
      <tr>
        <td style="border:1px solid #000; background:#D9D9D9; text-align:center; font-size:9.5pt; vertical-align:middle;">4.1.</td>
        <td colspan="11" style="border:1px solid #000; text-align:center; font-weight:bold; font-size:9.5pt; padding:2pt;">Logística</td>
      </tr>
      <tr>
        <td rowspan="2" style="border:1px solid #000; background:#D9D9D9; text-align:center; font-size:9.5pt; vertical-align:middle;">4.1.2.</td>
        <td colspan="11" style="border:1px solid #000; text-align:center; font-weight:bold; font-size:9.5pt; padding:2pt;">Gêneros Alimentícios</td>
      </tr>
      <tr>
        <td colspan="11" style="border:1px solid #000; text-align:center; font-size:9.5pt; padding:2pt;">${escapeHtml(doc.generosAlimenticios || 'S/A')}</td>
      </tr>
      <tr>
        <td rowspan="${total42RowSpan}" style="border:1px solid #000; background:#D9D9D9; text-align:center; font-size:9.5pt; vertical-align:middle;">4.2.</td>
        <td colspan="11" style="border:1px solid #000; text-align:center; font-weight:bold; font-size:9.5pt; padding:2pt;">Disponibilidade de Vtr e Obus / Mtr</td>
      </tr>
      <tr>
        <td rowspan="2" style="border:1px solid #000; text-align:center; font-size:8pt; vertical-align:middle;">OM</td>
        <td colspan="2" style="border:1px solid #000; text-align:center; font-size:8pt; padding:1.5pt;">Motocicletas</td>
        <td colspan="2" style="border:1px solid #000; text-align:center; font-size:8pt; padding:1.5pt;">Vtr Op</td>
        <td colspan="2" style="border:1px solid #000; text-align:center; font-size:8pt; padding:1.5pt;">Vtr Adm</td>
        <td colspan="2" style="border:1px solid #000; text-align:center; font-size:8pt; padding:1.5pt;">Vtr Bld</td>
        <td colspan="2" style="border:1px solid #000; text-align:center; font-size:8pt; padding:1.5pt;">Obus/Mrt</td>
      </tr>
      <tr>
        <td style="border:1px solid #000; text-align:center; font-size:7pt; padding:1.5pt;">Existente</td>
        <td style="border:1px solid #000; text-align:center; font-size:7pt; padding:1.5pt;">Disponível</td>
        <td style="border:1px solid #000; text-align:center; font-size:7pt; padding:1.5pt;">Existente</td>
        <td style="border:1px solid #000; text-align:center; font-size:7pt; padding:1.5pt;">Disponível</td>
        <td style="border:1px solid #000; text-align:center; font-size:7pt; padding:1.5pt;">Existente</td>
        <td style="border:1px solid #000; text-align:center; font-size:7pt; padding:1.5pt;">Disponível</td>
        <td style="border:1px solid #000; text-align:center; font-size:7pt; padding:1.5pt;">Existente</td>
        <td style="border:1px solid #000; text-align:center; font-size:7pt; padding:1.5pt;">Disponível</td>
        <td style="border:1px solid #000; text-align:center; font-size:7pt; padding:1.5pt;">Existente</td>
        <td style="border:1px solid #000; text-align:center; font-size:7pt; padding:1.5pt;">Disponível</td>
      </tr>
      <tr>
        <td style="border:1px solid #000; text-align:center; font-size:8pt; padding:2pt;">${escapeHtml(v.om)}</td>
        <td style="border:1px solid #000; text-align:center; font-size:8pt; padding:2pt;">${escapeHtml(v.motocicletasExistente)}</td>
        <td style="border:1px solid #000; text-align:center; font-size:8pt; padding:2pt;">${escapeHtml(v.motocicletasDisponivel)}</td>
        <td style="border:1px solid #000; text-align:center; font-size:8pt; padding:2pt;">${escapeHtml(v.vtrOpExistente)}</td>
        <td style="border:1px solid #000; text-align:center; font-size:8pt; padding:2pt;">${escapeHtml(v.vtrOpDisponivel)}</td>
        <td style="border:1px solid #000; text-align:center; font-size:8pt; padding:2pt;">${escapeHtml(v.vtrAdmExistente)}</td>
        <td style="border:1px solid #000; text-align:center; font-size:8pt; padding:2pt;">${escapeHtml(v.vtrAdmDisponivel)}</td>
        <td style="border:1px solid #000; text-align:center; font-size:8pt; padding:2pt;">${escapeHtml(v.vtrBldExistente)}</td>
        <td style="border:1px solid #000; text-align:center; font-size:8pt; padding:2pt;">${escapeHtml(v.vtrBldDisponivel)}</td>
        <td style="border:1px solid #000; text-align:center; font-size:8pt; padding:2pt;">${escapeHtml(v.obusMrtExistente)}</td>
        <td style="border:1px solid #000; text-align:center; font-size:8pt; padding:2pt;">${escapeHtml(v.obusMrtDisponivel)}</td>
      </tr>
      <tr>
        <td colspan="4" style="border:1px solid #000; text-align:center; font-size:8pt; padding:1.5pt;">Marca/Modelo</td>
        <td colspan="4" style="border:1px solid #000; text-align:center; font-size:8pt; padding:1.5pt;">Vtr Operacionais Disponíveis</td>
        <td colspan="3" style="border:1px solid #000; text-align:center; font-size:8pt; padding:1.5pt;">Vtr Operacionais Indisponíveis</td>
      </tr>
      ${marcaRowsHtml}
      <tr>
        <td rowspan="${total43RowSpan}" style="border:1px solid #000; background:#D9D9D9; text-align:center; font-size:9.5pt; vertical-align:middle;">4.3</td>
        <td colspan="11" style="border:1px solid #000; text-align:center; font-weight:bold; font-size:9.5pt; padding:2pt;">Execução Financeira</td>
      </tr>
      <tr>
        <td colspan="5" rowspan="2" style="border:1px solid #000; text-align:center; font-size:8pt; vertical-align:middle;">Conta Contábil – 1º BI Mec (Es)</td>
        <td colspan="2" style="border:1px solid #000; text-align:center; font-size:8pt; padding:1.5pt;">2026</td>
        <td colspan="2" style="border:1px solid #000; text-align:center; font-size:8pt; padding:1.5pt;">RP (2025)</td>
        <td colspan="2" style="border:1px solid #000; text-align:center; font-size:8pt; padding:1.5pt;">RP (até 2024)</td>
      </tr>
      <tr>
        <td style="border:1px solid #000; text-align:center; font-size:7.2pt; padding:1.5pt;">Empenhado</td>
        <td style="border:1px solid #000; text-align:center; font-size:7.2pt; padding:1.5pt;">Liquidado</td>
        <td style="border:1px solid #000; text-align:center; font-size:7.2pt; padding:1.5pt;">Inscrito</td>
        <td style="border:1px solid #000; text-align:center; font-size:7.2pt; padding:1.5pt;">Liquidado</td>
        <td style="border:1px solid #000; text-align:center; font-size:7.2pt; padding:1.5pt;">Inscrito</td>
        <td style="border:1px solid #000; text-align:center; font-size:7.2pt; padding:1.5pt;">Liquidado</td>
      </tr>
      ${finRowsHtml}
      <tr>
        <td rowspan="2" style="border:1px solid #000; background:#D9D9D9; text-align:center; font-size:9.5pt; vertical-align:middle;">5.</td>
        <td colspan="11" style="border:1px solid #000; text-align:center; font-weight:bold; font-size:9.5pt; padding:2pt;">Diversos</td>
      </tr>
      <tr>
        <td colspan="11" style="border:1px solid #000; padding:6pt 7pt; text-align:left; vertical-align:top;">${diversosHtml}</td>
      </tr>
    </table>
  </div>
</body>
</html>`;

  return new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
}
