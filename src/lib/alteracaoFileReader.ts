import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker } from 'tesseract.js';
import {
  AlteracaoHtmlBlock,
  RawAlteracaoLine,
  buildAlteracaoTableHtml,
  htmlToRawAlteracaoLines,
  plainTextToRawAlteracaoLines,
} from './alteracaoFormatter';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function cleanText(s: string): string {
  return s
    .replace(/[\u00a0\u2000-\u200f\u202f\u205f\u3000]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function isFontBold(fontName: string, styles?: Record<string, { fontFamily?: string }>): boolean {
  const family = styles?.[fontName]?.fontFamily || '';
  const combined = `${fontName} ${family}`.toLowerCase();
  return /\bbold\b|\bblack\b|\bheavy\b|\bsemi[-_]?bold\b|[-_,]b\b|[a-z]bd\b/.test(combined);
}

interface PdfTextItemLike {
  str: string;
  transform: number[];
  width?: number;
  fontName?: string;
}

interface PositionedChunk {
  text: string;
  x: number;
  y: number;
  width: number;
  bold: boolean;
}

interface PdfLineSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface DetectedPdfGrid {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  hLinesDesc: number[]; // top to bottom (descending PDF Y)
  vLinesAsc: number[];  // left to right (ascending PDF X)
}

function isHeaderContentText(text: string): boolean {
  const u = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  return (
    u.includes('MINISTERIO DA DEFESA') ||
    u.includes('EXERCITO BRASILEIRO') ||
    u.includes('FOLHAS DE ALTERACOES') ||
    u.includes('CONTINUACAO DAS FOLHAS DE ALTERACOES') ||
    /\bFOLHA\s+N[º°O]?\s*\d+\b/.test(u) ||
    u.includes('POSTO/GRADUACAO:') ||
    u.includes('IDENTIDADE:') ||
    /\bPERIODO:\s*\d{2}\/\d{2}/.test(u)
  );
}

function clusterValues(vals: number[], tolerance = 2.5): number[] {
  if (vals.length === 0) return [];
  const sorted = [...vals].sort((a, b) => a - b);
  const groups: number[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = groups[groups.length - 1];
    if (sorted[i] - prev[prev.length - 1] <= tolerance) {
      prev.push(sorted[i]);
    } else {
      groups.push([sorted[i]]);
    }
  }
  return groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

function multiplyMat(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function applyMat(m: number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * Extracts ruled grid regions (tables with >= 2 rows and >= 2 columns) from a PDF page operator list.
 */
async function detectPdfRuledGrids(
  page: pdfjsLib.PDFPageProxy,
  pageWidth: number,
  pageHeight: number
): Promise<DetectedPdfGrid[]> {
  try {
    const opList = await page.getOperatorList();
    const { OPS } = pdfjsLib;
    const stack: number[][] = [];
    let ctm = [1, 0, 0, 1, 0, 0];

    const hSegs: PdfLineSegment[] = [];
    const vSegs: PdfLineSegment[] = [];

    let curX = 0;
    let curY = 0;

    const recordSegment = (ax: number, ay: number, bx: number, by: number) => {
      const [tx0, ty0] = applyMat(ctm, ax, ay);
      const [tx1, ty1] = applyMat(ctm, bx, by);
      const dx = Math.abs(tx1 - tx0);
      const dy = Math.abs(ty1 - ty0);
      if (dy <= 1.8 && dx >= 12) {
        hSegs.push({
          x0: Math.min(tx0, tx1),
          y0: (ty0 + ty1) / 2,
          x1: Math.max(tx0, tx1),
          y1: (ty0 + ty1) / 2,
        });
      } else if (dx <= 1.8 && dy >= 8) {
        vSegs.push({
          x0: (tx0 + tx1) / 2,
          y0: Math.min(ty0, ty1),
          x1: (tx0 + tx1) / 2,
          y1: Math.max(ty0, ty1),
        });
      }
    };

    const recordRect = (x: number, y: number, w: number, h: number) => {
      const absW = Math.abs(w);
      const absH = Math.abs(h);
      // Skip outer page frame rectangle wrapping the whole sheet
      if (absW > pageWidth * 0.85 && absH > pageHeight * 0.7) {
        return;
      }
      // Thin filled rectangles are often drawn by PDF generators as cell borders!
      if (absH <= 2.5 && absW >= 12) {
        recordSegment(x, y + h / 2, x + w, y + h / 2);
        return;
      }
      if (absW <= 2.5 && absH >= 8) {
        recordSegment(x + w / 2, y, x + w / 2, y + h);
        return;
      }
      if (absW >= 12 && absH >= 8) {
        recordSegment(x, y, x + w, y);
        recordSegment(x, y + h, x + w, y + h);
        recordSegment(x, y, x, y + h);
        recordSegment(x + w, y, x + w, y + h);
      }
    };

    const processPathOps = (ops: number[], coords: number[]) => {
      let idx = 0;
      let startX = curX;
      let startY = curY;
      for (const op of ops) {
        if (op === OPS.moveTo) {
          curX = coords[idx++];
          curY = coords[idx++];
          startX = curX;
          startY = curY;
        } else if (op === OPS.lineTo) {
          const nx = coords[idx++];
          const ny = coords[idx++];
          recordSegment(curX, curY, nx, ny);
          curX = nx;
          curY = ny;
        } else if (op === OPS.curveTo) {
          idx += 4;
          curX = coords[idx++];
          curY = coords[idx++];
        } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
          idx += 2;
          curX = coords[idx++];
          curY = coords[idx++];
        } else if (op === OPS.closePath) {
          recordSegment(curX, curY, startX, startY);
          curX = startX;
          curY = startY;
        } else if (op === OPS.rectangle) {
          const rx = coords[idx++];
          const ry = coords[idx++];
          const rw = coords[idx++];
          const rh = coords[idx++];
          recordRect(rx, ry, rw, rh);
        }
      }
    };

    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i];
      if (fn === OPS.save) {
        stack.push([...ctm]);
      } else if (fn === OPS.restore) {
        ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      } else if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
        ctm = multiplyMat(ctm, args as number[]);
      } else if (fn === OPS.moveTo && Array.isArray(args)) {
        curX = args[0];
        curY = args[1];
      } else if (fn === OPS.lineTo && Array.isArray(args)) {
        recordSegment(curX, curY, args[0], args[1]);
        curX = args[0];
        curY = args[1];
      } else if (fn === OPS.rectangle && Array.isArray(args)) {
        recordRect(args[0], args[1], args[2], args[3]);
      } else if (fn === OPS.constructPath && Array.isArray(args) && args.length >= 2) {
        const opsArr = Array.isArray(args[0]) ? (args[0] as number[]) : [];
        const coordsArr = args[1] && (Array.isArray(args[1]) || ArrayBuffer.isView(args[1]))
          ? Array.from(args[1] as ArrayLike<number>)
          : [];
        if (opsArr.length > 0 && coordsArr.length > 0) {
          processPathOps(opsArr, coordsArr);
        }
      }
    }

    if (hSegs.length < 3) return [];

    // Build connected components of intersecting H and V segments (handles colspan merged headers!)
    const hAdjV: number[][] = hSegs.map(() => []);
    const vAdjH: number[][] = vSegs.map(() => []);
    for (let hi = 0; hi < hSegs.length; hi++) {
      const h = hSegs[hi];
      for (let vi = 0; vi < vSegs.length; vi++) {
        const v = vSegs[vi];
        if (
          v.x0 >= h.x0 - 5 &&
          v.x0 <= h.x1 + 5 &&
          h.y0 >= v.y0 - 5 &&
          h.y0 <= v.y1 + 5
        ) {
          hAdjV[hi].push(vi);
          vAdjH[vi].push(hi);
        }
      }
    }

    const visitedH = new Set<number>();
    const visitedV = new Set<number>();
    const grids: DetectedPdfGrid[] = [];

    for (let startH = 0; startH < hSegs.length; startH++) {
      if (visitedH.has(startH) || hAdjV[startH].length === 0) continue;

      const compH: number[] = [];
      const compV: number[] = [];
      const qH: number[] = [startH];
      const qV: number[] = [];
      visitedH.add(startH);

      while (qH.length > 0 || qV.length > 0) {
        while (qH.length > 0) {
          const hi = qH.pop()!;
          compH.push(hi);
          for (const vi of hAdjV[hi]) {
            if (!visitedV.has(vi)) {
              visitedV.add(vi);
              qV.push(vi);
            }
          }
        }
        while (qV.length > 0) {
          const vi = qV.pop()!;
          compV.push(vi);
          for (const hi of vAdjH[vi]) {
            if (!visitedH.has(hi)) {
              visitedH.add(hi);
              qH.push(hi);
            }
          }
        }
      }

      const hLinesDesc = clusterValues(
        compH.map((idx) => hSegs[idx].y0),
        3.5
      ).sort((a, b) => b - a);
      const vLinesAsc = clusterValues(
        compV.map((idx) => vSegs[idx].x0),
        3.5
      ).sort((a, b) => a - b);

      if (hLinesDesc.length >= 3 && vLinesAsc.length >= 3) {
        grids.push({
          minX: vLinesAsc[0],
          maxX: vLinesAsc[vLinesAsc.length - 1],
          minY: hLinesDesc[hLinesDesc.length - 1],
          maxY: hLinesDesc[0],
          hLinesDesc,
          vLinesAsc,
        });
      }
    }

    // Fallback: horizontal-ruled tables (e.g. >= 3 parallel H rules with same span, < 3 V dividers)
    const remainingH = hSegs.filter((_, idx) => !visitedH.has(idx));
    if (remainingH.length >= 3) {
      const bySpan = new Map<string, PdfLineSegment[]>();
      for (const h of remainingH) {
        if (h.x1 - h.x0 < pageWidth * 0.35) continue;
        const key = `${Math.round(h.x0 / 12) * 12}:${Math.round(h.x1 / 12) * 12}`;
        const list = bySpan.get(key) || [];
        list.push(h);
        bySpan.set(key, list);
      }
      for (const group of bySpan.values()) {
        const hLinesDesc = clusterValues(
          group.map((g) => g.y0),
          3.5
        ).sort((a, b) => b - a);
        if (hLinesDesc.length >= 3) {
          const minX = Math.min(...group.map((g) => g.x0));
          const maxX = Math.max(...group.map((g) => g.x1));
          grids.push({
            minX,
            maxX,
            minY: hLinesDesc[hLinesDesc.length - 1],
            maxY: hLinesDesc[0],
            hLinesDesc,
            vLinesAsc: [],
          });
        }
      }
    }

    return grids;
  } catch {
    return [];
  }
}

function joinCellChunksPreservingLines(cellChunks: PositionedChunk[]): string {
  if (cellChunks.length === 0) return '';
  const sorted = [...cellChunks].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PositionedChunk[][] = [];
  for (const ch of sorted) {
    const last = lines[lines.length - 1];
    if (!last || Math.abs(last[0].y - ch.y) > 3.5) {
      lines.push([ch]);
    } else {
      last.push(ch);
    }
  }
  return lines
    .map((line) => {
      const s = [...line].sort((a, b) => a.x - b.x);
      let out = '';
      for (let i = 0; i < s.length; i++) {
        if (i > 0) {
          const gap = s[i].x - (s[i - 1].x + s[i - 1].width);
          if (gap > 1.5 && !out.endsWith(' ') && !s[i].text.startsWith(' ')) {
            out += ' ';
          }
        }
        out += s[i].text;
      }
      return cleanText(out);
    })
    .filter((l) => l.length > 0)
    .join('\n');
}

function buildMatrixFromRuledGrid(
  grid: DetectedPdfGrid,
  chunks: PositionedChunk[]
): string[][] | null {
  const numRows = grid.hLinesDesc.length - 1;
  if (numRows < 2) return null;

  const regionChunks = chunks.filter(
    (ch) =>
      ch.x + ch.width * 0.5 >= grid.minX - 5 &&
      ch.x <= grid.maxX + 5 &&
      ch.y >= grid.minY - 4 &&
      ch.y <= grid.maxY + 4
  );
  if (regionChunks.length === 0) return null;

  // Horizontal-ruled table without vertical dividers: derive column X boundaries globally across rows
  let colBoundariesAsc = grid.vLinesAsc;
  if (colBoundariesAsc.length < 3) {
    // Group regionChunks into Y lines, split by >= 12pt gap, and cluster left X anchors
    const yLines: PositionedChunk[][] = [];
    const sortedByY = [...regionChunks].sort((a, b) => b.y - a.y || a.x - b.x);
    for (const ch of sortedByY) {
      const last = yLines[yLines.length - 1];
      if (!last || Math.abs(last[0].y - ch.y) > 3.5) yLines.push([ch]);
      else last.push(ch);
    }

    const segStarts: number[] = [];
    for (const line of yLines) {
      const segs = rowsToLineSegments(line, 12);
      if (segs.length >= 2) {
        segs.forEach((seg) => segStarts.push(seg[0].x));
      }
    }
    const anchors = clusterValues(segStarts, 14).sort((a, b) => a - b);
    if (anchors.length < 2) return null;

    colBoundariesAsc = [grid.minX - 2];
    for (let i = 1; i < anchors.length; i++) {
      colBoundariesAsc.push((anchors[i - 1] + anchors[i]) / 2);
    }
    colBoundariesAsc.push(grid.maxX + 2);
  }

  const numCols = colBoundariesAsc.length - 1;
  if (numCols < 2) return null;

  const cells: PositionedChunk[][][] = Array.from({ length: numRows }, () =>
    Array.from({ length: numCols }, () => [])
  );

  for (const ch of regionChunks) {
    let rIdx = grid.hLinesDesc.findIndex(
      (yTop, idx) =>
        idx < numRows &&
        ch.y <= yTop + 3.5 &&
        ch.y >= grid.hLinesDesc[idx + 1] - 3.5
    );
    if (rIdx < 0) {
      // Snap near border if within tight tolerance
      let bestDist = Infinity;
      for (let r = 0; r < numRows; r++) {
        const midY = (grid.hLinesDesc[r] + grid.hLinesDesc[r + 1]) / 2;
        const d = Math.abs(ch.y - midY);
        if (d < bestDist) {
          bestDist = d;
          rIdx = r;
        }
      }
    }

    const centerX = ch.x + Math.min(ch.width, 16) * 0.35;
    let cIdx = colBoundariesAsc.findIndex(
      (xLeft, idx) =>
        idx < numCols &&
        centerX >= xLeft - 3 &&
        centerX <= colBoundariesAsc[idx + 1] + 3
    );
    if (cIdx < 0) {
      cIdx = centerX < colBoundariesAsc[0] ? 0 : numCols - 1;
    }

    if (rIdx >= 0 && cIdx >= 0) {
      cells[rIdx][cIdx].push(ch);
    }
  }

  const matrix: string[][] = cells.map((row) =>
    row.map((cellChunks) => joinCellChunksPreservingLines(cellChunks))
  );

  const nonEmptyRows = matrix.filter((r) => r.some((c) => c.length > 0));
  if (nonEmptyRows.length < 2) return null;

  const combinedText = nonEmptyRows.flat().join(' ');
  if (isHeaderContentText(combinedText)) return null;

  return nonEmptyRows;
}

function rowsToLineSegments(
  row: PositionedChunk[],
  splitColumnThreshold: number
): PositionedChunk[][] {
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const segments: PositionedChunk[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const gap = curr.x - (prev.x + prev.width);
    const currentSegText = segments[segments.length - 1].map((s) => s.text.trim()).join('');
    const isOnlyDash = /^[-–—•]$/.test(currentSegText);
    if (gap > splitColumnThreshold && !isOnlyDash) {
      segments.push([curr]);
    } else {
      segments[segments.length - 1].push(curr);
    }
  }
  return segments;
}

function segmentsToTextLine(seg: PositionedChunk[]): RawAlteracaoLine | null {
  let joined = '';
  let boldChars = 0;
  let totalChars = 0;
  let singleBoldText = '';
  let boldRunCount = 0;
  let currentBoldRun = '';

  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    const prev = i > 0 ? seg[i - 1] : null;
    if (prev) {
      const gap = c.x - (prev.x + prev.width);
      if (gap > 1.8 && !joined.endsWith(' ') && !c.text.startsWith(' ')) {
        joined += ' ';
      }
    }
    joined += c.text;
    const nonWsLen = c.text.replace(/\s+/g, '').length;
    totalChars += nonWsLen;
    if (c.bold) {
      boldChars += nonWsLen;
      currentBoldRun += c.text;
    } else if (currentBoldRun.trim()) {
      boldRunCount++;
      singleBoldText = cleanText(currentBoldRun);
      currentBoldRun = '';
    }
  }
  if (currentBoldRun.trim()) {
    boldRunCount++;
    singleBoldText = cleanText(currentBoldRun);
  }

  const lineText = cleanText(joined);
  if (!lineText) return null;

  const isBold = totalChars > 0 && boldChars / totalChars >= 0.85;
  return {
    text: lineText,
    isBold,
    boldSubstring: !isBold && boldRunCount === 1 ? singleBoldText : undefined,
  };
}

