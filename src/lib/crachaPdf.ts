export type CrachaMode = 'identificacao' | 'rp';
export type CrachaSidedness = 'frente' | 'frente_verso';

export interface CrachaColors {
  topBg: string;
  topText: string;
  divider: string;
  centerBg: string;
  centerText: string;
  bottomBg: string;
  bottomText: string;
}

export interface CrachaEntry {
  nomeCompleto: string;
  cpf: string;
  rpTexto: string;
  versoIgual: boolean;
  versoTexto: string;
}

export interface CrachaConfig {
  mode: CrachaMode;
  perPage: number;
  widthMm: number;
  heightMm: number;
  sidedness: CrachaSidedness;
  topText: string;
  bottomText: string;
  rpHeaderText: string;
  uppercase: boolean;
  colors: CrachaColors;
  entries: CrachaEntry[];
}

export const DEFAULT_IDENTIFICACAO_COLORS: CrachaColors = {
  topBg: '#00761A',
  topText: '#FAE102',
  divider: '#FAE102',
  centerBg: '#FFFFFF',
  centerText: '#000000',
  bottomBg: '#00761A',
  bottomText: '#FAE102',
};

export const DEFAULT_RP_COLORS: CrachaColors = {
  topBg: '#AF0000',
  topText: '#FAE102',
  divider: '#FAE102',
  centerBg: '#AF0000',
  centerText: '#FAE102',
  bottomBg: '#00761A',
  bottomText: '#FAE102',
};

export const A4_W_MM = 210;
export const A4_H_MM = 297;
export const CRACHA_CREST_SRC = '/assets/brasao_1bimec.png';

export interface PlacedBadgeUnit {
  entryIndex: number;
  xMm: number;
  yMm: number;
  unitWidthMm: number;
  unitHeightMm: number;
  foldMode: 'none' | 'horizontal' | 'vertical';
}

export interface CrachaLayoutResult {
  pages: PlacedBadgeUnit[][];
  unitWidthMm: number;
  unitHeightMm: number;
  cols: number;
  rowsPerPage: number;
  foldMode: 'none' | 'horizontal' | 'vertical';
  oversizedWarning: string | null;
}

export function computeCrachaLayout(config: CrachaConfig): CrachaLayoutResult {
  const safeW = Math.max(30, Math.min(200, Number(config.widthMm) || 95));
  const safeH = Math.max(25, Math.min(280, Number(config.heightMm) || 70));
  const count = Math.max(1, Math.min(24, Math.floor(Number(config.perPage) || 1)));

  let foldMode: 'none' | 'horizontal' | 'vertical' = 'none';
  let unitWidthMm = safeW;
  let unitHeightMm = safeH;
  let oversizedWarning: string | null = null;

  if (config.sidedness === 'frente_verso') {
    if (safeW * 2 <= 204) {
      foldMode = 'horizontal';
      unitWidthMm = safeW * 2;
      unitHeightMm = safeH;
    } else if (safeH * 2 <= 288) {
      foldMode = 'vertical';
      unitWidthMm = safeW;
      unitHeightMm = safeH * 2;
      oversizedWarning =
        'Como 2× a largura ultrapassa 204 mm, frente e verso foram colados na vertical (dobra horizontal) para caber no A4.';
    } else {
      foldMode = 'horizontal';
      unitWidthMm = safeW * 2;
      unitHeightMm = safeH;
      oversizedWarning = 'As dimensões informadas excedem os limites da folha A4 (210 × 297 mm).';
    }
  }

  const marginX = 6;
  const marginY = 6;
  const gapX = foldMode === 'none' ? 3 : 4;
  const gapY = 0; // touching vertically like the reference PDFs (or clean cut line)

  const usableW = A4_W_MM - marginX * 2;
  const usableH = A4_H_MM - marginY * 2;

  const maxCols = Math.max(1, Math.floor((usableW + gapX) / (unitWidthMm + gapX)));
  const cols = Math.min(count, maxCols);
  const maxRows = Math.max(1, Math.floor((usableH + gapY) / (unitHeightMm + gapY)));

  const itemsPerPage = cols * maxRows;
  const totalPages = Math.ceil(count / itemsPerPage);
  const pages: PlacedBadgeUnit[][] = [];

  for (let p = 0; p < totalPages; p++) {
    const startIdx = p * itemsPerPage;
    const endIdx = Math.min(count, startIdx + itemsPerPage);
    const pageCount = endIdx - startIdx;
    const pageRows = Math.ceil(pageCount / cols);
    const actualCols = Math.min(cols, pageCount);

    const gridW = actualCols * unitWidthMm + (actualCols - 1) * gapX;
    const gridH = pageRows * unitHeightMm + (pageRows - 1) * gapY;

    const startX = (A4_W_MM - gridW) / 2;
    const startY = (A4_H_MM - gridH) / 2;

    const pageUnits: PlacedBadgeUnit[] = [];
    for (let i = 0; i < pageCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      pageUnits.push({
        entryIndex: startIdx + i,
        xMm: startX + col * (unitWidthMm + gapX),
        yMm: startY + row * (unitHeightMm + gapY),
        unitWidthMm,
        unitHeightMm,
        foldMode,
      });
    }
    pages.push(pageUnits);
  }

  return {
    pages,
    unitWidthMm,
    unitHeightMm,
    cols,
    rowsPerPage: maxRows,
    foldMode,
    oversizedWarning,
  };
}

