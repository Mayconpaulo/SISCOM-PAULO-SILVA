import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker } from 'tesseract.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface CrachaDocumentColumn {
  id: string;
  label: string;
  sample: string;
  isDerived?: boolean;
}

export interface CrachaSuggestedMapping {
  identPrincipal: string;
  identSecundario: string;
  identTop: string;
  identBottom: string;
  identBack: string;
  rpPrincipal: string;
  rpTop: string;
  rpBottom: string;
  rpBack: string;
}

export interface ExtractedCrachaDocument {
  fileName: string;
  sourceKind: 'tabela' | 'lista' | 'ocr';
  columns: CrachaDocumentColumn[];
  rows: Record<string, string>[];
  suggestedMapping: CrachaSuggestedMapping;
}

export interface ImportedCrachaSource extends ExtractedCrachaDocument {
  id: string;
}

export interface CrachaSlotRef {
  docId: string;
  colId: string;
}

export interface CrachaMultiMapping {
  identPrincipal: CrachaSlotRef;
  identSecundario: CrachaSlotRef;
  identTop: CrachaSlotRef;
  identBottom: CrachaSlotRef;
  identBack: CrachaSlotRef;
  rpPrincipal: CrachaSlotRef;
  rpTop: CrachaSlotRef;
  rpBottom: CrachaSlotRef;
  rpBack: CrachaSlotRef;
}

export type CrachaCrossLinkMode = 'auto' | 'name' | 'index';

export interface ResolvedCrachaRowEntry {
  nomeCompleto: string;
  cpf: string;
  rpTexto: string;
  topTextOverride: string;
  bottomTextOverride: string;
  versoIgual: boolean;
  versoTexto: string;
}

export interface MultiMappingResolution {
  rows: ResolvedCrachaRowEntry[];
  linkedByNameCount: number;
  hasCrossFileMapping: boolean;
  primaryDocName: string;
}

interface RawCellWithMeta {
  text: string;
  boldSubstring?: string;
}

