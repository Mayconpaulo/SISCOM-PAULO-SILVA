export interface AlteracaoHeaderExtract {
  ministerio?: string;
  forca?: string;
  comandoDivisao?: string;
  grandeUnidade?: string;
  omCodom?: string;
  omExtenso?: string;
  tituloDocumento?: string;
  guarnicao?: string;
  folhaInicial?: number;
  nomeCompleto?: string;
  nomeGuerra?: string;
  postoGraduacao?: string;
  qasQms?: string;
  identidade?: string;
  semestre?: string;
  periodo?: string;
}

export interface RawAlteracaoLine {
  text: string;
  isBold?: boolean;
  isUnderlined?: boolean;
  boldSubstring?: string;
  tableRows?: string[][];
}

export interface AlteracaoTableBlockMeta {
  rowsHtml: string[];
  colgroupHtml?: string;
  headerRowHtml?: string;
  itemId?: string;
}

export interface AlteracaoHtmlBlock {
  html: string;
  keepWithNext?: boolean;
  isSpacer?: boolean;
  tableMeta?: AlteracaoTableBlockMeta;
}

export interface ParsedAlteracaoSectionItem {
  id: string;
  kind: 'entry' | 'table';
  month: string;
  title: string;
  subtitle: string;
  previewLabel: string;
  paragraphs: string[];
  tableRows?: string[][];
}

export interface StructuredAlteracaoDoc {
  items: ParsedAlteracaoSectionItem[];
  monthOrder: string[];
  part2Lines: string[];
  part2BoldSubstrings?: Record<number, string>;
  extractedHeader: AlteracaoHeaderExtract;
}

export interface FormatAlteracaoOptions {
  semestre?: string;
  periodo?: string;
  fillSemesterMonths?: boolean;
  preferOptionSemester?: boolean;
}

export interface FormattedAlteracaoResult {
  blocks: AlteracaoHtmlBlock[];
  html: string;
  extractedHeader: AlteracaoHeaderExtract;
  structuredDoc: StructuredAlteracaoDoc;
  stats: {
    monthsCount: number;
    entriesCount: number;
    tablesCount: number;
  };
}

export const MONTHS_UPPER = [
  'JANEIRO',
  'FEVEREIRO',
  'MARÇO',
  'ABRIL',
  'MAIO',
  'JUNHO',
  'JULHO',
  'AGOSTO',
  'SETEMBRO',
  'OUTUBRO',
  'NOVEMBRO',
  'DEZEMBRO',
] as const;

const MONTH_LOOKUP: Record<string, string> = {
  JANEIRO: 'JANEIRO',
  FEVEREIRO: 'FEVEREIRO',
  MARCO: 'MARÇO',
  ABRIL: 'ABRIL',
  MAIO: 'MAIO',
  JUNHO: 'JUNHO',
  JULHO: 'JULHO',
  AGOSTO: 'AGOSTO',
  SETEMBRO: 'SETEMBRO',
  OUTUBRO: 'OUTUBRO',
  NOVEMBRO: 'NOVEMBRO',
  DEZEMBRO: 'DEZEMBRO',
};

export function escapeAlteracaoHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function buildAlteracaoTableHtml(
  rowsHtml: string[],
  itemId?: string,
  colgroupHtml?: string
): string {
  const itemAttr = itemId ? ` data-alt-item="${escapeAlteracaoHtml(itemId)}"` : '';
  return `<table class="alt-doc-table"${itemAttr} style="width:100%; table-layout:fixed; border-collapse:collapse; margin:2px 0; font-size:12pt; line-height:1.18;">${colgroupHtml ?? ''}<tbody>${rowsHtml.join('')}</tbody></table>`;
}

