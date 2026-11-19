import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker, PSM } from 'tesseract.js';
import { inferPortugueseRecipientPrefix } from '../../../shared/portugueseGender';

export { inferPortugueseRecipientPrefix };

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface AniversarianteEntry {
  id: string;
  sigla: string;
  qualificacao: string;
  nome: string;
  dia: string;
  mes: string;
  prefix?: string;
  rawDataNasc?: string;
}

export interface ParsedAniversariantesResult {
  monthName: string;
  year: number;
  entries: AniversarianteEntry[];
}

export const MONTHS_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const;

export function monthNumberToName(mm: number): string {
  if (mm >= 1 && mm <= 12) return MONTHS_PT[mm - 1];
  return 'Setembro';
}

export function normalizeMonthName(raw: string): string | null {
  const clean = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  const map: Record<string, string> = {
    janeiro: 'Janeiro',
    fevereiro: 'Fevereiro',
    marco: 'Março',
    abril: 'Abril',
    maio: 'Maio',
    junho: 'Junho',
    julho: 'Julho',
    agosto: 'Agosto',
    setembro: 'Setembro',
    outubro: 'Outubro',
    novembro: 'Novembro',
    dezembro: 'Dezembro',
  };
  for (const [k, v] of Object.entries(map)) {
    if (clean.includes(k)) return v;
  }
  return null;
}

/**
 * Normalizes extracted military rank (sigla) and qualification (qualificação)
 * according to Battalion rules:
 * - Whenever sigla is SD (including "Sd Rcr") and qualificação is RS, RSCT, RCR, "-", or empty:
 *   strip qualificação and keep only "SD".
 * - When sigla is SD and qualificação is INF, INT, SAU, COM, etc.: keep both ("SD INF", "SD INT", "SD SAU").
 */
export function normalizeSiglaAndQualificacao(
  rawSigla: string,
  rawQual: string
): { sigla: string; qualificacao: string } {
  let s = rawSigla
    .replace(/\s+/g, ' ')
    .replace(/[|[\]{}]/g, '')
    .trim()
    .toUpperCase();

  // Common OCR corrections for ranks
  s = s
    .replace(/\bSD\s*RCR\b/gi, 'SD RCR')
    .replace(/\bSD\s*RSCT\b/gi, 'SD RSCT')
    .replace(/\bSD\s*RS\b/gi, 'SD RS')
    .replace(/\b3[°º0Oo*ªa]?\s*SGT\b/gi, '3º SGT')
    .replace(/\b2[°º0Oo*ªa]?\s*SGT\b/gi, '2º SGT')
    .replace(/\b1[°º0Oo*ªa]?\s*SGT\b/gi, '1º SGT')
    .replace(/\b3[°º0Oo*ªa]?\s*TEN\b/gi, '3º TEN')
    .replace(/\b2[°º0Oo*ªa]?\s*TEN\b/gi, '2º TEN')
    .replace(/\b1[°º0Oo*ªa]?\s*TEN\b/gi, '1º TEN')
    .replace(/\bSUB\s*TEN\b/gi, 'ST')
    .replace(/\bSD\b/gi, 'SD')
    .replace(/\bCB\b/gi, 'CB');

  let q = rawQual
    .replace(/\s+/g, ' ')
    .replace(/[|[\]{}_.,:;]/g, '')
    .trim()
    .toUpperCase();

  // Common OCR fixes in military qualifications
  q = q
    .replace(/^SV[IL1][IT]$/i, 'SVTT')
    .replace(/^SVTT$/i, 'SVTT')
    .replace(/^EBCT$/i, 'EBCT')
    .replace(/^MAT\s*BEL$/i, 'MAT BEL')
    .replace(/^INF$/i, 'INF')
    .replace(/^INT$/i, 'INT')
    .replace(/^SAU$/i, 'SAU')
    .replace(/^COM$/i, 'COM')
    .replace(/^MUS$/i, 'MUS');

  const isEmptyDash = !q || /^[-—–~=·•*]+$/.test(q);
  const isRecruitQual = /^(RS|RSCT|RCR|REC|RECR|RECRUTA)$/i.test(q);

  if (s.startsWith('SD')) {
    const hasEmbeddedRcr = /\b(RCR|RS|RSCT)\b/i.test(s);
    if (hasEmbeddedRcr || isEmptyDash || isRecruitQual) {
      return { sigla: 'SD', qualificacao: '' };
    }
    return { sigla: 'SD', qualificacao: q };
  }

  return {
    sigla: s,
    qualificacao: isEmptyDash ? '' : q,
  };
}