let measureCanvas: HTMLCanvasElement | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  return measureCanvas.getContext('2d');
}

function measureSafeWidthPx(ctx: CanvasRenderingContext2D, text: string): number {
  const metrics = ctx.measureText(text);
  const bboxWidth =
    typeof metrics.actualBoundingBoxLeft === 'number' &&
    typeof metrics.actualBoundingBoxRight === 'number'
      ? metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight
      : 0;
  return Math.max(metrics.width, bboxWidth);
}

export function wrapAndFitText(params: {
  text: string;
  maxWidthMm: number;
  maxHeightMm: number;
  startPt: number;
  minPt?: number;
  maxLines?: number;
}): { lines: string[]; fontPt: number; adjusted: boolean } {
  const clean = params.text.trim();
  if (!clean) return { lines: [], fontPt: params.startPt, adjusted: false };

  const ctx = getMeasureCtx();
  const minPt = params.minPt ?? 3.5;
  const maxLines = params.maxLines ?? 3;
  if (!ctx) return { lines: [clean], fontPt: params.startPt, adjusted: false };

  const mmToPx = 96 / 25.4;
  const ptToPx = 96 / 72;
  // 96% safety width prevents kerning/SVG differences from touching either crest
  const maxW = Math.max(8, params.maxWidthMm * 0.96) * mmToPx;
  const maxH = params.maxHeightMm * mmToPx;

  const paragraphs = clean.split(/\r?\n/).map((p) => p.trim()).filter(Boolean);

  for (let pt = params.startPt; pt >= minPt; pt = Number((pt - 0.5).toFixed(1))) {
    const px = pt * ptToPx;
    ctx.font = `700 ${px}px "Open Sans", Arial, sans-serif`;

    const lines: string[] = [];
    let tooWideWord = false;

    for (const para of paragraphs) {
      const words = para.split(/\s+/);
      let current = '';
      for (const word of words) {
        if (measureSafeWidthPx(ctx, word) > maxW) {
          tooWideWord = true;
          break;
        }
        const test = current ? `${current} ${word}` : word;
        if (measureSafeWidthPx(ctx, test) <= maxW) {
          current = test;
        } else {
          if (current) lines.push(current);
          current = word;
        }
      }
      if (tooWideWord) break;
      if (current) lines.push(current);
    }

    if (tooWideWord) continue;
    const totalHeight = lines.length * px * 1.15;
    if (lines.length <= maxLines && totalHeight <= maxH) {
      return { lines, fontPt: pt, adjusted: pt < params.startPt };
    }
  }

  // Fallback for ultra-long unbroken tokens: scale proportionally below minPt so crests are never touched
  const fallbackLines = paragraphs.length > 0 ? paragraphs : [clean];
  ctx.font = `700 ${minPt * ptToPx}px "Open Sans", Arial, sans-serif`;
  const widestPx = Math.max(...fallbackLines.map((ln) => measureSafeWidthPx(ctx, ln)), 1);
  const heightLimitedPt = (maxH / (fallbackLines.length * 1.15)) / ptToPx;
  const widthLimitedPt = widestPx > maxW ? (minPt * maxW) / widestPx : minPt;
  const finalPt = Math.max(2, Number(Math.min(minPt, widthLimitedPt, heightLimitedPt).toFixed(1)));

  return { lines: fallbackLines, fontPt: finalPt, adjusted: true };
}