function cleanCellPreserveBreaks(value: string): string {
  return value
    .replace(/[\u00a0\u2000-\u200f\u202f\u205f\u3000]/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

function normalizeTableMatrix(matrix: string[][]): string[][] {
  const cleanedRows = matrix
    .map((row) => row.map((cell) => cleanCellPreserveBreaks(cell)))
    .filter((row) => row.some((c) => c.length > 0));
  if (cleanedRows.length === 0) return [];

  const maxCols = Math.max(...cleanedRows.map((r) => r.length));
  if (maxCols <= 0) return [];

  const padded = cleanedRows.map((row) => {
    const next = [...row];
    while (next.length < maxCols) next.push('');
    return next;
  });

  // Drop columns that are completely empty in every single row
  const activeColIndices: number[] = [];
  for (let c = 0; c < maxCols; c++) {
    if (padded.some((r) => r[c].length > 0)) {
      activeColIndices.push(c);
    }
  }
  if (activeColIndices.length === 0) return [];
  return padded.map((row) => activeColIndices.map((c) => row[c]));
}

function computeTableColgroupHtml(cleanMatrix: string[][]): string {
  const numCols = cleanMatrix[0]?.length ?? 0;
  if (numCols <= 0) return '';

  const colWeights: number[] = [];
  for (let c = 0; c < numCols; c++) {
    const lens = cleanMatrix
      .map((r) => {
        const lines = (r[c] || '').split('\n');
        return Math.max(...lines.map((l) => l.length));
      })
      .sort((a, b) => a - b);
    const p85 = lens[Math.min(lens.length - 1, Math.floor(lens.length * 0.85))] || 3;
    colWeights.push(Math.max(4, Math.min(60, p85)));
  }

  const totalWeight = colWeights.reduce((a, b) => a + b, 0) || numCols;
  const rawPercents = colWeights.map((w) => (w / totalWeight) * 100);
  const minPct = Math.min(10, Math.floor(70 / numCols));
  const clamped = rawPercents.map((p) => Math.max(minPct, Math.min(55, p)));
  const clampedSum = clamped.reduce((a, b) => a + b, 0) || 100;
  const normalized = clamped.map((p) => Math.round(((p / clampedSum) * 100) * 10) / 10);

  // Adjust rounding drift on widest column
  const drift = Math.round((100 - normalized.reduce((a, b) => a + b, 0)) * 10) / 10;
  if (drift !== 0) {
    let widestIdx = 0;
    for (let i = 1; i < normalized.length; i++) {
      if (normalized[i] > normalized[widestIdx]) widestIdx = i;
    }
    normalized[widestIdx] = Math.round((normalized[widestIdx] + drift) * 10) / 10;
  }

  return `<colgroup>${normalized.map((pct) => `<col style="width:${pct}%;">`).join('')}</colgroup>`;
}

function tableMatrixToParts(matrix: string[][]): {
  rowsHtml: string[];
  colgroupHtml: string;
  headerRowHtml?: string;
} {
  const cleanMatrix = normalizeTableMatrix(matrix);
  if (cleanMatrix.length === 0) {
    return { rowsHtml: [], colgroupHtml: '' };
  }

  const cellFontPt = '12pt';
  const colgroupHtml = computeTableColgroupHtml(cleanMatrix);

  const rowsHtml = cleanMatrix.map((row, rowIdx) => {
    const tag = rowIdx === 0 ? 'th' : 'td';
    const fontWeight = rowIdx === 0 ? ' font-weight:700;' : '';
    const cells = row
      .map((cell) => {
        const htmlContent = cell
          ? cell
              .split('\n')
              .map((part) => escapeAlteracaoHtml(part))
              .join('<br>')
          : '&nbsp;';
        return `<${tag} style="border:1px solid #000; padding:2px 4px; text-align:left; vertical-align:top; font-size:${cellFontPt}; line-height:1.18; overflow-wrap:anywhere; word-break:break-word;${fontWeight}">${htmlContent}</${tag}>`;
      })
      .join('');
    return `<tr>${cells}</tr>`;
  });

  return {
    rowsHtml,
    colgroupHtml,
    headerRowHtml: rowsHtml.length >= 2 ? rowsHtml[0] : undefined,
  };
}

function stripDiacriticsUpper(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function cleanInlineWhitespace(value: string): string {
  return value
    .replace(/[\u00a0\u2000-\u200f\u202f\u205f\u3000]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function normalizeMonthHeading(raw: string): string | null {
  const cleaned = stripDiacriticsUpper(raw).replace(/[:.\-–—\s]+$/g, '');
  return MONTH_LOOKUP[cleaned] ?? null;
}

const FIRST_HALF_MONTHS: ReadonlySet<string> = new Set(MONTHS_UPPER.slice(0, 6));
const SECOND_HALF_MONTHS: ReadonlySet<string> = new Set(MONTHS_UPPER.slice(6, 12));

export function inferSemesterMonths(
  semestre?: string,
  periodo?: string
): readonly string[] | null {
  const s = stripDiacriticsUpper(semestre || '');
  const p = stripDiacriticsUpper(periodo || '');

  if (/\b(?:2\s*[º°O]?|SEGUNDO)\s*SEM(?:ESTRE)?\b/.test(s)) {
    return MONTHS_UPPER.slice(6, 12);
  }
  if (/\b(?:1\s*[º°O]?|PRIMEIRO)\s*SEM(?:ESTRE)?\b/.test(s)) {
    return MONTHS_UPPER.slice(0, 6);
  }

  if (/\b0?1\/07\/\d{2,4}\b|\b31\/12\/\d{2,4}\b|\bJUL(?:HO)?\b|\bDEZ(?:EMBRO)?\b/.test(p)) {
    return MONTHS_UPPER.slice(6, 12);
  }
  if (/\b0?1\/01\/\d{2,4}\b|\b30\/06\/\d{2,4}\b|\bJAN(?:EIRO)?\b|\bJUN(?:HO)?\b/.test(p)) {
    return MONTHS_UPPER.slice(0, 6);
  }

  return null;
}

export function deriveSemestreAndPeriodo(
  extracted: AlteracaoHeaderExtract,
  monthOrder: readonly string[] = []
): { semestre?: string; periodo?: string } {
  let semestre = extracted.semestre;
  let periodo = extracted.periodo;

  const yearFromPeriodo = periodo?.match(/\b(20\d{2}|19\d{2})\b/)?.[1];
  const yearFromSemestre = semestre?.match(/\b(20\d{2}|19\d{2})\b/)?.[1];
  const year = yearFromSemestre || yearFromPeriodo || String(new Date().getFullYear());

  if (!semestre && periodo) {
    const months = inferSemesterMonths(undefined, periodo);
    if (months) {
      semestre = months[0] === 'JULHO' ? `2º Semestre de ${year}` : `1º Semestre de ${year}`;
    }
  }

  if (!semestre && monthOrder.length > 0) {
    const onlySecondHalf = monthOrder.every((m) => SECOND_HALF_MONTHS.has(m));
    const onlyFirstHalf = monthOrder.every((m) => FIRST_HALF_MONTHS.has(m));
    if (onlySecondHalf) {
      semestre = `2º Semestre de ${year}`;
    } else if (onlyFirstHalf) {
      semestre = `1º Semestre de ${year}`;
    }
  }

  if (!periodo && semestre) {
    const months = inferSemesterMonths(semestre, undefined);
    if (months) {
      periodo =
        months[0] === 'JULHO'
          ? `01/07/${year} a 31/12/${year}`
          : `01/01/${year} a 30/06/${year}`;
    }
  }

  return { semestre, periodo };
}

function isPart1Line(text: string): boolean {
  const u = stripDiacriticsUpper(text).replace(/[:.\-\s]+$/g, '');
  return /^1\s*[ªªA]?\s*PARTE$/.test(u);
}

function isPart2Line(text: string): boolean {
  const u = stripDiacriticsUpper(text);
  return /^2\s*[ªªA]?\s*PARTE\b/.test(u);
}

function isSemAlteracaoLine(text: string): boolean {
  const u = stripDiacriticsUpper(text).replace(/^[-–—•*\s]+/, '').replace(/[.\s]+$/, '');
  return u === 'SEM ALTERACAO' || u === 'SEM ALTERACOES';
}

/**
 * Topics like "Férias" are ALWAYS subtitles (never standalone Titles), even if written in uppercase
 * or formatted as "Férias - Apresentação por término".
 */
function isNonTitleTopic(candidate: string): boolean {
  const u = stripDiacriticsUpper(candidate).replace(/[:.\-\s]+$/g, '');
  return u === 'FERIAS' || /^FERIAS(\s|$)/.test(u);
}

function normalizeFeriasPrefix(text: string): string {
  return text.replace(/^F[ÉE]RIAS\b/i, 'Férias');
}

function normalizeEntryColon(text: string): string {
  let normalized = cleanInlineWhitespace(text).replace(/^[-–—]\s*/, '- ');

  const m = normalized.match(/^((?:- )?[^:\n]{1,240}?)\s*:\s*(.*)$/);
  if (m) {
    const left = m[1].trim();
    const right = m[2].trim();
    normalized = right ? `${left}: ${right}` : `${left}:`;
  }

  normalized = normalized.replace(/([0-9º°ª\)])\s+:(?=\s|$)/g, '$1:');

  return normalized;
}

function isEntryStartLine(text: string): boolean {
  const t = cleanInlineWhitespace(text);
  return /^[-–—]\s*/.test(t) && t.length > 2 && !isSemAlteracaoLine(t);
}

function isUppercaseHeadingCandidate(text: string): boolean {
  const clean = cleanInlineWhitespace(text);
  if (!clean || clean.length > 100) return false;
  if (isEntryStartLine(clean) || isSemAlteracaoLine(clean)) return false;
  if (normalizeMonthHeading(clean) || isPart1Line(clean) || isPart2Line(clean)) return false;
  if (isNonTitleTopic(clean)) return false;
  if (/[.;!?]$/.test(clean)) return false;

  const letters = clean.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length < 3) return false;
  return clean === clean.toUpperCase();
}

function splitTitleSubtitleDash(
  text: string,
  allowMixedCaseTitle: boolean
): { title: string; subtitle: string; isSubtitleOnly?: boolean } | null {
  const clean = cleanInlineWhitespace(text);
  if (!clean || isEntryStartLine(clean) || isSemAlteracaoLine(clean)) return null;
  if (/[.;!?]$/.test(clean)) return null;
  if (/\bBI\s*N[º°o]/i.test(clean) || /\bnominado a seguir\b/i.test(clean)) return null;

  const dashMatch = clean.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (!dashMatch) return null;

  const left = dashMatch[1].trim();
  const right = dashMatch[2].trim();
  if (!left || !right || left.length > 90 || right.length > 160) return null;

  const leftLetters = left.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (leftLetters.length < 3) return null;

  // "Férias - ..." must NEVER become Title="Férias"; keep entire text as Subtitle!
  if (isNonTitleTopic(left)) {
    return {
      title: '',
      subtitle: `${normalizeFeriasPrefix(left)} - ${right}`,
      isSubtitleOnly: true,
    };
  }

  const leftIsAllCaps = left === left.toUpperCase();
  if (!leftIsAllCaps && !allowMixedCaseTitle) return null;

  return {
    title: left.toUpperCase(),
    subtitle: right,
  };
}

function isHeaderTableText(text: string): boolean {
  const u = stripDiacriticsUpper(text);
  return (
    u.includes('MINISTERIO DA DEFESA') ||
    u.includes('FOLHAS DE ALTERACOES') ||
    u.includes('CONTINUACAO DAS FOLHAS DE ALTERACOES') ||
    /^FOLHA\s+N[º°O]?\s*\d+/.test(u) ||
    u.includes('POSTO/GRADUACAO:')
  );
}

/**
 * Extracts raw lines from rich HTML (editor content or Word-HTML .doc), preserving bold/underline hints
 * and body data tables.
 */
export function htmlToRawAlteracaoLines(html: string): RawAlteracaoLine[] {
  if (!html || !html.trim()) return [];

  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const blockTags = new Set([
      'P',
      'DIV',
      'LI',
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
      'TR',
      'BLOCKQUOTE',
    ]);
    const lines: RawAlteracaoLine[] = [];

    const extractFromContainer = (node: Element) => {
      const text = cleanInlineWhitespace(node.textContent || '');
      if (!text) return;

      const boldEls = Array.from(node.querySelectorAll('strong, b'));
      const boldText = boldEls.map((b) => cleanInlineWhitespace(b.textContent || '')).join(' ').trim();
      const isBold =
        boldText.length > 0 &&
        boldText.replace(/\s+/g, '') === text.replace(/\s+/g, '');

      const uEls = Array.from(node.querySelectorAll('u'));
      const isUnderlined = uEls.length > 0;

      const boldSubstring =
        !isBold && boldEls.length === 1
          ? cleanInlineWhitespace(boldEls[0].textContent || '')
          : undefined;

      lines.push({
        text,
        isBold,
        isUnderlined,
        boldSubstring: boldSubstring || undefined,
      });
    };

    const walk = (root: Element) => {
      for (const child of Array.from(root.children)) {
        if (child.tagName === 'TABLE') {
          const tableText = cleanInlineWhitespace(child.textContent || '');
          const rows = Array.from(child.querySelectorAll('tr'));
          if (isHeaderTableText(tableText)) {
            for (const tr of rows) {
              const cells = Array.from(tr.querySelectorAll('td, th'));
              for (const cell of cells) {
                const innerParagraphs = Array.from(cell.querySelectorAll('p, div'));
                if (innerParagraphs.length > 0) {
                  for (const p of innerParagraphs) extractFromContainer(p);
                } else {
                  extractFromContainer(cell);
                }
              }
            }
          } else {
            const matrix: string[][] = [];
            for (const tr of rows) {
              const cells = Array.from(tr.querySelectorAll('td, th'));
              if (cells.length === 0) continue;
              const rowVals: string[] = [];
              for (const c of cells) {
                const span = Math.max(1, parseInt(c.getAttribute('colspan') || '1', 10) || 1);
                const innerBlocks = Array.from(c.querySelectorAll('p, div'));
                let cellText = '';
                if (innerBlocks.length > 0) {
                  cellText = innerBlocks
                    .map((el) => cleanInlineWhitespace(el.textContent || ''))
                    .filter(Boolean)
                    .join('\n');
                } else {
                  cellText = cleanCellPreserveBreaks(
                    (c.innerHTML || '')
                      .replace(/<br\s*\/?>/gi, '\n')
                      .replace(/<[^>]+>/g, '')
                  );
                }
                rowVals.push(cellText);
                for (let s = 1; s < span; s++) {
                  rowVals.push('');
                }
              }
              if (rowVals.some((v) => v.length > 0)) matrix.push(rowVals);
            }
            if (matrix.length > 0) {
              lines.push({ text: '', tableRows: matrix });
            }
          }
          continue;
        }

        const hasNestedBlocks = Array.from(child.children).some((c) => blockTags.has(c.tagName));
        if (blockTags.has(child.tagName) && !hasNestedBlocks) {
          const innerHtml = child.innerHTML;
          if (/<br\s*\/?>/i.test(innerHtml)) {
            const parts = innerHtml.split(/<br\s*\/?>/i);
            for (const part of parts) {
              const frag = new DOMParser().parseFromString(`<div>${part}</div>`, 'text/html');
              const div = frag.body.firstElementChild;
              if (div) extractFromContainer(div);
            }
          } else {
            extractFromContainer(child);
          }
        } else if (hasNestedBlocks) {
          walk(child);
        } else {
          extractFromContainer(child);
        }
      }
    };

    walk(doc.body);
    if (lines.length > 0) return lines;
  }

  return plainTextToRawAlteracaoLines(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  );
}

export function plainTextToRawAlteracaoLines(rawText: string): RawAlteracaoLine[] {
  return rawText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => ({ text: cleanInlineWhitespace(line) }))
    .filter((line) => line.text.length > 0);
}

function isContinuationHeaderTrigger(lineText: string): boolean {
  const u = stripDiacriticsUpper(lineText);
  return /^CONTINUACAO\s+DAS\s+FOLHAS\s+DE\s+ALTERACOES\b/.test(u);
}

function isFolhaNumberLine(lineText: string): boolean {
  return /^FOLHA\s+N[º°o]?\s*\d+\b/i.test(cleanInlineWhitespace(lineText));
}

function isSemestreLine(lineText: string): boolean {
  return /^(?:1|2|PRIMEIRO|SEGUNDO)\s*[º°o]?\s*SEM(?:ESTRE)?(?:\s*(?:DE|\/|-)\s*\d{4})?\b/i.test(
    cleanInlineWhitespace(lineText)
  );
}

function isPeriodoLine(lineText: string): boolean {
  return /^PER[ÍI]ODO\s*:/i.test(cleanInlineWhitespace(lineText));
}

function extractInlineHeaderDates(lineText: string, header: AlteracaoHeaderExtract) {
  const clean = cleanInlineWhitespace(lineText);
  const semMatch = clean.match(
    /\b((?:1|2|PRIMEIRO|SEGUNDO)\s*[º°o]?\s*SEM(?:ESTRE)?\s*(?:(?:DE|\/|-)\s*\d{4})?)\b/i
  );
  if (semMatch && !header.semestre) {
    header.semestre = semMatch[1].trim();
  }

  const perMatch = clean.match(
    /\bPER[ÍI]ODO\s*:\s*(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4}\s*(?:a|ate|até|-)\s*\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4}|\S.+)$/i
  );
  if (perMatch && !header.periodo) {
    header.periodo = perMatch[1].trim();
  }

  const folhaMatch = clean.match(/\bFOLHA\s+N[º°o]?\s*(\d+)\b/i);
  if (folhaMatch && header.folhaInicial === undefined) {
    header.folhaInicial = Math.max(1, parseInt(folhaMatch[1], 10));
  }
}

