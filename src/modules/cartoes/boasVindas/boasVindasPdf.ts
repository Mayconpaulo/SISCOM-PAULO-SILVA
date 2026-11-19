import { BOAS_VINDAS_TITLE_PATH, BOAS_VINDAS_TITLE_VIEWBOX } from './boasVindasVectorTitle';
import {
  CARTAO_ASSET_RATIOS,
  CARTOES_ASSETS,
  type CartaoModel,
  type FittedBodyLine,
  type FittedBodyText,
  type JustifiedWord,
} from '../shared/cartoesAssets';

export {
  CARTAO_ASSET_RATIOS,
  CARTOES_ASSETS,
  type CartaoModel,
  type FittedBodyLine,
  type FittedBodyText,
  type JustifiedWord,
};

export interface BoasVindasConfig {
  cardWidthMm: number;
  cardHeightMm: number;
  countPerPage: number;
  bodyText: string;
  dateText: string;
}

export const A4_W_MM = 210;
export const A4_H_MM = 297;
export const SAFE_SHEET_MARGIN_MM = 3; // 3mm printer-safe margin around block

export const DEFAULT_BOAS_VINDAS_TEXT =
  'Os integrantes do 1º Batalhão de Infantaria Mecanizado (Escola) - Regimento Sampaio - "Os Punhos de Aço da 9ª de Guerra" desejam boas-vindas e que Deus abençoe abundantemente sua estadia, que seja a mais proveitosa possível.';

export const DEFAULT_BOAS_VINDAS_DATE = 'Quartel na Vila Militar, RJ, 29 de outubro de 2026.';

export const DEFAULT_BOAS_VINDAS_CONFIG: BoasVindasConfig = {
  cardWidthMm: 134,
  cardHeightMm: 95,
  countPerPage: 4,
  bodyText: DEFAULT_BOAS_VINDAS_TEXT,
  dateText: DEFAULT_BOAS_VINDAS_DATE,
};

export interface PlacedCartaoUnit {
  index: number;
  row: number;
  col: number;
  /** Top-left corner on Portrait A4 sheet (mm) */
  xMm: number;
  yMm: number;
  /** Slot dimensions on Portrait A4 sheet (mm) */
  slotW: number;
  slotH: number;
  /** Card logical dimensions (mm) */
  cardW: number;
  cardH: number;
  /** True when card is rotated 90° clockwise on A4 (matches reference PDF) */
  rotated90: boolean;
}

export interface CartaoLayoutResult {
  cardW: number;
  cardH: number;
  requestedCount: number;
  effectiveCount: number;
  maxPerPage: number;
  cols: number;
  rows: number;
  rotated90: boolean;
  blockXMm: number;
  blockYMm: number;
  blockWMm: number;
  blockHMm: number;
  placedCards: PlacedCartaoUnit[];
  sharedVerticalSeamsMm: number[];
  sharedHorizontalSeamsMm: number[];
  oversizedWarning: string | null;
}

export function clampCardDimensions(widthMm: number, heightMm: number): {
  cardW: number;
  cardH: number;
  oversizedWarning: string | null;
} {
  const usableW = A4_W_MM - SAFE_SHEET_MARGIN_MM * 2; // 204
  const usableH = A4_H_MM - SAFE_SHEET_MARGIN_MM * 2; // 291

  const rawW = Math.max(45, Number(widthMm) || 134);
  const rawH = Math.max(35, Number(heightMm) || 95);

  let cardW = rawW;
  let cardH = rawH;
  let oversizedWarning: string | null = null;

  const fitsUpright = cardW <= usableW && cardH <= usableH;
  const fitsRotated = cardH <= usableW && cardW <= usableH;

  if (!fitsUpright && !fitsRotated) {
    // Clamp gracefully into portrait or landscape usable bounds
    if (cardW >= cardH) {
      cardW = Math.min(cardW, usableH);
      cardH = Math.min(cardH, usableW);
    } else {
      cardW = Math.min(cardW, usableW);
      cardH = Math.min(cardH, usableH);
    }
    oversizedWarning = `As dimensões foram ajustadas para ${cardW} × ${cardH} mm para caber dentro da folha A4 (área útil ${usableW} × ${usableH} mm).`;
  }

  return { cardW, cardH, oversizedWarning };
}