export function formatAniversarianteRecipientLine(
  sigla: string,
  qualificacao: string,
  nome: string,
  prefix = 'AUTO'
): string {
  const norm = normalizeSiglaAndQualificacao(sigla, qualificacao);
  const trimmedPrefix = prefix.trim().toUpperCase();
  const resolvedPrefix =
    !trimmedPrefix || trimmedPrefix === 'AUTO'
      ? inferPortugueseRecipientPrefix(nome)
      : trimmedPrefix;
  const parts = [resolvedPrefix, norm.sigla, norm.qualificacao, nome.trim().toUpperCase()].filter(
    Boolean
  );
  return parts.join(' ');
}

export function formatBirthdayCardDate(day: string, monthName: string, year: number): string {
  const cleanDay = String(parseInt(day, 10) || day || '1');
  const cleanMonth = monthName.trim() || 'Setembro';
  const cleanYear = year || new Date().getFullYear();
  return `Quartel na Vila Militar, RJ, ${cleanDay} de ${cleanMonth} de ${cleanYear}`;
}

interface RowBand {
  top: number;
  bottom: number;
}

function clusterIndices(indices: number[], maxGap = 5): number[] {
  if (indices.length === 0) return [];
  const clusters: number[][] = [[indices[0]]];
  for (let i = 1; i < indices.length; i++) {
    const prev = clusters[clusters.length - 1];
    if (indices[i] - prev[prev.length - 1] <= maxGap) {
      prev.push(indices[i]);
    } else {
      clusters.push([indices[i]]);
    }
  }
  return clusters.map((c) => Math.round(c.reduce((a, b) => a + b, 0) / c.length));
}

function isTableBorderGray(r: number, g: number, b: number): boolean {
  return r >= 180 && r <= 238 && g >= 188 && g <= 242 && b >= 188 && b <= 242 && Math.max(r, g, b) < 248;
}

function detectRowBandsAndColumns(canvas: HTMLCanvasElement): {
  rowBands: RowBand[];
  colBounds: number[] | null;
  firstTableY: number;
} {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { rowBands: [], colBounds: null, firstTableY: Math.round(canvas.height * 0.14) };

  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;

  const yHits: number[] = [];
  const scanXStart = Math.round(w * 0.07);
  const scanXEnd = Math.round(w * 0.93);
  const sampleCountX = Math.floor((scanXEnd - scanXStart) / 3);

  for (let y = Math.round(h * 0.08); y < h - 6; y++) {
    let grayCnt = 0;
    for (let x = scanXStart; x < scanXEnd; x += 3) {
      const idx = (y * w + x) * 4;
      if (isTableBorderGray(data[idx], data[idx + 1], data[idx + 2])) {
        grayCnt++;
      }
    }
    if (grayCnt > sampleCountX * 0.45) {
      yHits.push(y);
    }
  }

  const hLines = clusterIndices(yHits, 2);
  const firstTableY = hLines.length > 0 ? hLines[0] : Math.round(h * 0.14);

  // Pair consecutive borders forming data rows (data rows are >= 3.8% of page height; empty filter bar is ~1.5%)
  const minDataRowH = Math.round(h * 0.038);
  const maxDataRowH = Math.round(h * 0.16);
  const rowBands: RowBand[] = [];
  for (let i = 0; i < hLines.length - 1; i++) {
    const gap = hLines[i + 1] - hLines[i];
    if (gap >= minDataRowH && gap <= maxDataRowH) {
      rowBands.push({ top: hLines[i], bottom: hLines[i + 1] });
    }
  }

  // Handle a table row split across a page break (top border exists at bottom of page, bottom border spilled to next page)
  if (hLines.length >= 2 && rowBands.length > 0) {
    const lastLine = hLines[hLines.length - 1];
    const remainingH = h - 6 - lastLine;
    if (remainingH >= minDataRowH) {
      const typicalH = Math.round(
        rowBands.reduce((acc, b) => acc + (b.bottom - b.top), 0) / rowBands.length
      );
      const checkBottom = Math.min(h - 6, lastLine + typicalH);
      let darkTextPixels = 0;
      for (let y = lastLine + 8; y < checkBottom - 4; y += 3) {
        for (let x = Math.round(w * 0.56); x < Math.round(w * 0.69); x += 2) {
          const idx = (y * w + x) * 4;
          if (data[idx] < 130 && data[idx + 1] < 130 && data[idx + 2] < 130) {
            darkTextPixels++;
          }
        }
      }
      if (darkTextPixels >= 12) {
        rowBands.push({ top: lastLine, bottom: checkBottom });
      }
    }
  }

  // Detect vertical column borders inside the table area
  let colBounds: number[] | null = null;
  if (rowBands.length > 0) {
    const yStart = rowBands[0].top;
    const yEnd = rowBands[rowBands.length - 1].bottom;
    const sampleCountY = Math.max(1, Math.floor((yEnd - yStart) / 4));
    const xHits: number[] = [];

    for (let x = Math.round(w * 0.04); x < Math.round(w * 0.96); x++) {
      let grayCnt = 0;
      for (let y = yStart; y < yEnd; y += 4) {
        const idx = (y * w + x) * 4;
        if (isTableBorderGray(data[idx], data[idx + 1], data[idx + 2])) {
          grayCnt++;
        }
      }
      if (grayCnt > sampleCountY * 0.48) {
        xHits.push(x);
      }
    }

    const vLines = clusterIndices(xHits, 2);
    if (vLines.length >= 18) {
      colBounds = vLines;
    }
  }

  return { rowBands, colBounds, firstTableY };
}

