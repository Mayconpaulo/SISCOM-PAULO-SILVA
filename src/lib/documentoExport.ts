export interface TableColumnDef {
  id: string;
  label: string;
  widthWeight: number;
  autoNumber?: boolean;
  defaultCellText: string;
  align?: 'left' | 'center' | 'right';
}

export interface StoredTableDocument {
  id: string;
  folderName: string;
  title: string;
  subtitle: string;
  orientation: 'landscape';
  rowCount: number;
  fontFamily: 'Arial' | 'Times New Roman' | 'Open Sans';
  headerBold: boolean;
  columns: TableColumnDef[];
  /** Custom cell overrides keyed by `${rowIndex}:${colId}` */
  cellValues: Record<string, string>;
  dateText: string;
  signatureText: string;
  signatureLines: number;
  updatedAt: string;
  isBuiltIn?: boolean;
}

export const LANDSCAPE_A4_W_MM = 297;
export const LANDSCAPE_A4_H_MM = 210;

export const DEFAULT_RELACAO_COLUMNS: TableColumnDef[] = [
  { id: 'nr', label: 'Nr', widthWeight: 4.5, autoNumber: true, defaultCellText: '', align: 'center' },
  { id: 'nome', label: 'NOME COMPLETO', widthWeight: 22, defaultCellText: '', align: 'left' },
  { id: 'identidade', label: 'IDENTIDADE', widthWeight: 10.5, defaultCellText: '', align: 'center' },
  { id: 'destino', label: 'DESTINO', widthWeight: 12, defaultCellText: '', align: 'left' },
  { id: 'hora', label: 'HORA ENTRADA', widthWeight: 8.5, defaultCellText: '', align: 'center' },
  {
    id: 'visitante',
    label: 'VISITANTE',
    widthWeight: 20,
    defaultCellText: 'ATIVA (  ) | RESERVA (  ) | CIVIL (   )',
    align: 'center',
  },
  { id: 'cracha', label: 'N° CRACHÁ', widthWeight: 7.5, defaultCellText: '', align: 'center' },
  { id: 'responsavel', label: 'RESPONSÁVEL', widthWeight: 8.5, defaultCellText: '', align: 'left' },
  { id: 'ass', label: 'ASS.', widthWeight: 6.5, defaultCellText: '', align: 'center' },
];

export function createDefaultRelacaoDocument(): StoredTableDocument {
  return {
    id: 'doc-relacao-entrada-saida-rp',
    folderName: 'Relações e Controles',
    title: 'RELAÇÃO DE ENTRADA E SAÍDA - RELAÇÕES PÚBLICAS',
    subtitle: '',
    orientation: 'landscape',
    rowCount: 15,
    fontFamily: 'Arial',
    headerBold: true,
    columns: DEFAULT_RELACAO_COLUMNS.map((c) => ({ ...c })),
    cellValues: {},
    dateText: 'Data ______/________/________',
    signatureText: 'Apoio (Nome de Guerra + Companhia + Assinatura):',
    signatureLines: 1,
    updatedAt: new Date().toISOString(),
    isBuiltIn: true,
  };
}

export interface LandscapeSheetMetrics {
  padXMm: number;
  padYMm: number;
  usableWMm: number;
  usableHMm: number;
  titleHMm: number;
  titleFontPt: number;
  subtitleFontPt: number;
  tableHeaderHMm: number;
  headerFontPt: number;
  rowHMm: number;
  cellFontPt: number;
  footerHMm: number;
  footerFontPt: number;
  dateToSigGapMm: number;
  isCompressed: boolean;
  resizeNotice: string;
}

/**
 * Guarantees that Title + Table Header + all N Rows + Date + Signature
 * fit strictly on ONE A4 Landscape page (297 x 210 mm).
 */