export function getMaxCardsPerPage(widthMm: number, heightMm: number): {
  maxPerPage: number;
  uprightCols: number;
  uprightRows: number;
  rotatedCols: number;
  rotatedRows: number;
} {
  const { cardW, cardH } = clampCardDimensions(widthMm, heightMm);
  const usableW = A4_W_MM - SAFE_SHEET_MARGIN_MM * 2; // 204
  const usableH = A4_H_MM - SAFE_SHEET_MARGIN_MM * 2; // 291

  const uprightCols = Math.floor((usableW + 0.001) / cardW);
  const uprightRows = Math.floor((usableH + 0.001) / cardH);
  const uprightMax = uprightCols * uprightRows;

  const rotatedCols = Math.floor((usableW + 0.001) / cardH);
  const rotatedRows = Math.floor((usableH + 0.001) / cardW);
  const rotatedMax = rotatedCols * rotatedRows;

  return {
    maxPerPage: Math.max(1, uprightMax, rotatedMax),
    uprightCols,
    uprightRows,
    rotatedCols,
    rotatedRows,
  };
}

interface GridCandidate {
  rotated90: boolean;
  cols: number;
  rows: number;
  slotW: number;
  slotH: number;
  waste: number;
  cuts: number;
  marginBalance: number;
}

/**
 * Computes zero-gap ("todos grudados") edge-to-edge placement centered on Portrait A4,
 * automatically capping countPerPage to the physical maximum allowed by the card dimensions.
 */
export function computeCartaoLayout(
  widthMm: number,
  heightMm: number,
  requestedCount: number
): CartaoLayoutResult {
  const { cardW, cardH, oversizedWarning } = clampCardDimensions(widthMm, heightMm);
  const limits = getMaxCardsPerPage(cardW, cardH);
  const maxPerPage = limits.maxPerPage;
  const safeRequested = Math.max(1, Math.floor(Number(requestedCount) || 1));
  const effectiveCount = Math.min(safeRequested, maxPerPage);

  const candidates: GridCandidate[] = [];

  const collect = (rotated90: boolean, maxCols: number, maxRows: number, slotW: number, slotH: number) => {
    if (maxCols <= 0 || maxRows <= 0) return;
    for (let cols = 1; cols <= maxCols; cols++) {
      for (let rows = 1; rows <= maxRows; rows++) {
        if (cols * rows < effectiveCount) continue;
        // Skip configurations with an entirely empty row or column
        if ((cols - 1) * rows >= effectiveCount) continue;
        if (cols * (rows - 1) >= effectiveCount) continue;
        const waste = cols * rows - effectiveCount;
        const cuts = (cols - 1) + (rows - 1);
        const usedW = cols * slotW;
        const usedH = rows * slotH;
        const marginBalance = Math.abs((A4_W_MM - usedW) - (A4_H_MM - usedH));
        candidates.push({ rotated90, cols, rows, slotW, slotH, waste, cuts, marginBalance });
      }
    }
  };

  collect(false, limits.uprightCols, limits.uprightRows, cardW, cardH);
  collect(true, limits.rotatedCols, limits.rotatedRows, cardH, cardW);

  candidates.sort((a, b) => {
    if (a.waste !== b.waste) return a.waste - b.waste;
    if (a.cuts !== b.cuts) return a.cuts - b.cuts;
    // When count=1 or tied cuts/waste, prefer upright first for ease of reading
    if (a.rotated90 !== b.rotated90) return a.rotated90 ? 1 : -1;
    return a.marginBalance - b.marginBalance;
  });

  const chosen: GridCandidate = candidates[0] || {
    rotated90: limits.rotatedCols * limits.rotatedRows > limits.uprightCols * limits.uprightRows,
    cols: 1,
    rows: 1,
    slotW: limits.rotatedCols * limits.rotatedRows > limits.uprightCols * limits.uprightRows ? cardH : cardW,
    slotH: limits.rotatedCols * limits.rotatedRows > limits.uprightCols * limits.uprightRows ? cardW : cardH,
    waste: 0,
    cuts: 0,
    marginBalance: 0,
  };

  const blockWMm = chosen.cols * chosen.slotW;
  const blockHMm = chosen.rows * chosen.slotH;
  const blockXMm = (A4_W_MM - blockWMm) / 2;
  const blockYMm = (A4_H_MM - blockHMm) / 2;

  const placedCards: PlacedCartaoUnit[] = [];
  for (let i = 0; i < effectiveCount; i++) {
    const row = Math.floor(i / chosen.cols);
    const col = i % chosen.cols;
    placedCards.push({
      index: i,
      row,
      col,
      xMm: blockXMm + col * chosen.slotW,
      yMm: blockYMm + row * chosen.slotH,
      slotW: chosen.slotW,
      slotH: chosen.slotH,
      cardW,
      cardH,
      rotated90: chosen.rotated90,
    });
  }

  const sharedVerticalSeamsMm: number[] = [];
  for (let c = 1; c < chosen.cols; c++) {
    sharedVerticalSeamsMm.push(blockXMm + c * chosen.slotW);
  }
  const sharedHorizontalSeamsMm: number[] = [];
  for (let r = 1; r < chosen.rows; r++) {
    sharedHorizontalSeamsMm.push(blockYMm + r * chosen.slotH);
  }

  return {
    cardW,
    cardH,
    requestedCount: safeRequested,
    effectiveCount,
    maxPerPage,
    cols: chosen.cols,
    rows: chosen.rows,
    rotated90: chosen.rotated90,
    blockXMm,
    blockYMm,
    blockWMm,
    blockHMm,
    placedCards,
    sharedVerticalSeamsMm,
    sharedHorizontalSeamsMm,
    oversizedWarning,
  };
}