function cleanCellText(s: string): string {
  return s
    .replace(/[\u00a0\u2000-\u200f\u202f\u205f\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripDiacriticsUpper(s: string): string {
  return cleanCellText(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
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

const HEADER_KEYWORDS_RE =
  /\b(NOME|GUERRA|IDENTIDADE|IDT|RG|CPF|POSTO|GRAD|GRADUACAO|P\/G|OM|FUNCAO|CARGO|SETOR|SECAO|ORD|NR|NUMERO|DATA|CATEGORIA|VINCULO|EMPRESA|DOCUMENTO|PLACA|VEICULO|MATRICULA|SIAPE|SARAM|PREC)\b/;

const RANK_PREFIX_RE =
  /^(?:GEN(?:\s+(?:EX|DIV|BDA))?|CEL|TEN\s*CEL|TC|MAJ|CAP|1[º°O]?\s*TEN|2[º°O]?\s*TEN|ASP(?:\s*OF)?|ST|SUBTEN|1[º°O]?\s*SGT|2[º°O]?\s*SGT|3[º°O]?\s*SGT|CB|SD(?:\s*(?:EP|EV|NB|RCR))?|AL|CAD|SR\.?|SRA\.?)\s+/i;

const NAME_PARTICLES = new Set(['DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'D']);

function extractWarNameHeuristic(rawFullName: string, boldHint?: string): string {
  const clean = cleanCellText(rawFullName);
  if (!clean) return '';

  if (boldHint) {
    const hint = cleanCellText(boldHint);
    if (
      hint.length >= 2 &&
      hint.length < clean.length &&
      clean.toUpperCase().includes(hint.toUpperCase())
    ) {
      return hint.toUpperCase();
    }
  }

  const withoutRank = clean.replace(RANK_PREFIX_RE, '').trim();
  const tokens = withoutRank.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return (tokens[0] || '').toUpperCase();

  // Check if the source marks war name via ALL CAPS tokens inside mixed-case name (e.g. "João Carlos da SILVA")
  const hasLower = /[a-záàâãéêíóôõúç]/.test(withoutRank);
  if (hasLower) {
    const upperTokens = tokens.filter(
      (t) =>
        t.length >= 2 &&
        t === t.toUpperCase() &&
        /[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(t) &&
        !NAME_PARTICLES.has(t.toUpperCase())
    );
    if (upperTokens.length > 0 && upperTokens.length < tokens.length) {
      return upperTokens.join(' ');
    }
  }

  // Fallback: last meaningful non-particle surname token
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i].replace(/[,.;:]+$/, '');
    if (t && !NAME_PARTICLES.has(t.toUpperCase())) {
      return t.toUpperCase();
    }
  }
  return tokens[tokens.length - 1].toUpperCase();
}

function extractCpfFromText(text: string): string {
  const formatted = text.match(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/);
  if (formatted) return formatted[0];
  const labeled = text.match(/\bCPF\s*[:\-]?\s*(\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2})\b/i);
  if (labeled) return cleanCellText(labeled[1]);
  return '';
}

function extractIdentidadeFromText(text: string): string {
  // Strip any CPF first so a labeled pattern never grabs the CPF by mistake
  const withoutCpf = text.replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, ' ');
  const labeled = withoutCpf.match(
    /\b(?:IDENTIDADE|IDT|RG)\s*[:\-]?\s*([A-Z0-9.\-\/]{5,18})\b/i
  );
  if (labeled) return cleanCellText(labeled[1]);
  const hyphenId = withoutCpf.match(/\b\d{7,11}-\d\b/);
  if (hyphenId) return hyphenId[0];
  return '';
}

function normalizeTabularRows(
  matrix: RawCellWithMeta[][],
  fileName: string,
  sourceKind: 'tabela' | 'lista' | 'ocr'
): ExtractedCrachaDocument {
  const nonEmptyRows: RawCellWithMeta[][] = matrix
    .map((r) =>
      r.map((c): RawCellWithMeta => ({ text: cleanCellText(c.text), boldSubstring: c.boldSubstring }))
    )
    .filter((r) => r.some((c) => c.text.length > 0));

  if (nonEmptyRows.length === 0) {
    throw new Error('Nenhum dado legível encontrado no documento.');
  }

  const maxCols = Math.max(...nonEmptyRows.map((r) => r.length));
  const padded: RawCellWithMeta[][] = nonEmptyRows.map((r) => {
    const next: RawCellWithMeta[] = [...r];
    while (next.length < maxCols) next.push({ text: '' });
    return next;
  });

  // Remove columns that are completely empty across all rows
  const activeIndices: number[] = [];
  for (let c = 0; c < maxCols; c++) {
    if (padded.some((r) => r[c].text.length > 0)) activeIndices.push(c);
  }
  const compact = padded.map((r) => activeIndices.map((idx) => r[idx]));
  const colCount = compact[0]?.length || 0;
  if (colCount === 0) {
    throw new Error('Nenhuma coluna com dados encontrada no documento.');
  }

  // Decide if row 0 is a header row
  const row0 = compact[0];
  const row0MatchesHeader =
    compact.length >= 2 &&
    row0.some((c) => HEADER_KEYWORDS_RE.test(stripDiacriticsUpper(c.text))) &&
    !row0.some((c) => /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(c.text));

  const headerLabels = row0MatchesHeader
    ? row0.map((c, idx) => c.text || `Coluna ${idx + 1}`)
    : Array.from({ length: colCount }, (_, idx) => `Coluna ${idx + 1}`);

  const dataRowsRaw = row0MatchesHeader ? compact.slice(1) : compact;

  // Deduplicate repeated header rows (common across multi-page PDF tables)
  const headerSig = headerLabels.map((h) => stripDiacriticsUpper(h)).join('|');
  const filteredDataRows = dataRowsRaw.filter((row) => {
    if (row0MatchesHeader) {
      const sig = row.map((c) => stripDiacriticsUpper(c.text)).join('|');
      if (sig === headerSig) return false;
    }
    return row.some((c) => c.text.length > 0);
  });

  if (filteredDataRows.length === 0) {
    throw new Error('O documento contém apenas cabeçalhos e nenhuma linha de dados.');
  }

  const columns: CrachaDocumentColumn[] = headerLabels.map((label, idx) => {
    const id = `col_${idx}`;
    const sample = filteredDataRows.find((r) => r[idx]?.text)?.[idx]?.text || '';
    return { id, label, sample };
  });

  const rows: Record<string, string>[] = filteredDataRows.map((row) => {
    const rec: Record<string, string> = {};
    columns.forEach((col, idx) => {
      rec[col.id] = row[idx]?.text || '';
    });
    return rec;
  });

  // Identify key columns by header label or sample heuristics
  const findColId = (re: RegExp): string =>
    columns.find((c) => re.test(stripDiacriticsUpper(c.label)))?.id || '';

  let colFullName =
    findColId(/\bNOME\s*COMPLETO\b/) ||
    columns.find(
      (c) =>
        /\bNOME\b/.test(stripDiacriticsUpper(c.label)) &&
        !/\bGUERRA\b/.test(stripDiacriticsUpper(c.label))
    )?.id ||
    '';

  const colWarName = findColId(/\bNOME\s*(?:DE\s*)?GUERRA\b|\bGUERRA\b/);
  let colPosto = findColId(/\b(POSTO|GRAD|GRADUACAO|P\/G|PG)\b/);
  let colIdentidade = findColId(/\b(IDENTIDADE|IDT|RG)\b/);
  let colCpf = findColId(/\bCPF\b/);

  // Content-based inference for headerless tables
  if (!colCpf) {
    const cpfMatch = columns.find((c) =>
      rows.slice(0, 8).some((r) => /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(r[c.id] || ''))
    );
    if (cpfMatch) colCpf = cpfMatch.id;
  }
  if (!colIdentidade) {
    const idMatch = columns.find(
      (c) =>
        c.id !== colCpf &&
        rows.slice(0, 8).some((r) => /^\d{6,11}-\d$/.test((r[c.id] || '').trim()))
    );
    if (idMatch) colIdentidade = idMatch.id;
  }
  if (!colFullName) {
    const nameMatch = columns.find(
      (c) =>
        c.id !== colCpf &&
        c.id !== colIdentidade &&
        c.id !== colWarName &&
        rows.slice(0, 8).some((r) => {
          const val = (r[c.id] || '').trim();
          return (
            val.split(/\s+/).length >= 2 &&
            /[A-Za-zÀ-ÿ]{3,}/.test(val) &&
            !/^\d+$/.test(val)
          );
        })
    );
    if (nameMatch) colFullName = nameMatch.id;
  }
  if (!colPosto) {
    const postoMatch = columns.find((c) =>
      rows
        .slice(0, 8)
        .some((r) =>
          /^(?:GEN|CEL|TC|MAJ|CAP|1[º°O]?\s*TEN|2[º°O]?\s*TEN|ST|1[º°O]?\s*SGT|2[º°O]?\s*SGT|3[º°O]?\s*SGT|CB|SD|ASP)$/i.test(
            (r[c.id] || '').trim()
          )
        )
    );
    if (postoMatch) colPosto = postoMatch.id;
  }

  // Add derived "Somente Nome de Guerra (extraído)" if we have a full name column without an explicit war-name column
  let derivedWarColId = '';
  if (!colWarName && colFullName) {
    const fullNameIdx = columns.findIndex((c) => c.id === colFullName);
    const derivedValues = filteredDataRows.map((rawRow, rIdx) => {
      const cell = rawRow[fullNameIdx];
      return extractWarNameHeuristic(rows[rIdx][colFullName] || '', cell?.boldSubstring);
    });
    if (derivedValues.some((v) => v.length > 0)) {
      derivedWarColId = 'derived_war_name';
      columns.push({
        id: derivedWarColId,
        label: 'Somente Nome de Guerra (extraído)',
        sample: derivedValues.find(Boolean) || '',
        isDerived: true,
      });
      rows.forEach((r, rIdx) => {
        r[derivedWarColId] = derivedValues[rIdx];
      });
    }
  }

  // Add composite "Posto/Grad + Nome de guerra" when both are available (or rank embedded in fullName)
  const effectiveWarCol = colWarName || derivedWarColId;
  if (effectiveWarCol) {
    const derivedComposite = rows.map((r) => {
      const rankFromCol = colPosto ? r[colPosto] : '';
      const rankFromName = !rankFromCol && colFullName
        ? (r[colFullName]?.match(RANK_PREFIX_RE)?.[0] || '').trim()
        : '';
      const posto = rankFromCol || rankFromName;
      return posto ? [posto, r[effectiveWarCol]].filter(Boolean).join(' ') : '';
    });
    if (derivedComposite.some(Boolean)) {
      const compositeId = 'derived_posto_war';
      columns.push({
        id: compositeId,
        label: 'Posto/Grad + Nome de guerra',
        sample: derivedComposite.find(Boolean) || '',
        isDerived: true,
      });
      rows.forEach((r, idx) => {
        r[compositeId] = derivedComposite[idx];
      });
    }
  }

  // Always offer standalone "Somente CPF (extraído)" when CPF is embedded or mixed in another column
  const extractedCpfs = rows.map((r) =>
    extractCpfFromText(Object.values(r).join(' '))
  );
  const existingCpfNeedsClean =
    !colCpf ||
    rows.some((r) => {
      const rawVal = (r[colCpf] || '').trim();
      const pureCpf = extractCpfFromText(rawVal);
      return Boolean(pureCpf && rawVal !== pureCpf);
    });
  if (existingCpfNeedsClean && extractedCpfs.some(Boolean)) {
    const derivedCpfId = 'derived_cpf';
    columns.push({
      id: derivedCpfId,
      label: 'Somente CPF (extraído)',
      sample: extractedCpfs.find(Boolean) || '',
      isDerived: true,
    });
    rows.forEach((r, idx) => {
      r[derivedCpfId] = extractedCpfs[idx];
    });
    if (!colCpf || colCpf === colIdentidade) {
      colCpf = derivedCpfId;
    }
  }

  // Always offer standalone "Somente Identidade (extraída)" when Identidade is embedded or mixed
  const extractedIds = rows.map((r) =>
    extractIdentidadeFromText(Object.values(r).join(' '))
  );
  const existingIdNeedsClean =
    !colIdentidade ||
    colIdentidade === colCpf ||
    rows.some((r) => {
      const rawVal = (r[colIdentidade] || '').trim();
      const pureId = extractIdentidadeFromText(rawVal);
      return Boolean(pureId && rawVal !== pureId);
    });
  if (existingIdNeedsClean && extractedIds.some(Boolean)) {
    const derivedIdCol = 'derived_identidade';
    columns.push({
      id: derivedIdCol,
      label: 'Somente Identidade (extraída)',
      sample: extractedIds.find(Boolean) || '',
      isDerived: true,
    });
    rows.forEach((r, idx) => {
      r[derivedIdCol] = extractedIds[idx];
    });
    if (!colIdentidade || colIdentidade === colCpf) {
      colIdentidade = derivedIdCol;
    }
  }

  const colOrd = findColId(/\b(ORD|NR|N[º°O]|NUMERO)\b/);

  const identPrincipal = colFullName || effectiveWarCol || columns[0]?.id || '';
  const identSecundario =
    colIdentidade ||
    colCpf ||
    columns.find((c) => c.id !== identPrincipal)?.id ||
    '';

  const rpPrincipal =
    colOrd ||
    effectiveWarCol ||
    identPrincipal ||
    columns[0]?.id ||
    '';

  return {
    fileName,
    sourceKind,
    columns,
    rows,
    suggestedMapping: {
      identPrincipal,
      identSecundario,
      identTop: '',
      identBottom: '',
      identBack: '',
      rpPrincipal,
      rpTop: '',
      rpBottom: '',
      rpBack: '',
    },
  };
}

// ==================== CSV / DELIMITED PARSER ====================

function detectDelimiter(lines: string[]): string | null {
  const sample = lines.slice(0, 8);
  const candidates = [';', '\t', '|', ','];
  let bestDelim: string | null = null;
  let bestScore = 0;

  for (const delim of candidates) {
    const counts = sample.map((l) => l.split(delim).length - 1);
    const nonZero = counts.filter((c) => c >= 1);
    if (nonZero.length >= Math.min(2, sample.length)) {
      const avg = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
      if (avg > bestScore) {
        bestScore = avg;
        bestDelim = delim;
      }
    }
  }
  return bestDelim;
}

function parseDelimitedText(raw: string, delimiter: string): RawCellWithMeta[][] {
  const rows: RawCellWithMeta[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\r') {
      if (raw[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row.map((text) => ({ text })));
      row = [];
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row.map((text) => ({ text })));
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row.map((text) => ({ text })));
  }

  return rows;
}

// ==================== XLSX PARSER (via JSZip) ====================

function excelColLettersToIndex(letters: string): number {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(0, idx - 1);
}

async function parseXlsxFile(file: File): Promise<RawCellWithMeta[][]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const parser = new DOMParser();

  // Read shared strings if present
  const sharedStrings: string[] = [];
  const ssFile = zip.file('xl/sharedStrings.xml');
  if (ssFile) {
    const ssDoc = parser.parseFromString(await ssFile.async('string'), 'application/xml');
    const sis = Array.from(ssDoc.getElementsByTagName('si'));
    for (const si of sis) {
      const ts = Array.from(si.getElementsByTagName('t'));
      sharedStrings.push(ts.map((t) => t.textContent || '').join(''));
    }
  }

  const sheetPaths = Object.keys(zip.files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(p))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (sheetPaths.length === 0) {
    throw new Error('Nenhuma planilha encontrada no arquivo Excel (.xlsx).');
  }

  // Pick the first worksheet that has meaningful rows
  for (const sheetPath of sheetPaths) {
    const sheetXml = await zip.file(sheetPath)!.async('string');
    const doc = parser.parseFromString(sheetXml, 'application/xml');
    const rowEls = Array.from(doc.getElementsByTagName('row'));
    const matrix: RawCellWithMeta[][] = [];

    for (const rowEl of rowEls) {
      const cells = Array.from(rowEl.getElementsByTagName('c'));
      const outRow: RawCellWithMeta[] = [];

      for (const cEl of cells) {
        const ref = cEl.getAttribute('r') || '';
        const colMatch = ref.match(/^([A-Z]+)/i);
        const colIdx = colMatch ? excelColLettersToIndex(colMatch[1].toUpperCase()) : outRow.length;
        const typeAttr = cEl.getAttribute('t') || '';

        let val = '';
        if (typeAttr === 'inlineStr') {
          const ts = Array.from(cEl.getElementsByTagName('t'));
          val = ts.map((t) => t.textContent || '').join('');
        } else {
          const vEl = cEl.getElementsByTagName('v')[0];
          const rawVal = vEl?.textContent ?? '';
          if (typeAttr === 's') {
            const sIdx = parseInt(rawVal, 10);
            val = Number.isFinite(sIdx) ? sharedStrings[sIdx] ?? '' : '';
          } else {
            val = rawVal;
          }
        }

        while (outRow.length <= colIdx) outRow.push({ text: '' });
        outRow[colIdx] = { text: cleanCellText(val) };
      }

      if (outRow.some((c) => c.text.length > 0)) {
        matrix.push(outRow);
      }
    }

    if (matrix.length > 0) return matrix;
  }

  return [];
}

// ==================== ODS PARSER (via JSZip) ====================

async function parseOdsFile(file: File): Promise<RawCellWithMeta[][]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const contentFile = zip.file('content.xml');
  if (!contentFile) {
    throw new Error('Arquivo .ods inválido.');
  }
  const doc = new DOMParser().parseFromString(await contentFile.async('string'), 'application/xml');
  const tables = Array.from(doc.getElementsByTagName('table:table'));
  for (const tbl of tables) {
    const rows = Array.from(tbl.getElementsByTagName('table:table-row'));
    const matrix: RawCellWithMeta[][] = [];
    for (const tr of rows) {
      const cells = Array.from(tr.getElementsByTagName('table:table-cell'));
      const outRow: RawCellWithMeta[] = [];
      for (const tc of cells) {
        const repeat = Math.min(
          50,
          Math.max(1, parseInt(tc.getAttribute('table:number-columns-repeated') || '1', 10) || 1)
        );
        const ps = Array.from(tc.getElementsByTagName('text:p'));
        const text = cleanCellText(ps.map((p) => p.textContent || '').join(' '));
        for (let i = 0; i < repeat; i++) {
          outRow.push({ text });
        }
      }
      if (outRow.some((c) => c.text.length > 0)) {
        matrix.push(outRow);
      }
    }
    if (matrix.length > 0) return matrix;
  }
  return [];
}

// ==================== DOCX PARSER (via JSZip) ====================

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function readDocxParagraphWithBold(p: Element): RawCellWithMeta {
  const runs = Array.from(p.getElementsByTagNameNS(W_NS, 'r'));
  let fullText = '';
  let boldRun = '';
  let firstBold = '';
  let boldCount = 0;

  for (const r of runs) {
    const rPr = r.getElementsByTagNameNS(W_NS, 'rPr')[0];
    let isBold = false;
    if (rPr) {
      const bEl = rPr.getElementsByTagNameNS(W_NS, 'b')[0];
      if (bEl) {
        const val = bEl.getAttribute('w:val') ?? bEl.getAttribute('val');
        isBold = val !== '0' && val !== 'false';
      }
    }
    const text = Array.from(r.getElementsByTagNameNS(W_NS, 't'))
      .map((t) => t.textContent || '')
      .join('');
    if (!text) continue;
    fullText += text;
    if (isBold) {
      boldRun += text;
    } else if (boldRun.trim()) {
      boldCount++;
      firstBold = cleanCellText(boldRun);
      boldRun = '';
    }
  }
  if (boldRun.trim()) {
    boldCount++;
    firstBold = cleanCellText(boldRun);
  }

  return {
    text: cleanCellText(fullText),
    boldSubstring: boldCount === 1 ? firstBold : undefined,
  };
}

async function parseDocxFile(
  file: File
): Promise<{ tables: RawCellWithMeta[][][]; lines: RawCellWithMeta[] }> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const docEntry = zip.file('word/document.xml');
  if (!docEntry) {
    throw new Error('Arquivo .docx inválido: word/document.xml não encontrado.');
  }
  const xml = await docEntry.async('string');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
  const tables: RawCellWithMeta[][][] = [];
  const lines: RawCellWithMeta[] = [];

  if (!body) return { tables, lines };

  for (const child of Array.from(body.children)) {
    const localName = child.localName || child.nodeName.replace(/^.*:/, '');
    if (localName === 'tbl') {
      const trs = Array.from(child.getElementsByTagNameNS(W_NS, 'tr'));
      const matrix: RawCellWithMeta[][] = [];
      for (const tr of trs) {
        const tcs = Array.from(tr.getElementsByTagNameNS(W_NS, 'tc'));
        const rowCells: RawCellWithMeta[] = [];
        for (const tc of tcs) {
          const ps = Array.from(tc.getElementsByTagNameNS(W_NS, 'p')).map(readDocxParagraphWithBold);
          const mergedText = cleanCellText(ps.map((x) => x.text).filter(Boolean).join(' '));
          const boldSub = ps.find((x) => x.boldSubstring)?.boldSubstring;
          rowCells.push({ text: mergedText, boldSubstring: boldSub });

          const tcPr = tc.getElementsByTagNameNS(W_NS, 'tcPr')[0];
          const gridSpan = tcPr?.getElementsByTagNameNS(W_NS, 'gridSpan')[0];
          const spanVal = parseInt(
            gridSpan?.getAttribute('w:val') ?? gridSpan?.getAttribute('val') ?? '1',
            10
          );
          if (Number.isFinite(spanVal) && spanVal > 1) {
            for (let s = 1; s < spanVal; s++) rowCells.push({ text: '' });
          }
        }
        if (rowCells.some((c) => c.text.length > 0)) {
          matrix.push(rowCells);
        }
      }
      if (matrix.length > 0) tables.push(matrix);
    } else if (localName === 'p') {
      const pMeta = readDocxParagraphWithBold(child);
      if (pMeta.text) lines.push(pMeta);
    }
  }

  return { tables, lines };
}