export function computeLandscapeSheetMetrics(doc: StoredTableDocument): LandscapeSheetMetrics {
  const rows = Math.max(1, Math.min(100, Math.floor(Number(doc.rowCount) || 15)));
  const hasSubtitle = Boolean(doc.subtitle.trim());
  const sigLines = Math.max(1, Math.min(4, Math.floor(Number(doc.signatureLines) || 1)));

  // Progressively tighten margins & header/footer chrome as rowCount increases
  const padXMm = rows > 40 ? 6 : 8;
  const padYMm = rows > 40 ? 4.5 : rows > 25 ? 6 : 8;
  const usableWMm = LANDSCAPE_A4_W_MM - padXMm * 2;
  const usableHMm = LANDSCAPE_A4_H_MM - padYMm * 2;

  const titleScale = rows <= 20 ? 1 : Math.max(0.62, 1 - (rows - 20) * 0.008);
  const titleHMm = (hasSubtitle ? 12.5 : 8.5) * titleScale;
  const titleFontPt = Number(Math.max(8, 12.5 * titleScale).toFixed(1));
  const subtitleFontPt = Number(Math.max(6.5, 9 * titleScale).toFixed(1));

  const tableHeaderHMm = Math.max(4.6, 8.2 * titleScale);
  const headerFontPt = Number(Math.max(5.2, 8.2 * titleScale).toFixed(1));

  const dateToSigGapMm = rows <= 25 ? 6.5 : rows <= 40 ? 4.8 : 3.6;
  const baseFooterMm = 8.0 + dateToSigGapMm + sigLines * 5.4;
  const footerHMm = Math.max(
    13.5,
    baseFooterMm * (rows <= 20 ? 1 : Math.max(0.68, 1 - (rows - 20) * 0.0065))
  );
  const footerFontPt = Number(Math.max(6.2, 9.2 * titleScale).toFixed(1));

  const verticalGapMm = rows > 35 ? 2.6 : 4.5;
  const bodyAvailableHMm = Math.max(40, usableHMm - titleHMm - tableHeaderHMm - footerHMm - verticalGapMm);
  const rowHMm = bodyAvailableHMm / rows;

  // Cell font scales with row height (at 50 rows, rowHMm ~ 3.45mm -> ~5.3pt)
  const rawCellPt = (rowHMm * 0.56 * 72) / 25.4;
  const cellFontPt = Number(Math.max(4.2, Math.min(9.5, rawCellPt)).toFixed(1));

  const isCompressed = rows > 20;
  const resizeNotice = isCompressed
    ? `Redimensionamento automático ativo: ${rows} linhas ajustadas para ${rowHMm.toFixed(1)} mm cada (fonte ${cellFontPt} pt) para caber título, tabela, data e assinatura na mesma folha A4 horizontal.`
    : `Folha A4 horizontal (297 × 210 mm): ${rows} linhas com ${rowHMm.toFixed(1)} mm cada (fonte ${cellFontPt} pt).`;

  return {
    padXMm,
    padYMm,
    usableWMm,
    usableHMm,
    titleHMm,
    titleFontPt,
    subtitleFontPt,
    tableHeaderHMm,
    headerFontPt,
    rowHMm,
    cellFontPt,
    footerHMm,
    footerFontPt,
    dateToSigGapMm,
    isCompressed,
    resizeNotice,
  };
}

export function getResolvedCellText(
  doc: StoredTableDocument,
  rowIndex: number,
  col: TableColumnDef
): string {
  const key = `${rowIndex}:${col.id}`;
  if (Object.prototype.hasOwnProperty.call(doc.cellValues, key)) {
    return doc.cellValues[key];
  }
  if (col.autoNumber) {
    return String(rowIndex + 1);
  }
  return col.defaultCellText || '';
}

