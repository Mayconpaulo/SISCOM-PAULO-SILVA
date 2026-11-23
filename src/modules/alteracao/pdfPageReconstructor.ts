export interface PdfTextItemLike {
  str: string;
  transform: number[];
  width?: number;
  height?: number;
}

export interface PdfOperatorListLike {
  fnArray: number[];
  argsArray: unknown[];
}

export interface PdfOpsConstantsLike {
  constructPath?: number;
  rectangle?: number;
  moveTo?: number;
  lineTo?: number;
}

interface PositionedSpan {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CellRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function normalizeInlineSpaces(value: string): string {
  return value
    .replace(/[\u00a0\u2000-\u200f\u202f\u205f\u3000]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Extracts vector cell rectangles from pdfjs-dist operator lists (supports pdfjs v5/v6
 * Float32Array constructPath arrays as well as legacy OPS.rectangle calls).
 * Excludes outer page border frames so only true data-table cells are returned.
 */
function extractVectorCellRects(
  ops: PdfOperatorListLike | null | undefined,
  OPS: PdfOpsConstantsLike | null | undefined
): CellRect[] {
  if (!ops || !OPS || !Array.isArray(ops.fnArray) || !Array.isArray(ops.argsArray)) {
    return [];
  }

  const rawRects: CellRect[] = [];

  const pushCandidateRect = (ax1: number, ay1: number, ax2: number, ay2: number) => {
    const x1 = Math.min(ax1, ax2);
    const x2 = Math.max(ax1, ax2);
    const y1 = Math.min(ay1, ay2);
    const y2 = Math.max(ay1, ay2);
    const w = x2 - x1;
    const h = y2 - y1;
    // Ignore tiny lines, decorative rules, and the outer page margin border
    if (w < 14 || h < 9) return;
    if (h > 420) return;
    if (w > 470 && h > 260) return;
    rawRects.push({ x1, y1, x2, y2 });
  };

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];

    if (OPS.constructPath !== undefined && fn === OPS.constructPath && Array.isArray(args)) {
      // pdfjs v5/v6 format: args = [paintOp, [Float32Array], minMax]
      const second = args[1];
      const coordsLike =
        Array.isArray(second) && second.length > 0 && second[0] && typeof second[0].length === 'number'
          ? (second[0] as ArrayLike<number>)
          : null;

      if (coordsLike && coordsLike.length >= 12) {
        // Parse subpaths encoded as [0(moveTo), x, y, 1(lineTo), x, y, ..., 4(closePath)]
        let xs: number[] = [];
        let ys: number[] = [];
        let idx = 0;
        const flushPolygon = () => {
          if (xs.length >= 4 && xs.length <= 6) {
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);
            const allAxisAligned = xs.every(
              (v, k) =>
                (Math.abs(v - minX) <= 1.5 || Math.abs(v - maxX) <= 1.5) &&
                (Math.abs(ys[k] - minY) <= 1.5 || Math.abs(ys[k] - maxY) <= 1.5)
            );
            if (allAxisAligned) {
              pushCandidateRect(minX, minY, maxX, maxY);
            }
          }
          xs = [];
          ys = [];
        };

        while (idx < coordsLike.length) {
          const cmd = coordsLike[idx++];
          if (cmd === 0) {
            flushPolygon();
            if (idx + 1 < coordsLike.length) {
              xs.push(coordsLike[idx++]);
              ys.push(coordsLike[idx++]);
            }
          } else if (cmd === 1) {
            if (idx + 1 < coordsLike.length) {
              xs.push(coordsLike[idx++]);
              ys.push(coordsLike[idx++]);
            }
          } else if (cmd === 2) {
            idx += 6;
            xs = [];
            ys = [];
          } else if (cmd === 3) {
            idx += 4;
            xs = [];
            ys = [];
          } else if (cmd === 4) {
            flushPolygon();
          } else {
            break;
          }
        }
        flushPolygon();
      }
    } else if (OPS.rectangle !== undefined && fn === OPS.rectangle && Array.isArray(args) && args.length >= 4) {
      const rx = Number(args[0]);
      const ry = Number(args[1]);
      const rw = Number(args[2]);
      const rh = Number(args[3]);
      if ([rx, ry, rw, rh].every(Number.isFinite)) {
        pushCandidateRect(rx, ry, rx + rw, ry + rh);
      }
    }
  }

