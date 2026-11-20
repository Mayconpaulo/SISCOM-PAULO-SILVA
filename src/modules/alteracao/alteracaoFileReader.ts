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

    const DRAW_OPS = {
      moveTo: 0,
      lineTo: 1,
      curveTo: 2,
      quadraticCurveTo: 3,
      closePath: 4,
    } as const;

    const VISIBLE_PAINT_OPS = new Set<number>([
      OPS.stroke,
      OPS.closeStroke,
      OPS.fill,
      OPS.eoFill,
      OPS.fillStroke,
      OPS.eoFillStroke,
      OPS.closeFillStroke,
      OPS.closeEOFillStroke,
    ]);

    const recordSegment = (ax: number, ay: number, bx: number, by: number) => {
      const [tx0, ty0] = applyMat(ctm, ax, ay);
      const [tx1, ty1] = applyMat(ctm, bx, by);
      const dx = Math.abs(tx1 - tx0);
      const dy = Math.abs(ty1 - ty0);
      if (dy <= 1.8 && dx >= 12) {
        const yMid = (ty0 + ty1) / 2;
        // Skip outer page top/bottom margin lines that span almost the full page width at extreme edges
        if (dx > pageWidth * 0.85 && (yMid < pageHeight * 0.05 || yMid > pageHeight * 0.96)) {
          return;
        }
        hSegs.push({
          x0: Math.min(tx0, tx1),
          y0: yMid,
          x1: Math.max(tx0, tx1),
          y1: yMid,
        });
      } else if (dx <= 1.8 && dy >= 8) {
        const xMid = (tx0 + tx1) / 2;
        // Skip outer page left/right frame rails spanning most of the sheet height
        if (dy > pageHeight * 0.65 && (xMid < pageWidth * 0.14 || xMid > pageWidth * 0.86)) {
          return;
        }
        vSegs.push({
          x0: xMid,
          y0: Math.min(ty0, ty1),
          x1: xMid,
          y1: Math.max(ty0, ty1),
        });
      }
    };

    const recordRect = (x: number, y: number, w: number, h: number) => {
      const [tx0, ty0] = applyMat(ctm, x, y);
      const [tx1, ty1] = applyMat(ctm, x + w, y + h);
      const absW = Math.abs(tx1 - tx0);
      const absH = Math.abs(ty1 - ty0);
      // Skip outer page frame rectangle wrapping the whole sheet
      if (absW > pageWidth * 0.82 && absH > pageHeight * 0.65) {
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

    const flushSubpathSegments = (pendingSegs: Array<[number, number, number, number]>) => {
      if (pendingSegs.length === 0) return;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const [ax, ay, bx, by] of pendingSegs) {
        const [tx0, ty0] = applyMat(ctm, ax, ay);
        const [tx1, ty1] = applyMat(ctm, bx, by);
        minX = Math.min(minX, tx0, tx1);
        maxX = Math.max(maxX, tx0, tx1);
        minY = Math.min(minY, ty0, ty1);
        maxY = Math.max(maxY, ty0, ty1);
      }
      const boxW = maxX - minX;
      const boxH = maxY - minY;
      // Skip giant outer page border subpaths (e.g. A4 outer frame drawn via 4 moveTo/lineTo lines)
      if (
        pendingSegs.length <= 5 &&
        boxW > pageWidth * 0.82 &&
        boxH > pageHeight * 0.65
      ) {
        return;
      }
      // Collapse thin filled bar subpaths into a single border segment
      if (pendingSegs.length <= 5 && boxH <= 2.5 && boxW >= 12) {
        hSegs.push({ x0: minX, y0: (minY + maxY) / 2, x1: maxX, y1: (minY + maxY) / 2 });
        return;
      }
      if (pendingSegs.length <= 5 && boxW <= 2.5 && boxH >= 8) {
        vSegs.push({ x0: (minX + maxX) / 2, y0: minY, x1: (minX + maxX) / 2, y1: maxY });
        return;
      }
      for (const [ax, ay, bx, by] of pendingSegs) {
        recordSegment(ax, ay, bx, by);
      }
    };

    // Legacy pdfjs v2/v3 constructPath handler
    const processLegacyPathOps = (ops: number[], coords: number[]) => {
      let idx = 0;
      let startX = curX;
      let startY = curY;
      let subpathSegs: Array<[number, number, number, number]> = [];
      for (const op of ops) {
        if (op === OPS.moveTo) {
          flushSubpathSegments(subpathSegs);
          subpathSegs = [];
          curX = coords[idx++];
          curY = coords[idx++];
          startX = curX;
          startY = curY;
        } else if (op === OPS.lineTo) {
          const nx = coords[idx++];
          const ny = coords[idx++];
          subpathSegs.push([curX, curY, nx, ny]);
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
          subpathSegs.push([curX, curY, startX, startY]);
          curX = startX;
          curY = startY;
        } else if (op === OPS.rectangle) {
          flushSubpathSegments(subpathSegs);
          subpathSegs = [];
          const rx = coords[idx++];
          const ry = coords[idx++];
          const rw = coords[idx++];
          const rh = coords[idx++];
          recordRect(rx, ry, rw, rh);
        }
      }
      flushSubpathSegments(subpathSegs);
    };

    // Modern pdfjs v5/v6 constructPath handler: args = [paintOp, [drawData], minMax]
    const processModernDrawOps = (drawData: ArrayLike<number>) => {
      let idx = 0;
      let startX = curX;
      let startY = curY;
      let subpathSegs: Array<[number, number, number, number]> = [];
      while (idx < drawData.length) {
        const dop = drawData[idx++];
        if (dop === DRAW_OPS.moveTo) {
          flushSubpathSegments(subpathSegs);
          subpathSegs = [];
          curX = drawData[idx++];
          curY = drawData[idx++];
          startX = curX;
          startY = curY;
        } else if (dop === DRAW_OPS.lineTo) {
          const nx = drawData[idx++];
          const ny = drawData[idx++];
          subpathSegs.push([curX, curY, nx, ny]);
          curX = nx;
          curY = ny;
        } else if (dop === DRAW_OPS.curveTo) {
          idx += 4;
          curX = drawData[idx++];
          curY = drawData[idx++];
        } else if (dop === DRAW_OPS.quadraticCurveTo) {
          idx += 2;
          curX = drawData[idx++];
          curY = drawData[idx++];
        } else if (dop === DRAW_OPS.closePath) {
          subpathSegs.push([curX, curY, startX, startY]);
          curX = startX;
          curY = startY;
        } else {
          break;
        }
      }
      flushSubpathSegments(subpathSegs);
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
        if (typeof args[0] === 'number') {
          if (VISIBLE_PAINT_OPS.has(args[0])) {
            const firstBuf = Array.isArray(args[1]) ? args[1][0] : args[1];
            if (firstBuf && (Array.isArray(firstBuf) || ArrayBuffer.isView(firstBuf))) {
              processModernDrawOps(firstBuf as ArrayLike<number>);
            }
          }
        } else if (Array.isArray(args[0])) {
          const opsArr = args[0] as number[];
          const coordsArr =
            args[1] && (Array.isArray(args[1]) || ArrayBuffer.isView(args[1]))
              ? Array.from(args[1] as ArrayLike<number>)
              : [];
          if (opsArr.length > 0 && coordsArr.length > 0) {
            processLegacyPathOps(opsArr, coordsArr);
          }
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
      const rawVLinesAsc = clusterValues(
        compV.map((idx) => vSegs[idx].x0),
        3.5
      ).sort((a, b) => a - b);

      if (hLinesDesc.length >= 3 && rawVLinesAsc.length >= 1) {
        const minHx = Math.min(...compH.map((idx) => hSegs[idx].x0), rawVLinesAsc[0]);
        const maxHx = Math.max(
          ...compH.map((idx) => hSegs[idx].x1),
          rawVLinesAsc[rawVLinesAsc.length - 1]
        );
        const vLinesAsc = [...rawVLinesAsc];
        if (vLinesAsc[0] > minHx + 12) vLinesAsc.unshift(minHx);
        if (vLinesAsc[vLinesAsc.length - 1] < maxHx - 12) vLinesAsc.push(maxHx);

        if (vLinesAsc.length >= 3) {
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

  // Handle tables drawn with outer box + header divider only (no horizontal lines between body rows)
  if (nonEmptyRows.length === 2 && numRows === 2) {
    const bodyHeight = grid.hLinesDesc[1] - grid.hLinesDesc[2];
    const headerHeight = grid.hLinesDesc[0] - grid.hLinesDesc[1];
    if (bodyHeight > 42 && headerHeight < 36) {
      const bodyChunks = regionChunks.filter((ch) => ch.y < grid.hLinesDesc[1] - 2);
      const yLines: PositionedChunk[][] = [];
      for (const ch of [...bodyChunks].sort((a, b) => b.y - a.y || a.x - b.x)) {
        const last = yLines[yLines.length - 1];
        if (!last || Math.abs(last[0].y - ch.y) > 3.5) yLines.push([ch]);
        else last.push(ch);
      }
      if (yLines.length >= 3) {
        const lineRows = yLines.map((lineChunks) => {
          const rowArr = new Array<string>(numCols).fill('');
          for (const ch of lineChunks) {
            const centerX = ch.x + Math.min(ch.width, 16) * 0.35;
            let cIdx = colBoundariesAsc.findIndex(
              (xLeft, idx) =>
                idx < numCols &&
                centerX >= xLeft - 3 &&
                centerX <= colBoundariesAsc[idx + 1] + 3
            );
            if (cIdx < 0) cIdx = centerX < colBoundariesAsc[0] ? 0 : numCols - 1;
            rowArr[cIdx] = rowArr[cIdx] ? `${rowArr[cIdx]} ${cleanText(ch.text)}` : cleanText(ch.text);
          }
          return rowArr;
        });
        const multiColLines = lineRows.filter((r) => r.filter((c) => c.length > 0).length >= 2).length;
        if (multiColLines >= Math.ceil(lineRows.length * 0.6)) {
          return [nonEmptyRows[0], ...lineRows];
        }
      }
    }
  }

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

  const xStart = seg[0].x;
  const lastChunk = seg[seg.length - 1];
  const xEnd = lastChunk.x + lastChunk.width;

  // Measure approximate PDF point width of the first token for accurate soft-wrap vs hard-break detection
  const firstToken = lineText.split(/\s+/)[0] || '';
  const firstNonEmptyChunk = seg.find((c) => c.text.trim().length > 0) ?? seg[0];
  let firstWordWidth = firstToken.length * 5.2;
  if (firstNonEmptyChunk && firstNonEmptyChunk.text.length > 0 && firstNonEmptyChunk.width > 0) {
    const chunkTrim = firstNonEmptyChunk.text.trimStart();
    if (chunkTrim.length >= firstToken.length && firstToken.length > 0) {
      const avgCharW = firstNonEmptyChunk.width / firstNonEmptyChunk.text.length;
      firstWordWidth = avgCharW * firstToken.length;
    } else if (firstNonEmptyChunk.width > 0) {
      firstWordWidth = firstNonEmptyChunk.width;
    }
  }
  firstWordWidth = Math.max(8, Math.min(180, firstWordWidth));

  const isBold = totalChars > 0 && boldChars / totalChars >= 0.85;
  return {
    text: lineText,
    isBold,
    boldSubstring: !isBold && boldRunCount === 1 ? singleBoldText : undefined,
    pdfXStart: xStart,
    pdfXEnd: xEnd,
    pdfFirstWordWidth: firstWordWidth,
  };
}

/**
 * Fallback borderless table detection: finds consecutive multi-column aligned rows
 * using global column anchors (avoiding false positives on 2ª Parte & narrative paragraphs).
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
      /\b(militar nominado|conforme publicado|sem altera[çc][ãa]o)\b/i.test(fullRowText) ||
      /^(?:[1-5]\.|[a-b]\.)\s+/i.test(cols[0].text) ||
      /\d{1,2}\s*a\s*\d{1,2}\s*m\s*\d{1,2}\s*d\b/i.test(fullRowText) ||
      /\.{3,}/.test(fullRowText) ||
      /^Quartel\b/i.test(fullRowText) ||
      /^(?:JANEIRO|FEVEREIRO|MAR[ÇC]O|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO):?$/i.test(
        fullRowText
      )
    ) {
      break;
    }

    candidateRows.push(cols);
  }

  if (candidateRows.length < 2) return null;

  // Reject 2-column candidates that look like wrapped prose justified lines
  const allTwoCols = candidateRows.every((r) => r.length === 2);
  if (
    allTwoCols &&
    (candidateRows.every((r) => r[0].text.length > 42 && r[1].text.length <= 16) ||
      candidateRows.some((r) => r[0].text.length > 52 && /[a-zà-ÿ],?$/.test(r[0].text)))
  ) {
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

  interface PdfCollectedEntry {
    line: RawAlteracaoLine;
    pageIndex: number;
    pageWidth: number;
    rowIndex: number;
    segCount: number;
    y: number;
  }

  const collected: PdfCollectedEntry[] = [];
  const pageWidths = new Map<number, number>();

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    pageWidths.set(p, viewport.width);
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
    let inPart2OnPage = false;

    let rIdx = 0;
    while (rIdx < rows.length) {
      const rowY = rows[rIdx][0].y;
      const fullRowJoined = cleanText(rows[rIdx].map((c) => c.text).join(' '));
      if (/^2\s*[ªªA]?\s*PARTE\b/i.test(fullRowJoined)) {
        inPart2OnPage = true;
      }

      // Check if this row sits inside a detected ruled table (never inside 2ª Parte)
      const matchIdx = !inPart2OnPage
        ? gridMatches.findIndex(
            (m) => rowY <= m.grid.maxY + 4 && rowY >= m.grid.minY - 4
          )
        : -1;
      if (matchIdx !== -1) {
        if (!emittedGrids.has(matchIdx)) {
          collected.push({
            line: { text: '', tableRows: gridMatches[matchIdx].matrix },
            pageIndex: p,
            pageWidth: viewport.width,
            rowIndex: rIdx,
            segCount: 1,
            y: rowY,
          });
          emittedGrids.add(matchIdx);
        }
        rIdx++;
        continue;
      }

      // Check borderless aligned multi-column table only after top page header region & outside 2ª Parte
      if (!inPart2OnPage && rowY < viewport.height * 0.85) {
        const borderless = tryConsumeBorderlessTable(rows, rIdx, viewport.width);
        if (borderless) {
          collected.push({
            line: { text: '', tableRows: borderless.matrix },
            pageIndex: p,
            pageWidth: viewport.width,
            rowIndex: rIdx,
            segCount: 1,
            y: rowY,
          });
          rIdx = borderless.endIdx + 1;
          continue;
        }
      }

      const segments = rowsToLineSegments(rows[rIdx], splitColumnThreshold);
      for (const seg of segments) {
        const line = segmentsToTextLine(seg);
        if (line) {
          collected.push({
            line,
            pageIndex: p,
            pageWidth: viewport.width,
            rowIndex: rIdx,
            segCount: segments.length,
            y: rowY,
          });
        }
      }
      rIdx++;
    }
  }

  if (collected.length === 0 && pdf.numPages > 0) {
    return readAlteracaoFromPdfOcr(pdf);
  }

  // Compute global document body right/left margins so pages with mostly short lines still know the true margin
  const percentile = (sortedAsc: number[], q: number): number => {
    if (sortedAsc.length === 0) return 0;
    const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(sortedAsc.length * q)));
    return sortedAsc[idx];
  };

  const docLongXEnds: number[] = [];
  const docBodyXStarts: number[] = [];
  for (const entry of collected) {
    if (entry.line.tableRows || entry.segCount !== 1) continue;
    if (isHeaderContentText(entry.line.text)) continue;
    const xStart = entry.line.pdfXStart ?? 0;
    const xEnd = entry.line.pdfXEnd ?? 0;
    docBodyXStarts.push(xStart);
    if (xEnd - xStart > entry.pageWidth * 0.45) {
      docLongXEnds.push(xEnd);
    }
  }
  docLongXEnds.sort((a, b) => a - b);
  docBodyXStarts.sort((a, b) => a - b);

  const fallbackPageW = pageWidths.get(1) ?? 595;
  const docRightMargin =
    docLongXEnds.length >= 3
      ? percentile(docLongXEnds, 0.92)
      : docLongXEnds.length > 0
        ? docLongXEnds[docLongXEnds.length - 1]
        : fallbackPageW * 0.88;
  const docLeftMargin =
    docBodyXStarts.length >= 3 ? percentile(docBodyXStarts, 0.15) : 42;

  // Per-page margin & typical single-line vertical step
  const pageMetrics = new Map<
    number,
    { rightMargin: number; leftMargin: number; lineStep: number }
  >();
  for (let p = 1; p <= pdf.numPages; p++) {
    const pageEntries = collected.filter(
      (e) => e.pageIndex === p && !e.line.tableRows && e.segCount === 1
    );
    const pLongEnds = pageEntries
      .filter(
        (e) =>
          !isHeaderContentText(e.line.text) &&
          (e.line.pdfXEnd ?? 0) - (e.line.pdfXStart ?? 0) > e.pageWidth * 0.45
      )
      .map((e) => e.line.pdfXEnd ?? 0)
      .sort((a, b) => a - b);
    const pStarts = pageEntries
      .filter((e) => !isHeaderContentText(e.line.text))
      .map((e) => e.line.pdfXStart ?? docLeftMargin)
      .sort((a, b) => a - b);

    const rawPageRight = pLongEnds.length >= 3 ? percentile(pLongEnds, 0.92) : docRightMargin;
    const rightMargin =
      rawPageRight < docRightMargin - 16 ? docRightMargin : rawPageRight;
    const leftMargin = pStarts.length >= 3 ? percentile(pStarts, 0.15) : docLeftMargin;

    const steps: number[] = [];
    for (let i = 1; i < pageEntries.length; i++) {
      const dy = pageEntries[i - 1].y - pageEntries[i].y;
      if (dy >= 6 && dy <= 30) steps.push(dy);
    }
    steps.sort((a, b) => a - b);
    const lineStep = steps.length > 0 ? percentile(steps, 0.5) : 14;

    pageMetrics.set(p, { rightMargin, leftMargin, lineStep });
  }

  // Classify every consecutive line pair: soft wrap (ran out of space) vs intentional hard line break
  for (let i = 0; i < collected.length; i++) {
    const curr = collected[i];
    if (curr.line.tableRows) continue;

    const metrics = pageMetrics.get(curr.pageIndex) ?? {
      rightMargin: docRightMargin,
      leftMargin: docLeftMargin,
      lineStep: 14,
    };
    curr.line.pdfRightMargin = metrics.rightMargin;

    const next = i + 1 < collected.length ? collected[i + 1] : null;
    if (!next || next.line.tableRows) {
      curr.line.hardBreakAfter = true;
      continue;
    }

    if (next.pageIndex !== curr.pageIndex) {
      // Across page break: mark hard break if clearly ended short; otherwise leave undefined
      // so formatter checks against the first body word after continuation headers are stripped.
      const remaining = metrics.rightMargin - (curr.line.pdfXEnd ?? metrics.rightMargin);
      if (remaining > 46) {
        curr.line.hardBreakAfter = true;
      }
      continue;
    }

    if (next.rowIndex === curr.rowIndex) {
      // Separate columns on the same horizontal row
      curr.line.hardBreakAfter = true;
      continue;
    }

    const dy = curr.y - next.y;
    const hasVerticalGap = dy > metrics.lineStep * 1.38;
    const remainingWidth = metrics.rightMargin - (curr.line.pdfXEnd ?? metrics.rightMargin);
    const nextWordW = next.line.pdfFirstWordWidth ?? 28;
    const endedShortBeforeMargin = remainingWidth > Math.max(24, nextWordW + 14);
    const currOffset = (curr.line.pdfXStart ?? metrics.leftMargin) - metrics.leftMargin;
    const nextOffset = (next.line.pdfXStart ?? metrics.leftMargin) - metrics.leftMargin;
    const nextIndented = nextOffset > 14 && currOffset <= 10;

    if (endedShortBeforeMargin || hasVerticalGap || nextIndented) {
      curr.line.hardBreakAfter = true;
      if (nextIndented) {
        next.line.hardBreakBefore = true;
      }
    } else {
      curr.line.hardBreakAfter = false;
    }
  }

  return collected.map((e) => e.line);
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function directWordChildren(el: Element, localTagName?: string): Element[] {
  const out: Element[] = [];
  for (const ch of Array.from(el.children)) {
    const name = ch.localName || ch.nodeName.replace(/^.*:/, '');
    if (!localTagName || name === localTagName) {
      out.push(ch);
    }
  }
  return out;
}

function extractDocxParagraphRuns(p: Element): Array<{
  text: string;
  isBold: boolean;
  isUnderlined: boolean;
  boldSubstring?: string;
}> {
  interface SubLineAcc {
    fullText: string;
    boldChars: number;
    totalChars: number;
    isUnderlined: boolean;
    boldRunCount: number;
    currentBoldRun: string;
    singleBoldText: string;
  }

  const createAcc = (): SubLineAcc => ({
    fullText: '',
    boldChars: 0,
    totalChars: 0,
    isUnderlined: false,
    boldRunCount: 0,
    currentBoldRun: '',
    singleBoldText: '',
  });

  const subLines: SubLineAcc[] = [createAcc()];

  const appendTextToCurrent = (chunk: string, runBold: boolean, runUnderlined: boolean) => {
    const acc = subLines[subLines.length - 1];
    if (runUnderlined) acc.isUnderlined = true;
    acc.fullText += chunk;
    const nonWs = chunk.replace(/\s+/g, '').length;
    acc.totalChars += nonWs;
    if (runBold) {
      acc.boldChars += nonWs;
      acc.currentBoldRun += chunk;
    } else if (acc.currentBoldRun.trim()) {
      acc.boldRunCount++;
      acc.singleBoldText = cleanText(acc.currentBoldRun);
      acc.currentBoldRun = '';
    }
  };

  const runs = Array.from(p.getElementsByTagNameNS(W_NS, 'r'));
  for (const r of runs) {
    const rPr = directWordChildren(r, 'rPr')[0];
    let runBold = false;
    let runUnderlined = false;
    if (rPr) {
      const bEl = directWordChildren(rPr, 'b')[0];
      if (bEl) {
        const val = bEl.getAttribute('w:val') ?? bEl.getAttribute('val');
        runBold = val !== '0' && val !== 'false';
      }
      const uEl = directWordChildren(rPr, 'u')[0];
      if (uEl) {
        const val = uEl.getAttribute('w:val') ?? uEl.getAttribute('val');
        if (val !== 'none') runUnderlined = true;
      }
    }

    for (const rChild of Array.from(r.children)) {
      const tag = rChild.localName || rChild.nodeName.replace(/^.*:/, '');
      if (tag === 't' || tag === 'delText') {
        const txt = rChild.textContent || '';
        if (txt) appendTextToCurrent(txt, runBold, runUnderlined);
      } else if (tag === 'tab') {
        appendTextToCurrent(' ', runBold, runUnderlined);
      } else if (tag === 'br' || tag === 'cr') {
        const brType = rChild.getAttribute('w:type') ?? rChild.getAttribute('type');
        if (brType !== 'page' && brType !== 'column') {
          subLines.push(createAcc());
        }
      }
    }
  }

  const out: Array<{
    text: string;
    isBold: boolean;
    isUnderlined: boolean;
    boldSubstring?: string;
    hardBreakAfter: boolean;
  }> = [];

  for (const acc of subLines) {
    if (acc.currentBoldRun.trim()) {
      acc.boldRunCount++;
      acc.singleBoldText = cleanText(acc.currentBoldRun);
    }
    const lineText = cleanText(acc.fullText);
    if (!lineText) continue;
    const isBold = acc.totalChars > 0 && acc.boldChars / acc.totalChars >= 0.85;
    out.push({
      text: lineText,
      isBold,
      isUnderlined: acc.isUnderlined,
      boldSubstring: !isBold && acc.boldRunCount === 1 ? acc.singleBoldText : undefined,
      hardBreakAfter: true,
    });
  }

  return out;
}

function isPart2TableMatrix(matrix: string[][]): boolean {
  const flat = matrix.flat().join(' ');
  return (
    /TEMPO\s+COMPUTADO|TEMPO\s+TOTAL\s+DE\s+EFETIVO/i.test(flat) ||
    matrix.filter((r) => r.some((c) => /\d{1,2}\s*a\s*\d{1,2}\s*m\s*\d{1,2}\s*d\b/i.test(c))).length >= 2
  );
}

function processDocxElement(el: Element, outLines: RawAlteracaoLine[]) {
  const localName = el.localName || el.nodeName.replace(/^.*:/, '');
  if (localName === 'p') {
    const pLines = extractDocxParagraphRuns(el);
    outLines.push(...pLines);
    return;
  }

  if (localName === 'sdt') {
    const sdtContent = directWordChildren(el, 'sdtContent')[0];
    if (sdtContent) {
      for (const ch of Array.from(sdtContent.children)) {
        processDocxElement(ch, outLines);
      }
    }
    return;
  }

  if (localName === 'tbl') {
    const trs = directWordChildren(el, 'tr');
    const matrix: string[][] = [];
    const tableParagraphs: RawAlteracaoLine[] = [];
    let hasNestedTable = false;

    for (const tr of trs) {
      const tcs = directWordChildren(tr, 'tc');
      const rowCells: string[] = [];
      for (const tc of tcs) {
        const cellLines: string[] = [];
        for (const tcChild of Array.from(tc.children)) {
          const tcTag = tcChild.localName || tcChild.nodeName.replace(/^.*:/, '');
          if (tcTag === 'p') {
            const pRuns = extractDocxParagraphRuns(tcChild);
            for (const pLine of pRuns) {
              tableParagraphs.push(pLine);
              cellLines.push(pLine.text);
            }
          } else if (tcTag === 'tbl' || tcTag === 'sdt') {
            hasNestedTable = true;
          }
        }
        rowCells.push(cellLines.filter(Boolean).join('\n'));

        const tcPr = directWordChildren(tc, 'tcPr')[0];
        const gridSpanEl = tcPr ? directWordChildren(tcPr, 'gridSpan')[0] : undefined;
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

    // If outer table wraps nested tables or is a 1-column layout container, walk cell contents directly
    const maxCols = matrix.length > 0 ? Math.max(...matrix.map((r) => r.length)) : 0;
    const nonEmptyColCount = matrix.reduce((acc, r) => {
      const filled = r.filter((c) => c.length > 0).length;
      return Math.max(acc, filled);
    }, 0);

    if (hasNestedTable || maxCols <= 1 || nonEmptyColCount <= 1) {
      for (const tr of trs) {
        for (const tc of directWordChildren(tr, 'tc')) {
          for (const tcChild of Array.from(tc.children)) {
            processDocxElement(tcChild, outLines);
          }
        }
      }
      return;
    }

    const fullTableText = matrix.flat().join(' ');
    if (isHeaderContentText(fullTableText)) {
      outLines.push(...tableParagraphs);
    } else if (isPart2TableMatrix(matrix)) {
      for (const row of matrix) {
        const joined = row.map((c) => cleanText(c)).filter(Boolean).join(' ');
        if (joined) outLines.push({ text: joined });
      }
    } else if (matrix.length > 0) {
      outLines.push({ text: '', tableRows: matrix });
    }
    return;
  }

  // Recurse into any wrapper containers (customXml, smartTag, etc.)
  for (const ch of Array.from(el.children)) {
    processDocxElement(ch, outLines);
  }
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
    processDocxElement(child, lines);
  }

  return lines;
}

function decodeQuotedPrintable(input: string): string {
  const normalized = input.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '=' && /^[0-9A-Fa-f]{2}/.test(normalized.slice(i + 1, i + 3))) {
      bytes.push(parseInt(normalized.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const code = normalized.charCodeAt(i);
      if (code < 128) bytes.push(code);
      else {
        const encoded = new TextEncoder().encode(ch);
        encoded.forEach((b) => bytes.push(b));
      }
    }
  }
  const u8 = new Uint8Array(bytes);
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(u8);
    return utf8;
  } catch {
    return new TextDecoder('windows-1252').decode(u8);
  }
}

function extractHtmlFromMhtml(raw: string): string | null {
  if (!/MIME-Version:/i.test(raw) || !/text\/html/i.test(raw)) return null;
  const htmlIdx = raw.search(/<!DOCTYPE|<html/i);
  if (htmlIdx < 0) return null;
  const headerSlice = raw.slice(Math.max(0, htmlIdx - 600), htmlIdx);
  const tail = raw.slice(htmlIdx);
  const boundaryMatch = raw.match(/boundary="?([^"\r\n;]+)"?/i);
  const endIdx = boundaryMatch ? tail.indexOf(`--${boundaryMatch[1]}`) : -1;
  const htmlSection = endIdx > 0 ? tail.slice(0, endIdx) : tail;
  return /quoted-printable/i.test(headerSlice)
    ? decodeQuotedPrintable(htmlSection)
    : htmlSection;
}

function rtfToPlainText(rtf: string): string {
  // Strip header destinations & convert basic RTF paragraphs/accents
  let s = rtf.replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|pict|object)[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/gi, '');
  s = s.replace(/\\par\b\s?|\\line\b\s?/gi, '\n');
  s = s.replace(/\\tab\b\s?/gi, ' ');
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_m, hex: string) => {
    const code = parseInt(hex, 16);
    try {
      return new TextDecoder('windows-1252').decode(new Uint8Array([code]));
    } catch {
      return String.fromCharCode(code);
    }
  });
  s = s.replace(/\\u(-?\d+)\??/g, (_m, numStr: string) => {
    let code = parseInt(numStr, 10);
    if (code < 0) code += 65536;
    return String.fromCharCode(code);
  });
  s = s.replace(/\\[a-zA-Z]+-?\d*\s?/g, '');
  s = s.replace(/[{}]/g, '');
  return s;
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

  const headBytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  // Detect legacy binary OLE2 .doc (D0 CF 11 E0 A1 B1 1A E1)
  if (
    headBytes.length >= 4 &&
    headBytes[0] === 0xd0 &&
    headBytes[1] === 0xcf &&
    headBytes[2] === 0x11 &&
    headBytes[3] === 0xe0
  ) {
    throw new Error(
      'Arquivo .doc binário antigo não suportado diretamente. Salve como .docx ou .pdf e envie novamente.'
    );
  }

  const text = await file.text();
  if (/^\s*\{\\rtf/i.test(text)) {
    return plainTextToRawAlteracaoLines(rtfToPlainText(text));
  }

  const mhtmlHtml = extractHtmlFromMhtml(text);
  if (mhtmlHtml) {
    return htmlToRawAlteracaoLines(mhtmlHtml);
  }

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
  /** Direct measured inner content height (clientHeight - vertical padding) of Page 1 editor */
  page1ContentHeightPx?: number;
  /** Direct measured inner content height (clientHeight - vertical padding) of continuation editor */
  contContentHeightPx?: number;
  /** Direct measured unscaled clientWidth of the live editor element */
  editorWidthPx?: number;
  startOnContinuationPage?: boolean;
  lockedPrefixHtmls?: string[];
}

/**
 * Measures formatted blocks & table rows in an A4-width hidden probe and splits cleanly across pages.
 * Whenever a table starts on one page and overflows to the next, only the overflow rows move to the
 * next sheet — placed strictly BELOW that page's continuation header.
 * Supports locking an existing prefix on the first reflowed page so edits above remain untouched.
 */
export function paginateAlteracaoBlocksInDom(
  blocks: AlteracaoHtmlBlock[],
  options: PaginateOptions
): string[] {
  const lockedPrefixHtmls = options.lockedPrefixHtmls ?? [];
  if (blocks.length === 0 && lockedPrefixHtmls.length === 0) return ['<p><br></p>'];

  // Outer A4 height = 297mm, top+bottom page padding = 26mm -> 271mm; outer black border = 2px
  const frameInnerPx = mmToPx(271) - 2;
  const editorPaddingVPx = mmToPx(7);
  const page1HeaderPx =
    options.page1HeaderHeightPx && options.page1HeaderHeightPx > 20
      ? options.page1HeaderHeightPx
      : mmToPx(47);
  // Real 3-line continuation header is ~19.5mm (~74px); never clamp upward to 27mm
  const contHeaderPx =
    options.contHeaderHeightPx && options.contHeaderHeightPx > 20
      ? options.contHeaderHeightPx
      : mmToPx(20);

  const rawPage1UsablePx =
    options.page1ContentHeightPx && options.page1ContentHeightPx > 160
      ? options.page1ContentHeightPx
      : frameInnerPx - page1HeaderPx - editorPaddingVPx;
  const rawContUsablePx =
    options.contContentHeightPx && options.contContentHeightPx > 200
      ? options.contContentHeightPx
      : frameInnerPx - contHeaderPx - editorPaddingVPx;

  // Minimal 4px subpixel safety margin so content reaches the full bottom of each A4 sheet
  const page1MaxPx = Math.max(160, rawPage1UsablePx - 4);
  const contMaxPx = Math.max(200, rawContUsablePx - 4);

  const probe = document.createElement('div');
  probe.className = 'alteracao-editor';
  probe.style.position = 'fixed';
  probe.style.left = '-99999px';
  probe.style.top = '0';
  probe.style.width =
    options.editorWidthPx && options.editorWidthPx > 200
      ? `${options.editorWidthPx}px`
      : '181.5mm';
  probe.style.padding = '3.5mm 4mm';
  probe.style.boxSizing = 'border-box';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.fontFamily = `"${options.fontFamily}", "Times New Roman", Times, serif`;
  probe.style.fontSize = options.fontSizePt;
  probe.style.lineHeight = options.lineHeight;
  probe.innerHTML = [...lockedPrefixHtmls, ...blocks.map((b) => b.html)].join('');
  document.body.appendChild(probe);

  const children = Array.from(probe.children) as HTMLElement[];
  const prefixCount = lockedPrefixHtmls.length;

  let initialPrefixHeight = 0;
  for (let p = 0; p < prefixCount; p++) {
    const child = children[p];
    if (!child) continue;
    const style = window.getComputedStyle(child);
    const mt = parseFloat(style.marginTop) || 0;
    const mb = parseFloat(style.marginBottom) || 0;
    initialPrefixHeight += child.getBoundingClientRect().height + mt + mb;
  }

  const blockHeights: number[] = [];
  const tableRowHeightsByBlock = new Map<number, number[]>();

  for (let i = 0; i < blocks.length; i++) {
    const child = children[prefixCount + i];
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
  let currentPageHtmls: string[] = [...lockedPrefixHtmls];
  let currentPageStrippableSpacerMask: boolean[] = lockedPrefixHtmls.map(() => false);
  let currentHeight = initialPrefixHeight;
  let currentMaxPx = options.startOnContinuationPage ? contMaxPx : page1MaxPx;

  const pushToCurrentPage = (html: string, h: number, isStrippableSpacer = false) => {
    currentPageHtmls.push(html);
    currentPageStrippableSpacerMask.push(isStrippableSpacer);
    currentHeight += h;
  };

  const startNextPage = () => {
    while (
      currentPageHtmls.length > 0 &&
      currentPageStrippableSpacerMask[currentPageStrippableSpacerMask.length - 1]
    ) {
      currentPageHtmls.pop();
      currentPageStrippableSpacerMask.pop();
    }
    if (currentPageHtmls.length > 0) {
      pages.push(currentPageHtmls);
    }
    currentPageHtmls = [];
    currentPageStrippableSpacerMask = [];
    currentHeight = 0;
    currentMaxPx = contMaxPx;
  };

  const measureBlockSpanHeight = (fromIdx: number, toIdx: number): number => {
    let total = 0;
    for (let k = fromIdx; k <= toIdx; k++) {
      if (blocks[k].tableMeta) {
        const fullTableH = blockHeights[k] ?? 40;
        if (fullTableH + 4 <= contMaxPx) {
          total += fullTableH + 4;
        } else {
          // Table taller than an entire page: keep heading with at least first 2 rows
          const rowHeights = tableRowHeightsByBlock.get(k) ?? [22];
          const minRowsH = rowHeights
            .slice(0, Math.min(2, rowHeights.length))
            .reduce((a, b) => a + b, 6);
          total += minRowsH;
        }
      } else {
        total += blockHeights[k] ?? 18;
      }
    }
    return total;
  };

  let idx = 0;
  while (idx < blocks.length) {
    const block = blocks[idx];

    if (currentPageHtmls.length === 0 && block.isSpacer && !block.preserveIfSpacer) {
      idx++;
      continue;
    }

    // Handle data tables: keep the ENTIRE table uncut on the next page whenever it fits on one page;
    // only split row-by-row if a single table is taller than a full continuation page.
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

      if (currentPageHtmls.length > 0 && fullTableHeight + 4 <= contMaxPx) {
        startNextPage();
        continue;
      }

      // Split giant multi-page table row-by-row across current and subsequent pages
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

    // 1) Follow keepWithNext heading chains (e.g., MÊS: + spacer + TÍTULO + Subtítulo + spacer + 1st content block),
    //    bridging at most 1 consecutive spacer per heading so user blank lines never chain unrelated blocks.
    let firstContentIdx = idx;
    if (block.keepWithNext) {
      let scan = idx;
      let consecutiveSpacers = 0;
      while (scan < blocks.length - 1) {
        if (blocks[scan].keepWithNext) {
          consecutiveSpacers = 0;
          scan++;
        } else if (blocks[scan].isSpacer && consecutiveSpacers < 1) {
          consecutiveSpacers++;
          scan++;
        } else {
          break;
        }
      }
      firstContentIdx = scan;
    }

    // 2) Extend strictly across small truly-fixed clusters (Subtitle + Table, Comportamento, 2ª Parte item 1 / signature).
    //    Regular text BI paragraphs have no atomicGroupId, so they flow smoothly line-by-line across pages.
    let groupEnd = firstContentIdx;
    const targetAtomicId = blocks[firstContentIdx]?.atomicGroupId ?? block.atomicGroupId;
    if (targetAtomicId && !block.isSpacer) {
      const allowCrossSpacer = targetAtomicId === 'part2-signature';
      let scan = firstContentIdx;
      while (scan < blocks.length - 1) {
        const directNext = blocks[scan + 1];
        if (!directNext.isSpacer) {
          if (directNext.atomicGroupId === targetAtomicId) {
            scan++;
            continue;
          }
          break;
        }
        // Only cross a spacer when explicitly allowed (2ª Parte signature) or immediately after a heading
        if (allowCrossSpacer || blocks[scan].keepWithNext) {
          let nextNonSpacer = scan + 1;
          while (nextNonSpacer < blocks.length && blocks[nextNonSpacer].isSpacer) {
            nextNonSpacer++;
          }
          if (
            nextNonSpacer < blocks.length &&
            blocks[nextNonSpacer].atomicGroupId === targetAtomicId
          ) {
            scan = nextNonSpacer;
            continue;
          }
        }
        break;
      }
      groupEnd = scan;
    }

    const singleHeight = blockHeights[idx] ?? 18;

    if (currentPageHtmls.length > 0 && groupEnd > idx) {
      const fullUnitHeight = measureBlockSpanHeight(idx, groupEnd);
      const isSpecialFixedCluster =
        targetAtomicId === 'part2-signature' ||
        targetAtomicId === 'part2-item-1' ||
        targetAtomicId === 'comportamento';

      // When a heading (keepWithNext) has NO atomic cluster on its body (normal text BI),
      // groupEnd === firstContentIdx: keep heading(s) attached to their first paragraph so
      // no Título/Subtítulo is orphaned at the bottom of a page, while all following paragraphs
      // flow individually one-by-one.
      const maxAtomicUnitPx =
        isSpecialFixedCluster || !targetAtomicId
          ? contMaxPx
          : Math.min(contMaxPx * 0.45, 420);

      if (currentHeight + fullUnitHeight > currentMaxPx && fullUnitHeight <= maxAtomicUnitPx) {
        startNextPage();
        continue;
      }

      // If a fixed cluster (e.g. tall table) exceeds the atomic cap, still keep leading headings
      // attached to at least their first content block so no Título/Subtítulo is ever orphaned.
      if (block.keepWithNext && firstContentIdx < groupEnd) {
        const headingPlusFirstHeight = measureBlockSpanHeight(idx, firstContentIdx);
        if (
          currentHeight + headingPlusFirstHeight > currentMaxPx &&
          headingPlusFirstHeight <= contMaxPx
        ) {
          startNextPage();
          continue;
        }
      }
    }

    if (currentPageHtmls.length > 0 && currentHeight + singleHeight > currentMaxPx) {
      startNextPage();
      continue;
    }

    pushToCurrentPage(
      block.html,
      singleHeight,
      Boolean(block.isSpacer && !block.preserveIfSpacer)
    );
    idx++;
  }

  while (
    currentPageHtmls.length > 0 &&
    currentPageStrippableSpacerMask[currentPageStrippableSpacerMask.length - 1]
  ) {
    currentPageHtmls.pop();
    currentPageStrippableSpacerMask.pop();
  }
  if (currentPageHtmls.length > 0) {
    pages.push(currentPageHtmls);
  }

  if (pages.length === 0) return ['<p><br></p>'];
  return pages.map((pageParts) => pageParts.join('\n'));
}