export function parseCsvLine(line: string, delimiter = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function importCsvAsDocument(fileName: string, csvText: string): StoredTableDocument {
  const cleanName = fileName.replace(/\.[^.]+$/, '') || 'Documento Importado';
  const rawLines = csvText.split(/\r?\n/);
  const firstNonEmpty = rawLines.find((l) => l.replace(/[,;\s]/g, '').length > 0) || '';
  const delimiter = (firstNonEmpty.match(/;/g)?.length || 0) > (firstNonEmpty.match(/,/g)?.length || 0) ? ';' : ',';
  const parsedRows = rawLines.map((l) => parseCsvLine(l, delimiter));

  // Find title row (first row with a single non-empty cell or longest text before table header)
  let title = cleanName.toUpperCase();
  let headerRowIdx = -1;

  for (let i = 0; i < Math.min(parsedRows.length, 15); i++) {
    const nonEmptyIndices = parsedRows[i]
      .map((val, idx) => ({ val: val.trim(), idx }))
      .filter((x) => x.val.length > 0);
    if (nonEmptyIndices.length === 1 && headerRowIdx === -1) {
      title = nonEmptyIndices[0].val;
    } else if (nonEmptyIndices.length >= 3) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) {
    // Simple generic fallback if no multi-column header detected
    const base = createDefaultRelacaoDocument();
    return {
      ...base,
      id: `doc-${Date.now()}`,
      title,
      isBuiltIn: false,
      updatedAt: new Date().toISOString(),
    };
  }

  const headerCells = parsedRows[headerRowIdx];
  const activeColIndices = headerCells
    .map((val, idx) => ({ val: val.trim(), idx }))
    .filter((x) => x.val.length > 0);

  const columns: TableColumnDef[] = activeColIndices.map((col, idx) => ({
    id: `col-${idx}-${col.val.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || idx}`,
    label: col.val,
    widthWeight: col.val.toUpperCase().includes('NOME')
      ? 22
      : col.val.toUpperCase() === 'NR'
      ? 5
      : 12,
    autoNumber: idx === 0 && col.val.toUpperCase() === 'NR',
    defaultCellText: '',
    align: idx === 0 ? 'center' : 'left',
  }));

  const cellValues: Record<string, string> = {};
  let dataRowCount = 0;
  let dateText = 'Data ______/________/________';
  let signatureText = 'Responsável / Assinatura:';

  for (let r = headerRowIdx + 1; r < parsedRows.length; r++) {
    const row = parsedRows[r];
    const nonEmpty = row.map((v) => v.trim()).filter(Boolean);
    if (nonEmpty.length === 0) continue;

    const joined = nonEmpty.join(' ');
    if (/^data\b/i.test(joined) && nonEmpty.length <= 2) {
      dateText = joined;
      continue;
    }
    if ((/assinatura|apoio|respons[aá]vel/i.test(joined) && nonEmpty.length === 1) || (nonEmpty.length > 3 && nonEmpty.every((v) => v === nonEmpty[0]))) {
      signatureText = nonEmpty[0];
      continue;
    }

    const rowIdx = dataRowCount;
    dataRowCount++;
    activeColIndices.forEach((colInfo, colIdx) => {
      const val = (row[colInfo.idx] || '').trim();
      if (val && !(columns[colIdx].autoNumber && val === String(rowIdx + 1))) {
        cellValues[`${rowIdx}:${columns[colIdx].id}`] = val;
      }
    });
  }

  return {
    id: `doc-${Date.now()}`,
    folderName: 'Documentos Importados',
    title,
    subtitle: '',
    orientation: 'landscape',
    rowCount: Math.max(10, dataRowCount || 15),
    fontFamily: 'Arial',
    headerBold: true,
    columns,
    cellValues,
    dateText,
    signatureText,
    signatureLines: 1,
    updatedAt: new Date().toISOString(),
    isBuiltIn: false,
  };
}

function fitTextCanvas(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidthPx: number,
  startPx: number,
  bold: boolean,
  fontFamily: string
): number {
  let px = startPx;
  const minPx = Math.max(4, startPx * 0.52);
  while (px > minPx) {
    ctx.font = `${bold ? 700 : 400} ${px}px "${fontFamily}", Arial, sans-serif`;
    if (ctx.measureText(text).width <= maxWidthPx) return px;
    px -= 0.5;
  }
  return minPx;
}

/**
 * Renders the document onto a 300-DPI A4 Landscape canvas (3508 x 2480 px).
 */
export async function renderLandscapeDocumentCanvas(
  doc: StoredTableDocument
): Promise<HTMLCanvasElement> {
  if (typeof document !== 'undefined' && document.fonts) {
    await document.fonts.ready;
  }

  const DPI = 300;
  const mmToPx = (mm: number) => (mm * DPI) / 25.4;
  const ptToPx = (pt: number) => (pt * DPI) / 72;

  const canvas = document.createElement('canvas');
  canvas.width = 3508; // 297mm at 300 DPI
  canvas.height = 2480; // 210mm at 300 DPI
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Contexto gráfico indisponível.');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const m = computeLandscapeSheetMetrics(doc);
  const startX = mmToPx(m.padXMm);
  const startY = mmToPx(m.padYMm);
  const tableW = mmToPx(m.usableWMm);

  // Title block
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const titleText = doc.title.trim();
  if (titleText) {
    const titlePx = fitTextCanvas(ctx, titleText, tableW * 0.96, ptToPx(m.titleFontPt), true, doc.fontFamily);
    ctx.font = `700 ${titlePx}px "${doc.fontFamily}", Arial, sans-serif`;
    const titleY = doc.subtitle.trim() ? startY + mmToPx(m.titleHMm * 0.34) : startY + mmToPx(m.titleHMm * 0.45);
    ctx.fillText(titleText, startX + tableW / 2, titleY);
  }
  if (doc.subtitle.trim()) {
    const subPx = fitTextCanvas(ctx, doc.subtitle.trim(), tableW * 0.96, ptToPx(m.subtitleFontPt), false, doc.fontFamily);
    ctx.font = `400 ${subPx}px "${doc.fontFamily}", Arial, sans-serif`;
    ctx.fillText(doc.subtitle.trim(), startX + tableW / 2, startY + mmToPx(m.titleHMm * 0.72));
  }

  // Compute column pixel widths
  const totalWeight = doc.columns.reduce((acc, c) => acc + Math.max(1, c.widthWeight), 0) || 1;
  const colWidthsPx = doc.columns.map((c) => (Math.max(1, c.widthWeight) / totalWeight) * tableW);

  const tableTopY = startY + mmToPx(m.titleHMm);
  const hdrH = mmToPx(m.tableHeaderHMm);
  const rowH = mmToPx(m.rowHMm);
  const rows = Math.max(1, Math.min(100, Math.floor(Number(doc.rowCount) || 15)));
  const totalTableH = hdrH + rows * rowH;

  // Header background tint (subtle light gray print-friendly)
  ctx.fillStyle = '#F3F4F6';
  ctx.fillRect(startX, tableTopY, tableW, hdrH);

  // Header labels
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'middle';
  let curX = startX;
  doc.columns.forEach((col, cIdx) => {
    const cw = colWidthsPx[cIdx];
    const lbl = col.label.trim();
    if (lbl) {
      const px = fitTextCanvas(ctx, lbl, cw - mmToPx(1.8), ptToPx(m.headerFontPt), doc.headerBold, doc.fontFamily);
      ctx.font = `${doc.headerBold ? 700 : 400} ${px}px "${doc.fontFamily}", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(lbl, curX + cw / 2, tableTopY + hdrH / 2);
    }
    curX += cw;
  });

  // Body rows
  for (let r = 0; r < rows; r++) {
    const ry = tableTopY + hdrH + r * rowH;
    let cx = startX;
    for (let cIdx = 0; cIdx < doc.columns.length; cIdx++) {
      const col = doc.columns[cIdx];
      const cw = colWidthsPx[cIdx];
      const val = getResolvedCellText(doc, r, col);

      if (val) {
        // Support multi-segment presets like "ATIVA (  ) | RESERVA (  ) | CIVIL (   )"
        if (val.includes('|')) {
          const parts = val.split('|').map((p) => p.trim()).filter(Boolean);
          const subW = cw / Math.max(1, parts.length);
          parts.forEach((part, pIdx) => {
            const px = fitTextCanvas(ctx, part, subW - mmToPx(1.2), ptToPx(m.cellFontPt), false, doc.fontFamily);
            ctx.font = `400 ${px}px "${doc.fontFamily}", Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(part, cx + subW * pIdx + subW / 2, ry + rowH / 2);
          });
        } else {
          const px = fitTextCanvas(ctx, val, cw - mmToPx(2.0), ptToPx(m.cellFontPt), false, doc.fontFamily);
          ctx.font = `400 ${px}px "${doc.fontFamily}", Arial, sans-serif`;
          const align = col.align || 'left';
          ctx.textAlign = align;
          const tx =
            align === 'center'
              ? cx + cw / 2
              : align === 'right'
              ? cx + cw - mmToPx(1.0)
              : cx + mmToPx(1.0);
          ctx.fillText(val, tx, ry + rowH / 2);
        }
      }
      cx += cw;
    }
  }

  // Crisp 1px-equivalent black grid lines
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = mmToPx(0.32);
  ctx.strokeRect(startX, tableTopY, tableW, totalTableH);

  // Horizontal lines
  ctx.beginPath();
  ctx.moveTo(startX, tableTopY + hdrH);
  ctx.lineTo(startX + tableW, tableTopY + hdrH);
  for (let r = 1; r < rows; r++) {
    const y = tableTopY + hdrH + r * rowH;
    ctx.moveTo(startX, y);
    ctx.lineTo(startX + tableW, y);
  }
  ctx.stroke();

  // Vertical lines
  ctx.beginPath();
  let vx = startX;
  for (let cIdx = 0; cIdx < colWidthsPx.length - 1; cIdx++) {
    vx += colWidthsPx[cIdx];
    ctx.moveTo(vx, tableTopY);
    ctx.lineTo(vx, tableTopY + totalTableH);
  }
  ctx.stroke();

  // Footer (Date + Signature lines)
  const footerTopY = tableTopY + totalTableH + mmToPx(rows > 35 ? 2.2 : 3.8);
  const footerPx = ptToPx(m.footerFontPt);
  ctx.font = `400 ${footerPx}px "${doc.fontFamily}", Arial, sans-serif`;
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'middle';

  if (doc.dateText.trim()) {
    ctx.textAlign = 'center';
    ctx.fillText(doc.dateText.trim(), startX + tableW / 2, footerTopY + footerPx * 0.65);
  }

  const sigCount = Math.max(1, Math.min(4, Math.floor(Number(doc.signatureLines) || 1)));
  const sigStartY =
    footerTopY +
    (doc.dateText.trim() ? footerPx * 1.15 + mmToPx(m.dateToSigGapMm) : footerPx * 0.8);
  const sigStep = Math.max(footerPx * 1.6, mmToPx(rows > 35 ? 4.5 : 6.0));

  for (let s = 0; s < sigCount; s++) {
    const sy = sigStartY + s * sigStep;
    const label = doc.signatureText.trim();
    ctx.textAlign = 'left';
    if (label) {
      ctx.fillText(label, startX, sy);
    }
    const labelW = label ? ctx.measureText(label).width + mmToPx(3) : 0;
    if (startX + labelW < startX + tableW) {
      ctx.beginPath();
      ctx.lineWidth = mmToPx(0.28);
      ctx.moveTo(startX + labelW, sy + footerPx * 0.38);
      ctx.lineTo(startX + tableW, sy + footerPx * 0.38);
      ctx.stroke();
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
 * Generates an exact 1-page A4 Landscape PDF (841.8898 x 595.2756 pt).
 */
export async function generateLandscapePdfBlob(doc: StoredTableDocument): Promise<Blob> {
  const canvas = await renderLandscapeDocumentCanvas(doc);
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
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 841.8898 595.2756] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n'
  );

  offsets.push(bytePos);
  pushStr(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
  );
  pushBytes(jpegBytes);
  pushStr('\nendstream\nendobj\n');

  const contentStream = 'q\n841.8898 0 0 595.2756 0 0 cm\n/Im0 Do\nQ\n';
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

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function generateLandscapeWordBlob(doc: StoredTableDocument): Blob {
  const m = computeLandscapeSheetMetrics(doc);
  const totalWeight = doc.columns.reduce((acc, c) => acc + Math.max(1, c.widthWeight), 0) || 1;
  const rows = Math.max(1, Math.min(100, Math.floor(Number(doc.rowCount) || 15)));

  const thHtml = doc.columns
    .map((c) => {
      const pct = ((Math.max(1, c.widthWeight) / totalWeight) * 100).toFixed(2);
      return `<th style="width:${pct}%; border:1px solid #000; padding:1px 3px; font-size:${m.headerFontPt}pt; font-weight:${
        doc.headerBold ? 'bold' : 'normal'
      }; background:#f3f4f6; text-align:center;">${escapeHtml(c.label)}</th>`;
    })
    .join('');

  const bodyRowsHtml = Array.from({ length: rows }, (_, r) => {
    const tds = doc.columns
      .map((col) => {
        const val = getResolvedCellText(doc, r, col).replaceAll('|', '   ');
        const align = col.align || 'left';
        return `<td style="border:1px solid #000; padding:0 3px; height:${m.rowHMm.toFixed(
          2
        )}mm; font-size:${m.cellFontPt}pt; text-align:${align}; vertical-align:middle;">${escapeHtml(
          val
        )}</td>`;
      })
      .join('');
    return `<tr>${tds}</tr>`;
  }).join('');

  const firstSigMarginPt = (m.dateToSigGapMm * 2.8346).toFixed(1);
  const sigLinesHtml = Array.from(
    { length: Math.max(1, Math.min(4, doc.signatureLines || 1)) },
    (_, idx) =>
      `<div style="margin-top:${
        idx === 0 ? firstSigMarginPt : '6'
      }pt; font-size:${m.footerFontPt}pt; border-bottom:1px solid #000; padding-bottom:1.5pt;">${escapeHtml(
        doc.signatureText
      )}</div>`
  ).join('');

  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(doc.title)}</title>
  <style>
    @page Section1 { size: 297mm 210mm; mso-page-orientation: landscape; margin: ${m.padYMm}mm ${m.padXMm}mm; }
    div.Section1 { page: Section1; }
    body { font-family: '${doc.fontFamily}', Arial, sans-serif; color: #000; margin: 0; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  </style>
</head>
<body>
  <div class="Section1">
    <div style="text-align:center; font-weight:bold; font-size:${m.titleFontPt}pt; margin-bottom:2pt;">${escapeHtml(
      doc.title
    )}</div>
    ${
      doc.subtitle.trim()
        ? `<div style="text-align:center; font-size:${m.subtitleFontPt}pt; margin-bottom:4pt;">${escapeHtml(
            doc.subtitle
          )}</div>`
        : ''
    }
    <table>
      <thead><tr>${thHtml}</tr></thead>
      <tbody>${bodyRowsHtml}</tbody>
    </table>
    <div style="text-align:center; font-size:${m.footerFontPt}pt; margin-top:6pt;">${escapeHtml(
      doc.dateText
    )}</div>
    ${sigLinesHtml}
  </div>
</body>
</html>`;

  return new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
}

export function generateCsvBlob(doc: StoredTableDocument): Blob {
  const rows = Math.max(1, Math.min(100, Math.floor(Number(doc.rowCount) || 15)));
  const csvEsc = (v: string) => {
    const clean = v.replaceAll('"', '""');
    return /[",\n]/.test(clean) ? `"${clean}"` : clean;
  };
  const lines: string[] = [];
  lines.push(csvEsc(doc.title));
  lines.push(doc.columns.map((c) => csvEsc(c.label)).join(','));
  for (let r = 0; r < rows; r++) {
    lines.push(doc.columns.map((c) => csvEsc(getResolvedCellText(doc, r, c))).join(','));
  }
  lines.push(csvEsc(doc.dateText));
  lines.push(csvEsc(doc.signatureText));
  return new Blob(['\ufeff', lines.join('\n')], { type: 'text/csv;charset=utf-8' });
}
