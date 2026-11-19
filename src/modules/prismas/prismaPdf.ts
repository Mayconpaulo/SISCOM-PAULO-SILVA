export interface PrismaData {
  nome: string;
  funcao: string;
}

export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;
export const PRISMA_WIDTH_MM = 153.75;
export const PRISMA_HEIGHT_MM = 102.5;
export const PRISMA_GAP_MM = 0.75;
export const FACE_HEIGHT_MM = PRISMA_HEIGHT_MM / 2; // 51.25mm
export const BORDER_MM = 1.06;

export const PRISMA_LEFT_MM = (A4_WIDTH_MM - PRISMA_WIDTH_MM) / 2; // 28.125mm

export const LEFT_CREST = {
  src: '/assets/brasao_exercito.png',
  insetLeftMm: 4.0,
  widthMm: 24.7,
  heightMm: 37.26,
};

export const RIGHT_CREST = {
  src: '/assets/brasao_1bimec.png',
  insetRightMm: 4.6,
  widthMm: 24.1,
  heightMm: 33.54,
};

const TEXT_SAFETY_PAD_MM = 4.0;
export const TEXT_LEFT_LIMIT_MM = LEFT_CREST.insetLeftMm + LEFT_CREST.widthMm + TEXT_SAFETY_PAD_MM; // 32.7mm
export const TEXT_RIGHT_LIMIT_MM =
  PRISMA_WIDTH_MM - RIGHT_CREST.insetRightMm - RIGHT_CREST.widthMm - TEXT_SAFETY_PAD_MM; // 121.05mm
export const TEXT_SAFE_WIDTH_MM = TEXT_RIGHT_LIMIT_MM - TEXT_LEFT_LIMIT_MM; // 88.35mm
export const TEXT_CENTER_X_MM = (TEXT_LEFT_LIMIT_MM + TEXT_RIGHT_LIMIT_MM) / 2; // 76.875mm

export const STANDARD_FONT_PT = 20;
const MIN_FONT_PT = 3.5;

export function getPrismaTopPositionsMm(count: 1 | 2): number[] {
  if (count === 1) {
    return [(A4_HEIGHT_MM - PRISMA_HEIGHT_MM) / 2];
  }
  const totalHeight = PRISMA_HEIGHT_MM * 2 + PRISMA_GAP_MM;
  const topFirst = (A4_HEIGHT_MM - totalHeight) / 2;
  return [topFirst, topFirst + PRISMA_HEIGHT_MM + PRISMA_GAP_MM];
}

let measureCanvas: HTMLCanvasElement | null = null;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas');
  }
  return measureCanvas.getContext('2d');
}

function measureTextSafeWidthPx(ctx: CanvasRenderingContext2D, text: string): number {
  const metrics = ctx.measureText(text);
  const bboxWidth =
    typeof metrics.actualBoundingBoxLeft === 'number' &&
    typeof metrics.actualBoundingBoxRight === 'number'
      ? metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight
      : 0;
  return Math.max(metrics.width, bboxWidth);
}

/**
 * Keeps font size strictly equal to STANDARD_FONT_PT (20pt) unless the text
 * would encroach on the safe area between the two crests. Only then does it shrink.
 */