export function getCrachaTextDiagnostics(
  config: CrachaConfig,
  entry: CrachaEntry
): { label: string; adjusted: boolean } {
  const wMm = Math.max(30, Math.min(200, Number(config.widthMm) || 95));
  const hMm = Math.max(25, Math.min(280, Number(config.heightMm) || 70));
  const fmt = (s: string) => (config.uppercase ? s.trim().toUpperCase() : s.trim());

  if (config.mode === 'identificacao') {
    const topH = hMm * 0.22;
    const divH = hMm * 0.04;
    const bottomH = hMm * 0.22;
    const centerH = hMm - topH - divH * 2 - bottomH;
    const crestH = Math.min(centerH * 0.76, hMm * 0.36);
    const crestW = crestH * (291 / 405);
    const crestPadX = wMm * 0.045;
    const textSafeW = Math.max(15, wMm - (crestPadX + crestW + 4.0) * 2);

    const nome = fmt(entry.nomeCompleto);
    const cpf = fmt(entry.cpf);
    const nomeFit = wrapAndFitText({
      text: nome,
      maxWidthMm: textSafeW,
      maxHeightMm: centerH * (cpf ? 0.52 : 0.78),
      startPt: 12.5,
      maxLines: 2,
    });
    const cpfFit = cpf
      ? wrapAndFitText({
          text: cpf,
          maxWidthMm: textSafeW,
          maxHeightMm: centerH * 0.28,
          startPt: 13,
          maxLines: 1,
        })
      : { fontPt: 13, adjusted: false };

    const adjusted = nomeFit.adjusted || cpfFit.adjusted;
    return {
      label: adjusted
        ? `Ajuste automático: Nome ${nomeFit.fontPt}pt${cpf ? ` · CPF ${cpfFit.fontPt}pt` : ''}`
        : `Padrão ${nomeFit.fontPt}pt (espaço livre ${textSafeW.toFixed(0)} mm)`,
      adjusted,
    };
  }

  const innerPad = 1.6;
  const topBodyH = hMm * 0.65;
  const innerTopH = topBodyH - innerPad;
  const crestH = Math.min(innerTopH * 0.62, hMm * 0.37);
  const crestW = crestH * (291 / 405);
  const crestPadX = innerPad + wMm * 0.045;
  const textSafeW = Math.max(15, wMm - (crestPadX + crestW + 3.5) * 2);
  const hdrH = fmt(config.rpHeaderText) ? innerTopH * 0.24 : 0;
  const mainAreaH = innerTopH - hdrH;
  const bodyText = fmt(entry.rpTexto);
  const startPt =
    bodyText.length <= 4 ? Math.min(62, mainAreaH * 1.4) : Math.min(28, mainAreaH * 0.9);
  const fit = wrapAndFitText({
    text: bodyText,
    maxWidthMm: textSafeW,
    maxHeightMm: mainAreaH * 0.85,
    startPt,
    maxLines: 3,
  });

  return {
    label: fit.adjusted
      ? `Ajuste automático: ${fit.fontPt}pt (espaço livre ${textSafeW.toFixed(0)} mm)`
      : `Padrão ${fit.fontPt}pt (espaço livre ${textSafeW.toFixed(0)} mm)`,
    adjusted: fit.adjusted,
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Falha ao carregar brasão: ${src}`));
    img.src = src;
  });
}

function drawSingleFaceCanvas(params: {
  ctx: CanvasRenderingContext2D;
  crestImg: HTMLImageElement;
  config: CrachaConfig;
  entry: CrachaEntry;
  isBack: boolean;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  rotated180?: boolean;
  mmToPx: (mm: number) => number;
  ptToPx: (pt: number) => number;
}) {
  const { ctx, crestImg, config, entry, isBack, xMm, yMm, wMm, hMm, rotated180, mmToPx, ptToPx } = params;

  ctx.save();
  if (rotated180) {
    ctx.translate(mmToPx(xMm + wMm / 2), mmToPx(yMm + hMm / 2));
    ctx.rotate(Math.PI);
    ctx.translate(-mmToPx(wMm / 2), -mmToPx(hMm / 2));
  } else {
    ctx.translate(mmToPx(xMm), mmToPx(yMm));
  }

  const wPx = mmToPx(wMm);
  const hPx = mmToPx(hMm);
  const { colors, mode, uppercase } = config;

  const fmt = (s: string) => (uppercase ? s.trim().toUpperCase() : s.trim());
  const topText = fmt(config.topText);
  const bottomText = fmt(config.bottomText);
  const rpHeaderText = fmt(config.rpHeaderText);

  if (mode === 'identificacao') {
    const topH = hMm * 0.22;
    const divH = hMm * 0.04;
    const bottomH = hMm * 0.22;
    const centerY = topH + divH;
    const centerH = hMm - topH - divH * 2 - bottomH;

    // Top band
    ctx.fillStyle = colors.topBg;
    ctx.fillRect(0, 0, wPx, mmToPx(topH));
    // Top yellow/accent divider
    ctx.fillStyle = colors.divider;
    ctx.fillRect(0, mmToPx(topH), wPx, mmToPx(divH));
    // Center band
    ctx.fillStyle = colors.centerBg;
    ctx.fillRect(0, mmToPx(centerY), wPx, mmToPx(centerH));
    // Bottom accent divider
    ctx.fillStyle = colors.divider;
    ctx.fillRect(0, mmToPx(centerY + centerH), wPx, mmToPx(divH));
    // Bottom band
    ctx.fillStyle = colors.bottomBg;
    ctx.fillRect(0, mmToPx(hMm - bottomH), wPx, mmToPx(bottomH));

    // Top text
    if (topText) {
      const fittedTop = wrapAndFitText({
        text: topText,
        maxWidthMm: wMm * 0.88,
        maxHeightMm: topH * 0.78,
        startPt: Math.min(26, topH * 1.45),
        maxLines: 1,
      });
      ctx.fillStyle = colors.topText;
      ctx.font = `700 ${ptToPx(fittedTop.fontPt)}px "Open Sans", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fittedTop.lines[0], wPx / 2, mmToPx(topH / 2));
    }

    // Bottom text
    if (bottomText) {
      const fittedBot = wrapAndFitText({
        text: bottomText,
        maxWidthMm: wMm * 0.9,
        maxHeightMm: bottomH * 0.78,
        startPt: Math.min(26, bottomH * 1.45),
        maxLines: 1,
      });
      ctx.fillStyle = colors.bottomText;
      ctx.font = `700 ${ptToPx(fittedBot.fontPt)}px "Open Sans", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fittedBot.lines[0], wPx / 2, mmToPx(hMm - bottomH / 2));
    }

    // Two side crests in center zone
    const crestH = Math.min(centerH * 0.76, hMm * 0.36);
    const crestW = crestH * (291 / 405);
    const crestPadX = wMm * 0.045;
    const crestY = centerY + (centerH - crestH) / 2;

    ctx.drawImage(crestImg, mmToPx(crestPadX), mmToPx(crestY), mmToPx(crestW), mmToPx(crestH));
    ctx.drawImage(
      crestImg,
      mmToPx(wMm - crestPadX - crestW),
      mmToPx(crestY),
      mmToPx(crestW),
      mmToPx(crestH)
    );

    // Center text (Nome Completo + CPF, or custom back text if unchecked)
    const textSafeW = Math.max(15, wMm - (crestPadX + crestW + 4.0) * 2);
    const centerMidY = centerY + centerH / 2;
    ctx.fillStyle = colors.centerText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (isBack && !entry.versoIgual && entry.versoTexto.trim()) {
      const fittedBack = wrapAndFitText({
        text: fmt(entry.versoTexto),
        maxWidthMm: textSafeW,
        maxHeightMm: centerH * 0.82,
        startPt: 13,
        maxLines: 4,
      });
      const px = ptToPx(fittedBack.fontPt);
      const lh = px * 1.18;
      ctx.font = `700 ${px}px "Open Sans", Arial, sans-serif`;
      const startY = mmToPx(centerMidY) - ((fittedBack.lines.length - 1) * lh) / 2;
      fittedBack.lines.forEach((ln, i) => ctx.fillText(ln, wPx / 2, startY + i * lh));
    } else {
      const nome = fmt(entry.nomeCompleto);
      const cpf = fmt(entry.cpf);
      const nomeFit = wrapAndFitText({
        text: nome,
        maxWidthMm: textSafeW,
        maxHeightMm: centerH * (cpf ? 0.52 : 0.78),
        startPt: 12.5,
        maxLines: 2,
      });
      const cpfFit = wrapAndFitText({
        text: cpf,
        maxWidthMm: textSafeW,
        maxHeightMm: centerH * 0.28,
        startPt: 13,
        maxLines: 1,
      });

      const nomePx = ptToPx(nomeFit.fontPt);
      const cpfPx = ptToPx(cpfFit.fontPt);
      const nomeLh = nomePx * 1.15;
      const gap = cpf && nomeFit.lines.length > 0 ? mmToPx(1.8) : 0;
      const totalBlockH = nomeFit.lines.length * nomeLh + gap + (cpf ? cpfPx : 0);
      let cursorY = mmToPx(centerMidY) - totalBlockH / 2 + nomeLh / 2;

      ctx.font = `700 ${nomePx}px "Open Sans", Arial, sans-serif`;
      for (const ln of nomeFit.lines) {
        ctx.fillText(ln, wPx / 2, cursorY);
        cursorY += nomeLh;
      }
      if (cpf) {
        cursorY += gap + cpfPx / 2 - nomeLh / 2;
        ctx.font = `700 ${cpfPx}px "Open Sans", Arial, sans-serif`;
        ctx.fillText(cpfFit.lines[0] || cpf, wPx / 2, cursorY);
      }
    }
  } else {
    // RP Mode (Red top/center body + Yellow divider + Green bottom banner)
    const topBodyH = hMm * 0.65;
    const divH = hMm * 0.05;
    const bottomH = hMm - topBodyH - divH;

    // White subtle framing margin inside outer black border (matches PDF)
    const innerPad = 1.6;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, wPx, hPx);

    const innerW = wMm - innerPad * 2;
    const innerTopH = topBodyH - innerPad;
    const innerBotH = bottomH - innerPad;

    ctx.fillStyle = colors.topBg;
    ctx.fillRect(mmToPx(innerPad), mmToPx(innerPad), mmToPx(innerW), mmToPx(innerTopH));

    ctx.fillStyle = colors.divider;
    ctx.fillRect(mmToPx(innerPad), mmToPx(topBodyH), mmToPx(innerW), mmToPx(divH));

    ctx.fillStyle = colors.bottomBg;
    ctx.fillRect(mmToPx(innerPad), mmToPx(topBodyH + divH), mmToPx(innerW), mmToPx(innerBotH));

    // Crests in top red zone
    const crestH = Math.min(innerTopH * 0.62, hMm * 0.37);
    const crestW = crestH * (291 / 405);
    const crestPadX = innerPad + wMm * 0.045;
    const crestY = innerPad + (innerTopH - crestH) / 2;

    ctx.drawImage(crestImg, mmToPx(crestPadX), mmToPx(crestY), mmToPx(crestW), mmToPx(crestH));
    ctx.drawImage(
      crestImg,
      mmToPx(wMm - crestPadX - crestW),
      mmToPx(crestY),
      mmToPx(crestW),
      mmToPx(crestH)
    );

    const textSafeW = Math.max(15, wMm - (crestPadX + crestW + 3.5) * 2);
    const bodyText = fmt(isBack && !entry.versoIgual && entry.versoTexto.trim() ? entry.versoTexto : entry.rpTexto);

    // Optional RP top header line above main text
    let mainAreaY = innerPad;
    let mainAreaH = innerTopH;
    if (rpHeaderText) {
      const hdrH = innerTopH * 0.24;
      const hdrFit = wrapAndFitText({
        text: rpHeaderText,
        maxWidthMm: textSafeW,
        maxHeightMm: hdrH,
        startPt: 13,
        maxLines: 1,
      });
      ctx.fillStyle = colors.topText;
      ctx.font = `700 ${ptToPx(hdrFit.fontPt)}px "Open Sans", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(hdrFit.lines[0], wPx / 2, mmToPx(innerPad + hdrH * 0.65));
      mainAreaY = innerPad + hdrH;
      mainAreaH = innerTopH - hdrH;
    }

    if (bodyText) {
      const startPt = bodyText.length <= 4 ? Math.min(62, mainAreaH * 1.4) : Math.min(28, mainAreaH * 0.9);
      const fit = wrapAndFitText({
        text: bodyText,
        maxWidthMm: textSafeW,
        maxHeightMm: mainAreaH * 0.85,
        startPt,
        maxLines: 3,
      });
      const px = ptToPx(fit.fontPt);
      const lh = px * 1.12;
      ctx.fillStyle = colors.centerText;
      ctx.font = `700 ${px}px "Open Sans", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const startY = mmToPx(mainAreaY + mainAreaH / 2) - ((fit.lines.length - 1) * lh) / 2;
      fit.lines.forEach((ln, i) => ctx.fillText(ln, wPx / 2, startY + i * lh));
    }

    if (bottomText) {
      const botFit = wrapAndFitText({
        text: bottomText,
        maxWidthMm: innerW * 0.9,
        maxHeightMm: innerBotH * 0.78,
        startPt: Math.min(28, innerBotH * 1.35),
        maxLines: 1,
      });
      ctx.fillStyle = colors.bottomText;
      ctx.font = `700 ${ptToPx(botFit.fontPt)}px "Open Sans", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(botFit.lines[0], wPx / 2, mmToPx(topBodyH + divH + innerBotH / 2));
    }
  }

  // Crisp outer black rectangle border
  const strokePx = mmToPx(0.55);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = strokePx;
  ctx.strokeRect(strokePx / 2, strokePx / 2, wPx - strokePx, hPx - strokePx);

  ctx.restore();
}

