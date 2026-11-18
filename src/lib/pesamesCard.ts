export type PesamesPrefix = 'AO' | 'À';
export type PesamesPhotoMode = 'sem_foto' | 'com_foto';

export const PESAMES_W_PX = 1080;
export const PESAMES_H_PX = 1350;

export const PESAMES_BG_ASSET =
  '/assets/aistudio/Story_Instagram_Nota_de_Falecimento_com_Foto_Minimalista_Preto__2__86568e31.png';

export const PESAMES_CIRCLE = {
  cx: 540,
  cy: 401.5,
  r: 190,
  diam: 380,
} as const;

export interface PesamesCardData {
  prefix: PesamesPrefix;
  recipientName: string;
  photoMode: PesamesPhotoMode;
  photoUrl: string | null;
  photoNaturalW: number;
  photoNaturalH: number;
  /** User multiplier around cover-fit size (0.4 to 4.0) */
  photoScale: number;
  /** Offset from circle center in card pixels (1080x1350 space) */
  photoOffsetX: number;
  photoOffsetY: number;
}

export function formatPesamesRecipientLine(prefix: PesamesPrefix, rawName: string): string {
  const cleaned = rawName
    .trim()
    .replace(/^(AO|À)\s+/i, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
  if (!cleaned || cleaned === '(REMETENTE)') return '(REMETENTE)';
  return `${prefix} ${cleaned}`;
}

export interface CircleImageGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Shared cover + resize + pan geometry inside a circle of diameter `circleDiam`
 * centered at `(cx, cy)`. Used identically by the interactive circle cropper,
 * SVG card preview, and high-res Canvas PNG exporter.
 */
export function computeCircleImageGeometry(
  imgW: number,
  imgH: number,
  cx: number,
  cy: number,
  circleDiam: number,
  userScale: number,
  offsetX: number,
  offsetY: number
): CircleImageGeometry {
  const safeW = Math.max(1, imgW);
  const safeH = Math.max(1, imgH);
  const coverScale = Math.max(circleDiam / safeW, circleDiam / safeH);
  const finalScale = coverScale * Math.max(0.25, Math.min(5, userScale || 1));
  const width = safeW * finalScale;
  const height = safeH * finalScale;
  return {
    x: cx - width / 2 + offsetX,
    y: cy - height / 2 + offsetY,
    width,
    height,
  };
}

let measureCanvas: HTMLCanvasElement | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  return measureCanvas.getContext('2d');
}

export interface FittedPesamesRecipient {
  lines: string[];
  fontSizePx: number;
  lineHeightPx: number;
  letterSpacingPx: number;
}

/**
 * Fits recipient line ("À SRA. LIA" / "AO ...") inside y=618..686 above the cross († at y=703).
 */
export function fitPesamesRecipientText(recipientLine: string): FittedPesamesRecipient {
  const clean = recipientLine.trim();
  if (!clean) {
    return { lines: [], fontSizePx: 46, lineHeightPx: 50, letterSpacingPx: 4.2 };
  }

  const ctx = getMeasureCtx();
  const maxWidth = 920;

  const measureWithTracking = (text: string, fontSize: number, tracking: number): number => {
    if (!ctx) return text.length * (fontSize * 0.58 + tracking);
    ctx.font = `400 ${fontSize}px "Plus Jakarta Sans", "Manrope", Arial, sans-serif`;
    const baseW = ctx.measureText(text).width;
    return baseW + Math.max(0, text.length - 1) * tracking;
  };

  // Try fitting on a single crisp line from 46px down to 28px
  for (let size = 46; size >= 28; size -= 1) {
    const tracking = size * 0.09;
    if (measureWithTracking(clean, size, tracking) <= maxWidth) {
      return {
        lines: [clean],
        fontSizePx: size,
        lineHeightPx: size * 1.12,
        letterSpacingPx: tracking,
      };
    }
  }

  // Balanced 2-line wrap for very long full names
  const words = clean.split(/\s+/);
  for (let size = 34; size >= 22; size -= 1) {
    const tracking = size * 0.075;
    let bestSplit: [string, string] | null = null;
    let bestDiff = Infinity;

    for (let splitIdx = 1; splitIdx < words.length; splitIdx++) {
      const l1 = words.slice(0, splitIdx).join(' ');
      const l2 = words.slice(splitIdx).join(' ');
      const w1 = measureWithTracking(l1, size, tracking);
      const w2 = measureWithTracking(l2, size, tracking);
      if (w1 <= maxWidth && w2 <= maxWidth) {
        const diff = Math.abs(w1 - w2);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestSplit = [l1, l2];
        }
      }
    }

    if (bestSplit) {
      return {
        lines: bestSplit,
        fontSizePx: size,
        lineHeightPx: size * 1.12,
        letterSpacingPx: tracking,
      };
    }
  }

  const mid = Math.ceil(words.length / 2);
  const line1 = words.slice(0, mid).join(' ');
  const line2 = words.slice(mid).join(' ');
  return {
    lines: line2 ? [line1, line2] : [line1],
    fontSizePx: 22,
    lineHeightPx: 25,
    letterSpacingPx: 1.5,
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('blob:') && !src.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Falha ao carregar imagem para o cartão de pêsames.'));
    img.src = src;
  });
}