/**
 * Fallback borderless table detection: finds consecutive multi-column aligned rows
 * using global column anchors (avoiding false positives on justified narrative paragraphs).
 */
function tryConsumeBorderlessTable(
  rows: PositionedChunk[][],
  startIdx: number,
  pageWidth: number
): { matrix: string[][]; endIdx: number } | null {
  const colGapThreshold = Math.max(19, pageWidth * 0.032);
  const candidateRows: { xStart: number; text: string }[][] = [];

  for (let idx = startIdx; idx < rows.length; idx++) {
    if (idx > startIdx) {
      const prevY = rows[idx - 1][0].y;
      const currY = rows[idx][0].y;
      if (prevY - currY > 30) break;
    }

    const segs = rowsToLineSegments(rows[idx], colGapThreshold);
    if (segs.length < 2) break;

    const cols = segs.map((seg) => ({
      xStart: seg[0].x,
      text: cleanText(seg.map((c) => c.text).join(' ')),
    }));
    const fullRowText = cols.map((c) => c.text).join(' ');

    if (
      /^[-–—•]\s*/.test(cols[0].text) ||
      isHeaderContentText(fullRowText) ||
      /\b(1ª|2ª)\s*PARTE\b/i.test(fullRowText) ||
      /\b(militar nominado|conforme publicado|sem altera[çc][ãa]o)\b/i.test(fullRowText)
    ) {
      break;
    }

    candidateRows.push(cols);
  }

  if (candidateRows.length < 2) return null;

  // Reject 2-column candidates that look like wrapped prose justified lines
  const allTwoCols = candidateRows.every((r) => r.length === 2);
  if (allTwoCols && candidateRows.every((r) => r[0].text.length > 42 && r[1].text.length <= 16)) {
    return null;
  }

  // Cluster column X anchors globally across all candidate rows
  const allXStarts = candidateRows.flatMap((r) => r.map((c) => c.xStart));
  const anchors = clusterValues(allXStarts, 18).sort((a, b) => a - b);
  if (anchors.length < 2 || anchors.length > 10) return null;

  // Keep contiguous prefix where segments snap cleanly onto anchors
  let validLen = 0;
  let multiColRowCount = 0;
  const snappedMatrix: string[][] = [];

  for (const row of candidateRows) {
    const outRow = new Array<string>(anchors.length).fill('');
    let alignedAll = true;
    let filledCols = 0;

    for (const seg of row) {
      let bestCol = 0;
      let bestDist = Infinity;
      for (let c = 0; c < anchors.length; c++) {
        const dist = Math.abs(seg.xStart - anchors[c]);
        if (dist < bestDist) {
          bestDist = dist;
          bestCol = c;
        }
      }
      if (bestDist > 26) {
        alignedAll = false;
        break;
      }
      outRow[bestCol] = outRow[bestCol] ? `${outRow[bestCol]} ${seg.text}` : seg.text;
    }

    if (!alignedAll) break;
    filledCols = outRow.filter((v) => v.length > 0).length;
    if (filledCols >= 2) multiColRowCount++;
    snappedMatrix.push(outRow);
    validLen++;
  }

  if (validLen < 2 || multiColRowCount < 2) return null;

  return {
    matrix: snappedMatrix,
    endIdx: startIdx + validLen - 1,
  };
}