/**
 * Builds a clean white canvas containing a single column strip across all detected rows
 * with generous inset so gray cell borders are never present near characters.
 */
function buildColumnStripCanvas(
  srcCanvas: HTMLCanvasElement,
  rowBands: RowBand[],
  x0: number,
  x1: number
): HTMLCanvasElement {
  const stripW = Math.max(40, x1 - x0 + 48);
  const strip = document.createElement('canvas');
  strip.width = stripW;
  strip.height = srcCanvas.height;
  const ctx = strip.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, strip.width, strip.height);

  const insetX = Math.max(3, Math.round((x1 - x0) * 0.03));
  for (const band of rowBands) {
    const insetY = 5;
    const cw = Math.max(4, x1 - x0 - insetX * 2);
    const ch = Math.max(4, band.bottom - band.top - insetY * 2);
    ctx.drawImage(
      srcCanvas,
      x0 + insetX,
      band.top + insetY,
      cw,
      ch,
      24,
      band.top + insetY,
      cw,
      ch
    );
  }
  return strip;
}

interface OcrLineBox {
  text: string;
  centerY: number;
}

function collectRowTextsFromOcrResult(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  rowBands: RowBand[]
): string[] {
  const buckets: string[][] = rowBands.map(() => []);

  // Prefer word/line bboxes when available
  const lines: OcrLineBox[] = [];
  if (Array.isArray(data?.blocks)) {
    for (const blk of data.blocks) {
      if (!Array.isArray(blk.paragraphs)) continue;
      for (const para of blk.paragraphs) {
        if (!Array.isArray(para.lines)) continue;
        for (const ln of para.lines) {
          const t = typeof ln.text === 'string' ? ln.text.trim() : '';
          const b = ln.bbox;
          if (t && b) {
            lines.push({ text: t, centerY: (b.y0 + b.y1) / 2 });
          }
        }
      }
    }
  } else if (Array.isArray(data?.lines)) {
    for (const ln of data.lines) {
      const t = typeof ln.text === 'string' ? ln.text.trim() : '';
      const b = ln.bbox;
      if (t && b) {
        lines.push({ text: t, centerY: (b.y0 + b.y1) / 2 });
      }
    }
  }

  for (const ln of lines) {
    for (let i = 0; i < rowBands.length; i++) {
      if (ln.centerY >= rowBands[i].top - 6 && ln.centerY <= rowBands[i].bottom + 6) {
        buckets[i].push(ln.text);
        break;
      }
    }
  }

  return buckets.map((arr) => arr.join(' ').replace(/\s+/g, ' ').trim());
}

/**
 * Fallback/Direct parser when the PDF actually contains selectable text items.
 */