function drawTrackedLineCanvas(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  fontSizePx: number,
  trackingPx: number
) {
  ctx.font = `400 ${fontSizePx}px "Plus Jakarta Sans", "Manrope", Arial, sans-serif`;
  let totalW = 0;
  for (let i = 0; i < text.length; i++) {
    totalW += ctx.measureText(text[i]).width;
    if (i < text.length - 1) totalW += trackingPx;
  }

  let cursorX = cx - totalW / 2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    ctx.fillText(ch, cursorX, cy);
    cursorX += ctx.measureText(ch).width + trackingPx;
  }
}

export async function renderPesamesCardCanvas(card: PesamesCardData): Promise<HTMLCanvasElement> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const [bgImg, photoImg] = await Promise.all([
    loadImage(PESAMES_BG_ASSET),
    card.photoMode === 'com_foto' && card.photoUrl ? loadImage(card.photoUrl) : Promise.resolve(null),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = PESAMES_W_PX;
  canvas.height = PESAMES_H_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponível.');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Base mourning template (1080 x 1350)
  ctx.drawImage(bgImg, 0, 0, PESAMES_W_PX, PESAMES_H_PX);

  // Smooth black fade mask covering the sample recipient band cleanly above the cross († at y=703)
  const maskGrad = ctx.createLinearGradient(0, 540, 0, 699);
  maskGrad.addColorStop(0, 'rgba(0,0,0,0)');
  maskGrad.addColorStop(0.49, 'rgba(0,0,0,1)');
  maskGrad.addColorStop(0.91, 'rgba(0,0,0,1)');
  maskGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = maskGrad;
  ctx.fillRect(0, 540, PESAMES_W_PX, 160);

  // Circular photo frame when "Com foto" is selected
  if (card.photoMode === 'com_foto' && photoImg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(PESAMES_CIRCLE.cx, PESAMES_CIRCLE.cy, PESAMES_CIRCLE.r, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = '#111111';
    ctx.fillRect(
      PESAMES_CIRCLE.cx - PESAMES_CIRCLE.r,
      PESAMES_CIRCLE.cy - PESAMES_CIRCLE.r,
      PESAMES_CIRCLE.diam,
      PESAMES_CIRCLE.diam
    );

    const imgW = photoImg.naturalWidth || card.photoNaturalW || PESAMES_CIRCLE.diam;
    const imgH = photoImg.naturalHeight || card.photoNaturalH || PESAMES_CIRCLE.diam;
    const geom = computeCircleImageGeometry(
      imgW,
      imgH,
      PESAMES_CIRCLE.cx,
      PESAMES_CIRCLE.cy,
      PESAMES_CIRCLE.diam,
      card.photoScale,
      card.photoOffsetX,
      card.photoOffsetY
    );
    ctx.drawImage(photoImg, geom.x, geom.y, geom.width, geom.height);
    ctx.restore();
  }

  // Recipient line ("À ..." / "AO ...")
  const recipientLine = formatPesamesRecipientLine(card.prefix, card.recipientName);
  if (recipientLine) {
    const fitted = fitPesamesRecipientText(recipientLine);
    ctx.fillStyle = '#FFFFFF';
    const centerBandY = 653;
    if (fitted.lines.length === 1) {
      drawTrackedLineCanvas(
        ctx,
        fitted.lines[0],
        PESAMES_W_PX / 2,
        centerBandY,
        fitted.fontSizePx,
        fitted.letterSpacingPx
      );
    } else {
      const startY = centerBandY - ((fitted.lines.length - 1) * fitted.lineHeightPx) / 2;
      fitted.lines.forEach((line, idx) => {
        drawTrackedLineCanvas(
          ctx,
          line,
          PESAMES_W_PX / 2,
          startY + idx * fitted.lineHeightPx,
          fitted.fontSizePx,
          fitted.letterSpacingPx
        );
      });
    }
  }

  return canvas;
}

export async function generatePesamesPngBlob(card: PesamesCardData): Promise<Blob> {
  const canvas = await renderPesamesCardCanvas(card);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Falha ao gerar PNG do cartão de pêsames.'));
    }, 'image/png');
  });
}