async function readAlteracaoFromPdfOcr(
  pdf: pdfjsLib.PDFDocumentProxy
): Promise<RawAlteracaoLine[]> {
  const worker = await createWorker('por');
  const lines: RawAlteracaoLine[] = [];
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 2.2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const { data } = await worker.recognize(canvas);
      const extracted = plainTextToRawAlteracaoLines(data.text || '');
      lines.push(...extracted);
    }
  } finally {
    await worker.terminate();
  }
  return lines;
}

async function readAlteracaoFromPdf(file: File): Promise<RawAlteracaoLine[]> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const allLines: RawAlteracaoLine[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const styles = content.styles as Record<string, { fontFamily?: string }> | undefined;

    const chunks: PositionedChunk[] = [];
    for (const rawItem of content.items) {
      const item = rawItem as PdfTextItemLike;
      if (typeof item.str !== 'string') continue;
      const text = item.str.replace(/\u00a0/g, ' ');
      if (!text.trim()) continue;
      const x = item.transform?.[4] ?? 0;
      const y = item.transform?.[5] ?? 0;
      const width = item.width ?? text.length * 4;
      const bold = item.fontName ? isFontBold(item.fontName, styles) : false;
      chunks.push({ text, x, y, width, bold });
    }

    // 1. Detect vector-ruled tables on this PDF page
    const grids = await detectPdfRuledGrids(page, viewport.width, viewport.height);
    const gridMatches: { grid: DetectedPdfGrid; matrix: string[][] }[] = [];
    for (const g of grids) {
      const matrix = buildMatrixFromRuledGrid(g, chunks);
      if (matrix) {
        gridMatches.push({ grid: g, matrix });
      }
    }

    // Group chunks into horizontal bands (top to bottom)
    chunks.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: PositionedChunk[][] = [];
    for (const chunk of chunks) {
      const lastRow = rows[rows.length - 1];
      if (!lastRow || Math.abs(lastRow[0].y - chunk.y) > 3.5) {
        rows.push([chunk]);
      } else {
        lastRow.push(chunk);
      }
    }

    const splitColumnThreshold = viewport.width * 0.16;
    const emittedGrids = new Set<number>();

    let rIdx = 0;
    while (rIdx < rows.length) {
      const rowY = rows[rIdx][0].y;

      // Check if this row sits inside a detected ruled table
      const matchIdx = gridMatches.findIndex(
        (m) => rowY <= m.grid.maxY + 4 && rowY >= m.grid.minY - 4
      );
      if (matchIdx !== -1) {
        if (!emittedGrids.has(matchIdx)) {
          allLines.push({ text: '', tableRows: gridMatches[matchIdx].matrix });
          emittedGrids.add(matchIdx);
        }
        rIdx++;
        continue;
      }

      // Check borderless aligned multi-column table only after we have left top page header region
      if (rowY < viewport.height * 0.85) {
        const borderless = tryConsumeBorderlessTable(rows, rIdx, viewport.width);
        if (borderless) {
          allLines.push({ text: '', tableRows: borderless.matrix });
          rIdx = borderless.endIdx + 1;
          continue;
        }
      }

      const segments = rowsToLineSegments(rows[rIdx], splitColumnThreshold);
      for (const seg of segments) {
        const line = segmentsToTextLine(seg);
        if (line) allLines.push(line);
      }
      rIdx++;
    }
  }

  if (allLines.length === 0 && pdf.numPages > 0) {
    return readAlteracaoFromPdfOcr(pdf);
  }

  return allLines;
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function extractDocxParagraphLine(p: Element): RawAlteracaoLine | null {
  const runs = Array.from(p.getElementsByTagNameNS(W_NS, 'r'));
  let fullText = '';
  let boldChars = 0;
  let totalChars = 0;
  let isUnderlined = false;
  let boldRunCount = 0;
  let currentBoldRun = '';
  let singleBoldText = '';

  for (const r of runs) {
    const rPr = r.getElementsByTagNameNS(W_NS, 'rPr')[0];
    let runBold = false;
    if (rPr) {
      const bEl = rPr.getElementsByTagNameNS(W_NS, 'b')[0];
      if (bEl) {
        const val = bEl.getAttribute('w:val') ?? bEl.getAttribute('val');
        runBold = val !== '0' && val !== 'false';
      }
      const uEl = rPr.getElementsByTagNameNS(W_NS, 'u')[0];
      if (uEl) {
        const val = uEl.getAttribute('w:val') ?? uEl.getAttribute('val');
        if (val !== 'none') isUnderlined = true;
      }
    }

    const tEls = Array.from(r.getElementsByTagNameNS(W_NS, 't'));
    const runText = tEls.map((t) => t.textContent || '').join('');
    if (runText) {
      fullText += runText;
      const nonWs = runText.replace(/\s+/g, '').length;
      totalChars += nonWs;
      if (runBold) {
        boldChars += nonWs;
        currentBoldRun += runText;
      } else if (currentBoldRun.trim()) {
        boldRunCount++;
        singleBoldText = cleanText(currentBoldRun);
        currentBoldRun = '';
      }
    }
  }

  if (currentBoldRun.trim()) {
    boldRunCount++;
    singleBoldText = cleanText(currentBoldRun);
  }

  const lineText = cleanText(fullText);
  if (!lineText) return null;

  const isBold = totalChars > 0 && boldChars / totalChars >= 0.85;
  return {
    text: lineText,
    isBold,
    isUnderlined,
    boldSubstring: !isBold && boldRunCount === 1 ? singleBoldText : undefined,
  };
}