/**
 * Extracts structured metadata from Page 1 & continuation headers, and returns filtered body lines.
 */
export function extractHeaderAndBodyLines(rawLines: RawAlteracaoLine[]): {
  extractedHeader: AlteracaoHeaderExtract;
  bodyLines: RawAlteracaoLine[];
} {
  const header: AlteracaoHeaderExtract = {};
  const skipIndices = new Set<number>();

  // 1. Detect continuation header blocks anywhere in the stream and skip them
  for (let i = 0; i < rawLines.length; i++) {
    if (rawLines[i].tableRows) continue;
    const text = rawLines[i].text;
    if (isContinuationHeaderTrigger(text)) {
      skipIndices.add(i);
      if (i > 0 && !rawLines[i - 1].tableRows) {
        const prev = rawLines[i - 1].text;
        const prevU = stripDiacriticsUpper(prev);
        if (
          /\b(BATALHAO|REGIMENTO|GRUPO|COMANDO|CENTRO|ESCOLA|PARQUE|BASE|DEPOSITO|HOSPITAL|COMPANHIA)\b/.test(
            prevU
          ) &&
          !isEntryStartLine(prev)
        ) {
          skipIndices.add(i - 1);
          if (!header.omExtenso) {
            header.omExtenso = prev;
          }
        }
      }
      for (let j = i + 1; j <= Math.min(rawLines.length - 1, i + 5); j++) {
        if (rawLines[j].tableRows) break;
        const nextText = rawLines[j].text;
        if (
          isPart1Line(nextText) ||
          isPart2Line(nextText) ||
          normalizeMonthHeading(nextText) ||
          isEntryStartLine(nextText)
        ) {
          break;
        }
        const nextU = stripDiacriticsUpper(nextText);
        if (
          /^(DO|DA)\s+/.test(nextU) ||
          isFolhaNumberLine(nextText) ||
          isSemestreLine(nextText) ||
          isPeriodoLine(nextText)
        ) {
          skipIndices.add(j);
          extractInlineHeaderDates(nextText, header);
          if (!header.nomeGuerra && rawLines[j].boldSubstring) {
            header.nomeGuerra = rawLines[j].boldSubstring;
          }
        }
      }
    }
  }

  // 2. Locate where the actual document body starts (1ª PARTE, 2ª PARTE, or first month)
  let bodyStartIdx = 0;
  for (let i = 0; i < Math.min(rawLines.length, 45); i++) {
    if (rawLines[i].tableRows) continue;
    const t = rawLines[i].text;
    if (isPart1Line(t) || isPart2Line(t) || normalizeMonthHeading(t)) {
      bodyStartIdx = i;
      break;
    }
  }

  const headerScanLimit = bodyStartIdx > 0 ? bodyStartIdx : Math.min(rawLines.length, 30);
  for (let i = 0; i < headerScanLimit; i++) {
    if (rawLines[i].tableRows) continue;
    const { text, boldSubstring } = rawLines[i];
    const u = stripDiacriticsUpper(text);

    extractInlineHeaderDates(text, header);

    if (/^MINISTERIO DA DEFESA\b/.test(u)) {
      header.ministerio = text;
      skipIndices.add(i);
    } else if (/^EXERCITO BRASILEIRO\b/.test(u)) {
      header.forca = text;
      skipIndices.add(i);
    } else if (/^FOLHAS? DE ALTERACOES\b/.test(u)) {
      header.tituloDocumento = text;
      skipIndices.add(i);
    } else if (/^GUARNICAO\b/.test(u)) {
      header.guarnicao = text;
      skipIndices.add(i);
    } else if (isFolhaNumberLine(text)) {
      const m = text.match(/(\d+)/);
      if (m && header.folhaInicial === undefined) {
        header.folhaInicial = Math.max(1, parseInt(m[1], 10));
      }
      skipIndices.add(i);
    } else if (/^CML\b|\b\d+ª\s*DE\b/.test(text) && !isEntryStartLine(text)) {
      header.comandoDivisao = text;
      skipIndices.add(i);
    } else if (/\bBDA\b|\bGUES\b/.test(u) && !isEntryStartLine(text)) {
      header.grandeUnidade = text;
      skipIndices.add(i);
    } else if (
      /\b\d{5,6}\b/.test(text) &&
      /\b(BI|OM|ES|BEC|GAC|RC|MEC)\b/i.test(text) &&
      text.length < 45
    ) {
      header.omCodom = text;
      skipIndices.add(i);
    } else if (/^NOME\s*:/i.test(text)) {
      const val = text.replace(/^NOME\s*:\s*/i, '').trim();
      if (val) header.nomeCompleto = val;
      if (boldSubstring && val.toUpperCase().includes(boldSubstring.toUpperCase())) {
        header.nomeGuerra = boldSubstring;
      }
      skipIndices.add(i);
    } else if (/^POSTO\s*\/?\s*GRADUA[ÇC][ÃA]O\s*:/i.test(text)) {
      const val = text.replace(/^POSTO\s*\/?\s*GRADUA[ÇC][ÃA]O\s*:\s*/i, '').trim();
      if (val) header.postoGraduacao = val;
      skipIndices.add(i);
    } else if (/^QAS\s*\/?\s*QMS\s*:/i.test(text)) {
      const val = text.replace(/^QAS\s*\/?\s*QMS\s*:\s*/i, '').trim();
      if (val) header.qasQms = val;
      skipIndices.add(i);
    } else if (/^IDENTIDADE\s*:/i.test(text)) {
      const val = text.replace(/^IDENTIDADE\s*:\s*/i, '').trim();
      const splitPeriodo = val.match(/^(.+?)\s+PER[ÍI]ODO\s*:\s*(.+)$/i);
      if (splitPeriodo) {
        header.identidade = splitPeriodo[1].trim();
        header.periodo = splitPeriodo[2].trim();
      } else if (val) {
        header.identidade = val;
      }
      skipIndices.add(i);
    } else if (isSemestreLine(text)) {
      header.semestre = text;
      skipIndices.add(i);
    } else if (isPeriodoLine(text)) {
      const val = text.replace(/^PER[ÍI]ODO\s*:\s*/i, '').trim();
      if (val) header.periodo = val;
      skipIndices.add(i);
    } else if (bodyStartIdx > 0 && i < bodyStartIdx) {
      skipIndices.add(i);
    }
  }

  // Filter skipped lines & merge consecutive tables of matching column count (split across PDF page breaks)
  const rawBodyLines: RawAlteracaoLine[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    if (skipIndices.has(i)) continue;
    const item = rawLines[i];
    if (!item.tableRows) {
      const t = item.text;
      if (isFolhaNumberLine(t) || isSemestreLine(t) || isPeriodoLine(t)) continue;
      if (header.omExtenso && stripDiacriticsUpper(t) === stripDiacriticsUpper(header.omExtenso)) {
        continue;
      }
    }
    rawBodyLines.push(item);
  }

  const bodyLines: RawAlteracaoLine[] = [];
  const normalizeRowSig = (row?: string[]) =>
    (row || []).map((c) => stripDiacriticsUpper(cleanInlineWhitespace(c))).join('|');

  for (const line of rawBodyLines) {
    const prev = bodyLines[bodyLines.length - 1];
    if (
      line.tableRows &&
      line.tableRows.length > 0 &&
      prev?.tableRows &&
      prev.tableRows.length > 0 &&
      line.tableRows[0]?.length === prev.tableRows[0]?.length
    ) {
      const incomingRows =
        line.tableRows.length > 1 &&
        normalizeRowSig(line.tableRows[0]) === normalizeRowSig(prev.tableRows[0])
          ? line.tableRows.slice(1)
          : line.tableRows;
      prev.tableRows = [...prev.tableRows, ...incomingRows];
    } else {
      bodyLines.push(line.tableRows ? { ...line, tableRows: [...line.tableRows] } : line);
    }
  }

  return { extractedHeader: header, bodyLines };
}