export async function renderCrachaPageCanvas(
  config: CrachaConfig,
  pageUnits: PlacedBadgeUnit[]
): Promise<HTMLCanvasElement> {
  if (typeof document !== 'undefined' && document.fonts) {
    await document.fonts.ready;
  }
  const crestImg = await loadImage(CRACHA_CREST_SRC);

  const DPI = 300;
  const mmToPx = (mm: number) => (mm * DPI) / 25.4;
  const ptToPx = (pt: number) => (pt * DPI) / 72;

  const canvas = document.createElement('canvas');
  canvas.width = 2480;
  canvas.height = 3508;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Contexto gráfico indisponível.');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const singleW = Math.max(30, Math.min(200, Number(config.widthMm) || 95));
  const singleH = Math.max(25, Math.min(280, Number(config.heightMm) || 70));

  for (const unit of pageUnits) {
    const entry = config.entries[unit.entryIndex] || config.entries[0];
    if (!entry) continue;

    if (unit.foldMode === 'none') {
      drawSingleFaceCanvas({
        ctx,
        crestImg,
        config,
        entry,
        isBack: false,
        xMm: unit.xMm,
        yMm: unit.yMm,
        wMm: singleW,
        hMm: singleH,
        mmToPx,
        ptToPx,
      });
    } else if (unit.foldMode === 'horizontal') {
      // Front on left, Back joined seamlessly on right
      drawSingleFaceCanvas({
        ctx,
        crestImg,
        config,
        entry,
        isBack: false,
        xMm: unit.xMm,
        yMm: unit.yMm,
        wMm: singleW,
        hMm: singleH,
        mmToPx,
        ptToPx,
      });
      drawSingleFaceCanvas({
        ctx,
        crestImg,
        config,
        entry,
        isBack: true,
        xMm: unit.xMm + singleW,
        yMm: unit.yMm,
        wMm: singleW,
        hMm: singleH,
        mmToPx,
        ptToPx,
      });
    } else {
      // Vertical fold (top rotated 180 deg, bottom upright)
      drawSingleFaceCanvas({
        ctx,
        crestImg,
        config,
        entry,
        isBack: true,
        xMm: unit.xMm,
        yMm: unit.yMm,
        wMm: singleW,
        hMm: singleH,
        rotated180: true,
        mmToPx,
        ptToPx,
      });
      drawSingleFaceCanvas({
        ctx,
        crestImg,
        config,
        entry,
        isBack: false,
        xMm: unit.xMm,
        yMm: unit.yMm + singleH,
        wMm: singleW,
        hMm: singleH,
        mmToPx,
        ptToPx,
      });
    }
  }

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
 * Generates a multi-page A4 PDF (595.2756 x 841.8898 pt) containing all computed pages.
 */
export async function generateCrachasPdfBlob(config: CrachaConfig): Promise<Blob> {
  const layout = computeCrachaLayout(config);
  const canvases = await Promise.all(
    layout.pages.map((pageUnits) => renderCrachaPageCanvas(config, pageUnits))
  );

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

  // Obj 1: Catalog, Obj 2: Pages
  offsets.push(bytePos);
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  const pageObjIds = canvases.map((_, idx) => 3 + idx * 3);
  offsets.push(bytePos);
  pushStr(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${canvases.length} >>\nendobj\n`
  );

  canvases.forEach((canvas, idx) => {
    const pageId = 3 + idx * 3;
    const imgId = pageId + 1;
    const contentId = pageId + 2;

    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.96);
    const jpegBytes = base64ToBytes(jpegDataUrl.split(',')[1]);

    offsets.push(bytePos);
    pushStr(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.2756 841.8898] /Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`
    );

    offsets.push(bytePos);
    pushStr(
      `${imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
    );
    pushBytes(jpegBytes);
    pushStr('\nendstream\nendobj\n');

    const contentStream = 'q\n595.2756 0 0 841.8898 0 0 cm\n/Im0 Do\nQ\n';
    offsets.push(bytePos);
    pushStr(
      `${contentId} 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`
    );
  });

  const xrefStart = bytePos;
  pushStr(`xref\n0 ${offsets.length}\n`);
  pushStr('0000000000 65535 f \n');
  for (let i = 1; i < offsets.length; i++) {
    pushStr(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  pushStr(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}

export async function generateCrachaPngBlob(
  config: CrachaConfig,
  pageIndex = 0
): Promise<Blob> {
  const layout = computeCrachaLayout(config);
  const pageUnits = layout.pages[pageIndex] || layout.pages[0] || [];
  const canvas = await renderCrachaPageCanvas(config, pageUnits);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Falha ao gerar PNG.'));
    }, 'image/png');
  });
}