async function readAlteracaoFromDocx(file: File): Promise<RawAlteracaoLine[]> {
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const docEntry = zip.file('word/document.xml');
  if (!docEntry) {
    throw new Error('Arquivo .docx inválido: word/document.xml não encontrado.');
  }
  const xmlText = await docEntry.async('string');
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const lines: RawAlteracaoLine[] = [];

  const body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
  if (!body) return lines;

  for (const child of Array.from(body.children)) {
    const localName = child.localName || child.nodeName.replace(/^.*:/, '');
    if (localName === 'p') {
      const line = extractDocxParagraphLine(child);
      if (line) lines.push(line);
    } else if (localName === 'tbl') {
      const trs = Array.from(child.getElementsByTagNameNS(W_NS, 'tr'));
      const matrix: string[][] = [];
      const tableParagraphs: RawAlteracaoLine[] = [];

      for (const tr of trs) {
        const tcs = Array.from(tr.getElementsByTagNameNS(W_NS, 'tc'));
        const rowCells: string[] = [];
        for (const tc of tcs) {
          const ps = Array.from(tc.getElementsByTagNameNS(W_NS, 'p'));
          const cellParts: string[] = [];
          for (const p of ps) {
            const pLine = extractDocxParagraphLine(p);
            if (pLine) {
              tableParagraphs.push(pLine);
              cellParts.push(pLine.text);
            }
          }
          rowCells.push(cellParts.map((part) => cleanText(part)).filter(Boolean).join('\n'));

          // Respect Word gridSpan so merged cells keep uniform column alignment
          const tcPr = tc.getElementsByTagNameNS(W_NS, 'tcPr')[0];
          const gridSpanEl = tcPr?.getElementsByTagNameNS(W_NS, 'gridSpan')[0];
          const spanVal = parseInt(
            gridSpanEl?.getAttribute('w:val') ?? gridSpanEl?.getAttribute('val') ?? '1',
            10
          );
          if (Number.isFinite(spanVal) && spanVal > 1) {
            for (let s = 1; s < spanVal; s++) {
              rowCells.push('');
            }
          }
        }
        if (rowCells.some((c) => c.length > 0)) {
          matrix.push(rowCells);
        }
      }

      const fullTableText = matrix.flat().join(' ');
      if (isHeaderContentText(fullTableText)) {
        lines.push(...tableParagraphs);
      } else if (matrix.length > 0) {
        lines.push({ text: '', tableRows: matrix });
      }
    }
  }

  return lines;
}