async function tryParseTextPdf(
  pdf: pdfjsLib.PDFDocumentProxy
): Promise<{ monthName: string | null; entries: AniversarianteEntry[] } | null> {
  let totalItems = 0;
  let monthName: string | null = null;
  const entries: AniversarianteEntry[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    totalItems += tc.items.length;
    if (tc.items.length === 0) continue;

    const viewport = page.getViewport({ scale: 1 });
    interface TItem {
      str: string;
      xFrac: number;
      y: number;
    }
    const items: TItem[] = [];
    for (const raw of tc.items) {
      if (!('str' in raw) || !raw.str.trim()) continue;
      const tr = raw.transform as number[];
      const x = tr[4];
      const y = viewport.height - tr[5];
      items.push({ str: raw.str.trim(), xFrac: x / viewport.width, y });
    }

    if (p === 1 && !monthName) {
      const topText = items
        .filter((it) => it.y < viewport.height * 0.14)
        .map((it) => it.str)
        .join(' ');
      monthName = normalizeMonthName(topText);
    }

    // Group items by date rows (items in DATA NASC column xFrac 0.67..0.78 matching DD/MM/YYYY)
    const dateItems = items.filter(
      (it) => it.xFrac >= 0.67 && it.xFrac <= 0.78 && /\d{2}\/\d{2}\/\d{4}/.test(it.str)
    );
    for (const dItem of dateItems) {
      const m = dItem.str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (!m) continue;
      const dia = String(parseInt(m[1], 10));
      const mesNum = parseInt(m[2], 10);
      if (!monthName && mesNum >= 1 && mesNum <= 12) {
        monthName = monthNumberToName(mesNum);
      }

      const nearby = items.filter((it) => Math.abs(it.y - dItem.y) < 32);
      const siglaRaw = nearby
        .filter((it) => it.xFrac >= 0.27 && it.xFrac <= 0.356)
        .map((it) => it.str)
        .join(' ');
      const qualRaw = nearby
        .filter((it) => it.xFrac >= 0.354 && it.xFrac <= 0.464)
        .map((it) => it.str)
        .join(' ');
      const nomeRaw = nearby
        .filter((it) => it.xFrac >= 0.56 && it.xFrac <= 0.686)
        .sort((a, b) => a.y - b.y)
        .map((it) => it.str)
        .join(' ');

      if (!nomeRaw) continue;
      const { sigla, qualificacao } = normalizeSiglaAndQualificacao(siglaRaw, qualRaw);
      entries.push({
        id: `aniv-${p}-${entries.length + 1}`,
        sigla,
        qualificacao,
        nome: nomeRaw.toUpperCase(),
        dia,
        mes: monthName || monthNumberToName(mesNum),
        rawDataNasc: m[0],
      });
    }
  }

  if (totalItems === 0 || entries.length === 0) return null;
  return { monthName, entries };
}

