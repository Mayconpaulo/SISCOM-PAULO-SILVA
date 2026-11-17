import JSZip from 'jszip';
import { CARTAO_ASSET_RATIOS, CARTOES_ASSETS, type FittedBodyLine, type JustifiedWord } from './cartoesPdf';

export type AniversarioAudience = 'batalhao' | 'eterno_comandante';
export type AniversarioInputMode = 'relacao' | 'individual';

export const ANIV_W_PX = 1600;
export const ANIV_H_PX = 1135;

export const DEFAULT_ANIV_BODY_BATALHAO =
  'Os integrantes do 1° Batalhão de Infantaria Mecanizado (Escola) - Regimento Sampaio - "Os Punhos de Aço da 9ª de Guerra" cumprimentam o prezado companheiro pelo transcurso de sua data natalícia, formulando votos de saúde e felicidade extensivos a sua digníssima família.';

export const DEFAULT_ANIV_BODY_ETERNO_CMT =
  'Os integrantes do 1° Batalhão de Infantaria Mecanizado (Escola) - Regimento Sampaio - "Os Punhos de Aço da 9ª de Guerra" cumprimentam o Eterno Comandante pelo transcurso de sua data natalícia, formulando votos de saúde e felicidade extensivos a sua digníssima família.';

export interface AniversarioCardData {
  recipientLine: string; // e.g. "AO SD INF JOSUE GAIBA COELHO"
  bodyText: string;
  dateLine: string; // e.g. "Quartel na Vila Militar, RJ, 5 de Novembro de 2026"
}

export const ANIV_METRICS = {
  width: ANIV_W_PX,
  height: ANIV_H_PX,
  blueBorder: 22,
  redBorder: 23,
  innerLeft: 45,
  innerTop: 45,
  innerW: ANIV_W_PX - 90,
  innerH: ANIV_H_PX - 90,
  leftPatch: { x: 113, y: 88, w: 176, h: 246 },
  rightPatch: { x: 1311, y: 99, w: 185, h: 225 },
  recipientY: 405,
  recipientSize: 36,
  recipientTracking: 3.2,
  recipientMaxW: 1320,
  bodyX: 156,
  bodyY: 494,
  bodyMaxW: 1288,
  bodyMaxH: 255,
  dateY: 805,
  dateSize: 34,
  dateMaxW: 1220,
  sigBox: { x: 800 - (245 * CARTAO_ASSET_RATIOS.assinaturaCmt) / 2, y: 828, w: 245 * CARTAO_ASSET_RATIOS.assinaturaCmt, h: 245 },
  cmdNameY: 936,
  cmdNameSize: 35,
  cmdTitleY: 974,
  cmdTitleSize: 31,
  cmdMaxW: 1240,
} as const;

let measureCanvas: HTMLCanvasElement | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  return measureCanvas.getContext('2d');
}

export interface FittedAniversarioBody {
  lines: FittedBodyLine[];
  fontSizePx: number;
  lineHeightPx: number;
}