const PT_MONTHS_LONG = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

export function formatPtBrDateLong(isoDateStr: string): string {
  const m = isoDateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const year = parseInt(m[1], 10);
  const monthIdx = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  if (monthIdx < 0 || monthIdx > 11 || day < 1 || day > 31) return '';
  return `${day} de ${PT_MONTHS_LONG[monthIdx]} de ${year}`;
}

export interface ServiceTimeResult {
  years: number;
  months: number;
  days: number;
  formatted: string;
}

export function calculateServiceTime(
  startDateIso: string,
  endDateIso: string
): ServiceTimeResult | null {
  const sm = startDateIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const em = endDateIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!sm || !em) return null;

  const sy = parseInt(sm[1], 10);
  const smo = parseInt(sm[2], 10);
  const sd = parseInt(sm[3], 10);

  const ey = parseInt(em[1], 10);
  const emo = parseInt(em[2], 10);
  const ed = parseInt(em[3], 10);

  if (sy < 1950 || sy > 2100 || ey < 1950 || ey > 2100) return null;

  const startMs = Date.UTC(sy, smo - 1, sd);
  const endMs = Date.UTC(ey, emo - 1, ed);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return null;

  let years = ey - sy;
  let months = emo - smo;
  let days = ed - sd;

  if (days < 0) {
    const prevMonthDays = new Date(ey, emo - 1, 0).getDate();
    days += prevMonthDays;
    months -= 1;
  }
  if (months < 0) {
    months += 12;
    years -= 1;
  }

  const pad2 = (n: number) => String(Math.max(0, n)).padStart(2, '0');
  return {
    years,
    months,
    days,
    formatted: `${pad2(years)} a ${pad2(months)} m ${pad2(days)} d`,
  };
}