export function computeFittedFontPt(text: string, weight: '400' | '700'): number {
  const clean = text.trim();
  if (!clean) return STANDARD_FONT_PT;

  const ctx = getMeasureContext();
  if (!ctx) return STANDARD_FONT_PT;

  // Measure in px at 96 DPI with 97% safety margin against browser subpixel kerning
  const mmToPx = 96 / 25.4;
  const ptToPx = 96 / 72;
  const maxWidthPx = TEXT_SAFE_WIDTH_MM * 0.97 * mmToPx;

  let sizePt = STANDARD_FONT_PT;
  while (sizePt > MIN_FONT_PT) {
    ctx.font = `${weight} ${sizePt * ptToPx}px "Open Sans", Arial, sans-serif`;
    if (measureTextSafeWidthPx(ctx, clean) <= maxWidthPx) {
      return sizePt;
    }
    sizePt = Number((sizePt - 0.5).toFixed(1));
  }

  ctx.font = `${weight} ${MIN_FONT_PT * ptToPx}px "Open Sans", Arial, sans-serif`;
  const minW = measureTextSafeWidthPx(ctx, clean);
  if (minW > maxWidthPx && minW > 0) {
    return Math.max(2, Number(((MIN_FONT_PT * maxWidthPx) / minW).toFixed(1)));
  }
  return MIN_FONT_PT;
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

/**
 * Renders the exact A4 page at 300 DPI (2480 x 3508 px) on an HTML5 canvas.
 */
export async function renderA4PrismaCanvas(
  count: 1 | 2,
  prismas: [PrismaData, PrismaData],
  uppercase: boolean
): Promise<HTMLCanvasElement> {
  if (typeof document !== 'undefined' && document.fonts) {
    await document.fonts.ready;
  }

  const [exercitoImg, batalhaoImg] = await Promise.all([
    loadImage(LEFT_CREST.src),
    loadImage(RIGHT_CREST.src),
  ]);

  const DPI = 300;
  const mmToPx = (mm: number) => (mm * DPI) / 25.4;
  const ptToPx = (pt: number) => (pt * DPI) / 72;

  const widthPx = 2480;
  const heightPx = 3508;

  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Não foi possível inicializar o contexto gráfico.');
  }

  // Crisp white A4 paper background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, widthPx, heightPx);

  const topsMm = getPrismaTopPositionsMm(count);
  const activePrismas = count === 1 ? [prismas[0]] : [prismas[0], prismas[1]];

  const rectX = mmToPx(PRISMA_LEFT_MM);
  const rectW = mmToPx(PRISMA_WIDTH_MM);
  const rectH = mmToPx(PRISMA_HEIGHT_MM);
  const faceH = mmToPx(FACE_HEIGHT_MM);
  const strokePx = mmToPx(BORDER_MM);

  const leftCrestW = mmToPx(LEFT_CREST.widthMm);
  const leftCrestH = mmToPx(LEFT_CREST.heightMm);
  const leftCrestX = rectX + mmToPx(LEFT_CREST.insetLeftMm);

  const rightCrestW = mmToPx(RIGHT_CREST.widthMm);
  const rightCrestH = mmToPx(RIGHT_CREST.heightMm);
  const rightCrestX = rectX + rectW - mmToPx(RIGHT_CREST.insetRightMm) - rightCrestW;

  const textCenterX = rectX + mmToPx(TEXT_CENTER_X_MM);

  for (let idx = 0; idx < activePrismas.length; idx++) {
    const item = activePrismas[idx];
    const rectY = mmToPx(topsMm[idx]);

    const rawNome = item.nome.trim();
    const rawFuncao = item.funcao.trim();
    const nome = uppercase ? rawNome.toUpperCase() : rawNome;
    const funcao = uppercase ? rawFuncao.toUpperCase() : rawFuncao;

    const nomePt = computeFittedFontPt(nome, '700');
    const funcaoPt = computeFittedFontPt(funcao, '400');

    const nomePx = ptToPx(nomePt);
    const funcaoPx = ptToPx(funcaoPt);

    const drawFace = (faceY: number, rotated: boolean) => {
      const leftCrestY = faceY + (faceH - leftCrestH) / 2;
      const rightCrestY = faceY + (faceH - rightCrestH) / 2;
      const faceCenterY = faceY + faceH / 2;

      // Left crest (Brasão do Exército)
      ctx.save();
      if (rotated) {
        ctx.translate(leftCrestX + leftCrestW / 2, leftCrestY + leftCrestH / 2);
        ctx.rotate(Math.PI);
        ctx.drawImage(exercitoImg, -leftCrestW / 2, -leftCrestH / 2, leftCrestW, leftCrestH);
      } else {
        ctx.drawImage(exercitoImg, leftCrestX, leftCrestY, leftCrestW, leftCrestH);
      }
      ctx.restore();

      // Right crest (Brasão 1º BI MEC (ES))
      ctx.save();
      if (rotated) {
        ctx.translate(rightCrestX + rightCrestW / 2, rightCrestY + rightCrestH / 2);
        ctx.rotate(Math.PI);
        ctx.drawImage(batalhaoImg, -rightCrestW / 2, -rightCrestH / 2, rightCrestW, rightCrestH);
      } else {
        ctx.drawImage(batalhaoImg, rightCrestX, rightCrestY, rightCrestW, rightCrestH);
      }
      ctx.restore();

      // Centered text block (Nome bold + Função regular)
      ctx.save();
      ctx.translate(textCenterX, faceCenterY);
      if (rotated) {
        ctx.rotate(Math.PI);
      }
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const lineOffset = mmToPx(4.2);
      if (nome && funcao) {
        ctx.font = `700 ${nomePx}px "Open Sans", Arial, sans-serif`;
        ctx.fillText(nome, 0, -lineOffset);

        ctx.font = `400 ${funcaoPx}px "Open Sans", Arial, sans-serif`;
        ctx.fillText(funcao, 0, lineOffset);
      } else if (nome) {
        ctx.font = `700 ${nomePx}px "Open Sans", Arial, sans-serif`;
        ctx.fillText(nome, 0, 0);
      } else if (funcao) {
        ctx.font = `400 ${funcaoPx}px "Open Sans", Arial, sans-serif`;
        ctx.fillText(funcao, 0, 0);
      }
      ctx.restore();
    };

    // Top half-face (rotated 180° for folding)
    drawFace(rectY, true);
    // Bottom half-face (upright)
    drawFace(rectY + faceH, false);

    // Outer black rectangle frame
    ctx.save();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = strokePx;
    ctx.strokeRect(rectX + strokePx / 2, rectY + strokePx / 2, rectW - strokePx, rectH - strokePx);
    ctx.restore();
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
 * Wraps the 300-DPI A4 JPEG render inside a clean, valid PDF 1.4 A4 document (595.2756 x 841.8898 pt).
 */
export async function generateA4PdfBlob(
  count: 1 | 2,
  prismas: [PrismaData, PrismaData],
  uppercase: boolean
): Promise<Blob> {
  const canvas = await renderA4PrismaCanvas(count, prismas, uppercase);
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

export async function generateA4PngBlob(
  count: 1 | 2,
  prismas: [PrismaData, PrismaData],
  uppercase: boolean
): Promise<Blob> {
  const canvas = await renderA4PrismaCanvas(count, prismas, uppercase);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Falha ao gerar imagem PNG.'));
    }, 'image/png');
  });
}