// ==================== PDF PARSER (Tables + Lines + Bold + OCR) ====================

interface PdfChunk {
  text: string;
  x: number;
  y: number;
  width: number;
  bold: boolean;
}

function isPdfFontBold(fontName: string, styles?: Record<string, { fontFamily?: string }>): boolean {
  const family = styles?.[fontName]?.fontFamily || '';
  const combined = `${fontName} ${family}`.toLowerCase();
  return /\bbold\b|\bblack\b|\bheavy\b|\bsemi[-_]?bold\b|[-_,]b\b|[a-z]bd\b/.test(combined);
}

function splitRowChunksIntoColumns(row: PdfChunk[], gapThreshold: number): PdfChunk[][] {
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const segs: PdfChunk[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const gap = curr.x - (prev.x + prev.width);
    if (gap > gapThreshold) {
      segs.push([curr]);
    } else {
      segs[segs.length - 1].push(curr);
    }
  }
  return segs;
}

function chunksToCellMeta(chunks: PdfChunk[]): RawCellWithMeta {
  const sorted = [...chunks].sort((a, b) => a.x - b.x);
  let text = '';
  let boldRun = '';
  let firstBold = '';
  let boldCount = 0;

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const prev = i > 0 ? sorted[i - 1] : null;
    if (prev && c.x - (prev.x + prev.width) > 1.8 && !text.endsWith(' ') && !c.text.startsWith(' ')) {
      text += ' ';
    }
    text += c.text;
    if (c.bold) {
      boldRun += c.text;
    } else if (boldRun.trim()) {
      boldCount++;
      firstBold = cleanCellText(boldRun);
      boldRun = '';
    }
  }
  if (boldRun.trim()) {
    boldCount++;
    firstBold = cleanCellText(boldRun);
  }

  return {
    text: cleanCellText(text),
    boldSubstring: boldCount === 1 ? firstBold : undefined,
  };
}