let measureCanvas: HTMLCanvasElement | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas');
  }
  return measureCanvas.getContext('2d');
}

export interface BoasVindasCardMetrics {
  unit: number;
  blueThickness: number;
  whiteGap: number;
  redThickness: number;
  redInset: number;
  innerLeft: number;
  innerTop: number;
  innerW: number;
  innerH: number;
  leftPatch: { x: number; y: number; w: number; h: number };
  rightPatch: { x: number; y: number; w: number; h: number };
  repCrest: { x: number; y: number; size: number };
  headerLines: { text: string; size: number; y: number; bold: boolean }[];
  headerMaxW: number;
  titleBox: { x: number; y: number; w: number; h: number };
  bodyBox: { x: number; y: number; maxW: number; maxH: number };
  dateY: number;
  dateSize: number;
  dateMaxW: number;
  sigBox: { x: number; y: number; w: number; h: number };
  cmdNameY: number;
  cmdNameSize: number;
  cmdTitleY: number;
  cmdTitleSize: number;
  cmdMaxW: number;
  brasaoFitaBox: { x: number; y: number; w: number; h: number };
}

export function getBoasVindasCardMetrics(cardW: number, cardH: number): BoasVindasCardMetrics {
  const unit = Math.min(cardW / 134, cardH / 95);
  const blueThickness = 2.55 * unit;
  const whiteGap = 0.55 * unit;
  const redThickness = 1.95 * unit;
  const redInset = blueThickness + whiteGap;

  const innerLeft = redInset + redThickness;
  const innerTop = redInset + redThickness;
  const innerW = cardW - innerLeft * 2;
  const innerH = cardH - innerTop * 2;

  // Top-left (1º BI MEC) & Top-right (BRASIL FEB) patches aligned horizontally
  const leftPatchH = cardH * 0.205;
  const leftPatchW = leftPatchH * CARTAO_ASSET_RATIOS.distintivo1BiMec;
  const leftPatch = {
    x: cardW * 0.072,
    y: cardH * 0.068,
    w: leftPatchW,
    h: leftPatchH,
  };

  const rightPatchH = cardH * 0.20;
  const rightPatchW = rightPatchH * CARTAO_ASSET_RATIOS.distintivoFeb;
  const rightPatch = {
    x: cardW * 0.928 - rightPatchW,
    y: cardH * 0.072,
    w: rightPatchW,
    h: rightPatchH,
  };

  // Center Coat of Arms + 6 bold compact lines aligned in total height with the side logos
  const repSize = cardH * 0.068;
  const repCrest = {
    x: cardW / 2 - repSize / 2,
    y: cardH * 0.066,
    size: repSize,
  };

  const hdrFontSize = 1.52 * unit;
  const hdrLineStep = 1.96 * unit;
  const hdrStartY = repCrest.y + repSize + 2.3 * unit;
  const headerTexts = [
    'MINISTÉRIO DA DEFESA',
    'EXÉRCITO BRASILEIRO',
    'CML - 1ª DE - GUEs 9ª Bda Inf Mtz',
    '1º BATALHÃO DE INFANTARIA MECANIZADO (ESCOLA)',
    '(REGIMENTO DE BRAGANÇA/1767)',
    'REGIMENTO SAMPAIO',
  ];
  const headerLines = headerTexts.map((text, idx) => ({
    text,
    size: hdrFontSize,
    y: hdrStartY + idx * hdrLineStep,
    bold: true,
  }));
  const headerMaxW = cardW * 0.56;

  // Title "BOAS VINDAS" matching PDF width (~52% of card width)
  const titleW = cardW * 0.52;
  const titleH = titleW * (758.8 / 7491.4);
  const titleBox = {
    x: cardW / 2 - titleW / 2,
    y: cardH * 0.298,
    w: titleW,
    h: titleH,
  };

  // Edge-to-edge body text inside red frame (~83% of card width, never touching red border)
  const bodyX = cardW * 0.085;
  const bodyMaxW = cardW * 0.83;
  const bodyY = titleBox.y + titleBox.h + 3.2 * unit;
  const dateY = cardH * 0.662;
  const bodyMaxH = Math.max(8, dateY - bodyY - 3.0 * unit);

  // Signature block
  const sigH = cardH * 0.175;
  const sigW = sigH * CARTAO_ASSET_RATIOS.assinaturaCmt;
  const sigBox = {
    x: cardW / 2 - sigW / 2,
    y: cardH * 0.705,
    w: sigW,
    h: sigH,
  };

  // Bottom-right Army Crest + Red/Blue Ribbon composited directly from PDF alignment
  // Bottom ribbon tips land right on the inner edge of the blue border, right star tip touches inner red frame
  const brasaoFitaH = cardH * 0.376;
  const brasaoFitaW = brasaoFitaH * CARTAO_ASSET_RATIOS.brasaoExercitoFita;
  const brasaoFitaBox = {
    x: cardW * 0.834,
    y: cardH * 0.596,
    w: brasaoFitaW,
    h: brasaoFitaH,
  };

  return {
    unit,
    blueThickness,
    whiteGap,
    redThickness,
    redInset,
    innerLeft,
    innerTop,
    innerW,
    innerH,
    leftPatch,
    rightPatch,
    repCrest,
    headerLines,
    headerMaxW,
    titleBox,
    bodyBox: { x: bodyX, y: bodyY, maxW: bodyMaxW, maxH: bodyMaxH },
    dateY,
    dateSize: 3.05 * unit,
    dateMaxW: cardW * 0.78,
    sigBox,
    cmdNameY: cardH * 0.875,
    cmdNameSize: 2.35 * unit,
    cmdTitleY: cardH * 0.916,
    cmdTitleSize: 2.05 * unit,
    cmdMaxW: cardW * 0.66,
    brasaoFitaBox,
  };
}