const PART2_TIME_ONLY_RE = /^\s*(\d{1,2})\s*a\s*(\d{1,2})\s*m\s*(\d{1,2})\s*d\s*$/i;
const PART2_ITEM_WITH_TIME_RE =
  /^([1-5]\.|[a-b]\.)\s*(.+?)\s*(?:[.\s]+)?(\d{1,2}\s*a\s*\d{1,2}\s*m\s*\d{1,2}\s*d)\s*$/i;
const PART2_ITEM_LABEL_ONLY_RE = /^([1-5]\.|[a-b]\.)\s*(.+?)\s*[.\s]*$/i;

function normalizeTimeValueStr(raw: string): string {
  const m = raw.match(/(\d{1,2})\s*a\s*(\d{1,2})\s*m\s*(\d{1,2})\s*d/i);
  if (!m) return '00 a 00 m 00 d';
  return `${m[1].padStart(2, '0')} a ${m[2].padStart(2, '0')} m ${m[3].padStart(2, '0')} d`;
}

function estimateTimesNewRomanWidthPx(text: string): number {
  let w = 0;
  for (const ch of text) {
    if (ch === ' ') w += 3.5;
    else if (ch === '.' || ch === ',' || ch === ':' || ch === ';') w += 3.4;
    else if (/[iljIft\|]/.test(ch)) w += 4.1;
    else if (/[mwMW]/.test(ch)) w += 10.6;
    else if (/[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(ch)) w += 9.1;
    else if (/[0-9]/.test(ch)) w += 7.0;
    else w += 6.5;
  }
  return w;
}

export function formatPart2DotRow(labelWithPrefix: string, timeValue: string): string {
  const cleanLabel = cleanInlineWhitespace(labelWithPrefix).replace(/[.\s]+$/, '');
  const cleanValue = normalizeTimeValueStr(timeValue);
  const targetWidthPx = 618;
  const usedWidthPx =
    estimateTimesNewRomanWidthPx(cleanLabel) + estimateTimesNewRomanWidthPx(cleanValue);
  const dotCount = Math.max(4, Math.round((targetWidthPx - usedWidthPx) / 3.45));
  return `${cleanLabel}${'.'.repeat(dotCount)}${cleanValue}`;
}

function isPart2CenteredFooterTrigger(line: string): boolean {
  const clean = cleanInlineWhitespace(line);
  if (!clean) return false;
  if (/^Quartel\b/i.test(clean)) return true;
  if (/,\s*\d{1,2}\s+de\s+[a-zç]+\s+de\s+\d{4}\.?$/i.test(clean)) return true;
  if (/^[_\-–—]{5,}$/.test(clean)) return true;
  if (/^(CMT|COMANDANTE|SUBCMT|CHEFE|ENC)\b/i.test(clean)) return true;
  return false;
}

export function normalizePart2Lines(
  rawPart2Lines: string[],
  boldSubstrings?: Record<number, string>
): {
  lines: string[];
  boldByIdx: Record<number, string>;
} {
  const merged: { text: string; bold?: string }[] = [];

  for (let i = 0; i < rawPart2Lines.length; i++) {
    const text = cleanInlineWhitespace(rawPart2Lines[i]);
    if (!text) continue;
    const bold = boldSubstrings?.[i];

    const labelOnlyMatch = text.match(PART2_ITEM_LABEL_ONLY_RE);
    const nextText = i + 1 < rawPart2Lines.length ? cleanInlineWhitespace(rawPart2Lines[i + 1]) : '';
    if (
      labelOnlyMatch &&
      !PART2_ITEM_WITH_TIME_RE.test(text) &&
      PART2_TIME_ONLY_RE.test(nextText)
    ) {
      merged.push({
        text: `${labelOnlyMatch[1]} ${labelOnlyMatch[2].replace(/[.\s]+$/, '')} ${nextText}`,
        bold,
      });
      i++;
      continue;
    }

    merged.push({ text, bold });
  }

  const lines: string[] = [];
  const boldByIdx: Record<number, string> = {};

  merged.forEach((entry, idx) => {
    let line = entry.text;
    if (idx === 0 && isPart2Line(line)) {
      line = '2ª PARTE';
    } else {
      const m = line.match(PART2_ITEM_WITH_TIME_RE);
      if (m) {
        const prefix = m[1];
        const label = `${prefix} ${m[2].replace(/[.\s]+$/, '')}`;
        let val = normalizeTimeValueStr(m[3]);
        // Standardize item 1 (TC) & sub-item a (Arregimentado) to 06 months per semester standard
        if (prefix === '1.' || prefix.toLowerCase() === 'a.') {
          val = '00 a 06 m 00 d';
        }
        line = formatPart2DotRow(label, val);
      } else if (/^[_\-–—]{5,}$/.test(line)) {
        line = '_________________________________________';
      }
    }
    const outIdx = lines.length;
    lines.push(line);
    if (entry.bold) {
      boldByIdx[outIdx] = entry.bold;
    }
  });

  return { lines, boldByIdx };
}

export function applyServiceTimeToPart2Lines(
  existingPart2Lines: string[],
  serviceTimeFormatted: string,
  options?: {
    datePtBr?: string;
    guarnicao?: string;
  }
): string[] {
  const dateLabel =
    options?.datePtBr || formatPtBrDateLong(new Date().toISOString().slice(0, 10));

  if (existingPart2Lines.length === 0) {
    return [
      '2ª PARTE',
      formatPart2DotRow('1. TEMPO COMPUTADO DE EFETIVO SERVIÇO (TC)', '00 a 06 m 00 d'),
      formatPart2DotRow('a. Arregimentado', '00 a 06 m 00 d'),
      formatPart2DotRow('b. Não Arregimentado', '00 a 00 m 00 d'),
      formatPart2DotRow('2. TEMPO NÃO COMPUTADO (TNC)', '00 a 00 m 00 d'),
      formatPart2DotRow('3. TEMPO DE SERVIÇO COMPUTÁVEL PARA MEDALHA MILITAR', serviceTimeFormatted),
      formatPart2DotRow('4. TEMPO DE SERVIÇO NACIONAL RELEVANTE (TSNR)', '00 a 00 m 00 d'),
      formatPart2DotRow('5. TEMPO TOTAL DE EFETIVO SERVIÇO (TTES)', serviceTimeFormatted),
      `Quartel da Vila Militar, Rio de Janeiro, RJ, ${dateLabel}`,
      '_________________________________________',
      'ADRIANO CAMPOS NOBRE – 2º Ten',
      'CMT CIA C Ap',
    ];
  }

  const normalized = normalizePart2Lines(existingPart2Lines);
  let hasItem3 = false;
  let hasItem5 = false;

  const updated = normalized.lines.map((line) => {
    const m = line.match(PART2_ITEM_WITH_TIME_RE);
    if (!m) return line;
    const prefix = m[1];
    const label = `${prefix} ${m[2].replace(/[.\s]+$/, '')}`;

    if (prefix === '1.' || prefix.toLowerCase() === 'a.') {
      return formatPart2DotRow(label, '00 a 06 m 00 d');
    }
    if (prefix === '3.') {
      hasItem3 = true;
      return formatPart2DotRow(label, serviceTimeFormatted);
    }
    if (prefix === '5.') {
      hasItem5 = true;
      return formatPart2DotRow(label, serviceTimeFormatted);
    }
    return formatPart2DotRow(label, m[3]);
  });

  if (!hasItem3) {
    const insertAt = updated.findIndex((l) => /^4\./.test(l));
    const row3 = formatPart2DotRow(
      '3. TEMPO DE SERVIÇO COMPUTÁVEL PARA MEDALHA MILITAR',
      serviceTimeFormatted
    );
    if (insertAt >= 0) updated.splice(insertAt, 0, row3);
    else updated.push(row3);
  }
  if (!hasItem5) {
    const insertAt = updated.findIndex((l) => isPart2CenteredFooterTrigger(l));
    const row5 = formatPart2DotRow(
      '5. TEMPO TOTAL DE EFETIVO SERVIÇO (TTES)',
      serviceTimeFormatted
    );
    if (insertAt >= 0) updated.splice(insertAt, 0, row5);
    else updated.push(row5);
  }

  return updated;
}

/**
 * Renders standardized HTML blocks from a StructuredAlteracaoDoc filtered by enabledItemIds.
 * Used both on initial formatting AND reactively whenever checkboxes are toggled.
 */
export function renderBlocksFromStructuredDoc(
  doc: StructuredAlteracaoDoc,
  enabledIds?: ReadonlySet<string>,
  options: FormatAlteracaoOptions = {}
): {
  blocks: AlteracaoHtmlBlock[];
  html: string;
  entriesCount: number;
  tablesCount: number;
  monthsCount: number;
} {
  const effectiveSemestre = options.preferOptionSemester
    ? options.semestre || doc.extractedHeader.semestre
    : doc.extractedHeader.semestre || options.semestre;
  const effectivePeriodo = options.preferOptionSemester
    ? options.periodo || doc.extractedHeader.periodo
    : doc.extractedHeader.periodo || options.periodo;

  const monthsWithItems = new Set(doc.items.map((item) => item.month));
  const activeMonthsSource =
    monthsWithItems.size > 0 ? Array.from(monthsWithItems) : doc.monthOrder;
  const docOnlyFirstHalf =
    activeMonthsSource.length > 0 && activeMonthsSource.every((m) => FIRST_HALF_MONTHS.has(m));
  const docOnlySecondHalf =
    activeMonthsSource.length > 0 && activeMonthsSource.every((m) => SECOND_HALF_MONTHS.has(m));

  let semesterMonths = inferSemesterMonths(effectiveSemestre, effectivePeriodo);
  if (!options.preferOptionSemester) {
    if (docOnlySecondHalf && (!semesterMonths || semesterMonths[0] === 'JANEIRO')) {
      semesterMonths = MONTHS_UPPER.slice(6, 12);
    } else if (docOnlyFirstHalf && (!semesterMonths || semesterMonths[0] === 'JULHO')) {
      semesterMonths = MONTHS_UPPER.slice(0, 6);
    }
  }

  const shouldFill = options.fillSemesterMonths !== false;

  const finalMonths: string[] = [];
  if (shouldFill && semesterMonths) {
    for (const m of semesterMonths) finalMonths.push(m);
    for (const m of doc.monthOrder) {
      if (!finalMonths.includes(m) && monthsWithItems.has(m)) {
        finalMonths.push(m);
      }
    }
  } else {
    for (const m of doc.monthOrder) finalMonths.push(m);
    if (finalMonths.length === 0 && semesterMonths) {
      for (const m of semesterMonths) finalMonths.push(m);
    }
  }

  const blocks: AlteracaoHtmlBlock[] = [];
  const spacer = (): AlteracaoHtmlBlock => ({ html: '<p><br></p>', isSpacer: true });

  blocks.push({ html: '<p>1ª PARTE:</p>', keepWithNext: true });
  blocks.push(spacer());

  let totalEntries = 0;
  let totalTables = 0;

  finalMonths.forEach((monthName, monthIdx) => {
    if (monthIdx > 0) {
      blocks.push(spacer());
    }

    blocks.push({ html: `<p>${escapeAlteracaoHtml(monthName)}:</p>`, keepWithNext: true });
    blocks.push(spacer());

    const activeMonthItems = doc.items.filter(
      (item) =>
        item.month === monthName && (!enabledIds || enabledIds.has(item.id))
    );

    if (activeMonthItems.length === 0) {
      blocks.push({ html: '<p>- <u>Sem Alteração</u></p>' });
      return;
    }

    // Group items by normalized title within the month (preserving first-seen title order)
    const groupOrder: string[] = [];
    const groups = new Map<
      string,
      { displayTitle: string; items: ParsedAlteracaoSectionItem[] }
    >();

    for (const item of activeMonthItems) {
      const hasContent =
        item.kind === 'table'
          ? Boolean(item.tableRows && item.tableRows.length > 0)
          : item.paragraphs.length > 0;
      if (!hasContent) continue;

      const key = stripDiacriticsUpper(item.title);
      let grp = groups.get(key);
      if (!grp) {
        grp = { displayTitle: item.title, items: [] };
        groups.set(key, grp);
        groupOrder.push(key);
      }
      grp.items.push(item);
    }

    if (groupOrder.length === 0) {
      blocks.push({ html: '<p>- <u>Sem Alteração</u></p>' });
      return;
    }

    groupOrder.forEach((key, gIdx) => {
      const grp = groups.get(key)!;
      if (gIdx > 0) {
        blocks.push(spacer());
      }

      const groupKey = `${monthName}::${grp.displayTitle.toUpperCase()}`;

      // Print Title ONCE in bold
      blocks.push({
        html: `<p data-alt-group="${escapeAlteracaoHtml(groupKey)}"><strong>${escapeAlteracaoHtml(grp.displayTitle)}</strong></p>`,
        keepWithNext: true,
      });

      let lastRenderedSubtitleKey = '';

      grp.items.forEach((item, itemIdx) => {
        const subKey = stripDiacriticsUpper(item.subtitle);
        const sameSubtitleAsPrevTableContinuation =
          item.kind === 'table' &&
          itemIdx > 0 &&
          subKey === lastRenderedSubtitleKey;

        let itemAnchorAssigned = false;
        const itemAttr = ` data-alt-item="${escapeAlteracaoHtml(item.id)}"`;

        if (!sameSubtitleAsPrevTableContinuation) {
          if (itemIdx === 0) {
            if (item.subtitle) {
              const attr = item.kind === 'entry' ? itemAttr : '';
              if (attr) itemAnchorAssigned = true;
              blocks.push({
                html: `<p${attr}><strong>${escapeAlteracaoHtml(item.subtitle)}</strong></p>`,
                keepWithNext: true,
              });
            }
            blocks.push(spacer());
          } else {
            blocks.push(spacer());
            if (item.subtitle) {
              const attr = item.kind === 'entry' ? itemAttr : '';
              if (attr) itemAnchorAssigned = true;
              blocks.push({
                html: `<p${attr}><strong>${escapeAlteracaoHtml(item.subtitle)}</strong></p>`,
                keepWithNext: true,
              });
            }
          }
        } else {
          blocks.push(spacer());
        }

        lastRenderedSubtitleKey = subKey;

        if (item.kind === 'table' && item.tableRows) {
          const { rowsHtml, colgroupHtml, headerRowHtml } = tableMatrixToParts(item.tableRows);
          if (rowsHtml.length > 0) {
            totalTables++;
            blocks.push({
              html: buildAlteracaoTableHtml(rowsHtml, item.id, colgroupHtml),
              tableMeta: { rowsHtml, colgroupHtml, headerRowHtml, itemId: item.id },
            });
          }
        } else {
          item.paragraphs.forEach((para, pIdx) => {
            totalEntries++;
            const attr = !itemAnchorAssigned && pIdx === 0 ? itemAttr : '';
            if (attr) itemAnchorAssigned = true;
            blocks.push({ html: `<p${attr}>${escapeAlteracaoHtml(para)}</p>` });
          });
        }
      });
    });
  });

  if (doc.part2Lines.length > 0) {
    const { lines: normalizedPart2, boldByIdx } = normalizePart2Lines(
      doc.part2Lines,
      doc.part2BoldSubstrings
    );

    const pushSpacerIfNeeded = () => {
      if (blocks.length > 0 && !blocks[blocks.length - 1].isSpacer) {
        blocks.push(spacer());
      }
    };

    const formatLineWithBold = (lineText: string, boldSub?: string): string => {
      if (!boldSub) return escapeAlteracaoHtml(lineText);
      const upperIdx = lineText.toUpperCase().indexOf(boldSub.toUpperCase());
      if (upperIdx === -1) return escapeAlteracaoHtml(lineText);
      const before = escapeAlteracaoHtml(lineText.slice(0, upperIdx));
      const mid = escapeAlteracaoHtml(lineText.slice(upperIdx, upperIdx + boldSub.length));
      const after = escapeAlteracaoHtml(lineText.slice(upperIdx + boldSub.length));
      return `${before}<strong>${mid}</strong>${after}`;
    };

    pushSpacerIfNeeded();
    let inCenteredFooter = false;
    let addedSigSpacer = false;

    normalizedPart2.forEach((line, idx) => {
      if (idx === 0) {
        blocks.push({
          html: `<p data-alt-part2="true">${escapeAlteracaoHtml(line || '2ª PARTE')}</p>`,
          keepWithNext: true,
        });
        blocks.push(spacer());
        return;
      }

      if (!inCenteredFooter && isPart2CenteredFooterTrigger(line)) {
        inCenteredFooter = true;
        pushSpacerIfNeeded();
      }

      if (inCenteredFooter) {
        if (/^[_\-–—]{5,}$/.test(line) && !addedSigSpacer) {
          pushSpacerIfNeeded();
          addedSigSpacer = true;
        }
        blocks.push({
          html: `<p style="text-align:center;">${formatLineWithBold(line, boldByIdx[idx])}</p>`,
        });
        return;
      }

      // Add vertical spacing between items 1, b., 2, 3, 4, and 5
      if (/^(?:b\.|[2-5]\.)\s*/i.test(line)) {
        pushSpacerIfNeeded();
      }

      blocks.push({ html: `<p>${formatLineWithBold(line, boldByIdx[idx])}</p>` });
    });
  }

  return {
    blocks,
    html: blocks.map((b) => b.html).join('\n'),
    entriesCount: totalEntries,
    tablesCount: totalTables,
    monthsCount: finalMonths.length,
  };
}

/**
 * Formats raw alteration lines into a standardized StructuredAlteracaoDoc and HTML blocks.
 */
export function formatAlteracaoLinesToBlocks(
  rawLines: RawAlteracaoLine[],
  options: FormatAlteracaoOptions = {}
): FormattedAlteracaoResult {
  const { extractedHeader, bodyLines } = extractHeaderAndBodyLines(rawLines);

  const effectiveSemestre = options.preferOptionSemester
    ? options.semestre || extractedHeader.semestre
    : extractedHeader.semestre || options.semestre;
  const effectivePeriodo = options.preferOptionSemester
    ? options.periodo || extractedHeader.periodo
    : extractedHeader.periodo || options.periodo;

  const items: ParsedAlteracaoSectionItem[] = [];
  const monthOrder: string[] = [];
  const part2Lines: string[] = [];
  const part2BoldSubstrings: Record<number, string> = {};

  const registerMonth = (month: string): string => {
    if (!monthOrder.includes(month)) {
      monthOrder.push(month);
    }
    return month;
  };

  let currentMonthName: string | null = null;
  let lastTitleInMonth = '';
  let lastKnownTitleOverall = '';
  let currentTitle = '';
  let currentSubtitle = '';
  let currentEntryItem: ParsedAlteracaoSectionItem | null = null;
  let inPart2 = false;
  let itemSeq = 0;

  const getActiveMonth = (): string => {
    if (currentMonthName) return currentMonthName;
    const fallbackMonths = inferSemesterMonths(effectiveSemestre, effectivePeriodo);
    currentMonthName = registerMonth(fallbackMonths ? fallbackMonths[0] : 'JANEIRO');
    return currentMonthName;
  };

  const resolveActiveTitle = (): string => {
    if (currentTitle && !isNonTitleTopic(currentTitle)) return currentTitle;
    if (lastTitleInMonth && !isNonTitleTopic(lastTitleInMonth)) return lastTitleInMonth;
    if (lastKnownTitleOverall && !isNonTitleTopic(lastKnownTitleOverall)) {
      return lastKnownTitleOverall;
    }
    return 'ALTERAÇÕES DE SUBTENENTES E SARGENTOS';
  };

  const ensureCurrentEntryItem = (): ParsedAlteracaoSectionItem => {
    const month = getActiveMonth();
    const title = resolveActiveTitle();
    const subtitle = currentSubtitle;

    if (
      currentEntryItem &&
      currentEntryItem.kind === 'entry' &&
      currentEntryItem.month === month &&
      currentEntryItem.title === title &&
      currentEntryItem.subtitle === subtitle &&
      currentEntryItem.paragraphs.length === 0
    ) {
      return currentEntryItem;
    }

    const newItem: ParsedAlteracaoSectionItem = {
      id: `item-${itemSeq++}`,
      kind: 'entry',
      month,
      title,
      subtitle,
      previewLabel: subtitle || title,
      paragraphs: [],
    };
    items.push(newItem);
    currentEntryItem = newItem;
    return newItem;
  };

  for (let i = 0; i < bodyLines.length; i++) {
    const raw = bodyLines[i];

    // Structured data table inside body
    if (raw.tableRows && raw.tableRows.length > 0) {
      const month = getActiveMonth();
      const title = resolveActiveTitle();
      const subtitle = currentSubtitle;
      const rows = raw.tableRows;
      const firstCellPreview =
        rows[0]
          ?.filter((c) => cleanInlineWhitespace(c).length > 0)
          .slice(0, 3)
          .join(' · ') || 'Tabela';
      const cols = Math.max(...rows.map((r) => r.length));

      items.push({
        id: `item-${itemSeq++}`,
        kind: 'table',
        month,
        title,
        subtitle,
        previewLabel: `Tabela (${rows.length}×${cols}): ${firstCellPreview}`.slice(0, 80),
        paragraphs: [],
        tableRows: rows,
      });
      currentEntryItem = null;
      continue;
    }

    const text = cleanInlineWhitespace(raw.text);
    if (!text) continue;

    if (inPart2) {
      const pIdx = part2Lines.length;
      part2Lines.push(text);
      if (raw.boldSubstring) {
        part2BoldSubstrings[pIdx] = raw.boldSubstring;
      }
      continue;
    }

    if (isPart1Line(text)) {
      continue;
    }

    if (isPart2Line(text)) {
      inPart2 = true;
      part2Lines.push('2ª PARTE');
      continue;
    }

    const maybeMonth = normalizeMonthHeading(text);
    if (maybeMonth) {
      currentMonthName = registerMonth(maybeMonth);
      lastTitleInMonth = '';
      currentTitle = '';
      currentSubtitle = '';
      currentEntryItem = null;
      continue;
    }

    if (isSemAlteracaoLine(text)) {
      getActiveMonth();
      currentEntryItem = null;
      continue;
    }

    const lastPara =
      currentEntryItem && currentEntryItem.paragraphs.length > 0
        ? currentEntryItem.paragraphs[currentEntryItem.paragraphs.length - 1]
        : '';
    const prevParaEndedSentence = !lastPara || /[.;!?]$/.test(lastPara);
    const prevParaEndsColon = /:$/.test(lastPara);

    const nextLine = i + 1 < bodyLines.length ? bodyLines[i + 1] : undefined;

    // 0. Guard: standalone "Férias" / "FÉRIAS" line is ALWAYS subtitle, NEVER title
    if (isNonTitleTopic(text) && !isEntryStartLine(text)) {
      const parentTitle = resolveActiveTitle();
      currentTitle = parentTitle;
      lastTitleInMonth = parentTitle;
      lastKnownTitleOverall = parentTitle;
      currentEntryItem = null;

      if (
        nextLine &&
        !nextLine.tableRows &&
        !isEntryStartLine(nextLine.text) &&
        !isSemAlteracaoLine(nextLine.text) &&
        !normalizeMonthHeading(nextLine.text) &&
        !isPart2Line(nextLine.text) &&
        !/[.;!?]$/.test(nextLine.text) &&
        nextLine.text.length <= 140
      ) {
        currentSubtitle = `${normalizeFeriasPrefix(text)} - ${cleanInlineWhitespace(nextLine.text)}`;
        i++;
      } else {
        currentSubtitle = normalizeFeriasPrefix(text);
      }
      continue;
    }

    // 1. Check "TÍTULO - Subtítulo" on single line
    const splitDash = splitTitleSubtitleDash(
      text,
      prevParaEndedSentence && !prevParaEndsColon
    );
    if (splitDash) {
      if (splitDash.isSubtitleOnly || !splitDash.title) {
        const parentTitle = resolveActiveTitle();
        currentTitle = parentTitle;
        lastTitleInMonth = parentTitle;
        lastKnownTitleOverall = parentTitle;
        currentSubtitle = splitDash.subtitle;
      } else {
        currentTitle = splitDash.title;
        lastTitleInMonth = splitDash.title;
        lastKnownTitleOverall = splitDash.title;
        currentSubtitle = splitDash.subtitle;
      }
      currentEntryItem = null;
      continue;
    }

    // 2. Check already-split Bold/Uppercase Title line (e.g., "INSTRUÇÃO" followed by "Instrução de Quadros")
    const isStandaloneUpper =
      (raw.isBold || (prevParaEndedSentence && !prevParaEndsColon)) &&
      isUppercaseHeadingCandidate(text);

    if (isStandaloneUpper) {
      currentTitle = text.toUpperCase();
      lastTitleInMonth = currentTitle;
      lastKnownTitleOverall = currentTitle;
      currentSubtitle = '';
      currentEntryItem = null;

      if (
        nextLine &&
        !nextLine.tableRows &&
        !isEntryStartLine(nextLine.text) &&
        !isSemAlteracaoLine(nextLine.text) &&
        !normalizeMonthHeading(nextLine.text) &&
        !isPart2Line(nextLine.text) &&
        !isUppercaseHeadingCandidate(nextLine.text) &&
        !/[.;!?]$/.test(nextLine.text) &&
        nextLine.text.length <= 140
      ) {
        currentSubtitle = cleanInlineWhitespace(nextLine.text);
        i++;
      }
      continue;
    }

    // 3. Check standalone bold Subtitle (or plain-text subtitle right before an entry start)
    if (
      !isEntryStartLine(text) &&
      !isSemAlteracaoLine(text) &&
      !/[.;!?]$/.test(text) &&
      text.length <= 140 &&
      (lastTitleInMonth || lastKnownTitleOverall) &&
      (raw.isBold ||
        (prevParaEndedSentence &&
          !prevParaEndsColon &&
          nextLine &&
          !nextLine.tableRows &&
          isEntryStartLine(nextLine.text)))
    ) {
      const parentTitle = resolveActiveTitle();
      currentTitle = parentTitle;
      lastTitleInMonth = parentTitle;
      currentSubtitle = text;
      currentEntryItem = null;
      continue;
    }

    // 4. Entry paragraph starting with "- ..."
    if (isEntryStartLine(text)) {
      const normalized = normalizeEntryColon(text);
      currentEntryItem = ensureCurrentEntryItem();
      currentEntryItem.paragraphs.push(normalized);
      if (currentEntryItem.paragraphs.length === 1) {
        currentEntryItem.previewLabel =
          currentEntryItem.subtitle || normalized.slice(0, 70);
      }
      continue;
    }

    // 5. Standalone ":" line left over from PDF extraction -> attach without space
    if (text === ':' && currentEntryItem && currentEntryItem.paragraphs.length > 0) {
      const idx = currentEntryItem.paragraphs.length - 1;
      currentEntryItem.paragraphs[idx] = currentEntryItem.paragraphs[idx].replace(/\s*:?\s*$/, ':');
      continue;
    }

    // 6. Continuation line right after "- a 14, BI Nº 31:" OR wrapped PDF sentence line
    if (currentEntryItem && currentEntryItem.paragraphs.length > 0) {
      const idx = currentEntryItem.paragraphs.length - 1;
      const prev = currentEntryItem.paragraphs[idx];
      const cleanedCont = text.replace(/([0-9º°ª\)])\s+:(?=\s|$)/g, '$1:');
      if (/^:\s*/.test(cleanedCont)) {
        const afterColon = cleanedCont.replace(/^:\s*/, '');
        const trimmedPrev = prev.replace(/\s*:?\s*$/, ':');
        currentEntryItem.paragraphs[idx] = afterColon ? `${trimmedPrev} ${afterColon}` : trimmedPrev;
      } else if (/:$/.test(prev)) {
        currentEntryItem.paragraphs[idx] = `${prev.replace(/\s+:$/, ':')} ${cleanedCont}`;
      } else if (!/[.;!?]$/.test(prev)) {
        currentEntryItem.paragraphs[idx] = `${prev} ${cleanedCont}`;
      } else {
        currentEntryItem.paragraphs.push(normalizeEntryColon(cleanedCont));
      }
      continue;
    }

    // Fallback: orphan line before any "- " bullet inside a section
    currentEntryItem = ensureCurrentEntryItem();
    const norm = normalizeEntryColon(text);
    currentEntryItem.paragraphs.push(norm);
    currentEntryItem.previewLabel = currentEntryItem.subtitle || norm.slice(0, 70);
  }

  const structuredDoc: StructuredAlteracaoDoc = {
    items,
    monthOrder,
    part2Lines,
    part2BoldSubstrings:
      Object.keys(part2BoldSubstrings).length > 0 ? part2BoldSubstrings : undefined,
    extractedHeader,
  };

  const rendered = renderBlocksFromStructuredDoc(structuredDoc, undefined, options);

  return {
    blocks: rendered.blocks,
    html: rendered.html,
    extractedHeader,
    structuredDoc,
    stats: {
      monthsCount: rendered.monthsCount,
      entriesCount: rendered.entriesCount,
      tablesCount: rendered.tablesCount,
    },
  };
}

export function formatAlteracaoHtmlOrText(
  input: string,
  options: FormatAlteracaoOptions = {}
): FormattedAlteracaoResult {
  const looksLikeHtml = /<(p|div|br|strong|b|u|table|tr|td|th)\b/i.test(input);
  const rawLines = looksLikeHtml
    ? htmlToRawAlteracaoLines(input)
    : plainTextToRawAlteracaoLines(input);
  return formatAlteracaoLinesToBlocks(rawLines, options);
}