async function parsePdfFile(
  file: File
): Promise<{ tables: RawCellWithMeta[][][]; lines: RawCellWithMeta[]; usedOcr: boolean }> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;

  const allRowGroups: { chunks: PdfChunk[]; pageWidth: number }[] = [];
  const lines: RawCellWithMeta[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const styles = content.styles as Record<string, { fontFamily?: string }> | undefined;

    const chunks: PdfChunk[] = [];
    for (const rawItem of content.items) {
      const item = rawItem as {
        str?: string;
        transform?: number[];
        width?: number;
        fontName?: string;
      };
      if (typeof item.str !== 'string' || !item.str.trim()) continue;
      chunks.push({
        text: item.str.replace(/\u00a0/g, ' '),
        x: item.transform?.[4] ?? 0,
        y: item.transform?.[5] ?? 0,
        width: item.width ?? item.str.length * 4,
        bold: item.fontName ? isPdfFontBold(item.fontName, styles) : false,
      });
    }

    chunks.sort((a, b) => b.y - a.y || a.x - b.x);
    const pageRows: PdfChunk[][] = [];
    for (const ch of chunks) {
      const last = pageRows[pageRows.length - 1];
      if (!last || Math.abs(last[0].y - ch.y) > 4.0) {
        pageRows.push([ch]);
      } else {
        last.push(ch);
      }
    }

    for (const r of pageRows) {
      allRowGroups.push({ chunks: r, pageWidth: viewport.width });
      lines.push(chunksToCellMeta(r));
    }
  }

  // OCR fallback if PDF is scanned images without selectable text
  if (lines.length === 0 && pdf.numPages > 0) {
    const worker = await createWorker('por');
    const ocrLines: RawCellWithMeta[] = [];
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
        for (const rawLine of (data.text || '').split(/\r?\n/)) {
          const clean = cleanCellText(rawLine);
          if (clean) ocrLines.push({ text: clean });
        }
      }
    } finally {
      await worker.terminate();
    }
    return { tables: [], lines: ocrLines, usedOcr: true };
  }

  // Build aligned multi-column tables across consecutive rows when gap separation is clear
  const tables: RawCellWithMeta[][][] = [];
  let idx = 0;
  while (idx < allRowGroups.length) {
    const gapThresh = Math.max(12, allRowGroups[idx].pageWidth * 0.02);
    const segs = splitRowChunksIntoColumns(allRowGroups[idx].chunks, gapThresh);
    if (segs.length < 2) {
      idx++;
      continue;
    }

    // Collect contiguous multi-column rows
    const candidateSegs: { xStart: number; meta: RawCellWithMeta }[][] = [];
    let scan = idx;
    while (scan < allRowGroups.length) {
      const rowSegs = splitRowChunksIntoColumns(allRowGroups[scan].chunks, gapThresh);
      if (rowSegs.length < 2) break;
      candidateSegs.push(
        rowSegs.map((s) => ({
          xStart: s[0].x,
          meta: chunksToCellMeta(s),
        }))
      );
      scan++;
    }

    if (candidateSegs.length >= 2) {
      const anchors = clusterValues(
        candidateSegs.flatMap((r) => r.map((c) => c.xStart)),
        16
      ).sort((a, b) => a - b);

      if (anchors.length >= 2 && anchors.length <= 16) {
        const matrix: RawCellWithMeta[][] = candidateSegs.map((row) => {
          const out = Array.from({ length: anchors.length }, (): RawCellWithMeta => ({ text: '' }));
          for (const seg of row) {
            let bestCol = 0;
            let bestDist = Infinity;
            for (let c = 0; c < anchors.length; c++) {
              const d = Math.abs(seg.xStart - anchors[c]);
              if (d < bestDist) {
                bestDist = d;
                bestCol = c;
              }
            }
            if (out[bestCol].text) {
              out[bestCol] = {
                text: `${out[bestCol].text} ${seg.meta.text}`,
                boldSubstring: out[bestCol].boldSubstring || seg.meta.boldSubstring,
              };
            } else {
              out[bestCol] = seg.meta;
            }
          }
          return out;
        });
        tables.push(matrix);
        idx = scan;
        continue;
      }
    }
    idx++;
  }

  return { tables, lines, usedOcr: false };
}

// ==================== UNSTRUCTURED / KEY-VALUE LINE PARSER ====================