  // Deduplicate nearly identical cell rectangles (e.g. fill + stroke emitted twice)
  const unique: CellRect[] = [];
  for (const r of rawRects) {
    const dup = unique.some(
      (u) =>
        Math.abs(u.x1 - r.x1) <= 2.5 &&
        Math.abs(u.y1 - r.y1) <= 2.5 &&
        Math.abs(u.x2 - r.x2) <= 2.5 &&
        Math.abs(u.y2 - r.y2) <= 2.5
    );
    if (!dup) unique.push(r);
  }
  return unique;
}

function rectsTouchOrOverlap(a: CellRect, b: CellRect, tol = 4.5): boolean {
  return !(
    a.x2 + tol < b.x1 ||
    b.x2 + tol < a.x1 ||
    a.y2 + tol < b.y1 ||
    b.y2 + tol < a.y1
  );
}

/**
 * Groups adjacent cell rectangles into connected tables and validates that each table
 * has genuine grid structure (>= 2 rows or >= 2 columns with text).
 */
function clusterRectsIntoTables(cells: CellRect[]): CellRect[][] {
  if (cells.length < 2) return [];
  const visited = new Array<boolean>(cells.length).fill(false);
  const groups: CellRect[][] = [];

  for (let i = 0; i < cells.length; i++) {
    if (visited[i]) continue;
    const queue = [i];
    visited[i] = true;
    const group: CellRect[] = [];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      group.push(cells[curr]);
      for (let j = 0; j < cells.length; j++) {
        if (!visited[j] && rectsTouchOrOverlap(cells[curr], cells[j])) {
          visited[j] = true;
          queue.push(j);
        }
      }
    }
    if (group.length >= 2) {
      groups.push(group);
    }
  }

  return groups;
}

function formatCellSpansText(spans: PositionedSpan[]): string {
  if (spans.length === 0) return '';
  const sorted = [...spans].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PositionedSpan[][] = [];
  for (const sp of sorted) {
    const last = lines[lines.length - 1];
    if (!last || Math.abs(last[0].y - sp.y) > 3.5) {
      lines.push([sp]);
    } else {
      last.push(sp);
    }
  }

  const lineStrings = lines
    .map((row) => {
      row.sort((a, b) => a.x - b.x);
      let s = '';
      for (let i = 0; i < row.length; i++) {
        const curr = row[i];
        if (i > 0) {
          const prev = row[i - 1];
          const gap = curr.x - (prev.x + prev.width);
          if (gap > 1.2 && !s.endsWith(' ') && !curr.text.startsWith(' ')) {
            s += ' ';
          }
        }
        s += curr.text;
      }
      return normalizeInlineSpaces(s);
    })
    .filter(Boolean);

  let joined = '';
  for (const part of lineStrings) {
    if (!joined) {
      joined = part;
    } else if (joined.endsWith('/') || joined.endsWith('-')) {
      if (joined.endsWith(' -')) {
        joined = `${joined} ${part}`;
      } else if (joined.endsWith('/')) {
        joined = `${joined}${part}`;
      } else {
        joined = `${joined} ${part}`;
      }
    } else {
      joined = `${joined} ${part}`;
    }
  }
  return normalizeInlineSpaces(joined);
}

/**
 * Reconstructs readable line-by-line text from a single PDF page, preserving structured
 * vector tables cleanly inside [[TABELA_INICIO]] ... [[TABELA_FIM]] markers while
 * removing faux-bold overlapping duplicate glyphs.
 */