export function fitAniversarioBodyText(text: string): FittedAniversarioBody {
  const ctx = getMeasureCtx();
  const baseFontSizePx = 36.5;
  const minFontSizePx = 20;
  const maxWidthPx = ANIV_METRICS.bodyMaxW;
  const maxHeightPx = ANIV_METRICS.bodyMaxH;

  const cleanParagraphs = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((p) => p.trim());

  const measurePx = (s: string, fontSizePx: number): number => {
    if (ctx) return ctx.measureText(s).width;
    return s.length * fontSizePx * 0.45;
  };

  const wrapAt = (fontSizePx: number): FittedBodyLine[] => {
    if (ctx) {
      ctx.font = `italic 400 ${fontSizePx}px "Open Sans", "Plus Jakarta Sans", Arial, sans-serif`;
    }
    const spacePx = measurePx(' ', fontSizePx);
    const result: FittedBodyLine[] = [];

    for (const para of cleanParagraphs) {
      if (!para) {
        result.push({ words: [], isLastInParagraph: true, rawText: '' });
        continue;
      }
      const rawWords = para.split(/\s+/);
      const paraLines: string[][] = [];
      let cur: string[] = [];

      for (const w of rawWords) {
        const cand = cur.length > 0 ? `${cur.join(' ')} ${w}` : w;
        if (measurePx(cand, fontSizePx) <= maxWidthPx || cur.length === 0) {
          cur.push(w);
        } else {
          paraLines.push(cur);
          cur = [w];
        }
      }
      if (cur.length > 0) paraLines.push(cur);

      paraLines.forEach((lineWords, idx) => {
        const isLast = idx === paraLines.length - 1;
        const widths = lineWords.map((w) => measurePx(w, fontSizePx));

        if (!isLast && lineWords.length > 1) {
          const sumW = widths.reduce((a, b) => a + b, 0);
          const gap = Math.max(spacePx * 0.65, (maxWidthPx - sumW) / (lineWords.length - 1));
          let cx = 0;
          const words: JustifiedWord[] = lineWords.map((w, wi) => {
            const item = { text: w, xOffsetMm: cx };
            cx += widths[wi] + gap;
            return item;
          });
          result.push({ words, isLastInParagraph: false, rawText: lineWords.join(' ') });
        } else {
          let cx = 0;
          const words: JustifiedWord[] = lineWords.map((w, wi) => {
            const item = { text: w, xOffsetMm: cx };
            cx += widths[wi] + spacePx;
            return item;
          });
          result.push({ words, isLastInParagraph: true, rawText: lineWords.join(' ') });
        }
      });
    }
    return result;
  };

  let size = baseFontSizePx;
  let lines = wrapAt(size);
  const lineRatio = 1.62;

  while (size > minFontSizePx) {
    if (lines.length * size * lineRatio <= maxHeightPx) break;
    size -= 1;
    lines = wrapAt(size);
  }

  return {
    lines,
    fontSizePx: size,
    lineHeightPx: size * lineRatio,
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

interface AnivLoadedAssets {
  marcaDagua: HTMLImageElement;
  distintivo1BiMec: HTMLImageElement;
  distintivoFeb: HTMLImageElement;
  assinaturaCmt: HTMLImageElement;
}

let cachedAssetsPromise: Promise<AnivLoadedAssets> | null = null;
function loadAnivAssets(): Promise<AnivLoadedAssets> {
  if (!cachedAssetsPromise) {
    cachedAssetsPromise = Promise.all([
      loadImage(CARTOES_ASSETS.marcaDagua),
      loadImage(CARTOES_ASSETS.distintivo1BiMec),
      loadImage(CARTOES_ASSETS.distintivoFeb),
      loadImage(CARTOES_ASSETS.assinaturaCmt),
    ]).then(([marcaDagua, distintivo1BiMec, distintivoFeb, assinaturaCmt]) => ({
      marcaDagua,
      distintivo1BiMec,
      distintivoFeb,
      assinaturaCmt,
    }));
  }
  return cachedAssetsPromise;
}

function drawTrackedCenteredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  maxW: number,
  fontStr: (size: number) => string,
  baseSize: number,
  baseTracking: number
) {
  let size = baseSize;
  let tracking = baseTracking;
  const measureTotal = (s: string, tr: number) => {
    let w = 0;
    for (let i = 0; i < s.length; i++) {
      w += ctx.measureText(s[i]).width;
      if (i < s.length - 1) w += tr;
    }
    return w;
  };

  ctx.font = fontStr(size);
  let totalW = measureTotal(text, tracking);
  if (totalW > maxW && totalW > 0) {
    const ratio = maxW / totalW;
    size = Math.max(baseSize * 0.52, baseSize * ratio);
    tracking = baseTracking * ratio;
    ctx.font = fontStr(size);
    totalW = measureTotal(text, tracking);
  }

  let cursorX = cx - totalW / 2;
  ctx.textAlign = 'left';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    ctx.fillText(ch, cursorX, y);
    cursorX += ctx.measureText(ch).width + tracking;
  }
}