function parseFreeLinesIntoTable(lines: RawCellWithMeta[]): RawCellWithMeta[][] {
  const cleanLines = lines.map((l) => ({ ...l, text: cleanCellText(l.text) })).filter((l) => l.text);
  if (cleanLines.length === 0) return [];

  // 1. Check if delimited text (e.g., paste/TXT with ; or | or TAB)
  const delim = detectDelimiter(cleanLines.map((l) => l.text));
  if (delim) {
    return parseDelimitedText(cleanLines.map((l) => l.text).join('\n'), delim);
  }

  // 2. Check Key: Value multi-line blocks (e.g., Nome: ...\nCPF: ...\nIdentidade: ...)
  const kvMatches = cleanLines.filter((l) =>
    /^(?:NOME(?:\s+COMPLETO)?|NOME\s+DE\s+GUERRA|POSTO(?:\s*\/\s*GRAD(?:UA[ÇC][ÃA]O)?)?|IDENTIDADE|IDT|CPF|RG|FUN[ÇC][ÃA]O|CARGO|OM|SETOR)\s*:/i.test(
      l.text
    )
  );
  if (kvMatches.length >= 2) {
    const keysOrder: string[] = [];
    const records: Record<string, string>[] = [];
    let currentRec: Record<string, string> = {};

    for (const line of cleanLines) {
      const m = line.text.match(/^([^:]{2,40}):\s*(.+)$/);
      if (!m) continue;
      const key = cleanCellText(m[1]);
      const val = cleanCellText(m[2]);
      const normKey = stripDiacriticsUpper(key);

      if (currentRec[normKey] !== undefined && Object.keys(currentRec).length > 0) {
        records.push(currentRec);
        currentRec = {};
      }
      if (!keysOrder.some((k) => stripDiacriticsUpper(k) === normKey)) {
        keysOrder.push(key);
      }
      currentRec[normKey] = val;
    }
    if (Object.keys(currentRec).length > 0) {
      records.push(currentRec);
    }

    if (records.length >= 1 && keysOrder.length >= 1) {
      const matrix: RawCellWithMeta[][] = [
        keysOrder.map((k) => ({ text: k })),
        ...records.map((rec) =>
          keysOrder.map((k) => ({ text: rec[stripDiacriticsUpper(k)] || '' }))
        ),
      ];
      return matrix;
    }
  }

  // 3. Fallback: person-per-line list (extract Posto/Grad, Nome Completo, Nome de Guerra, Identidade, CPF)
  const personRows: RawCellWithMeta[][] = [
    [
      { text: 'POSTO/GRAD' },
      { text: 'NOME COMPLETO' },
      { text: 'NOME DE GUERRA' },
      { text: 'IDENTIDADE' },
      { text: 'CPF' },
      { text: 'LINHA COMPLETA' },
    ],
  ];

  for (const line of cleanLines) {
    let raw = line.text.replace(/^(?:\d+\s*[-.)]\s*|[-–—•*]\s*)/, '').trim();
    if (!raw || HEADER_KEYWORDS_RE.test(stripDiacriticsUpper(raw)) && raw.split(/\s+/).length <= 4) {
      continue;
    }

    const cpf = extractCpfFromText(raw);
    const idt = extractIdentidadeFromText(raw);

    let stripped = raw;
    if (cpf) stripped = stripped.replace(cpf, ' ');
    if (idt) stripped = stripped.replace(idt, ' ');
    stripped = stripped
      .replace(/\b(?:CPF|IDENTIDADE|IDT|RG)\s*[:\-]?\s*/gi, ' ')
      .replace(/\s*[-–—|;/,]+\s*$/, '')
      .replace(/^\s*[-–—|;/,]+\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();

    const rankMatch = stripped.match(RANK_PREFIX_RE);
    const posto = rankMatch ? cleanCellText(rankMatch[0]) : '';
    const fullName = cleanCellText(rankMatch ? stripped.slice(rankMatch[0].length) : stripped);
    const warName = extractWarNameHeuristic(fullName, line.boldSubstring);

    if (!fullName && !cpf && !idt) continue;

    personRows.push([
      { text: posto },
      { text: fullName || raw, boldSubstring: line.boldSubstring },
      { text: warName },
      { text: idt },
      { text: cpf },
      { text: line.text },
    ]);
  }

  return personRows.length > 1 ? personRows : [];
}

// ==================== HTML / WORD-HTML PARSER ====================

function parseHtmlString(html: string): { tables: RawCellWithMeta[][][]; lines: RawCellWithMeta[] } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const tables: RawCellWithMeta[][][] = [];
  const lines: RawCellWithMeta[] = [];

  for (const tbl of Array.from(doc.querySelectorAll('table'))) {
    const matrix: RawCellWithMeta[][] = [];
    for (const tr of Array.from(tbl.querySelectorAll('tr'))) {
      const cells = Array.from(tr.querySelectorAll('th, td'));
      const row: RawCellWithMeta[] = [];
      for (const cell of cells) {
        const boldEl = cell.querySelector('strong, b');
        const text = cleanCellText(cell.textContent || '');
        const boldSub = boldEl ? cleanCellText(boldEl.textContent || '') : undefined;
        row.push({
          text,
          boldSubstring: boldSub && boldSub.length < text.length ? boldSub : undefined,
        });
        const span = Math.max(1, parseInt(cell.getAttribute('colspan') || '1', 10) || 1);
        for (let s = 1; s < span; s++) row.push({ text: '' });
      }
      if (row.some((c) => c.text.length > 0)) matrix.push(row);
    }
    if (matrix.length > 0) tables.push(matrix);
  }

  for (const el of Array.from(doc.body.querySelectorAll('p, div, li'))) {
    if (el.closest('table')) continue;
    if (el.querySelector('p, div, li')) continue;
    const text = cleanCellText(el.textContent || '');
    if (!text) continue;
    const boldEl = el.querySelector('strong, b');
    const boldSub = boldEl ? cleanCellText(boldEl.textContent || '') : undefined;
    lines.push({
      text,
      boldSubstring: boldSub && boldSub.length < text.length ? boldSub : undefined,
    });
  }

  return { tables, lines };
}

function mergeLargestCompatibleTables(tables: RawCellWithMeta[][][]): RawCellWithMeta[][] {
  if (tables.length === 0) return [];
  // Pick the table with most rows, merging consecutive tables of identical column count
  const grouped: RawCellWithMeta[][][][] = [];
  for (const t of tables) {
    const cols = Math.max(...t.map((r) => r.length));
    const prev = grouped[grouped.length - 1];
    if (prev && Math.max(...prev[0].map((r) => r.length)) === cols) {
      prev.push(t);
    } else {
      grouped.push([t]);
    }
  }

  let bestMerged: RawCellWithMeta[][] = tables[0];
  for (const grp of grouped) {
    const merged: RawCellWithMeta[][] = grp.flat();
    if (merged.length > bestMerged.length) {
      bestMerged = merged;
    }
  }
  return bestMerged;
}

function decodeQuotedPrintableText(input: string): string {
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
    return new TextDecoder('utf-8', { fatal: true }).decode(u8);
  } catch {
    return new TextDecoder('windows-1252').decode(u8);
  }
}

function extractMhtmlHtml(raw: string): string | null {
  if (!/MIME-Version:/i.test(raw) || !/text\/html/i.test(raw)) return null;
  const htmlIdx = raw.search(/<!DOCTYPE|<html/i);
  if (htmlIdx < 0) return null;
  const headerSlice = raw.slice(Math.max(0, htmlIdx - 600), htmlIdx);
  const tail = raw.slice(htmlIdx);
  const boundaryMatch = raw.match(/boundary="?([^"\r\n;]+)"?/i);
  const endIdx = boundaryMatch ? tail.indexOf(`--${boundaryMatch[1]}`) : -1;
  const htmlSection = endIdx > 0 ? tail.slice(0, endIdx) : tail;
  return /quoted-printable/i.test(headerSlice)
    ? decodeQuotedPrintableText(htmlSection)
    : htmlSection;
}