export async function parseAniversariantesPdf(
  file: File,
  onProgress?: (percent: number, statusText: string) => void
): Promise<ParsedAniversariantesResult> {
  const yearMatch = file.name.match(/\b(20\d{2})\b/);
  const detectedYear = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();

  onProgress?.(5, 'Abrindo documento PDF...');
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  // 1. Fast path for text-based PDFs
  const textParsed = await tryParseTextPdf(pdf);
  if (textParsed && textParsed.entries.length > 0) {
    const finalMonth = textParsed.monthName || 'Setembro';
    onProgress?.(100, `Extraídos ${textParsed.entries.length} militares.`);
    return {
      monthName: finalMonth,
      year: detectedYear,
      entries: textParsed.entries.map((e) => ({ ...e, mes: finalMonth })),
    };
  }

  // 2. Vector-outlined / scanned table path via 300 DPI canvas + column-isolated Tesseract OCR
  onProgress?.(10, 'Inicializando motor de leitura de tabela...');
  const worker = await createWorker('por');
  let detectedMonth: string | null = null;
  const allEntries: AniversarianteEntry[] = [];

  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const pageBasePct = 15 + ((p - 1) / pdf.numPages) * 80;
      onProgress?.(Math.round(pageBasePct), `Lendo página ${p} de ${pdf.numPages}...`);

      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 3.4 }); // ~2024x2862 sharp black-on-white
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: ctx, viewport, canvas }).promise;

      const { rowBands, colBounds, firstTableY } = detectRowBandsAndColumns(canvas);
      if (rowBands.length === 0) continue;

      // Extract month from title on page 1
      if (p === 1 && !detectedMonth) {
        const titleCanvas = document.createElement('canvas');
        titleCanvas.width = canvas.width;
        titleCanvas.height = Math.max(60, firstTableY - 10);
        const tCtx = titleCanvas.getContext('2d')!;
        tCtx.fillStyle = '#FFFFFF';
        tCtx.fillRect(0, 0, titleCanvas.width, titleCanvas.height);
        tCtx.drawImage(canvas, 0, 0, canvas.width, titleCanvas.height, 0, 0, canvas.width, titleCanvas.height);
        const titleRes = await worker.recognize(titleCanvas, {}, { blocks: true });
        detectedMonth = normalizeMonthName(titleRes.data.text || '');
      }

      // Column ranges: either exact detected vertical lines (10 columns = 20 borders) or known PDF ratios
      let siglaRange: [number, number];
      let qualRange: [number, number];
      let nomeRange: [number, number];
      let dataRange: [number, number];
      let diaRange: [number, number];

      if (colBounds && colBounds.length >= 18) {
        // Vertical pairs: (0,1)=ORD, (2,3)=ID, (4,5)=OM, (6,7)=SIGLA, (8,9)=QUAL, (10,11)=GUERRA, (12,13)=NOME, (14,15)=DATA, (16,17)=DIA
        siglaRange = [colBounds[6], colBounds[7]];
        qualRange = [colBounds[8], colBounds[9]];
        nomeRange = [colBounds[12], colBounds[13]];
        dataRange = [colBounds[14], colBounds[15]];
        diaRange = colBounds.length >= 18 ? [colBounds[16], colBounds[17]] : [Math.round(canvas.width * 0.771), Math.round(canvas.width * 0.846)];
      } else {
        siglaRange = [Math.round(canvas.width * 0.278), Math.round(canvas.width * 0.353)];
        qualRange = [Math.round(canvas.width * 0.356), Math.round(canvas.width * 0.461)];
        nomeRange = [Math.round(canvas.width * 0.564), Math.round(canvas.width * 0.682)];
        dataRange = [Math.round(canvas.width * 0.686), Math.round(canvas.width * 0.767)];
        diaRange = [Math.round(canvas.width * 0.771), Math.round(canvas.width * 0.846)];
      }

      const siglaStrip = buildColumnStripCanvas(canvas, rowBands, siglaRange[0], siglaRange[1]);
      const qualStrip = buildColumnStripCanvas(canvas, rowBands, qualRange[0], qualRange[1]);
      const nomeStrip = buildColumnStripCanvas(canvas, rowBands, nomeRange[0], nomeRange[1]);
      const dataStrip = buildColumnStripCanvas(canvas, rowBands, dataRange[0], dataRange[1]);
      const diaStrip = buildColumnStripCanvas(canvas, rowBands, diaRange[0], diaRange[1]);

      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: '' });
      const siglaRes = await worker.recognize(siglaStrip, {}, { blocks: true });
      const qualRes = await worker.recognize(qualStrip, {}, { blocks: true });
      const nomeRes = await worker.recognize(nomeStrip, {}, { blocks: true });

      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        tessedit_char_whitelist: '0123456789/',
      });
      const dataRes = await worker.recognize(dataStrip, {}, { blocks: true });
      const diaRes = await worker.recognize(diaStrip, {}, { blocks: true });

      const siglaRows = collectRowTextsFromOcrResult(siglaRes.data, rowBands);
      const qualRows = collectRowTextsFromOcrResult(qualRes.data, rowBands);
      const nomeRows = collectRowTextsFromOcrResult(nomeRes.data, rowBands);
      const dataRows = collectRowTextsFromOcrResult(dataRes.data, rowBands);
      const diaRows = collectRowTextsFromOcrResult(diaRes.data, rowBands);

      for (let i = 0; i < rowBands.length; i++) {
        const nomeRaw = nomeRows[i]?.replace(/\s+/g, ' ').trim() || '';
        if (!nomeRaw) continue;

        const dataMatch = (dataRows[i] || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
        let diaNum = 0;
        if (dataMatch) {
          diaNum = parseInt(dataMatch[1], 10);
          const mesNum = parseInt(dataMatch[2], 10);
          if (!detectedMonth && mesNum >= 1 && mesNum <= 12) {
            detectedMonth = monthNumberToName(mesNum);
          }
        } else {
          const diaClean = (diaRows[i] || '').replace(/\D/g, '');
          if (diaClean) diaNum = parseInt(diaClean, 10);
        }

        const { sigla, qualificacao } = normalizeSiglaAndQualificacao(
          siglaRows[i] || '',
          qualRows[i] || ''
        );

        allEntries.push({
          id: `aniv-${p}-${allEntries.length + 1}`,
          sigla,
          qualificacao,
          nome: nomeRaw.toUpperCase(),
          dia: diaNum > 0 && diaNum <= 31 ? String(diaNum) : '1',
          mes: detectedMonth || 'Setembro',
          rawDataNasc: dataMatch?.[0],
        });
      }
    }
  } finally {
    await worker.terminate();
  }

  const finalMonth = detectedMonth || 'Setembro';
  onProgress?.(100, `Leitura concluída: ${allEntries.length} militares extraídos.`);

  return {
    monthName: finalMonth,
    year: detectedYear,
    entries: allEntries.map((e) => ({ ...e, mes: finalMonth })),
  };
}