/**
 * Word-wraps and justifies the welcome body text (full lines fill edge-to-edge width;
 * last line of each paragraph remains naturally left-aligned), auto-shrinking if very long.
 */
export function fitBoasVindasBodyText(
  text: string,
  maxWidthMm: number,
  maxHeightMm: number,
  cardH: number
): FittedBodyText {
  const ctx = getMeasureCtx();
  const scaleFactor = Math.min(cardH / 95, maxWidthMm / (134 * 0.83));
  const baseFontSizeMm = 3.15 * scaleFactor;
  const minFontSizeMm = 1.5 * scaleFactor;

  const cleanParagraphs = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((p) => p.trim());

  const measurePx = (s: string, fontSizeMm: number, pxScale: number): number => {
    if (ctx) return ctx.measureText(s).width;
    return s.length * fontSizeMm * pxScale * 0.45;
  };

  const wrapAndJustifyAtSize = (fontSizeMm: number): FittedBodyLine[] => {
    const pxScale = 10;
    if (ctx) {
      ctx.font = `italic 400 ${fontSizeMm * pxScale}px "Open Sans", "Plus Jakarta Sans", Arial, sans-serif`;
    }
    const maxWidthPx = maxWidthMm * pxScale;
    const spacePx = measurePx(' ', fontSizeMm, pxScale);
    const result: FittedBodyLine[] = [];

    for (const para of cleanParagraphs) {
      if (!para) {
        result.push({ words: [], isLastInParagraph: true, rawText: '' });
        continue;
      }

      const rawWords = para.split(/\s+/);
      const paraLines: string[][] = [];
      let currentWords: string[] = [];

      for (const word of rawWords) {
        const candidateStr = currentWords.length > 0 ? `${currentWords.join(' ')} ${word}` : word;
        const wPx = measurePx(candidateStr, fontSizeMm, pxScale);
        if (wPx <= maxWidthPx || currentWords.length === 0) {
          currentWords.push(word);
        } else {
          paraLines.push(currentWords);
          currentWords = [word];
        }
      }
      if (currentWords.length > 0) paraLines.push(currentWords);

      paraLines.forEach((lineWords, lineIdx) => {
        const isLastInParagraph = lineIdx === paraLines.length - 1;
        const wordWidthsPx = lineWords.map((w) => measurePx(w, fontSizeMm, pxScale));

        if (!isLastInParagraph && lineWords.length > 1) {
          const sumWordsPx = wordWidthsPx.reduce((acc, v) => acc + v, 0);
          const gapPx = Math.max(spacePx * 0.65, (maxWidthPx - sumWordsPx) / (lineWords.length - 1));
          let cursorPx = 0;
          const justified: JustifiedWord[] = lineWords.map((w, wi) => {
            const item = { text: w, xOffsetMm: cursorPx / pxScale };
            cursorPx += wordWidthsPx[wi] + gapPx;
            return item;
          });
          result.push({
            words: justified,
            isLastInParagraph: false,
            rawText: lineWords.join(' '),
          });
        } else {
          let cursorPx = 0;
          const natural: JustifiedWord[] = lineWords.map((w, wi) => {
            const item = { text: w, xOffsetMm: cursorPx / pxScale };
            cursorPx += wordWidthsPx[wi] + spacePx;
            return item;
          });
          result.push({
            words: natural,
            isLastInParagraph: true,
            rawText: lineWords.join(' '),
          });
        }
      });
    }

    return result;
  };

  let chosenSize = baseFontSizeMm;
  let chosenLines = wrapAndJustifyAtSize(chosenSize);
  const lineRatio = 1.32;

  while (chosenSize > minFontSizeMm) {
    const totalH = chosenLines.length * chosenSize * lineRatio;
    if (totalH <= maxHeightMm) break;
    chosenSize -= 0.1 * scaleFactor;
    chosenLines = wrapAndJustifyAtSize(chosenSize);
  }

  return {
    lines: chosenLines,
    fontSizeMm: Math.max(minFontSizeMm, chosenSize),
    lineHeightMm: Math.max(minFontSizeMm, chosenSize) * lineRatio,
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Falha ao carregar imagem: ${src}`));
    img.src = src;
  });
}

let cachedVectorTitleImg: HTMLImageElement | null = null;
async function getVectorTitleImage(): Promise<HTMLImageElement> {
  if (cachedVectorTitleImg) return cachedVectorTitleImg;
  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BOAS_VINDAS_TITLE_VIEWBOX}"><path d="${BOAS_VINDAS_TITLE_PATH}" fill="#000000"/></svg>`;
  const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    cachedVectorTitleImg = img;
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface LoadedCartaoImages {
  marcaDagua: HTMLImageElement;
  brasaoRepublica: HTMLImageElement;
  distintivo1BiMec: HTMLImageElement;
  distintivoFeb: HTMLImageElement;
  brasaoExercitoFita: HTMLImageElement;
  assinaturaCmt: HTMLImageElement;
  boasVindasTitle: HTMLImageElement;
}

async function loadAllCartaoImages(): Promise<LoadedCartaoImages> {
  const [
    marcaDagua,
    brasaoRepublica,
    distintivo1BiMec,
    distintivoFeb,
    brasaoExercitoFita,
    assinaturaCmt,
    boasVindasTitle,
  ] = await Promise.all([
    loadImage(CARTOES_ASSETS.marcaDagua),
    loadImage(CARTOES_ASSETS.brasaoRepublica),
    loadImage(CARTOES_ASSETS.distintivo1BiMec),
    loadImage(CARTOES_ASSETS.distintivoFeb),
    loadImage(CARTOES_ASSETS.brasaoExercitoFita),
    loadImage(CARTOES_ASSETS.assinaturaCmt),
    getVectorTitleImage(),
  ]);

  return {
    marcaDagua,
    brasaoRepublica,
    distintivo1BiMec,
    distintivoFeb,
    brasaoExercitoFita,
    assinaturaCmt,
    boasVindasTitle,
  };
}

function drawFittedTextCanvas(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  maxW: number,
  fontStr: (sizePx: number) => string,
  baseSizePx: number
) {
  let size = baseSizePx;
  ctx.font = fontStr(size);
  const measured = ctx.measureText(text).width;
  if (measured > maxW && measured > 0) {
    size = Math.max(baseSizePx * 0.55, baseSizePx * (maxW / measured));
    ctx.font = fontStr(size);
  }
  ctx.fillText(text, cx, y);
}

function drawSingleBoasVindasCardOnCanvas(
  ctx: CanvasRenderingContext2D,
  cardW: number,
  cardH: number,
  pxPerMm: number,
  config: BoasVindasConfig,
  imgs: LoadedCartaoImages
) {
  const wPx = cardW * pxPerMm;
  const hPx = cardH * pxPerMm;
  const m = getBoasVindasCardMetrics(cardW, cardH);

  // Clip strictly inside the card boundary
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, wPx, hPx);
  ctx.clip();

  // White card base
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, wPx, hPx);

  // Outer blue frame + white gap + inner red frame
  const bluePx = m.blueThickness * pxPerMm;
  const redInsetPx = m.redInset * pxPerMm;
  const redPx = m.redThickness * pxPerMm;

  ctx.strokeStyle = '#4A94FA';
  ctx.lineWidth = bluePx;
  ctx.strokeRect(bluePx / 2, bluePx / 2, wPx - bluePx, hPx - bluePx);

  ctx.strokeStyle = '#FC2902';
  ctx.lineWidth = redPx;
  ctx.strokeRect(
    redInsetPx + redPx / 2,
    redInsetPx + redPx / 2,
    wPx - (redInsetPx + redPx / 2) * 2,
    hPx - (redInsetPx + redPx / 2) * 2
  );

  // Watermark centered in interior with opacity 0.48
  const innerLeftPx = m.innerLeft * pxPerMm;
  const innerTopPx = m.innerTop * pxPerMm;
  const innerWPx = m.innerW * pxPerMm;
  const innerHPx = m.innerH * pxPerMm;

  ctx.save();
  ctx.globalAlpha = 0.48;
  let wmW = innerWPx * 0.96;
  let wmH = wmW / CARTAO_ASSET_RATIOS.marcaDagua;
  if (wmH > innerHPx * 0.94) {
    wmH = innerHPx * 0.94;
    wmW = wmH * CARTAO_ASSET_RATIOS.marcaDagua;
  }
  ctx.drawImage(
    imgs.marcaDagua,
    wPx / 2 - wmW / 2,
    innerTopPx + (innerHPx - wmH) * 0.58,
    wmW,
    wmH
  );
  ctx.restore();

  // Top-left, Top-right, and Top-center crests
  ctx.drawImage(
    imgs.distintivo1BiMec,
    m.leftPatch.x * pxPerMm,
    m.leftPatch.y * pxPerMm,
    m.leftPatch.w * pxPerMm,
    m.leftPatch.h * pxPerMm
  );
  ctx.drawImage(
    imgs.distintivoFeb,
    m.rightPatch.x * pxPerMm,
    m.rightPatch.y * pxPerMm,
    m.rightPatch.w * pxPerMm,
    m.rightPatch.h * pxPerMm
  );
  ctx.drawImage(
    imgs.brasaoRepublica,
    m.repCrest.x * pxPerMm,
    m.repCrest.y * pxPerMm,
    m.repCrest.size * pxPerMm,
    m.repCrest.size * pxPerMm
  );

  // Center institutional serif header (all lines bold, compact height matching side patches)
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const hl of m.headerLines) {
    drawFittedTextCanvas(
      ctx,
      hl.text,
      wPx / 2,
      hl.y * pxPerMm,
      m.headerMaxW * pxPerMm,
      (sz) => `${hl.bold ? 700 : 400} ${sz}px "Times New Roman", Georgia, serif`,
      hl.size * pxPerMm
    );
  }

  // Vector "BOAS VINDAS" title
  ctx.drawImage(
    imgs.boasVindasTitle,
    m.titleBox.x * pxPerMm,
    m.titleBox.y * pxPerMm,
    m.titleBox.w * pxPerMm,
    m.titleBox.h * pxPerMm
  );

  // Body paragraph (justified edge-to-edge inside red frame)
  const fitted = fitBoasVindasBodyText(config.bodyText, m.bodyBox.maxW, m.bodyBox.maxH, cardH);
  ctx.fillStyle = '#111111';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `italic 400 ${fitted.fontSizeMm * pxPerMm}px "Open Sans", "Plus Jakarta Sans", Arial, sans-serif`;

  let by = m.bodyBox.y * pxPerMm;
  const bodyStartX = m.bodyBox.x * pxPerMm;
  for (const line of fitted.lines) {
    for (const word of line.words) {
      ctx.fillText(word.text, bodyStartX + word.xOffsetMm * pxPerMm, by);
    }
    by += fitted.lineHeightMm * pxPerMm;
  }

  // Editable Date line (centered italic)
  const dateText = config.dateText.trim();
  if (dateText) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawFittedTextCanvas(
      ctx,
      dateText,
      wPx / 2,
      m.dateY * pxPerMm,
      m.dateMaxW * pxPerMm,
      (sz) => `italic 400 ${sz}px "Open Sans", "Plus Jakarta Sans", Arial, sans-serif`,
      m.dateSize * pxPerMm
    );
  }

  // Commander handwritten signature + name + title
  ctx.drawImage(
    imgs.assinaturaCmt,
    m.sigBox.x * pxPerMm,
    m.sigBox.y * pxPerMm,
    m.sigBox.w * pxPerMm,
    m.sigBox.h * pxPerMm
  );

  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  drawFittedTextCanvas(
    ctx,
    'ALEX FERREIRA GOMES JÚNIOR - TC',
    wPx / 2,
    m.cmdNameY * pxPerMm,
    m.cmdMaxW * pxPerMm,
    (sz) => `700 ${sz}px "Times New Roman", Georgia, serif`,
    m.cmdNameSize * pxPerMm
  );
  drawFittedTextCanvas(
    ctx,
    'Comandante do 1º Batalhão de Infantaria Mecanizado (Escola)',
    wPx / 2,
    m.cmdTitleY * pxPerMm,
    m.cmdMaxW * pxPerMm,
    (sz) => `400 ${sz}px "Times New Roman", Georgia, serif`,
    m.cmdTitleSize * pxPerMm
  );

  // Bottom-right cluster clipped just inside the outer blue border so ribbons match PDF cleanly
  const ribbonClipInsetPx = (m.blueThickness + m.whiteGap * 0.2) * pxPerMm;
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    ribbonClipInsetPx,
    ribbonClipInsetPx,
    wPx - ribbonClipInsetPx * 2,
    hPx - ribbonClipInsetPx * 2
  );
  ctx.clip();

  ctx.drawImage(
    imgs.brasaoExercitoFita,
    m.brasaoFitaBox.x * pxPerMm,
    m.brasaoFitaBox.y * pxPerMm,
    m.brasaoFitaBox.w * pxPerMm,
    m.brasaoFitaBox.h * pxPerMm
  );
  ctx.restore();

  ctx.restore();
}

