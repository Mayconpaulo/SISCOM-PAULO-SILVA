import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker } from 'tesseract.js';
import type { BiBulletinPage } from './biSearchTypes';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfTextItemLike {
  str: string;
  transform: number[];
  width?: number;
}

interface PositionedSpan {
  text: string;
  x: number;
  y: number;
  width: number;
}

function normalizeInlineSpaces(value: string): string {
  return value
    .replace(/[\u00a0\u2000-\u200f\u202f\u205f\u3000]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Reconstructs readable line-by-line text from a single PDF page preserving columns/tables
 * with tab-like spacing and removing faux-bold overlapping duplicate glyphs.
 */
function reconstructPdfPageText(items: unknown[]): string {
  const rawSpans: PositionedSpan[] = [];

  for (const raw of items) {
    const item = raw as PdfTextItemLike;
    if (typeof item.str !== 'string') continue;
    const text = item.str.replace(/\u00a0/g, ' ');
    if (!text.trim()) continue;
    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5] ?? 0;
    const width = item.width ?? text.length * 4;
    rawSpans.push({ text, x, y, width });
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

  // Group into horizontal lines by Y proximity
  const rows: PositionedSpan[][] = [];
  for (const span of spans) {
    const lastRow = rows[rows.length - 1];
    if (!lastRow || Math.abs(lastRow[0].y - span.y) > 3.5) {
      rows.push([span]);
    } else {
      lastRow.push(span);
    }
  }

  const lines: string[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let line = '';
    for (let i = 0; i < row.length; i++) {
      const curr = row[i];
      if (i > 0) {
        const prev = row[i - 1];
        const gap = curr.x - (prev.x + prev.width);
        if (gap > 22) {
          // Preserve wide columnar separation (tables / lists) using a pipe-safe spacing hint
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
    if (cleaned) lines.push(cleaned);
  }

  return lines.join('\n');
}

async function readPdfBulletinPages(
  file: File,
  onProgress?: (stage: 'reading' | 'ocr', detail: string) => void
): Promise<BiBulletinPage[]> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;

  const pages: BiBulletinPage[] = [];
  const pagesNeedingOcr: number[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    onProgress?.('reading', `Lendo pág. ${p}/${pdf.numPages}`);
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const text = reconstructPdfPageText(content.items);
    const meaningfulChars = text.replace(/\s+/g, '').length;

    pages.push({ pageNumber: p, text, usedOcr: false });
    if (meaningfulChars < 35) {
      pagesNeedingOcr.push(p);
    }
  }

  // Selective per-page OCR only for scanned/image pages
  if (pagesNeedingOcr.length > 0) {
    const worker = await createWorker('por');
    try {
      for (let i = 0; i < pagesNeedingOcr.length; i++) {
        const pNum = pagesNeedingOcr[i];
        onProgress?.('ocr', `OCR pág. ${pNum} (${i + 1}/${pagesNeedingOcr.length})`);
        const page = await pdf.getPage(pNum);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        const { data } = await worker.recognize(canvas);
        const ocrText = (data.text || '').trim();
        const target = pages.find((pg) => pg.pageNumber === pNum);
        if (target && ocrText.length > target.text.length) {
          target.text = ocrText;
          target.usedOcr = true;
        }
      }
    } finally {
      await worker.terminate();
    }
  }

  return pages;
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

async function readDocxBulletinPages(file: File): Promise<BiBulletinPage[]> {
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const xmlFile = zip.file('word/document.xml');
  if (!xmlFile) {
    throw new Error('Arquivo .docx sem word/document.xml válido.');
  }

  const xmlText = await xmlFile.async('string');
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
  const body = xmlDoc.getElementsByTagNameNS(W_NS, 'body')[0];
  if (!body) {
    return [{ pageNumber: 1, text: '' }];
  }

  const lines: string[] = [];
  for (const child of Array.from(body.children)) {
    const localName = child.localName || child.nodeName.replace(/^.*:/, '');
    if (localName === 'p') {
      const textNodes = Array.from(child.getElementsByTagNameNS(W_NS, 't'));
      const joined = normalizeInlineSpaces(textNodes.map((n) => n.textContent || '').join(''));
      if (joined) lines.push(joined);
    } else if (localName === 'tbl') {
      const rows = Array.from(child.getElementsByTagNameNS(W_NS, 'tr'));
      for (const tr of rows) {
        const cells = Array.from(tr.getElementsByTagNameNS(W_NS, 'tc')).map((tc) => {
          const tNodes = Array.from(tc.getElementsByTagNameNS(W_NS, 't'));
          return normalizeInlineSpaces(tNodes.map((n) => n.textContent || '').join(' '));
        });
        if (cells.some((c) => c.length > 0)) {
          lines.push(cells.join(' | '));
        }
      }
    }
  }

  // Paginate large DOCX into ~50-line logical pages for easy inspection
  const fullLines = lines.length > 0 ? lines : [''];
  const pages: BiBulletinPage[] = [];
  const linesPerPage = 55;
  for (let i = 0; i < fullLines.length; i += linesPerPage) {
    pages.push({
      pageNumber: pages.length + 1,
      text: fullLines.slice(i, i + linesPerPage).join('\n'),
      usedOcr: false,
    });
  }
  return pages;
}

export async function readBulletinFileToPages(
  file: File,
  onProgress?: (stage: 'reading' | 'ocr', detail: string) => void
): Promise<BiBulletinPage[]> {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith('.pdf') || file.type === 'application/pdf') {
    return readPdfBulletinPages(file, onProgress);
  }

  if (
    lowerName.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    onProgress?.('reading', 'Lendo documento Word...');
    return readDocxBulletinPages(file);
  }

  onProgress?.('reading', 'Lendo texto...');
  const text = await file.text();
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const splitByFormFeed = normalized.split('\f').filter((s) => s.trim().length > 0);
  if (splitByFormFeed.length > 1) {
    return splitByFormFeed.map((chunk, idx) => ({
      pageNumber: idx + 1,
      text: chunk.trim(),
      usedOcr: false,
    }));
  }

  return [{ pageNumber: 1, text: normalized, usedOcr: false }];
}