export async function renderAniversarioCardCanvas(
  card: AniversarioCardData
): Promise<HTMLCanvasElement> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const assets = await loadAnivAssets();
  const canvas = document.createElement('canvas');
  canvas.width = ANIV_W_PX;
  canvas.height = ANIV_H_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponível.');

  const m = ANIV_METRICS;

  // White base
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, ANIV_W_PX, ANIV_H_PX);

  // Outer blue border (#4A94FA) touching inner red border (#FC2902) directly
  ctx.strokeStyle = '#4A94FA';
  ctx.lineWidth = m.blueBorder;
  ctx.strokeRect(m.blueBorder / 2, m.blueBorder / 2, ANIV_W_PX - m.blueBorder, ANIV_H_PX - m.blueBorder);

  ctx.strokeStyle = '#FC2902';
  ctx.lineWidth = m.redBorder;
  ctx.strokeRect(
    m.blueBorder + m.redBorder / 2,
    m.blueBorder + m.redBorder / 2,
    ANIV_W_PX - (m.blueBorder + m.redBorder / 2) * 2,
    ANIV_H_PX - (m.blueBorder + m.redBorder / 2) * 2
  );

  // Watermark stretched cleanly across inner area
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.drawImage(assets.marcaDagua, m.innerLeft, m.innerTop + 30, m.innerW, m.innerH - 30);
  ctx.restore();

  // Top-left & top-right logos
  ctx.drawImage(
    assets.distintivo1BiMec,
    m.leftPatch.x,
    m.leftPatch.y,
    m.leftPatch.w,
    m.leftPatch.h
  );
  ctx.drawImage(
    assets.distintivoFeb,
    m.rightPatch.x,
    m.rightPatch.y,
    m.rightPatch.w,
    m.rightPatch.h
  );

  // Recipient line (centered wide-tracked serif)
  ctx.fillStyle = '#111111';
  ctx.textBaseline = 'middle';
  drawTrackedCenteredText(
    ctx,
    card.recipientLine.trim(),
    ANIV_W_PX / 2,
    m.recipientY,
    m.recipientMaxW,
    (sz) => `400 ${sz}px "Times New Roman", Georgia, serif`,
    m.recipientSize,
    m.recipientTracking
  );

  // Justified italic body paragraph
  const fitted = fitAniversarioBodyText(card.bodyText);
  ctx.fillStyle = '#111111';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `italic 400 ${fitted.fontSizePx}px "Open Sans", "Plus Jakarta Sans", Arial, sans-serif`;

  let by = m.bodyY;
  for (const line of fitted.lines) {
    for (const w of line.words) {
      ctx.fillText(w.text, m.bodyX + w.xOffsetMm, by);
    }
    by += fitted.lineHeightPx;
  }

  // Date line (centered serif)
  ctx.fillStyle = '#111111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let dateSize: number = m.dateSize;
  ctx.font = `400 ${dateSize}px "Times New Roman", Georgia, serif`;
  const dm = ctx.measureText(card.dateLine).width;
  if (dm > m.dateMaxW && dm > 0) {
    dateSize = Math.max(20, dateSize * (m.dateMaxW / dm));
    ctx.font = `400 ${dateSize}px "Times New Roman", Georgia, serif`;
  }
  ctx.fillText(card.dateLine, ANIV_W_PX / 2, m.dateY);

  // Handwritten signature + Commander name & title
  ctx.drawImage(
    assets.assinaturaCmt,
    m.sigBox.x,
    m.sigBox.y,
    m.sigBox.w,
    m.sigBox.h
  );

  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${m.cmdNameSize}px "Times New Roman", Georgia, serif`;
  ctx.fillText('ALEX FERREIRA GOMES JÚNIOR - TC', ANIV_W_PX / 2, m.cmdNameY);

  ctx.font = `400 ${m.cmdTitleSize}px "Times New Roman", Georgia, serif`;
  ctx.fillText(
    'Comandante do 1º Batalhão de Infantaria Mecanizado (Escola)',
    ANIV_W_PX / 2,
    m.cmdTitleY
  );

  return canvas;
}

export async function generateAniversarioPngBlob(card: AniversarioCardData): Promise<Blob> {
  const canvas = await renderAniversarioCardCanvas(card);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Falha ao gerar PNG do cartão de aniversário.'));
    }, 'image/png');
  });
}

function sanitizeFilename(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_\- ]+/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

export async function generateAniversariosZipBlob(
  items: { filenameBase: string; card: AniversarioCardData }[],
  onProgress?: (current: number, total: number) => void
): Promise<Blob> {
  const zip = new JSZip();
  for (let i = 0; i < items.length; i++) {
    onProgress?.(i + 1, items.length);
    const pngBlob = await generateAniversarioPngBlob(items[i].card);
    const prefix = String(i + 1).padStart(2, '0');
    const safeName = sanitizeFilename(items[i].filenameBase) || `cartao_${prefix}`;
    zip.file(`${prefix}_${safeName}.png`, pngBlob);
  }
  return zip.generateAsync({ type: 'blob' });
}