function decodeRtfToPlainText(rtf: string): string {
  let s = rtf.replace(
    /\{\\(?:fonttbl|colortbl|stylesheet|info|pict|object)[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/gi,
    ''
  );
  s = s.replace(/\\row\b\s?/gi, '\n');
  s = s.replace(/\\cell\b\s?/gi, '\t');
  s = s.replace(/\\par\b\s?|\\line\b\s?/gi, '\n');
  s = s.replace(/\\tab\b\s?/gi, '\t');
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

async function parseOdtFile(
  file: File
): Promise<{ tables: RawCellWithMeta[][][]; lines: RawCellWithMeta[] }> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const contentFile = zip.file('content.xml');
  if (!contentFile) {
    throw new Error('Arquivo .odt inválido.');
  }
  const doc = new DOMParser().parseFromString(await contentFile.async('string'), 'application/xml');
  const tables: RawCellWithMeta[][][] = [];
  const lines: RawCellWithMeta[] = [];

  for (const tbl of Array.from(doc.getElementsByTagName('table:table'))) {
    const matrix: RawCellWithMeta[][] = [];
    for (const tr of Array.from(tbl.getElementsByTagName('table:table-row'))) {
      const rowCells: RawCellWithMeta[] = [];
      for (const tc of Array.from(tr.getElementsByTagName('table:table-cell'))) {
        const ps = Array.from(tc.getElementsByTagName('text:p'));
        const text = cleanCellText(ps.map((p) => p.textContent || '').join(' '));
        rowCells.push({ text });
      }
      if (rowCells.some((c) => c.text.length > 0)) matrix.push(rowCells);
    }
    if (matrix.length > 0) tables.push(matrix);
  }

  for (const p of Array.from(doc.getElementsByTagName('text:p'))) {
    if (p.closest('table\\:table, table')) continue;
    const text = cleanCellText(p.textContent || '');
    if (text) lines.push({ text });
  }

  return { tables, lines };
}

export async function extractCrachaDocumentData(
  file: File
): Promise<ExtractedCrachaDocument> {
  const lowerName = file.name.toLowerCase();
  const mime = (file.type || '').toLowerCase();

  // 1. Image OCR
  if (
    mime.startsWith('image/') ||
    /\.(png|jpe?g|webp|bmp|tiff?|gif)$/i.test(lowerName)
  ) {
    const worker = await createWorker('por');
    const url = URL.createObjectURL(file);
    try {
      const { data } = await worker.recognize(url);
      const lines = (data.text || '')
        .split(/\r?\n/)
        .map((t) => ({ text: cleanCellText(t) }))
        .filter((l) => l.text.length > 0);
      const matrix = parseFreeLinesIntoTable(lines);
      return normalizeTabularRows(matrix, file.name, 'ocr');
    } finally {
      URL.revokeObjectURL(url);
      await worker.terminate();
    }
  }

  // 2. Excel (.xlsx)
  if (
    lowerName.endsWith('.xlsx') ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    const matrix = await parseXlsxFile(file);
    return normalizeTabularRows(matrix, file.name, 'tabela');
  }

  // 3. OpenDocument Spreadsheet (.ods)
  if (
    lowerName.endsWith('.ods') ||
    mime === 'application/vnd.oasis.opendocument.spreadsheet'
  ) {
    const matrix = await parseOdsFile(file);
    return normalizeTabularRows(matrix, file.name, 'tabela');
  }

  // 3b. OpenDocument Text (.odt)
  if (
    lowerName.endsWith('.odt') ||
    mime === 'application/vnd.oasis.opendocument.text'
  ) {
    const { tables, lines } = await parseOdtFile(file);
    if (tables.length > 0) {
      const merged = mergeLargestCompatibleTables(tables);
      if (merged.length >= 2) {
        return normalizeTabularRows(merged, file.name, 'tabela');
      }
    }
    const matrix = parseFreeLinesIntoTable(lines);
    return normalizeTabularRows(matrix, file.name, 'lista');
  }

  // 4. Word (.docx or ZIP-packaged .doc)
  const headBytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const isZipMagic =
    headBytes.length >= 4 &&
    headBytes[0] === 0x50 &&
    headBytes[1] === 0x4b &&
    headBytes[2] === 0x03 &&
    headBytes[3] === 0x04;
  const isOle2Magic =
    headBytes.length >= 4 &&
    headBytes[0] === 0xd0 &&
    headBytes[1] === 0xcf &&
    headBytes[2] === 0x11 &&
    headBytes[3] === 0xe0;

  if (
    lowerName.endsWith('.docx') ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    (lowerName.endsWith('.doc') && isZipMagic)
  ) {
    const { tables, lines } = await parseDocxFile(file);
    if (tables.length > 0) {
      const merged = mergeLargestCompatibleTables(tables);
      if (merged.length >= 2) {
        return normalizeTabularRows(merged, file.name, 'tabela');
      }
    }
    const matrix = parseFreeLinesIntoTable(lines);
    return normalizeTabularRows(matrix, file.name, 'lista');
  }

  if (isOle2Magic) {
    throw new Error(
      `O arquivo "${file.name}" está em formato .doc/.xls binário antigo (OLE2). Salve como .docx, .xlsx ou .pdf e envie novamente.`
    );
  }

  // 5. PDF (.pdf)
  if (lowerName.endsWith('.pdf') || mime === 'application/pdf') {
    const { tables, lines, usedOcr } = await parsePdfFile(file);
    if (tables.length > 0) {
      const merged = mergeLargestCompatibleTables(tables);
      if (merged.length >= 2) {
        return normalizeTabularRows(merged, file.name, 'tabela');
      }
    }
    const matrix = parseFreeLinesIntoTable(lines);
    return normalizeTabularRows(matrix, file.name, usedOcr ? 'ocr' : 'lista');
  }

  // 6. Text / CSV / TSV / HTML / RTF / MHTML / Word-HTML (.doc)
  const rawText = await file.text();
  if (/^\s*\{\\rtf/i.test(rawText)) {
    const rtfText = decodeRtfToPlainText(rawText);
    const rtfLines = rtfText
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((t) => ({ text: cleanCellText(t) }))
      .filter((l) => l.text.length > 0);
    const rtfDelim = detectDelimiter(rtfLines.map((l) => l.text));
    if (rtfDelim) {
      return normalizeTabularRows(parseDelimitedText(rtfText, rtfDelim), file.name, 'tabela');
    }
    return normalizeTabularRows(parseFreeLinesIntoTable(rtfLines), file.name, 'lista');
  }

  const mhtmlHtml = extractMhtmlHtml(rawText);
  if (mhtmlHtml) {
    const { tables, lines } = parseHtmlString(mhtmlHtml);
    if (tables.length > 0) {
      const merged = mergeLargestCompatibleTables(tables);
      if (merged.length >= 2) {
        return normalizeTabularRows(merged, file.name, 'tabela');
      }
    }
    return normalizeTabularRows(parseFreeLinesIntoTable(lines), file.name, 'lista');
  }

  if (/<(html|body|table|tr|td|th|p|div)\b/i.test(rawText)) {
    const { tables, lines } = parseHtmlString(rawText);
    if (tables.length > 0) {
      const merged = mergeLargestCompatibleTables(tables);
      if (merged.length >= 2) {
        return normalizeTabularRows(merged, file.name, 'tabela');
      }
    }
    const matrix = parseFreeLinesIntoTable(lines);
    return normalizeTabularRows(matrix, file.name, 'lista');
  }

  const textLines = rawText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((t) => ({ text: cleanCellText(t) }))
    .filter((l) => l.text.length > 0);
  const delim = detectDelimiter(textLines.map((l) => l.text));
  if (delim) {
    const matrix = parseDelimitedText(rawText, delim);
    return normalizeTabularRows(matrix, file.name, 'tabela');
  }

  const matrix = parseFreeLinesIntoTable(textLines);
  return normalizeTabularRows(matrix, file.name, 'lista');
}

// ==================== MULTI-DOCUMENT MAPPING & CROSS-FILE LINKING ====================

export const EMPTY_SLOT_REF: CrachaSlotRef = { docId: '', colId: '' };

function scoreDocumentAsNameSource(doc: ImportedCrachaSource): number {
  const labels = doc.columns.map((c) => stripDiacriticsUpper(c.label));
  let score = doc.rows.length > 0 ? 1 : 0;
  if (labels.some((l) => /\bNOME\b/.test(l))) score += 10;
  if (labels.some((l) => /\bGUERRA\b/.test(l))) score += 4;
  return score;
}

function scoreDocumentAsSecondaryIdSource(doc: ImportedCrachaSource): number {
  const labels = doc.columns.map((c) => stripDiacriticsUpper(c.label));
  let score = 0;
  if (labels.some((l) => /\b(IDENTIDADE|IDT|RG)\b/.test(l))) score += 10;
  if (labels.some((l) => /\bCPF\b/.test(l))) score += 8;
  return score;
}

function pickPreferredIdCol(doc: ImportedCrachaSource): string {
  return (
    doc.columns.find((c) => c.id === doc.suggestedMapping.identSecundario)?.id ||
    doc.columns.find((c) => /\b(IDENTIDADE|IDT|CPF)\b/.test(stripDiacriticsUpper(c.label)))?.id ||
    doc.columns[0]?.id ||
    ''
  );
}

export function buildInitialMultiMapping(
  sources: ImportedCrachaSource[]
): CrachaMultiMapping {
  if (sources.length === 0) {
    return {
      identPrincipal: EMPTY_SLOT_REF,
      identSecundario: EMPTY_SLOT_REF,
      identTop: EMPTY_SLOT_REF,
      identBottom: EMPTY_SLOT_REF,
      identBack: EMPTY_SLOT_REF,
      rpPrincipal: EMPTY_SLOT_REF,
      rpTop: EMPTY_SLOT_REF,
      rpBottom: EMPTY_SLOT_REF,
      rpBack: EMPTY_SLOT_REF,
    };
  }

  const primaryDoc =
    [...sources].sort((a, b) => scoreDocumentAsNameSource(b) - scoreDocumentAsNameSource(a))[0] ||
    sources[0];

  let secDoc = primaryDoc;
  let secColId = primaryDoc.suggestedMapping.identSecundario;

  // If the primary document doesn't have an ID/CPF column and a 2nd document does, auto-link it!
  if (sources.length > 1) {
    const primaryHasId = scoreDocumentAsSecondaryIdSource(primaryDoc) > 0;
    const bestOtherIdDoc = sources
      .filter((s) => s.id !== primaryDoc.id)
      .sort((a, b) => scoreDocumentAsSecondaryIdSource(b) - scoreDocumentAsSecondaryIdSource(a))[0];

    if (!primaryHasId && bestOtherIdDoc && scoreDocumentAsSecondaryIdSource(bestOtherIdDoc) > 0) {
      secDoc = bestOtherIdDoc;
      secColId = pickPreferredIdCol(bestOtherIdDoc);
    } else if (!secColId && bestOtherIdDoc) {
      secDoc = bestOtherIdDoc;
      secColId = pickPreferredIdCol(bestOtherIdDoc);
    }
  }

  return {
    identPrincipal: primaryDoc.suggestedMapping.identPrincipal
      ? { docId: primaryDoc.id, colId: primaryDoc.suggestedMapping.identPrincipal }
      : EMPTY_SLOT_REF,
    identSecundario: secColId ? { docId: secDoc.id, colId: secColId } : EMPTY_SLOT_REF,
    identTop: primaryDoc.suggestedMapping.identTop
      ? { docId: primaryDoc.id, colId: primaryDoc.suggestedMapping.identTop }
      : EMPTY_SLOT_REF,
    identBottom: primaryDoc.suggestedMapping.identBottom
      ? { docId: primaryDoc.id, colId: primaryDoc.suggestedMapping.identBottom }
      : EMPTY_SLOT_REF,
    identBack: primaryDoc.suggestedMapping.identBack
      ? { docId: primaryDoc.id, colId: primaryDoc.suggestedMapping.identBack }
      : EMPTY_SLOT_REF,
    rpPrincipal: primaryDoc.suggestedMapping.rpPrincipal
      ? { docId: primaryDoc.id, colId: primaryDoc.suggestedMapping.rpPrincipal }
      : EMPTY_SLOT_REF,
    rpTop: primaryDoc.suggestedMapping.rpTop
      ? { docId: primaryDoc.id, colId: primaryDoc.suggestedMapping.rpTop }
      : EMPTY_SLOT_REF,
    rpBottom: primaryDoc.suggestedMapping.rpBottom
      ? { docId: primaryDoc.id, colId: primaryDoc.suggestedMapping.rpBottom }
      : EMPTY_SLOT_REF,
    rpBack: primaryDoc.suggestedMapping.rpBack
      ? { docId: primaryDoc.id, colId: primaryDoc.suggestedMapping.rpBack }
      : EMPTY_SLOT_REF,
  };
}

export function reconcileMultiMapping(
  prev: CrachaMultiMapping | null,
  nextSources: ImportedCrachaSource[]
): CrachaMultiMapping {
  if (nextSources.length === 0) return buildInitialMultiMapping([]);
  if (!prev) return buildInitialMultiMapping(nextSources);

  const byId = new Map(nextSources.map((s) => [s.id, s]));
  const defaults = buildInitialMultiMapping(nextSources);

  const validateSlot = (slot: CrachaSlotRef, fallback: CrachaSlotRef): CrachaSlotRef => {
    if (!slot.docId || !slot.colId) return EMPTY_SLOT_REF;
    const src = byId.get(slot.docId);
    if (!src || !src.columns.some((c) => c.id === slot.colId)) {
      return fallback;
    }
    return slot;
  };

  const next: CrachaMultiMapping = {
    identPrincipal: validateSlot(prev.identPrincipal, defaults.identPrincipal),
    identSecundario: validateSlot(prev.identSecundario, defaults.identSecundario),
    identTop: validateSlot(prev.identTop, EMPTY_SLOT_REF),
    identBottom: validateSlot(prev.identBottom, EMPTY_SLOT_REF),
    identBack: validateSlot(prev.identBack, EMPTY_SLOT_REF),
    rpPrincipal: validateSlot(prev.rpPrincipal, defaults.rpPrincipal),
    rpTop: validateSlot(prev.rpTop, EMPTY_SLOT_REF),
    rpBottom: validateSlot(prev.rpBottom, EMPTY_SLOT_REF),
    rpBack: validateSlot(prev.rpBack, EMPTY_SLOT_REF),
  };

  // If user added a 2nd document containing ID/CPF and identSecundario wasn't explicitly set yet,
  // or points to a blank/fallback column on doc 1 without IDs, helpfully link it!
  if (nextSources.length > 1) {
    const newest = nextSources[nextSources.length - 1];
    const secSrc = byId.get(next.identSecundario.docId);
    const secHasIdLabel = secSrc
      ? scoreDocumentAsSecondaryIdSource(secSrc) > 0
      : false;
    if (!secHasIdLabel && scoreDocumentAsSecondaryIdSource(newest) > 0) {
      next.identSecundario = { docId: newest.id, colId: pickPreferredIdCol(newest) };
    }
  }

  return next;
}

function normalizeMatchNameTokens(raw: string): string[] {
  const noRank = cleanCellText(raw).replace(RANK_PREFIX_RE, '').trim();
  return stripDiacriticsUpper(noRank)
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !NAME_PARTICLES.has(t));
}

function extractRowMatchProfile(
  doc: ImportedCrachaSource,
  row: Record<string, string>
): { fullNorm: string; tokens: string[]; cpfDigits: string; idtNorm: string } {
  const nameCandidates: string[] = [];
  for (const col of doc.columns) {
    const lbl = stripDiacriticsUpper(col.label);
    const val = (row[col.id] || '').trim();
    if (!val) continue;
    if (/\bNOME\b/.test(lbl) && !/\bGUERRA\b/.test(lbl)) {
      nameCandidates.unshift(val);
    } else if (/\bGUERRA\b/.test(lbl)) {
      nameCandidates.push(val);
    }
  }
  if (nameCandidates.length === 0) {
    for (const val of Object.values(row)) {
      const clean = (val || '').trim();
      if (clean && /[A-Za-zÀ-ÿ]{3,}/.test(clean) && !/^\d[\d.\-\/]*$/.test(clean)) {
        nameCandidates.push(clean);
      }
    }
  }

  const bestName = nameCandidates[0] || '';
  const tokens = normalizeMatchNameTokens(bestName);
  const fullNorm = tokens.join(' ');
  const joinedRow = Object.values(row).join(' ');
  const cpfRaw = extractCpfFromText(joinedRow);
  const idtRaw = extractIdentidadeFromText(joinedRow);

  return {
    fullNorm,
    tokens,
    cpfDigits: cpfRaw.replace(/\D/g, ''),
    idtNorm: stripDiacriticsUpper(idtRaw).replace(/[^A-Z0-9]/g, ''),
  };
}

function findBestMatchingRowIndex(
  baseProfile: ReturnType<typeof extractRowMatchProfile>,
  otherProfiles: ReturnType<typeof extractRowMatchProfile>[]
): number {
  if (baseProfile.cpfDigits.length === 11) {
    const idx = otherProfiles.findIndex((p) => p.cpfDigits === baseProfile.cpfDigits);
    if (idx !== -1) return idx;
  }
  if (baseProfile.idtNorm.length >= 6) {
    const idx = otherProfiles.findIndex((p) => p.idtNorm === baseProfile.idtNorm);
    if (idx !== -1) return idx;
  }
  if (!baseProfile.fullNorm) return -1;

  const exactIdx = otherProfiles.findIndex((p) => p.fullNorm === baseProfile.fullNorm);
  if (exactIdx !== -1) return exactIdx;

  // Token overlap matching (e.g. "João Carlos da Silva" vs "3º Sgt João C. Silva" or war name "SILVA")
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < otherProfiles.length; i++) {
    const p = otherProfiles[i];
    if (p.tokens.length === 0) continue;
    const baseSet = new Set(baseProfile.tokens);
    let overlap = 0;
    for (const tok of p.tokens) {
      if (baseSet.has(tok)) overlap++;
    }
    if (overlap >= 2) {
      const score = overlap * 10 - Math.abs(p.tokens.length - baseProfile.tokens.length);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    } else if (
      overlap === 1 &&
      (p.tokens.length === 1 || baseProfile.tokens.length === 1) &&
      (p.tokens[0]?.length || 0) >= 4
    ) {
      // Single unique surname / war name match
      const score = 5;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
  }
  return bestIdx;
}

export function resolveMultiDocumentRows(
  sources: ImportedCrachaSource[],
  mapping: CrachaMultiMapping,
  targetMode: 'identificacao' | 'rp',
  linkMode: CrachaCrossLinkMode = 'auto'
): MultiMappingResolution {
  if (sources.length === 0) {
    return { rows: [], linkedByNameCount: 0, hasCrossFileMapping: false, primaryDocName: '' };
  }

  const byId = new Map(sources.map((s) => [s.id, s]));
  const primarySlot =
    targetMode === 'identificacao' ? mapping.identPrincipal : mapping.rpPrincipal;
  const fallbackSlot =
    targetMode === 'identificacao' ? mapping.identSecundario : mapping.rpTop;

  const primaryDoc =
    byId.get(primarySlot.docId) ||
    byId.get(fallbackSlot.docId) ||
    sources[0];

  const baseRows = primaryDoc.rows.slice(0, 200);
  const baseProfiles = baseRows.map((r) => extractRowMatchProfile(primaryDoc, r));

  // Precompute cross-file alignment map for any external document referenced
  const relevantSlots =
    targetMode === 'identificacao'
      ? [
          mapping.identPrincipal,
          mapping.identSecundario,
          mapping.identTop,
          mapping.identBottom,
          mapping.identBack,
        ]
      : [mapping.rpPrincipal, mapping.rpTop, mapping.rpBottom, mapping.rpBack];

  const otherDocIds = Array.from(
    new Set(
      relevantSlots
        .map((s) => s.docId)
        .filter((id) => Boolean(id) && id !== primaryDoc.id && byId.has(id))
    )
  );

  const rowMappingByDocId = new Map<string, (number | null)[]>();
  let totalNameMatched = 0;

  for (const otherId of otherDocIds) {
    const otherDoc = byId.get(otherId)!;
    const otherRows = otherDoc.rows.slice(0, 200);
    const otherProfiles = otherRows.map((r) => extractRowMatchProfile(otherDoc, r));

    if (linkMode === 'index') {
      rowMappingByDocId.set(
        otherId,
        baseRows.map((_, i) => (i < otherRows.length ? i : null))
      );
      continue;
    }

    const nameMatches = baseProfiles.map((bp) => findBestMatchingRowIndex(bp, otherProfiles));
    const matchCount = nameMatches.filter((m) => m !== -1).length;

    if (linkMode === 'name' || matchCount > 0) {
      totalNameMatched = Math.max(totalNameMatched, matchCount);
      rowMappingByDocId.set(
        otherId,
        nameMatches.map((m) => (m !== -1 ? m : null))
      );
    } else {
      // External doc has no matching names (e.g. a pure list of CPFs/numbers): fall back cleanly to row index
      rowMappingByDocId.set(
        otherId,
        baseRows.map((_, i) => (i < otherRows.length ? i : null))
      );
    }
  }

  const readSlotValue = (slot: CrachaSlotRef, baseRowIdx: number): string => {
    if (!slot.docId || !slot.colId) return '';
    const src = byId.get(slot.docId);
    if (!src) return '';
    if (src.id === primaryDoc.id) {
      return (src.rows[baseRowIdx]?.[slot.colId] || '').trim();
    }
    const mappedIdx = rowMappingByDocId.get(src.id)?.[baseRowIdx] ?? null;
    if (mappedIdx === null) return '';
    return (src.rows[mappedIdx]?.[slot.colId] || '').trim();
  };

  const rows: ResolvedCrachaRowEntry[] = baseRows.map((_, idx) => {
    if (targetMode === 'identificacao') {
      const backVal = readSlotValue(mapping.identBack, idx);
      return {
        nomeCompleto: readSlotValue(mapping.identPrincipal, idx),
        cpf: readSlotValue(mapping.identSecundario, idx),
        rpTexto: readSlotValue(mapping.rpPrincipal, idx),
        topTextOverride: readSlotValue(mapping.identTop, idx),
        bottomTextOverride: readSlotValue(mapping.identBottom, idx),
        versoIgual: !(mapping.identBack.docId && mapping.identBack.colId),
        versoTexto: backVal,
      };
    }

    const backVal = readSlotValue(mapping.rpBack, idx);
    return {
      nomeCompleto: readSlotValue(mapping.identPrincipal, idx),
      cpf: readSlotValue(mapping.identSecundario, idx),
      rpTexto: readSlotValue(mapping.rpPrincipal, idx),
      topTextOverride: readSlotValue(mapping.rpTop, idx),
      bottomTextOverride: readSlotValue(mapping.rpBottom, idx),
      versoIgual: !(mapping.rpBack.docId && mapping.rpBack.colId),
      versoTexto: backVal,
    };
  });

  return {
    rows,
    linkedByNameCount: totalNameMatched,
    hasCrossFileMapping: otherDocIds.length > 0,
    primaryDocName: primaryDoc.fileName,
  };
}