export function reconstructPdfPageText(
  items: unknown[],
  ops?: PdfOperatorListLike | null,
  OPS?: PdfOpsConstantsLike | null
): string {
  const rawSpans: PositionedSpan[] = [];

  for (const raw of items) {
    const item = raw as PdfTextItemLike;
    if (typeof item.str !== 'string') continue;
    const text = item.str.replace(/\u00a0/g, ' ');
    if (!text.trim()) continue;
    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5] ?? 0;
    const height = Math.abs(item.height || item.transform?.[3] || 10);
    const width = item.width ?? text.length * 4;
    rawSpans.push({ text, x, y, width, height });
  }

  if (rawSpans.length === 0) return '';

  // Sort top-to-bottom (descending Y), left-to-right (ascending X)
  rawSpans.sort((a, b) => b.y - a.y || a.x - b.x);

  // Deduplicate faux-bold double-printed glyphs at nearly identical (x, y)
  const spans: PositionedSpan[] = [];
  for (const span of rawSpans) {
    const trimmed = span.text.trim();
    let isDup = false;
    for (let k = spans.length - 1; k >= 0; k--) {
      const prev = spans[k];
      if (prev.y - span.y > 2.6) break;
      if (
        Math.abs(prev.y - span.y) <= 2.2 &&
        Math.abs(prev.x - span.x) <= 2.4 &&
        prev.text.trim() === trimmed
      ) {
        prev.width = Math.max(prev.width, span.width);
        isDup = true;
        break;
      }
    }
    if (!isDup) spans.push(span);
  }

  // Detect vector cell tables and assign enclosed spans into exact (row, col) cells
  const cellRects = extractVectorCellRects(ops, OPS);
  const tableGroups = clusterRectsIntoTables(cellRects);
  const consumedSpanIndices = new Set<number>();

  interface PositionedOutputBlock {
    yTop: number;
    lines: string[];
  }
  const outputBlocks: PositionedOutputBlock[] = [];

  for (const group of tableGroups) {
    // Cluster cells into horizontal rows by top edge y2 (descending)
    const sortedCells = [...group].sort((a, b) => b.y2 - a.y2 || a.x1 - b.x1);
    const rowBands: CellRect[][] = [];
    for (const cell of sortedCells) {
      const lastBand = rowBands[rowBands.length - 1];
      if (!lastBand || Math.abs(lastBand[0].y2 - cell.y2) > 4.5) {
        rowBands.push([cell]);
      } else {
        lastBand.push(cell);
      }
    }

    const maxCols = rowBands.reduce((acc, band) => Math.max(acc, band.length), 0);
    if (rowBands.length < 2 && maxCols < 2) continue;
    if (maxCols < 2 && rowBands.length < 3) continue;

    const tableMatchedIndices: number[] = [];
    const tableRowStrings: string[] = [];

    for (const band of rowBands) {
      band.sort((a, b) => a.x1 - b.x1);
      const cellTexts: string[] = [];
      for (const cell of band) {
        const cellSpans: PositionedSpan[] = [];
        for (let sIdx = 0; sIdx < spans.length; sIdx++) {
          if (consumedSpanIndices.has(sIdx)) continue;
          const sp = spans[sIdx];
          const cx = sp.x + Math.min(sp.width * 0.5, 18);
          const cy = sp.y + sp.height * 0.35;
          if (
            cx >= cell.x1 - 2.5 &&
            cx <= cell.x2 + 2.5 &&
            cy >= cell.y1 - 2.5 &&
            cy <= cell.y2 + 2.5
          ) {
            cellSpans.push(sp);
            tableMatchedIndices.push(sIdx);
          }
        }
        cellTexts.push(formatCellSpansText(cellSpans));
      }
      if (cellTexts.some((t) => t.length > 0)) {
        tableRowStrings.push(cellTexts.join(' | '));
      }
    }

    const totalPopulatedCells = tableRowStrings.reduce(
      (sum, r) => sum + r.split(' | ').filter((c) => c.trim().length > 0).length,
      0
    );
    if (tableRowStrings.length >= 1 && totalPopulatedCells >= 2) {
      for (const sIdx of tableMatchedIndices) {
        consumedSpanIndices.add(sIdx);
      }
      const yTop = Math.max(...group.map((c) => c.y2));
      outputBlocks.push({
        yTop,
        lines: ['[[TABELA_INICIO]]', ...tableRowStrings, '[[TABELA_FIM]]'],
      });
    }
  }

  // Reconstruct remaining non-table spans into standard horizontal lines
  const freeSpans = spans.filter((_, idx) => !consumedSpanIndices.has(idx));
  const rows: PositionedSpan[][] = [];
  for (const span of freeSpans) {
    const lastRow = rows[rows.length - 1];
    if (!lastRow || Math.abs(lastRow[0].y - span.y) > 3.5) {
      rows.push([span]);
    } else {
      lastRow.push(span);
    }
  }

  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let line = '';
    for (let i = 0; i < row.length; i++) {
      const curr = row[i];
      if (i > 0) {
        const prev = row[i - 1];
        const gap = curr.x - (prev.x + prev.width);
        if (gap > 22) {
          line += '   |   ';
        } else if (gap > 1.6 && !line.endsWith(' ') && !curr.text.startsWith(' ')) {
          line += ' ';
        }
      }
      line += curr.text;
    }
    const cleaned = line
      .replace(/[\u00a0\u2000-\u200f\u202f\u205f\u3000]/g, ' ')
      .replace(/\s+\|\s+/g, ' | ')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    if (cleaned) {
      const yTop = Math.max(...row.map((s) => s.y));
      outputBlocks.push({ yTop, lines: [cleaned] });
    }
  }

  // Sort all text lines & tables in exact top-to-bottom reading order
  outputBlocks.sort((a, b) => b.yTop - a.yTop);

  const finalLines: string[] = [];
  for (const block of outputBlocks) {
    finalLines.push(...block.lines);
  }
  return finalLines.join('\n');
}