/**
 * Renders the full A4 Portrait page at 300 DPI (2480 x 3508 px) with all cards
 * glued edge-to-edge (gap = 0) and external ruler cut ticks for single-pass cutting.
 */
export async function renderCartoesPageCanvas(
  config: BoasVindasConfig,
  dpi = 300
): Promise<HTMLCanvasElement> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const pxPerMm = dpi / 25.4;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(A4_W_MM * pxPerMm);
  canvas.height = Math.round(A4_H_MM * pxPerMm);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponível.');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const layout = computeCartaoLayout(config.cardWidthMm, config.cardHeightMm, config.countPerPage);
  const imgs = await loadAllCartaoImages();

  for (const unit of layout.placedCards) {
    ctx.save();
    const xPx = unit.xMm * pxPerMm;
    const yPx = unit.yMm * pxPerMm;

    if (unit.rotated90) {
      // Rotate 90° clockwise around top-right of card -> maps (0..cardW, 0..cardH) into (xPx..xPx+cardH, yPx..yPx+cardW)
      ctx.translate(xPx + unit.slotW * pxPerMm, yPx);
      ctx.rotate(Math.PI / 2);
      drawSingleBoasVindasCardOnCanvas(ctx, unit.cardW, unit.cardH, pxPerMm, config, imgs);
    } else {
      ctx.translate(xPx, yPx);
      drawSingleBoasVindasCardOnCanvas(ctx, unit.cardW, unit.cardH, pxPerMm, config, imgs);
    }
    ctx.restore();
  }

  // Draw crisp external crop ticks in the outer margin along every outer edge & shared cut seam
  const tickLen = 2.6 * pxPerMm;
  const tickOffset = 0.6 * pxPerMm;
  const bx0 = layout.blockXMm * pxPerMm;
  const by0 = layout.blockYMm * pxPerMm;
  const bx1 = (layout.blockXMm + layout.blockWMm) * pxPerMm;
  const by1 = (layout.blockYMm + layout.blockHMm) * pxPerMm;

  ctx.save();
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
  ctx.lineWidth = Math.max(1, 0.16 * pxPerMm);

  // Outer vertical edge ticks + shared vertical cut seams
  const allVerticalXs = [bx0, ...layout.sharedVerticalSeamsMm.map((x) => x * pxPerMm), bx1];
  for (const vx of allVerticalXs) {
    ctx.beginPath();
    ctx.moveTo(vx, Math.max(0, by0 - tickOffset - tickLen));
    ctx.lineTo(vx, Math.max(0, by0 - tickOffset));
    ctx.moveTo(vx, Math.min(canvas.height, by1 + tickOffset));
    ctx.lineTo(vx, Math.min(canvas.height, by1 + tickOffset + tickLen));
    ctx.stroke();
  }

  // Outer horizontal edge ticks + shared horizontal cut seams
  const allHorizontalYs = [by0, ...layout.sharedHorizontalSeamsMm.map((y) => y * pxPerMm), by1];
  for (const hy of allHorizontalYs) {
    ctx.beginPath();
    ctx.moveTo(Math.max(0, bx0 - tickOffset - tickLen), hy);
    ctx.lineTo(Math.max(0, bx0 - tickOffset), hy);
    ctx.moveTo(Math.min(canvas.width, bx1 + tickOffset), hy);
    ctx.lineTo(Math.min(canvas.width, bx1 + tickOffset + tickLen), hy);
    ctx.stroke();
  }

  // Thin crisp hairline right on shared seams so estilete alignment is unmistakable
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = Math.max(1, 0.14 * pxPerMm);
  for (const vxMm of layout.sharedVerticalSeamsMm) {
    const vx = vxMm * pxPerMm;
    ctx.beginPath();
    ctx.moveTo(vx, by0);
    ctx.lineTo(vx, by1);
    ctx.stroke();
  }
  for (const hyMm of layout.sharedHorizontalSeamsMm) {
    const hy = hyMm * pxPerMm;
    ctx.beginPath();
    ctx.moveTo(bx0, hy);
    ctx.lineTo(bx1, hy);
    ctx.stroke();
  }

  ctx.restore();
  return canvas;
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
 * Generates an exact A4 PDF (595.2756 x 841.8898 pt) at 300 DPI.
 */
export async function generateCartoesPdfBlob(config: BoasVindasConfig): Promise<Blob> {
  const canvas = await renderCartoesPageCanvas(config, 300);
  const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.96);
  const jpegBytes = base64ToBytes(jpegDataUrl.split(',')[1]);

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

  offsets.push(bytePos);
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  offsets.push(bytePos);
  pushStr('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  offsets.push(bytePos);
  pushStr(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.2756 841.8898] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n'
  );

  offsets.push(bytePos);
  pushStr(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
  );
  pushBytes(jpegBytes);
  pushStr('\nendstream\nendobj\n');

  const contentStream = 'q\n595.2756 0 0 841.8898 0 0 cm\n/Im0 Do\nQ\n';
  offsets.push(bytePos);
  pushStr(`5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`);

  const xrefStart = bytePos;
  pushStr(`xref\n0 ${offsets.length}\n`);
  pushStr('0000000000 65535 f \n');
  for (let i = 1; i < offsets.length; i++) {
    pushStr(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  pushStr(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}

export async function generateCartoesPngBlob(config: BoasVindasConfig): Promise<Blob> {
  const canvas = await renderCartoesPageCanvas(config, 300);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Falha ao gerar PNG.'));
    }, 'image/png');
  });
}