export async function readAlteracaoFile(file: File): Promise<RawAlteracaoLine[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    return readAlteracaoFromPdf(file);
  }
  if (
    name.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return readAlteracaoFromDocx(file);
  }

  const text = await file.text();
  if (/<(html|body|p|div|table|tr|td|th|strong|b)\b/i.test(text)) {
    return htmlToRawAlteracaoLines(text);
  }
  return plainTextToRawAlteracaoLines(text);
}

function mmToPx(mm: number): number {
  return (mm * 96) / 25.4;
}

export interface PaginateOptions {
  fontFamily: string;
  fontSizePt: string;
  lineHeight: string;
  page1HeaderHeightPx?: number;
  contHeaderHeightPx?: number;
}

/**
 * Measures formatted blocks & table rows in an A4-width hidden probe and splits cleanly across pages.
 * Whenever a table starts on one page and overflows to the next, only the overflow rows move to the
 * next sheet — placed strictly BELOW that page's continuation header.
 */
export function paginateAlteracaoBlocksInDom(
  blocks: AlteracaoHtmlBlock[],
  options: PaginateOptions
): string[] {
  if (blocks.length === 0) return ['<p><br></p>'];

  const frameInnerPx = mmToPx(271) - 4;
  const editorPaddingVPx = mmToPx(7);
  const page1HeaderPx = options.page1HeaderHeightPx ?? mmToPx(47);
  const contHeaderPx = Math.max(options.contHeaderHeightPx ?? 0, mmToPx(24));

  const page1MaxPx = Math.max(160, frameInnerPx - page1HeaderPx - editorPaddingVPx - 14);
  const contMaxPx = Math.max(200, frameInnerPx - contHeaderPx - editorPaddingVPx - 14);

  const probe = document.createElement('div');
  probe.className = 'alteracao-editor';
  probe.style.position = 'fixed';
  probe.style.left = '-99999px';
  probe.style.top = '0';
  probe.style.width = '181.5mm';
  probe.style.padding = '3.5mm 4mm';
  probe.style.boxSizing = 'border-box';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.fontFamily = `"${options.fontFamily}", "Times New Roman", Times, serif`;
  probe.style.fontSize = options.fontSizePt;
  probe.style.lineHeight = options.lineHeight;
  probe.innerHTML = blocks.map((b) => b.html).join('');
  document.body.appendChild(probe);

  const blockHeights: number[] = [];
  const tableRowHeightsByBlock = new Map<number, number[]>();
  const children = Array.from(probe.children) as HTMLElement[];

  for (let i = 0; i < blocks.length; i++) {
    const child = children[i];
    if (!child) {
      blockHeights.push(18);
      continue;
    }
    const style = window.getComputedStyle(child);
    const mt = parseFloat(style.marginTop) || 0;
    const mb = parseFloat(style.marginBottom) || 0;
    const rectH = child.getBoundingClientRect().height;
    blockHeights.push(rectH + mt + mb);

    if (blocks[i].tableMeta) {
      const trs = Array.from(child.querySelectorAll('tr')) as HTMLElement[];
      tableRowHeightsByBlock.set(
        i,
        trs.map((tr) => tr.getBoundingClientRect().height)
      );
    }
  }
  document.body.removeChild(probe);

  const pages: string[][] = [];
  let currentPageHtmls: string[] = [];
  let currentPageSpacerMask: boolean[] = [];
  let currentHeight = 0;
  let currentMaxPx = page1MaxPx;

  const pushToCurrentPage = (html: string, h: number, isSpacer = false) => {
    currentPageHtmls.push(html);
    currentPageSpacerMask.push(isSpacer);
    currentHeight += h;
  };

  const startNextPage = () => {
    while (
      currentPageHtmls.length > 0 &&
      currentPageSpacerMask[currentPageSpacerMask.length - 1]
    ) {
      currentPageHtmls.pop();
      currentPageSpacerMask.pop();
    }
    if (currentPageHtmls.length > 0) {
      pages.push(currentPageHtmls);
    }
    currentPageHtmls = [];
    currentPageSpacerMask = [];
    currentHeight = 0;
    currentMaxPx = contMaxPx;
  };

  let idx = 0;
  while (idx < blocks.length) {
    const block = blocks[idx];

    if (currentPageHtmls.length === 0 && block.isSpacer) {
      idx++;
      continue;
    }

    // Handle splittable data tables across page breaks (below continuation header!)
    if (block.tableMeta && block.tableMeta.rowsHtml.length > 0) {
      const { rowsHtml: allRowHtmls, colgroupHtml, headerRowHtml, itemId } = block.tableMeta;
      const allRowHeights =
        tableRowHeightsByBlock.get(idx) ?? allRowHtmls.map(() => 22);
      const headerRowHeight = headerRowHtml ? (allRowHeights[0] ?? 22) : 0;
      const tableOverheadPx = 8;

      const fullTableHeight = blockHeights[idx] ?? 40;
      if (currentHeight + fullTableHeight + 4 <= currentMaxPx) {
        pushToCurrentPage(block.html, fullTableHeight, false);
        idx++;
        continue;
      }

      // Split table row-by-row across current and subsequent pages
      let rowOffset = 0;
      while (rowOffset < allRowHtmls.length) {
        const isContinuationChunk = rowOffset > 0 && Boolean(headerRowHtml);
        const includeRepeatedHeader =
          isContinuationChunk &&
          headerRowHeight + (allRowHeights[rowOffset] ?? 22) + tableOverheadPx <= currentMaxPx - 8;

        const repeatedHeaderCost = includeRepeatedHeader ? headerRowHeight : 0;
        const remainingPx = currentMaxPx - currentHeight - tableOverheadPx - repeatedHeaderCost;

        let fitRows = 0;
        let accRowPx = 0;
        for (let r = rowOffset; r < allRowHtmls.length; r++) {
          const rh = allRowHeights[r] ?? 22;
          if (accRowPx + rh <= remainingPx) {
            accRowPx += rh;
            fitRows++;
          } else {
            break;
          }
        }

        const minRowsHere = rowOffset === 0 ? Math.min(2, allRowHtmls.length) : 1;
        if (fitRows < minRowsHere) {
          if (currentPageHtmls.length > 0) {
            startNextPage();
            continue;
          }
          // Empty sheet fallback for single tall row
          fitRows = 1;
          accRowPx = allRowHeights[rowOffset] ?? 40;
        }

        const dataChunk = allRowHtmls.slice(rowOffset, rowOffset + fitRows);
        const chunkRows =
          includeRepeatedHeader && headerRowHtml ? [headerRowHtml, ...dataChunk] : dataChunk;

        pushToCurrentPage(
          buildAlteracaoTableHtml(chunkRows, itemId, colgroupHtml),
          accRowPx + repeatedHeaderCost + tableOverheadPx,
          false
        );
        rowOffset += fitRows;

        if (rowOffset < allRowHtmls.length) {
          startNextPage();
        }
      }

      idx++;
      continue;
    }

    // Group keepWithNext chains (e.g., MÊS: + spacer + TÍTULO + Subtítulo + spacer + 1st item/table)
    let groupEnd = idx;
    if (block.keepWithNext) {
      let scan = idx;
      while (scan < blocks.length - 1) {
        if (blocks[scan].keepWithNext || blocks[scan].isSpacer) {
          scan++;
        } else {
          break;
        }
      }
      groupEnd = scan;
    }

    let groupHeight = 0;
    for (let k = idx; k <= groupEnd; k++) {
      if (blocks[k].tableMeta) {
        // Keep heading with at least first 2 rows of table
        const rowHeights = tableRowHeightsByBlock.get(k) ?? [22];
        const minRowsH = rowHeights
          .slice(0, Math.min(2, rowHeights.length))
          .reduce((a, b) => a + b, 6);
        groupHeight += minRowsH;
      } else {
        groupHeight += blockHeights[k] ?? 18;
      }
    }

    const singleHeight = blockHeights[idx] ?? 18;

    if (
      currentPageHtmls.length > 0 &&
      block.keepWithNext &&
      currentHeight + groupHeight > currentMaxPx &&
      groupHeight <= contMaxPx
    ) {
      startNextPage();
      continue;
    }

    if (currentPageHtmls.length > 0 && currentHeight + singleHeight > currentMaxPx) {
      startNextPage();
      continue;
    }

    pushToCurrentPage(block.html, singleHeight, Boolean(block.isSpacer));
    idx++;
  }

  while (
    currentPageHtmls.length > 0 &&
    currentPageSpacerMask[currentPageSpacerMask.length - 1]
  ) {
    currentPageHtmls.pop();
    currentPageSpacerMask.pop();
  }
  if (currentPageHtmls.length > 0) {
    pages.push(currentPageHtmls);
  }

  if (pages.length === 0) return ['<p><br></p>'];
  return pages.map((pageParts) => pageParts.join('\n'));
}
