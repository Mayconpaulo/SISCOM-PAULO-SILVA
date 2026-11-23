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
  tableItemId?: string;
  /** True when the source document explicitly broke the line after this line (short PDF line before right margin, vertical paragraph gap, or explicit DOCX/HTML paragraph/br). */
  hardBreakAfter?: boolean;
  /** True when this line explicitly starts a new line/paragraph (e.g., first-line indent or explicit break). */
  hardBreakBefore?: boolean;
  /** Optional PDF geometry for cross-page wrap analysis after continuation headers are stripped. */
  pdfXStart?: number;
  pdfXEnd?: number;
  pdfRightMargin?: number;
  pdfFirstWordWidth?: number;
  /** True when this line was the last line on its source page before a page break. */
  crossPageAfter?: boolean;
  /** True when a continuation header/footer was stripped immediately before this body line. */
  skippedHeaderBefore?: boolean;
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
  atomicGroupId?: string;
  preserveIfSpacer?: boolean;
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
  /** When true, continues immediately below the previous item (e.g., Observações after a DCEM table) without re-printing the bold subtitle. */
  continueWithoutSubtitle?: boolean;
}

export interface ComportamentoDocLine {
  text: string;
  isBold?: boolean;
}

export interface StructuredAlteracaoDoc {
  items: ParsedAlteracaoSectionItem[];
  monthOrder: string[];
  comportamentoLines?: ComportamentoDocLine[];
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
    colWeights.push(Math.max(3, Math.min(65, p85)));
  }

  const totalWeight = colWeights.reduce((a, b) => a + b, 0) || numCols;
  const rawPercents = colWeights.map((w) => (w / totalWeight) * 100);
  const minPct = Math.min(8, Math.floor(55 / numCols));
  const maxPct = numCols === 2 ? 82 : numCols === 3 ? 72 : 65;
  const clamped = rawPercents.map((p) => Math.max(minPct, Math.min(maxPct, p)));
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

  const extractYearFromText = (text?: string): string | undefined => {
    if (!text) return undefined;
    const fourDigit = text.match(/\b(20\d{2}|19\d{2})\b/)?.[1];
    if (fourDigit) return fourDigit;
    const slashTwoDigit = text.match(/\b\d{1,2}\/\d{1,2}\/(\d{2})\b/)?.[1];
    if (slashTwoDigit) {
      const n = parseInt(slashTwoDigit, 10);
      return String(n <= 50 ? 2000 + n : 1900 + n);
    }
    const trailingTwoDigit = text.match(/(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)[A-ZÇ]*\s*(?:DE\s*)?(\d{2})\b/i)?.[1];
    if (trailingTwoDigit) {
      const n = parseInt(trailingTwoDigit, 10);
      return String(n <= 50 ? 2000 + n : 1900 + n);
    }
    const deTwoDigit = text.match(/\bDE\s+(\d{2})\b/i)?.[1];
    if (deTwoDigit) {
      const n = parseInt(deTwoDigit, 10);
      return String(n <= 50 ? 2000 + n : 1900 + n);
    }
    return undefined;
  };

  const yearFromPeriodo = extractYearFromText(periodo);
  const yearFromSemestre = extractYearFromText(semestre);
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

export function isComportamentoHeadingLine(text: string): boolean {
  const u = stripDiacriticsUpper(cleanInlineWhitespace(text))
    .replace(/^[-–—•*\s]+/, '')
    .replace(/[:.\-–—\s]+$/, '');
  return (
    u === 'COMPORTAMENTO' ||
    u === 'COMPORTAMENTO MILITAR' ||
    u === 'CLASSIFICACAO DE COMPORTAMENTO' ||
    u === 'CLASSIFICACAO DO COMPORTAMENTO'
  );
}

export function isComportamentoInlineLine(text: string): boolean {
  const clean = cleanInlineWhitespace(text);
  return /^(?:[-–—]\s*)?(?:CLASSIFICA[ÇC][ÃA]O\s+D[EO]\s+)?COMPORTAMENTO(?:\s+MILITAR)?\s*[:\-–—]\s*\S+/i.test(
    clean
  );
}

export function isComportamentoStatementLine(text: string): boolean {
  const clean = cleanInlineWhitespace(text);
  if (!clean || clean.length > 220) return false;
  // Never hijack a dated BI publication line like "- a 14, BI Nº 31: Ingressou no excepcional comportamento."
  if (/^[-–—]\s*(?:a\s+\d{1,2}|em\s+\d{1,2}|\d{1,2}[\/\.])/i.test(clean)) return false;
  if (/\b(?:BI|BOL|BOLETIM|ADIT|PORTARIA)\s*N[º°o]/i.test(clean)) return false;
  const u = stripDiacriticsUpper(clean).replace(/^[-–—•*\s]+/, '');
  return (
    /^(?:PERMANECE|CONTINUA|ENCONTRA-SE|ACHA-SE|MANTEM-SE|INGRESSOU|PASSOU|CLASSIFICAD[OA]|ENQUADRAD[OA]|REBAIXAD[OA])\b.*\bCOMPORTAMENTO\b/.test(
      u
    ) ||
    /^(?:NO\s+)?(?:EXCEPCIONAL|OTIMO|BOM|INSUFICIENTE|MAU)\s+COMPORTAMENTO\b/.test(u) ||
    /^COMPORTAMENTO\s+(?:EXCEPCIONAL|OTIMO|BOM|INSUFICIENTE|MAU)\b/.test(u)
  );
}

export function isAnyComportamentoLine(text: string): boolean {
  return (
    isComportamentoHeadingLine(text) ||
    isComportamentoInlineLine(text) ||
    isComportamentoStatementLine(text)
  );
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

const WB_START = '(?<![A-Za-zÀ-ÿ0-9_])';
const WB_END = '(?![A-Za-zÀ-ÿ0-9_])';

function matchReplacementCase(original: string, singular: string): string {
  const letters = original.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length > 0 && original === original.toUpperCase()) {
    return singular.toUpperCase();
  }
  if (/^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(original)) {
    return singular.charAt(0).toUpperCase() + singular.slice(1);
  }
  return singular;
}

function replaceWholeWordToken(
  text: string,
  patternBody: string,
  replacement: string | ((match: string, ...groups: string[]) => string)
): string {
  const re = new RegExp(`${WB_START}(${patternBody})${WB_END}`, 'gi');
  return text.replace(re, (...args) => {
    const full = args[0] as string;
    const next =
      typeof replacement === 'function'
        ? replacement(full, ...(args.slice(1, -2) as string[]))
        : replacement;
    return matchReplacementCase(full, next);
  });
}

const PLURAL_MILITARY_TRIGGER_RE = new RegExp(
  `${WB_START}(?:` +
    `(?:nom[iy]?nad[oa]s|nomiad[oa]s|relacionad[oa]s|designad[oa]s|nomead[oa]s|elogiados|punidos|dispensados|escalados|autorizados|movimentados|transferidos|promovidos|classificados|habilitados|credenciados|selecionados|citad[oa]s|referid[oa]s|mencionad[oa]s|aludid[oa]s|constantes)\\s+(?:aos?|dos?|pelos?|nos?|os)\\s+(?:seguintes\\s+)?militares|` +
    `(?:aos?|dos?|pelos?|nos?|com\\s+os|para\\s+os|entre\\s+os|todos\\s+os|os)\\s+(?:seguintes|respectivos|referidos|citados|aludidos|mesmos|supracitados)?\\s*militares(?:\\s+(?:abaixo|acima|a\\s+seguir|ora))?|` +
    `militares\\s+(?:(?:abaixo|acima|a\\s+seguir)\\s+)?(?:nom[iy]?nad[oa]s|nomiad[oa]s|relacionad[oa]s|designad[oa]s|nomead[oa]s|citad[oa]s|referid[oa]s|mencionad[oa]s|constantes|listad[oa]s|discriminad[oa]s|indicad[oa]s)` +
  `)${WB_END}`,
  'i'
);

const CONTINUATION_PLURAL_SUBJECT_RE = new RegExp(
  `^(?:[-–—]\\s*)?(?:os\\s+(?:mesmos|referidos|citados|aludidos|supracitados|respectivos)|tais\\s+militares|estes\\s+militares|eles)${WB_END}`,
  'i'
);

const MIL_PARTICIPLE_MAP: Array<[string, string]> = [
  ['nom[iy]?nados', 'nominado'],
  ['nomiados', 'nominado'],
  ['designados', 'designado'],
  ['nomeados', 'nomeado'],
  ['relacionados', 'relacionado'],
  ['constantes', 'constante'],
  ['elogiados', 'elogiado'],
  ['punidos', 'punido'],
  ['dispensados', 'dispensado'],
  ['escalados', 'escalado'],
  ['autorizados', 'autorizado'],
  ['impedidos', 'impedido'],
  ['licenciados', 'licenciado'],
  ['movimentados', 'movimentado'],
  ['transferidos', 'transferido'],
  ['classificados', 'classificado'],
  ['desligados', 'desligado'],
  ['adidos', 'adido'],
  ['agregados', 'agregado'],
  ['reformados', 'reformado'],
  ['promovidos', 'promovido'],
  ['matriculados', 'matriculado'],
  ['aprovados', 'aprovado'],
  ['reprovados', 'reprovado'],
  ['inaptos', 'inapto'],
  ['aptos', 'apto'],
  ['prontos', 'pronto'],
  ['ausentes', 'ausente'],
  ['presentes', 'presente'],
  ['interessados', 'interessado'],
  ['beneficiados', 'beneficiado'],
  ['contemplados', 'contemplado'],
  ['condecorados', 'condecorado'],
  ['agraciados', 'agraciado'],
  ['supracitados', 'supracitado'],
  ['citados', 'citado'],
  ['referidos', 'referido'],
  ['aludidos', 'aludido'],
  ['mencionados', 'mencionado'],
  ['listados', 'listado'],
  ['discriminados', 'discriminado'],
  ['indicados', 'indicado'],
  ['selecionados', 'selecionado'],
  ['escalonados', 'escalonado'],
  ['habilitados', 'habilitado'],
  ['credenciados', 'credenciado'],
  ['empenhados', 'empenhado'],
  ['dedicados', 'dedicado'],
  ['compromissados', 'compromissado'],
  ['encarregados', 'encarregado'],
  ['respons[áa]veis', 'responsável'],
  ['integrantes', 'integrante'],
  ['componentes', 'componente'],
  ['submetidos', 'submetido'],
  ['inspecionados', 'inspecionado'],
  ['julgados', 'julgado'],
  ['considerados', 'considerado'],
  ['enquadrados', 'enquadrado'],
  ['lotados', 'lotado'],
  ['empregados', 'empregado'],
  ['engajados', 'engajado'],
  ['reengajados', 'reengajado'],
  ['substitu[íi]dos', 'substituído'],
  ['isentos', 'isento'],
  ['obrigados', 'obrigado'],
  ['convocados', 'convocado'],
];

const VERB_PLURAL_TO_SINGULAR: Array<[string, string]> = [
  ['apresentaram-se', 'apresentou-se'],
  ['apresentam-se', 'apresenta-se'],
  ['apresentarem-se', 'apresentar-se'],
  ['apresentar-se-ão', 'apresentar-se-á'],
  ['encontram-se', 'encontra-se'],
  ['encontravam-se', 'encontrava-se'],
  ['encontraram-se', 'encontrou-se'],
  ['desligam-se', 'desliga-se'],
  ['desligaram-se', 'desligou-se'],
  ['achar-se-ão', 'achar-se-á'],
  ['acham-se', 'acha-se'],
  ['foram', 'foi'],
  ['são', 'é'],
  ['eram', 'era'],
  ['estão', 'está'],
  ['estavam', 'estava'],
  ['estiveram', 'esteve'],
  ['estiverem', 'estiver'],
  ['estarão', 'estará'],
  ['estarem', 'estar'],
  ['serão', 'será'],
  ['serem', 'ser'],
  ['sejam', 'seja'],
  ['forem', 'for'],
  ['ficam', 'fica'],
  ['ficaram', 'ficou'],
  ['ficarão', 'ficará'],
  ['fiquem', 'fique'],
  ['tenham', 'tenha'],
  ['têm', 'tem'],
  ['tinham', 'tinha'],
  ['tiveram', 'teve'],
  ['tiverem', 'tiver'],
  ['terão', 'terá'],
  ['devem', 'deve'],
  ['deverão', 'deverá'],
  ['devam', 'deva'],
  ['deveriam', 'deveria'],
  ['podem', 'pode'],
  ['poderão', 'poderá'],
  ['possam', 'possa'],
  ['puderam', 'pôde'],
  ['puderem', 'puder'],
  ['passam', 'passa'],
  ['passaram', 'passou'],
  ['passarão', 'passará'],
  ['passem', 'passe'],
  ['seguem', 'segue'],
  ['seguiram', 'seguiu'],
  ['seguirão', 'seguirá'],
  ['sigam', 'siga'],
  ['permanecem', 'permanece'],
  ['permaneceram', 'permaneceu'],
  ['permanecerão', 'permanecerá'],
  ['permaneçam', 'permaneça'],
  ['fazem', 'faz'],
  ['faziam', 'fazia'],
  ['fizeram', 'fez'],
  ['fizerem', 'fizer'],
  ['farão', 'fará'],
  ['fazerem', 'fazer'],
  ['vão', 'vai'],
  ['iam', 'ia'],
  ['irão', 'irá'],
  ['irem', 'ir'],
  ['vêm', 'vem'],
  ['vieram', 'veio'],
  ['vierem', 'vier'],
  ['virão', 'virá'],
  ['virem', 'vir'],
  ['houveram', 'houve'],
  ['houverem', 'houver'],
  ['haverão', 'haverá'],
  ['deram', 'deu'],
  ['derem', 'der'],
  ['darão', 'dará'],
  ['dão', 'dá'],
  ['puseram', 'pôs'],
  ['puserem', 'puser'],
  ['compuseram', 'compôs'],
  ['dispuseram', 'dispôs'],
  ['compõem', 'compõe'],
  ['contêm', 'contém'],
  ['mantêm', 'mantém'],
  ['mantiveram', 'manteve'],
  ['retêm', 'retém'],
  ['obtêm', 'obtém'],
  ['obtiveram', 'obteve'],
  ['trouxeram', 'trouxe'],
  ['trouxerem', 'trouxer'],
  ['disseram', 'disse'],
  ['disserem', 'disser'],
  ['souberam', 'soube'],
  ['souberem', 'souber'],
  ['quiseram', 'quis'],
  ['quiserem', 'quiser'],
  ['constam', 'consta'],
  ['constavam', 'constava'],
  ['recebem', 'recebe'],
  ['receberam', 'recebeu'],
  ['receberão', 'receberá'],
  ['concluem', 'conclui'],
  ['concluíram', 'concluiu'],
  ['concluirão', 'concluirá'],
  ['iniciam', 'inicia'],
  ['iniciaram', 'iniciou'],
  ['iniciarão', 'iniciará'],
  ['retornam', 'retorna'],
  ['retornaram', 'retornou'],
  ['retornarão', 'retornará'],
  ['entram', 'entra'],
  ['entraram', 'entrou'],
  ['entrarão', 'entrará'],
  ['saem', 'sai'],
  ['saíram', 'saiu'],
  ['sairão', 'sairá'],
  ['cumprem', 'cumpre'],
  ['cumpriram', 'cumpriu'],
  ['cumprirão', 'cumprirá'],
  ['participam', 'participa'],
  ['participaram', 'participou'],
  ['participarão', 'participará'],
  ['concorrem', 'concorre'],
  ['concorreram', 'concorreu'],
  ['concorrerão', 'concorrerá'],
  ['exercem', 'exerce'],
  ['exerceram', 'exerceu'],
  ['desempenham', 'desempenha'],
  ['desempenharam', 'desempenhou'],
  ['respondem', 'responde'],
  ['responderam', 'respondeu'],
  ['responderão', 'responderá'],
  ['assumem', 'assume'],
  ['assumiram', 'assumiu'],
  ['assumirão', 'assumirá'],
  ['entregam', 'entrega'],
  ['entregaram', 'entregou'],
  ['pertencem', 'pertence'],
  ['pertenciam', 'pertencia'],
  ['atuam', 'atua'],
  ['atuaram', 'atuou'],
  ['comparecem', 'comparece'],
  ['compareceram', 'compareceu'],
  ['comparecerão', 'comparecerá'],
  ['possuem', 'possui'],
  ['possuíam', 'possuía'],
  ['integram', 'integra'],
  ['integraram', 'integrou'],
  ['demonstram', 'demonstra'],
  ['demonstraram', 'demonstrou'],
  ['recebam', 'receba'],
  ['compareçam', 'compareça'],
  ['apresentem', 'apresente'],
  ['realizem', 'realize'],
  ['realizam', 'realiza'],
  ['realizaram', 'realizou'],
  ['realizarão', 'realizará'],
  ['gozam', 'goza'],
  ['gozaram', 'gozou'],
  ['gozarão', 'gozará'],
  ['necessitam', 'necessita'],
  ['necessitaram', 'necessitou'],
  ['percebem', 'percebe'],
  ['perceberam', 'percebeu'],
  ['perceberão', 'perceberá'],
];

function singularizeSingleSentence(sentence: string): string {
  let out = sentence;

  // 1. Transform compound military group phrases with articles/prepositions first
  const prepSingularMap: Record<string, string> = {
    os: 'o',
    aos: 'ao',
    dos: 'do',
    pelos: 'pelo',
    nos: 'no',
    'com os': 'com o',
    'para os': 'para o',
    'entre os': 'entre o',
    'todos os': 'o',
    estes: 'este',
    esses: 'esse',
    aqueles: 'aquele',
    destes: 'deste',
    desses: 'desse',
    daqueles: 'daquele',
    nestes: 'neste',
    nesses: 'nesse',
    naqueles: 'naquele',
  };

  const prepPat =
    '(?:com\\s+os|para\\s+os|entre\\s+os|todos\\s+os|aos|dos|pelos|nos|estes|esses|aqueles|destes|desses|daqueles|nestes|nesses|naqueles|os)';
  const adjBeforePat =
    '(?:seguintes|respectivos|referidos|citados|aludidos|mesmos|supracitados)';
  const adjAfterPat =
    '(?:nom[iy]?nados|nomiados|relacionados|designados|nomeados|citados|referidos|mencionados|listados|indicados|discriminados|constantes)';

  const adjSingularWord = (w: string): string => {
    const low = w.toLowerCase();
    if (/^nom[iy]?nad/.test(low) || /^nomiad/.test(low)) return 'nominado';
    if (low.endsWith('es')) return low.slice(0, -1); // seguintes -> seguinte, constantes -> constante
    if (low.endsWith('s')) return low.slice(0, -1);
    return low;
  };

  // e.g., "nomiados os seguintes militares" / "relacionados os seguintes militares" -> "nominado o seguinte militar"
  out = out.replace(
    new RegExp(
      `${WB_START}(${adjAfterPat})\\s+(${prepPat})\\s+(?:(${adjBeforePat})\\s+)?militares${WB_END}`,
      'gi'
    ),
    (full, adjAfter: string, prep: string, adjBefore?: string) => {
      const pKey = prep.toLowerCase().replace(/\s+/g, ' ');
      const sPrep = prepSingularMap[pKey] || 'o';
      const sAfter = adjSingularWord(adjAfter);
      const sBefore = adjBefore ? ` ${adjSingularWord(adjBefore)}` : '';
      return matchReplacementCase(full, `${sAfter} ${sPrep}${sBefore} militar`);
    }
  );

  // e.g., "aos seguintes militares abaixo nominados" / "os seguintes militares" / "os militares nominados a seguir"
  out = out.replace(
    new RegExp(
      `${WB_START}(${prepPat})\\s+(?:(${adjBeforePat})\\s+)?militares(?:\\s+(abaixo|acima|a\\s+seguir|ora))?(?:\\s+(${adjAfterPat}))?${WB_END}`,
      'gi'
    ),
    (full, prep: string, adjBefore?: string, pos?: string, adjAfter?: string) => {
      const pKey = prep.toLowerCase().replace(/\s+/g, ' ');
      const sPrep = prepSingularMap[pKey] || 'o';
      const parts = [sPrep];
      if (adjBefore) parts.push(adjSingularWord(adjBefore));
      parts.push('militar');
      if (pos) parts.push(pos.toLowerCase().replace(/\s+/g, ' '));
      if (adjAfter) parts.push(adjSingularWord(adjAfter));
      return matchReplacementCase(full, parts.join(' '));
    }
  );

  // Fallback bare "militares nominados/relacionados..."
  out = out.replace(
    new RegExp(
      `${WB_START}militares(?:\\s+(abaixo|acima|a\\s+seguir))?\\s+(${adjAfterPat})${WB_END}`,
      'gi'
    ),
    (full, pos?: string, adjAfter?: string) => {
      const parts = ['militar'];
      if (pos) parts.push(pos.toLowerCase().replace(/\s+/g, ' '));
      if (adjAfter) parts.push(adjSingularWord(adjAfter));
      return matchReplacementCase(full, parts.join(' '));
    }
  );

  // 2. Relative/pronoun references to the military subject
  out = replaceWholeWordToken(out, '(?:aos|dos|pelos|nos|os)\\s+quais', (m) => {
    const first = m.split(/\s+/)[0].toLowerCase();
    const map: Record<string, string> = {
      os: 'o',
      aos: 'ao',
      dos: 'do',
      pelos: 'pelo',
      nos: 'no',
    };
    return `${map[first] || 'o'} qual`;
  });

  out = replaceWholeWordToken(out, '(?:aos|dos|pelos|nos|com\\s+os|os)\\s+mesmos', (m) => {
    const low = m.toLowerCase().replace(/\s+/g, ' ');
    if (low.startsWith('com os')) return 'com o mesmo';
    const first = low.split(' ')[0];
    const map: Record<string, string> = {
      os: 'o',
      aos: 'ao',
      dos: 'do',
      pelos: 'pelo',
      nos: 'no',
    };
    return `${map[first] || 'o'} mesmo`;
  });

  // 3. Explicit military rank plurals inside military-reference phrases
  out = replaceWholeWordToken(
    out,
    '(os|aos|dos|pelos|nos)\\s+(oficiais|subtenentes|sargentos|cabos|soldados|alunos|instrutores|monitores)',
    (_full, art: string, noun: string) => {
      const artMap: Record<string, string> = {
        os: 'o',
        aos: 'ao',
        dos: 'do',
        pelos: 'pelo',
        nos: 'no',
      };
      const nLow = noun.toLowerCase();
      const sNoun = nLow === 'oficiais' ? 'oficial' : nLow.slice(0, -1);
      return `${artMap[art.toLowerCase()] || 'o'} ${sNoun}`;
    }
  );

  // 4. Explicit irregular & regular military verbs
  for (const [pl, sg] of VERB_PLURAL_TO_SINGULAR) {
    out = replaceWholeWordToken(out, pl.replace(/[-]/g, '\\-'), sg);
  }

  // Personal infinitives after infinitive prepositions/clauses (para comporem -> para compor, para se apresentarem -> para se apresentar)
  out = out.replace(
    new RegExp(
      `(${WB_START}(?:para|por|a\\s+fim\\s+de|de\\s+modo\\s+a|com\\s+a\\s+finalidade\\s+de|sem\\s+preju[íi]zo\\s+de|sem|at[ée]|ap[óo]s|antes\\s+de|depois\\s+de|devendo|visando|objetivando|em\\s+raz[ãa]o\\s+de|em\\s+virtude\\s+de|al[ée]m\\s+de)\\s+(?:(?:se|n[ãa]o|lhes|os)\\s+)?)([A-Za-zÀ-ÿ]+(?:arem|erem|irem|orem))((?:-se)?)`,
      'gi'
    ),
    (_full, prefix: string, verb: string, enclitic: string) => {
      const vLow = verb.toLowerCase();
      let singularInf = verb;
      if (vLow === 'terem') singularInf = 'ter';
      else if (vLow === 'serem') singularInf = 'ser';
      else if (vLow === 'estarem') singularInf = 'estar';
      else if (vLow === 'irem') singularInf = 'ir';
      else if (vLow === 'virem') singularInf = 'vir';
      else if (vLow === 'porem') singularInf = 'pôr';
      else if (vLow.endsWith('arem') || vLow.endsWith('erem') || vLow.endsWith('irem') || vLow.endsWith('orem')) {
        singularInf = verb.slice(0, -2);
      }
      return `${prefix}${matchReplacementCase(verb, singularInf)}${enclitic || ''}`;
    }
  );

  // Regular future plural with mesoclisis (-ar-se-ão / -er-se-ão / -ir-se-ão -> -ar-se-á / ...)
  out = out.replace(
    new RegExp(`${WB_START}([A-Za-zÀ-ÿ]+(?:ar|er|ir)-se-)ão${WB_END}`, 'gi'),
    (_full, stem: string, ) => `${stem}${stem === stem.toUpperCase() ? 'Á' : 'á'}`
  );

  // Regular 3rd person plural preterite (-aram -> -ou, -eram -> -eu, -iram/-íram -> -iu)
  out = out.replace(
    new RegExp(`${WB_START}([A-Za-zÀ-ÿ]{2,})(aram|eram|[ií]ram)${WB_END}`, 'gi'),
    (full, stem: string, ending: string) => {
      const low = full.toLowerCase();
      if (low === 'foram' || low === 'eram' || low.endsWith('veram') || low.endsWith('zeram') || low.endsWith('seram') || low.endsWith('deram') || low.endsWith('uberam')) {
        return full;
      }
      const eLow = ending.toLowerCase();
      const sEnd = eLow === 'aram' ? 'ou' : eLow === 'eram' ? 'eu' : 'iu';
      return matchReplacementCase(full, `${stem}${sEnd}`);
    }
  );

  // Regular 3rd person plural future (-arão / -erão / -irão -> -ará / -erá / -irá)
  out = out.replace(
    new RegExp(`${WB_START}([A-Za-zÀ-ÿ]{2,})(ar|er|ir)ão${WB_END}`, 'gi'),
    (full, stem: string, theme: string) => matchReplacementCase(full, `${stem}${theme}á`)
  );

  // 5. Military status participles & adjectives
  for (const [pl, sg] of MIL_PARTICIPLE_MAP) {
    out = replaceWholeWordToken(out, pl, sg);
  }

  return out;
}

const ABBREV_END_RE = /\b(?:n[º°o]|nr|art|inc|cel|tc|maj|cap|ten|sgt|cb|sd|sr|sra|dr|dra|p[áa]g|fl|fls|etc|doc|obs|ref|proc|of)\s*\.$/i;

export function singularizeMilitaryGroupText(paragraph: string): string {
  if (!paragraph || !paragraph.trim()) return paragraph;

  // Quick pre-check on whole paragraph before sentence splitting
  if (!PLURAL_MILITARY_TRIGGER_RE.test(paragraph)) {
    return paragraph;
  }

  // Split into sentence chunks keeping whitespace/punctuation exact
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < paragraph.length; i++) {
    const ch = paragraph[i];
    if ((ch === '.' || ch === ';' || ch === '!' || ch === '?') && i + 1 < paragraph.length && /\s/.test(paragraph[i + 1])) {
      const candidate = paragraph.slice(start, i + 1);
      if (ch === '.' && (ABBREV_END_RE.test(candidate) || /\d\.$/.test(candidate))) {
        continue;
      }
      sentences.push(candidate);
      start = i + 1;
    }
  }
  if (start < paragraph.length) {
    sentences.push(paragraph.slice(start));
  }

  let prevWasMilitaryPlural = false;
  const transformed = sentences.map((seg) => {
    const hasTrigger = PLURAL_MILITARY_TRIGGER_RE.test(seg);
    const trimmed = seg.trimStart();
    const isContinuation = prevWasMilitaryPlural && CONTINUATION_PLURAL_SUBJECT_RE.test(trimmed);
    if (hasTrigger || isContinuation) {
      prevWasMilitaryPlural = true;
      return singularizeSingleSentence(seg);
    }
    prevWasMilitaryPlural = false;
    return seg;
  });

  return transformed.join('');
}

function isEntryStartLine(text: string): boolean {
  const t = cleanInlineWhitespace(text);
  return /^[-–—]\s*/.test(t) && t.length > 2 && !isSemAlteracaoLine(t);
}

/**
 * Matches dated/numbered BI header prefixes ending with ":" such as:
 * "- a 14, BI Nº 31:", "- em 05, BI nº 102:", "- a 12, Adit BI nº 15:", "- BI Nº 12:".
 * The opening BI text MUST ALWAYS be pulled onto the same line immediately after ":".
 */
function isBiHeaderColonPrefix(text: string): boolean {
  const clean = cleanInlineWhitespace(text);
  if (!clean || clean.length > 125 || !/:$/.test(clean)) return false;
  if (
    /^[-–—]\s*(?:(?:a|em|de|no\s+dia)\s+\d{1,2}\b|\d{1,2}\s*(?:\/|\.|de\b))/i.test(clean)
  ) {
    return true;
  }
  if (/^[-–—]\s*(?:BI|BOL|BOLETIM|ADIT|ADITAMENTO|PORTARIA|BOL\s+INT)\b/i.test(clean)) {
    return true;
  }
  return false;
}

const KNOWN_MAJOR_SECTION_TITLES = new Set([
  'ASSUNTOS GERAIS E ADMINISTRATIVOS',
  'INSTRUCAO',
  'JUSTICA E DISCIPLINA',
  'SERVICOS DIARIOS',
  'SERVICO DIARIO',
  'COMPORTAMENTO',
  'COMPORTAMENTO MILITAR',
  'ELOGIOS',
  'PUNICOES',
  'CONDECORACOES',
  'MOVIMENTACAO',
  'PROMOCOES',
  'INSPECAO DE SAUDE',
  'TEMPO DE SERVICO',
  'ALTERACOES DE OFICIAIS',
  'ALTERACOES DE SUBTENENTES E SARGENTOS',
  'ALTERACOES DE CABOS E SOLDADOS',
  'ALTERACOES DE PRACAS',
  '1A PARTE',
  '2A PARTE',
]);

function isKnownMajorSectionTitle(text: string): boolean {
  const norm = stripDiacriticsUpper(cleanInlineWhitespace(text)).replace(/[:.\-–—\s]+$/, '');
  return KNOWN_MAJOR_SECTION_TITLES.has(norm) || /^ALTERACOES\s+DE\s+/.test(norm);
}

function cleanSubtitleAgainstTitle(title: string, subtitle: string): string {
  const cleanSub = cleanInlineWhitespace(subtitle);
  if (!cleanSub) return '';
  const normTitle = stripDiacriticsUpper(title);
  const normSub = stripDiacriticsUpper(cleanSub);
  if (!normTitle) return cleanSub;
  if (normSub === normTitle) return '';
  const dashMatch = cleanSub.match(/^(.+?)(?:\s+[-–—]\s*|\s*[-–—]\s+)(.+)$/);
  if (dashMatch && stripDiacriticsUpper(dashMatch[1]) === normTitle) {
    const stripped = dashMatch[2].trim();
    return stripDiacriticsUpper(stripped) === normTitle ? '' : stripped;
  }
  return cleanSub;
}

function isUppercaseHeadingCandidate(text: string): boolean {
  const clean = cleanInlineWhitespace(text);
  if (!clean || clean.length > 90) return false;
  if (isEntryStartLine(clean) || isSemAlteracaoLine(clean)) return false;
  if (normalizeMonthHeading(clean) || isPart1Line(clean) || isPart2Line(clean)) return false;
  if (isNonTitleTopic(clean)) return false;
  if (/[.;!?]$/.test(clean)) return false;
  // Reject inline key-value lines like "NOTA FINAL: E" or "CPF: 123..." inside a BI
  if (/:/.test(clean)) return false;
  if (
    /^(?:DE|DO|DA|DOS|DAS|NO|NA|NOS|NAS|EM|AO|AOS|COM|POR|PARA|PELO|PELA|SEM|SOB|SOBRE|BI|BOL|BOLETIM|PORTARIA|ADITAMENTO|ADIT|OF[ÍI]CIO|MEMO|DIEX)\b/i.test(
      clean
    )
  ) {
    return false;
  }

  const letters = clean.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length < 3) return false;
  const withoutPrep = clean.replace(/\b(?:de|da|do|das|dos|e|em|para|por|com|a|o|as|os)\b/g, '');
  const contentLetters = withoutPrep.replace(/[^A-Za-zÀ-ÿ]/g, '');
  return contentLetters.length >= 3 && withoutPrep === withoutPrep.toUpperCase();
}

function splitTitleSubtitleDash(
  text: string,
  allowSplit: boolean,
  isBoldLine = false
): { title: string; subtitle: string; isSubtitleOnly?: boolean } | null {
  if (!allowSplit) return null;
  const clean = cleanInlineWhitespace(text);
  if (!clean || isEntryStartLine(clean) || isSemAlteracaoLine(clean)) return null;
  if (/[;!?]$/.test(clean)) return null;
  if (/\.$/.test(clean) && !isBoldLine && !ABBREV_END_RE.test(clean)) return null;
  if (/\bBI\s*N[º°o]/i.test(clean) || /\bnominado a seguir\b/i.test(clean)) return null;

  // Match first separator dash with whitespace on at least one side (never breaks hyphenated words like SUB-TENENTE).
  // Everything after that dash is the complete Subtitle (even if it contains additional dashes).
  const dashMatch = clean.match(/^(.+?)(?:\s+[-–—]\s*|\s*[-–—]\s+)(.+)$/);
  if (!dashMatch) return null;

  const left = dashMatch[1].trim();
  const right = dashMatch[2].trim();
  if (!left || !right || left.length > 90 || right.length > 260) return null;
  if (/:/.test(left)) return null;

  // Never mistake date/bulletin/document prefixes for a Section Title
  if (
    /^\d{1,2}\s+(?:DE\s+)?(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)/i.test(left) ||
    /^\d{1,2}\/\d{1,2}/.test(left) ||
    /^(?:BI|BOL|BOLETIM|PORTARIA|ADIT|ADITAMENTO|MEMO|OF[ÍI]CIO|DIEX|MSG|NOTA|ANEXO|ITEM|ART|N[º°O]?)\b/i.test(
      left
    ) ||
    /^(?:1ª|2ª)\s*PARTE\b/i.test(left)
  ) {
    return null;
  }

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

  // Allow lowercase Portuguese prepositions inside an uppercase Title (e.g. "ASSUNTOS GERAIS e ADMINISTRATIVOS")
  if (/^\d/.test(left)) return null;
  const leftWithoutPrep = left.replace(/\b(?:de|da|do|das|dos|e|em|para|por|com|a|o|as|os)\b/g, '');
  const leftContentLetters = leftWithoutPrep.replace(/[^A-Za-zÀ-ÿ]/g, '');
  const leftIsAllCaps =
    leftContentLetters.length >= 3 && leftWithoutPrep === leftWithoutPrep.toUpperCase();
  if (!leftIsAllCaps) return null;

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

function isPart2TableMatrixHtml(matrix: string[][]): boolean {
  const flat = matrix.flat().join(' ');
  return (
    /TEMPO\s+COMPUTADO|TEMPO\s+TOTAL\s+DE\s+EFETIVO/i.test(flat) ||
    matrix.filter((r) => r.some((c) => /\d{1,2}\s*a\s*\d{1,2}\s*m\s*\d{1,2}\s*d\b/i.test(c))).length >= 2
  );
}

function htmlFragmentToTextWithBreaks(doc: Document, fragmentHtml: string): string {
  const tmp = doc.createElement('div');
  tmp.innerHTML = fragmentHtml.replace(/<br\s*\/?>/gi, '\n');
  return cleanCellPreserveBreaks(tmp.textContent || '');
}

function directHtmlTableRows(tableEl: Element): Element[] {
  const rows: Element[] = [];
  for (const ch of Array.from(tableEl.children)) {
    const tag = ch.tagName.toUpperCase();
    if (tag === 'TR') {
      rows.push(ch);
    } else if (tag === 'THEAD' || tag === 'TBODY' || tag === 'TFOOT') {
      for (const tr of Array.from(ch.children)) {
        if (tr.tagName.toUpperCase() === 'TR') rows.push(tr);
      }
    }
  }
  return rows;
}

function directHtmlRowCells(trEl: Element): Element[] {
  return Array.from(trEl.children).filter((ch) => {
    const tag = ch.tagName.toUpperCase();
    return tag === 'TD' || tag === 'TH';
  });
}

/**
 * Extracts raw lines from rich HTML (editor content or Word-HTML .doc), preserving bold/underline hints
 * and body data tables without corrupting HTML entities or nested layout tables.
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
      let text = cleanInlineWhitespace(node.textContent || '');
      if (!text) return;

      if (
        node.tagName === 'LI' &&
        node.parentElement?.tagName === 'UL' &&
        !isEntryStartLine(text) &&
        !isSemAlteracaoLine(text)
      ) {
        text = `- ${text}`;
      }

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
        hardBreakAfter: true,
      });
    };

    const walk = (root: Element) => {
      for (const child of Array.from(root.children)) {
        if (child.tagName === 'TABLE') {
          const tableText = cleanInlineWhitespace(child.textContent || '');
          const rows = directHtmlTableRows(child);
          const hasNestedTable = child.querySelector('table') !== null;

          if (isHeaderTableText(tableText) && !hasNestedTable) {
            for (const tr of rows) {
              const cells = directHtmlRowCells(tr);
              for (const cell of cells) {
                const innerParagraphs = Array.from(cell.children).filter((el) =>
                  blockTags.has(el.tagName)
                );
                if (innerParagraphs.length > 0) {
                  for (const p of innerParagraphs) walkCellElement(p);
                } else {
                  extractFromContainer(cell);
                }
              }
            }
            continue;
          }

          if (hasNestedTable) {
            for (const tr of rows) {
              for (const cell of directHtmlRowCells(tr)) {
                walkCellElement(cell);
              }
            }
            continue;
          }

          const matrix: string[][] = [];
          for (const tr of rows) {
            const cells = directHtmlRowCells(tr);
            if (cells.length === 0) continue;
            const rowVals: string[] = [];
            for (const c of cells) {
              const span = Math.max(1, parseInt(c.getAttribute('colspan') || '1', 10) || 1);
              const innerBlocks = Array.from(c.children).filter((el) =>
                blockTags.has(el.tagName)
              );
              let cellText = '';
              if (innerBlocks.length > 0) {
                cellText = innerBlocks
                  .map((el) => htmlFragmentToTextWithBreaks(doc, el.innerHTML || ''))
                  .filter(Boolean)
                  .join('\n');
              } else {
                cellText = htmlFragmentToTextWithBreaks(doc, c.innerHTML || '');
              }
              rowVals.push(cellText);
              for (let s = 1; s < span; s++) {
                rowVals.push('');
              }
            }
            if (rowVals.some((v) => v.length > 0)) matrix.push(rowVals);
          }

          const nonEmptyCols = matrix.reduce(
            (acc, r) => Math.max(acc, r.filter((v) => v.length > 0).length),
            0
          );

          if (nonEmptyCols <= 1) {
            for (const tr of rows) {
              for (const cell of directHtmlRowCells(tr)) {
                walkCellElement(cell);
              }
            }
          } else if (isPart2TableMatrixHtml(matrix)) {
            for (const row of matrix) {
              const joined = row.map((v) => cleanInlineWhitespace(v)).filter(Boolean).join(' ');
              if (joined) lines.push({ text: joined });
            }
          } else if (matrix.length > 0) {
            lines.push({
              text: '',
              tableRows: matrix,
              tableItemId: child.getAttribute('data-alt-item') || undefined,
            });
          }
          continue;
        }

        const hasNestedBlocks = Array.from(child.children).some(
          (c) => blockTags.has(c.tagName) || c.tagName === 'TABLE' || c.tagName === 'UL' || c.tagName === 'OL'
        );
        if (blockTags.has(child.tagName) && !hasNestedBlocks) {
          const innerHtml = child.innerHTML;
          if (/<br\s*\/?>/i.test(innerHtml)) {
            const parts = innerHtml.split(/<br\s*\/?>/i);
            for (const part of parts) {
              const div = doc.createElement('div');
              div.innerHTML = part;
              extractFromContainer(div);
            }
          } else {
            extractFromContainer(child);
          }
        } else if (hasNestedBlocks || child.tagName === 'UL' || child.tagName === 'OL') {
          walk(child);
        } else {
          extractFromContainer(child);
        }
      }
    };

    const walkCellElement = (cell: Element) => {
      const hasChildrenBlocks = Array.from(cell.children).some(
        (c) => blockTags.has(c.tagName) || c.tagName === 'TABLE' || c.tagName === 'UL' || c.tagName === 'OL'
      );
      if (hasChildrenBlocks) {
        walk(cell);
      } else if (/<br\s*\/?>/i.test(cell.innerHTML)) {
        const parts = cell.innerHTML.split(/<br\s*\/?>/i);
        for (const part of parts) {
          const div = doc.createElement('div');
          div.innerHTML = part;
          extractFromContainer(div);
        }
      } else {
        extractFromContainer(cell);
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
  const rawLines = rawText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => cleanInlineWhitespace(line))
    .filter((line) => line.length > 0);

  if (rawLines.length === 0) return [];

  // Infer wrapped column width (for OCR / hard-wrapped plain text) vs intentional short lines
  const lengths = rawLines
    .map((l) => l.length)
    .filter((len) => len >= 40)
    .sort((a, b) => a - b);
  const wrapWidth =
    lengths.length >= 3
      ? lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * 0.85))]
      : 0;

  return rawLines.map((text, idx) => {
    const next = idx + 1 < rawLines.length ? rawLines[idx + 1] : '';
    const nextFirstWordLen = next ? (next.split(/\s+/)[0]?.length ?? 0) : 0;
    const hardBreakAfter =
      !next ||
      wrapWidth < 52 ||
      text.length + 1 + nextFirstWordLen <= wrapWidth - 6;
    return { text, hardBreakAfter };
  });
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

/**
 * Detects standalone header lines requesting CP / PREC-CP (which are omitted from our Alterações).
 * Never matches CPF, CPO, CPOR, CPEX, etc.
 */
function isStandaloneCpLine(text: string): boolean {
  const clean = cleanInlineWhitespace(text);
  if (!clean || clean.length > 80) return false;
  return /^(?:PREC[\s\/\-–—]*CP|C\.?\s*P\.?)(?:\s*:\s*[\dA-Za-z.\-\/\s]*|\s+[\d.\-\/\s]{2,}|\s*$)/i.test(
    clean
  );
}

/**
 * Strips inline "CP: ..." / "PREC-CP: ..." fragments from extracted header field values
 * without ever touching CPF, CPO, CPOR, etc.
 */
function stripInlineCpField(val: string): string {
  const cleaned = cleanInlineWhitespace(val)
    .replace(
      /(?:^|[\s,;|\-–—]+)(?:PREC[\s\/\-–—]*CP|C\.?P\.?)\s*:\s*(?:[\d.\-\/]+(?:\s+[\d.\-\/]+)*)?(?=\s*(?:$|[,;|]|PER[ÍI]ODO\b|SEMESTRE\b|FOLHA\b|QAS\b|QMS\b|POSTO\b|IDENTIDADE\b))/gi,
      ' '
    )
    .replace(
      /(?:^|[\s,;|\-–—]+)(?:PREC[\s\/\-–—]*CP|C\.?P\.?)\s+[\d.\-\/]{3,}(?=\s*(?:$|[,;|]|PER[ÍI]ODO\b|SEMESTRE\b|FOLHA\b))/gi,
      ' '
    )
    .replace(/\s*[-–—|;,:]+\s*$/, '');
  return cleanInlineWhitespace(cleaned);
}

function extractInlineHeaderDates(lineText: string, header: AlteracaoHeaderExtract) {
  const clean = stripInlineCpField(cleanInlineWhitespace(lineText));
  const semMatch = clean.match(
    /\b((?:1|2|PRIMEIRO|SEGUNDO)\s*[º°o]?\s*SEM(?:ESTRE)?\s*(?:(?:DE|\/|-)\s*\d{4})?)\b/i
  );
  if (semMatch && !header.semestre) {
    header.semestre = stripInlineCpField(semMatch[1]);
  }

  const perMatch = clean.match(
    /\bPER[ÍI]ODO\s*:\s*(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4}\s*(?:a|ate|até|-)\s*\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4}|\S.+)$/i
  );
  if (perMatch && !header.periodo) {
    header.periodo = stripInlineCpField(perMatch[1]);
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
      // Scan backwards up to 3 lines to catch both "FOLHA Nº XX" and the OM line above it
      for (let back = 1; back <= 3 && i - back >= 0; back++) {
        const idxBack = i - back;
        if (rawLines[idxBack].tableRows) break;
        const prev = rawLines[idxBack].text;
        const prevU = stripDiacriticsUpper(prev);
        if (
          isEntryStartLine(prev) ||
          normalizeMonthHeading(prev) ||
          isPart1Line(prev) ||
          isPart2Line(prev)
        ) {
          break;
        }
        if (isFolhaNumberLine(prev) || isStandaloneCpLine(prev)) {
          skipIndices.add(idxBack);
          extractInlineHeaderDates(prev, header);
          continue;
        }
        if (
          /\b(BATALHAO|REGIMENTO|GRUPO|COMANDO|CENTRO|ESCOLA|PARQUE|BASE|DEPOSITO|HOSPITAL|COMPANHIA|BRIGADA|ESQUADRAO|BI\s*MEC|0\d{4,5})\b/.test(
            prevU
          ) &&
          prev.length <= 95
        ) {
          skipIndices.add(idxBack);
          if (!header.omExtenso) {
            header.omExtenso = stripInlineCpField(prev);
          }
        }
      }

      for (let j = i + 1; j <= Math.min(rawLines.length - 1, i + 6); j++) {
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
          isPeriodoLine(nextText) ||
          isStandaloneCpLine(nextText) ||
          (j === i + 4 && nextText.length <= 65 && !/[.;!?]$/.test(nextText))
        ) {
          skipIndices.add(j);
          extractInlineHeaderDates(nextText, header);
          if (!header.nomeGuerra && rawLines[j].boldSubstring) {
            header.nomeGuerra = rawLines[j].boldSubstring;
          }
        } else {
          break;
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

    if (isStandaloneCpLine(text)) {
      // Reference Alteração header may contain a standalone CP / PREC-CP line: always drop it
      skipIndices.add(i);
    } else if (/^MINISTERIO DA DEFESA\b/.test(u)) {
      header.ministerio = text;
      skipIndices.add(i);
    } else if (/^EXERCITO BRASILEIRO\b/.test(u)) {
      header.forca = text;
      skipIndices.add(i);
    } else if (/^FOLHAS? DE ALTERACOES\b/.test(u)) {
      header.tituloDocumento = text;
      skipIndices.add(i);
    } else if (/^GUARNICAO\b/.test(u)) {
      header.guarnicao = stripInlineCpField(text);
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
      header.omCodom = stripInlineCpField(text);
      skipIndices.add(i);
    } else if (/^NOME\s*:/i.test(text)) {
      const val = stripInlineCpField(text.replace(/^NOME\s*:\s*/i, ''));
      if (val) header.nomeCompleto = val;
      if (boldSubstring && val.toUpperCase().includes(boldSubstring.toUpperCase())) {
        header.nomeGuerra = boldSubstring;
      }
      skipIndices.add(i);
    } else if (/^POSTO\s*\/?\s*GRADUA[ÇC][ÃA]O\s*:/i.test(text)) {
      const val = stripInlineCpField(text.replace(/^POSTO\s*\/?\s*GRADUA[ÇC][ÃA]O\s*:\s*/i, ''));
      if (val) header.postoGraduacao = val;
      skipIndices.add(i);
    } else if (/^QAS\s*\/?\s*QMS\s*:/i.test(text)) {
      const val = stripInlineCpField(text.replace(/^QAS\s*\/?\s*QMS\s*:\s*/i, ''));
      if (val) header.qasQms = val;
      skipIndices.add(i);
    } else if (/^IDENTIDADE\s*:/i.test(text)) {
      const rawVal = text.replace(/^IDENTIDADE\s*:\s*/i, '').trim();
      const splitPeriodo = rawVal.match(/^(.+?)\s+PER[ÍI]ODO\s*:\s*(.+)$/i);
      if (splitPeriodo) {
        const cleanId = stripInlineCpField(splitPeriodo[1]);
        const cleanPer = stripInlineCpField(splitPeriodo[2]);
        if (cleanId) header.identidade = cleanId;
        if (cleanPer) header.periodo = cleanPer;
      } else {
        const cleanId = stripInlineCpField(rawVal);
        if (cleanId) header.identidade = cleanId;
      }
      skipIndices.add(i);
    } else if (isSemestreLine(text)) {
      header.semestre = stripInlineCpField(text);
      skipIndices.add(i);
    } else if (isPeriodoLine(text)) {
      const val = stripInlineCpField(text.replace(/^PER[ÍI]ODO\s*:\s*/i, ''));
      if (val) header.periodo = val;
      skipIndices.add(i);
    } else if (bodyStartIdx > 0 && i < bodyStartIdx) {
      skipIndices.add(i);
    }
  }

  const isStandalonePageFooterLine = (lineText: string): boolean => {
    const clean = cleanInlineWhitespace(lineText);
    if (!clean || clean.length > 48) return false;
    return (
      /^(?:P[ÁA]GINA|P[ÁA]G\.?|FL\.?|FOLHA)\s*\d+\s*(?:DE|\/)\s*\d+\s*$/i.test(clean) ||
      /^[-–—]?\s*\d{1,3}\s*[-–—]?$/.test(clean) ||
      /^\d{1,3}\s*\/\s*\d{1,3}$/.test(clean)
    );
  };

  // Filter skipped lines & track whether a header break happened between elements
  const rawBodyStream: Array<{ line: RawAlteracaoLine; skippedBefore: boolean }> = [];
  let sawSkipped = false;
  for (let i = 0; i < rawLines.length; i++) {
    if (skipIndices.has(i)) {
      sawSkipped = true;
      continue;
    }
    const item = rawLines[i];
    if (!item.tableRows) {
      const t = item.text;
      if (
        isFolhaNumberLine(t) ||
        isSemestreLine(t) ||
        isPeriodoLine(t) ||
        isStandaloneCpLine(t) ||
        isStandalonePageFooterLine(t)
      ) {
        sawSkipped = true;
        continue;
      }
      if (header.omExtenso && stripDiacriticsUpper(t) === stripDiacriticsUpper(header.omExtenso)) {
        sawSkipped = true;
        continue;
      }
    }
    rawBodyStream.push({
      line: sawSkipped ? { ...item, skippedHeaderBefore: true } : item,
      skippedBefore: sawSkipped,
    });
    sawSkipped = false;
  }

  const bodyLines: RawAlteracaoLine[] = [];
  const normalizeRowSig = (row?: string[]) =>
    (row || []).map((c) => stripDiacriticsUpper(cleanInlineWhitespace(c))).join('|');
  const normalizeLineDedupSig = (t: string) =>
    stripDiacriticsUpper(cleanInlineWhitespace(t)).replace(/\s+/g, ' ').trim();

  for (const entry of rawBodyStream) {
    const { line, skippedBefore } = entry;
    const prev = bodyLines[bodyLines.length - 1];
    if (
      line.tableRows &&
      line.tableRows.length > 0 &&
      prev?.tableRows &&
      prev.tableRows.length > 0 &&
      line.tableRows[0]?.length === prev.tableRows[0]?.length
    ) {
      const sameItemId =
        Boolean(line.tableItemId && prev.tableItemId && line.tableItemId === prev.tableItemId);
      const differentItemId =
        Boolean(line.tableItemId && prev.tableItemId && line.tableItemId !== prev.tableItemId);
      const sameHeaderSig =
        normalizeRowSig(line.tableRows[0]) === normalizeRowSig(prev.tableRows[0]);

      if (!differentItemId && (sameItemId || sameHeaderSig || skippedBefore)) {
        let incomingRows =
          line.tableRows.length > 1 && sameHeaderSig
            ? line.tableRows.slice(1)
            : line.tableRows;
        // Guard against a single row duplicated right across a page break
        if (
          incomingRows.length > 0 &&
          prev.tableRows.length > 0 &&
          normalizeRowSig(incomingRows[0]) ===
            normalizeRowSig(prev.tableRows[prev.tableRows.length - 1])
        ) {
          incomingRows = incomingRows.slice(1);
        }
        prev.tableRows = [...prev.tableRows, ...incomingRows];
        continue;
      }
    }

    // Deduplicate exact repeated text lines across page breaks or overlapping PDF layers
    if (!line.tableRows && prev && !prev.tableRows) {
      const prevSig = normalizeLineDedupSig(prev.text);
      const currSig = normalizeLineDedupSig(line.text);
      const crossedPage = Boolean(skippedBefore || prev.crossPageAfter);
      if (
        currSig.length > 0 &&
        currSig === prevSig &&
        !isSemAlteracaoLine(line.text) &&
        (crossedPage || currSig.length >= 28)
      ) {
        continue;
      }
    }

    bodyLines.push(line.tableRows ? { ...line, tableRows: [...line.tableRows] } : line);
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
export const PART2_ITEM_WITH_TIME_RE =
  /^([1-5]\.|[a-b]\.)\s*(.+?)\s*(?:[.\s]+)?(\d{1,2}\s*a\s*\d{1,2}\s*m\s*\d{1,2}\s*d)\s*$/i;
export const PART2_ITEM_LABEL_ONLY_RE = /^([1-5]\.|[a-b]\.)\s*(.+?)\s*[.\s]*$/i;

export function normalizeTimeValueStr(raw: string): string {
  const m = raw.match(/(\d{1,2})\s*a\s*(\d{1,2})\s*m\s*(\d{1,2})\s*d/i);
  if (!m) return '00 a 00 m 00 d';
  return `${m[1].padStart(2, '0')} a ${m[2].padStart(2, '0')} m ${m[3].padStart(2, '0')} d`;
}

function estimateTimesNewRomanWidthPx(text: string): number {
  let w = 0;
  for (const ch of text) {
    if (ch === ' ') w += 4.0;
    else if (ch === '.' || ch === ',' || ch === ':' || ch === ';') w += 4.0;
    else if (/[iljIft\|]/.test(ch)) w += 4.7;
    else if (/[mwMW]/.test(ch)) w += 12.1;
    else if (/[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(ch)) w += 10.6;
    else if (/[0-9]/.test(ch)) w += 8.0;
    else w += 7.4;
  }
  return w;
}

export function formatPart2DotRow(labelWithPrefix: string, timeValue: string): string {
  const cleanLabel = cleanInlineWhitespace(labelWithPrefix).replace(/[.\s]+$/, '');
  const cleanValue = normalizeTimeValueStr(timeValue);
  const targetWidthPx = 638;
  const usedWidthPx =
    estimateTimesNewRomanWidthPx(cleanLabel) + estimateTimesNewRomanWidthPx(cleanValue);
  const dotCount = Math.max(4, Math.round((targetWidthPx - usedWidthPx) / 4.0));
  return `${cleanLabel}${'.'.repeat(dotCount)}${cleanValue}`;
}

export function isPart2ClosingDateLine(line: string): boolean {
  const clean = cleanInlineWhitespace(line);
  if (!clean) return false;
  if (/^Quartel\b/i.test(clean)) return true;
  if (/,\s*(?:\d{1,2}|_+)\s+de\s+[a-zçãõéíóú_]+\s+de\s+(?:\d{4}|_+)\.?$/i.test(clean)) {
    return true;
  }
  return false;
}

export function replaceDateInPart2ClosingLine(line: string, datePtBr: string): string {
  const clean = cleanInlineWhitespace(line);
  if (!datePtBr) return clean;
  const datePattern =
    /(,\s*)(?:\d{1,2}|_+)\s+de\s+[a-zçãõéíóú_]+\s+de\s+(?:\d{4}|_+)(\.?)$/i;
  if (datePattern.test(clean)) {
    return clean.replace(datePattern, `$1${datePtBr}$2`);
  }
  if (/^Quartel\b/i.test(clean)) {
    return `${clean.replace(/[,\s.]+$/, '')}, ${datePtBr}`;
  }
  return clean;
}

export function isPart2CenteredFooterTrigger(line: string): boolean {
  const clean = cleanInlineWhitespace(line);
  if (!clean) return false;
  if (isPart2ClosingDateLine(clean)) return true;
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
    updateClosingDate?: boolean;
  }
): string[] {
  const dateLabel =
    options?.datePtBr || formatPtBrDateLong(new Date().toISOString().slice(0, 10));
  const hasTimeUpdate = Boolean(serviceTimeFormatted && serviceTimeFormatted.trim());

  if (existingPart2Lines.length === 0) {
    const timeVal = hasTimeUpdate ? serviceTimeFormatted : '00 a 00 m 00 d';
    return [
      '2ª PARTE',
      formatPart2DotRow('1. TEMPO COMPUTADO DE EFETIVO SERVIÇO (TC)', '00 a 06 m 00 d'),
      formatPart2DotRow('a. Arregimentado', '00 a 06 m 00 d'),
      formatPart2DotRow('b. Não Arregimentado', '00 a 00 m 00 d'),
      formatPart2DotRow('2. TEMPO NÃO COMPUTADO (TNC)', '00 a 00 m 00 d'),
      formatPart2DotRow('3. TEMPO DE SERVIÇO COMPUTÁVEL PARA MEDALHA MILITAR', timeVal),
      formatPart2DotRow('4. TEMPO DE SERVIÇO NACIONAL RELEVANTE (TSNR)', '00 a 00 m 00 d'),
      formatPart2DotRow('5. TEMPO TOTAL DE EFETIVO SERVIÇO (TTES)', timeVal),
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
    if (options?.updateClosingDate && options?.datePtBr && isPart2ClosingDateLine(line)) {
      return replaceDateInPart2ClosingLine(line, options.datePtBr);
    }
    if (!hasTimeUpdate) return line;
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

  if (hasTimeUpdate && !hasItem3) {
    const insertAt = updated.findIndex((l) => /^4\./.test(l));
    const row3 = formatPart2DotRow(
      '3. TEMPO DE SERVIÇO COMPUTÁVEL PARA MEDALHA MILITAR',
      serviceTimeFormatted
    );
    if (insertAt >= 0) updated.splice(insertAt, 0, row3);
    else updated.push(row3);
  }
  if (hasTimeUpdate && !hasItem5) {
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

    blocks.push({
      html: `<p data-alt-month="${escapeAlteracaoHtml(monthName)}">${escapeAlteracaoHtml(monthName)}:</p>`,
      keepWithNext: true,
    });
    blocks.push(spacer());

    const activeMonthItems = doc.items.filter(
      (item) =>
        item.month === monthName && (!enabledIds || enabledIds.has(item.id))
    );

    if (activeMonthItems.length === 0) {
      blocks.push({
        html: `<p data-alt-sem-alt="${escapeAlteracaoHtml(monthName)}">- <u>Sem Alteração</u></p>`,
      });
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
      blocks.push({
        html: `<p data-alt-sem-alt="${escapeAlteracaoHtml(monthName)}">- <u>Sem Alteração</u></p>`,
      });
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
        const effectiveSubtitle = cleanSubtitleAgainstTitle(grp.displayTitle, item.subtitle);
        const subKey = stripDiacriticsUpper(effectiveSubtitle);
        const sameSubtitleAsPrevTableContinuation =
          itemIdx > 0 &&
          (Boolean(item.continueWithoutSubtitle) ||
            (item.kind === 'table' && subKey !== '' && subKey === lastRenderedSubtitleKey));

        const itemAttr = ` data-alt-item="${escapeAlteracaoHtml(item.id)}"`;
        // Bind Subtitle + Table atomically, while text BI paragraphs flow smoothly line-by-line
        // across page boundaries without dragging entire multi-paragraph blocks back and forth.
        const subAtomicId = item.kind === 'table' ? item.id : undefined;

        if (!sameSubtitleAsPrevTableContinuation) {
          if (itemIdx === 0) {
            if (effectiveSubtitle) {
              blocks.push({
                html: `<p${itemAttr}><strong>${escapeAlteracaoHtml(effectiveSubtitle)}</strong></p>`,
                keepWithNext: true,
                atomicGroupId: subAtomicId,
              });
            }
            blocks.push(spacer());
          } else {
            blocks.push(spacer());
            if (effectiveSubtitle) {
              blocks.push({
                html: `<p${itemAttr}><strong>${escapeAlteracaoHtml(effectiveSubtitle)}</strong></p>`,
                keepWithNext: true,
                atomicGroupId: subAtomicId,
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
              atomicGroupId: item.id,
              tableMeta: { rowsHtml, colgroupHtml, headerRowHtml, itemId: item.id },
            });
          }
        } else {
          item.paragraphs.forEach((para) => {
            totalEntries++;
            blocks.push({
              html: `<p${itemAttr}>${escapeAlteracaoHtml(para)}</p>`,
            });
          });
        }
      });
    });
  });

  if (doc.comportamentoLines && doc.comportamentoLines.length > 0) {
    if (blocks.length > 0 && !blocks[blocks.length - 1].isSpacer) {
      blocks.push(spacer());
    }
    doc.comportamentoLines.forEach((compLine) => {
      const isHeading = Boolean(compLine.isBold || isComportamentoHeadingLine(compLine.text));
      const inner = isHeading
        ? `<strong>${escapeAlteracaoHtml(compLine.text)}</strong>`
        : escapeAlteracaoHtml(compLine.text);
      blocks.push({
        html: `<p data-alt-comportamento="true">${inner}</p>`,
        keepWithNext: isHeading,
        atomicGroupId: 'comportamento',
      });
    });
  }

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
    let sawQuartelLine = false;
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
        const isQuartelOrDate =
          /^Quartel\b/i.test(line) || /,\s*\d{1,2}\s+de\s+[a-zç]+\s+de\s+\d{4}\.?$/i.test(line);
        const isSigUnderline = /^[_\-–—]{5,}$/.test(line);

        if (isQuartelOrDate) {
          pushSpacerIfNeeded();
          blocks.push({
            html: `<p style="text-align:center;">${formatLineWithBold(line, boldByIdx[idx])}</p>`,
          });
          sawQuartelLine = true;
          return;
        }

        // Always leave signing space (2 blank lines) between "Quartel da Vila Militar..."
        // and the signature line / Commander's name & role
        if (!addedSigSpacer) {
          if (sawQuartelLine) {
            blocks.push(
              { html: '<p><br></p>', isSpacer: true, preserveIfSpacer: true },
              { html: '<p><br></p>', isSpacer: true, preserveIfSpacer: true }
            );
          } else {
            pushSpacerIfNeeded();
            blocks.push({ html: '<p><br></p>', isSpacer: true, preserveIfSpacer: true });
          }
          addedSigSpacer = true;
        }

        blocks.push({
          html: `<p style="text-align:center;">${formatLineWithBold(line, boldByIdx[idx])}</p>`,
          keepWithNext: isSigUnderline,
        });
        return;
      }

      // Every line in 2ª Parte (1., a., b., 2., 3., 4., 5.) is separated by a blank line
      // ("uma linha pula linha") and has no rigid atomic grouping so each line flows freely.
      pushSpacerIfNeeded();
      blocks.push({
        html: `<p>${formatLineWithBold(line, boldByIdx[idx])}</p>`,
      });
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
 * Renders HTML blocks for a single item (or group header + items) for surgical re-insertion
 * into live edited pages without rebuilding or disturbing content above the insertion point.
 */
export function renderItemBlocksForInsertion(
  itemsToInsert: ParsedAlteracaoSectionItem[],
  opts: {
    includeGroupHeader: boolean;
    groupDisplayTitle?: string;
    monthName: string;
    isFirstItemInGroup: boolean;
    prevSubtitleInGroup?: string;
  }
): AlteracaoHtmlBlock[] {
  const blocks: AlteracaoHtmlBlock[] = [];
  const spacer = (): AlteracaoHtmlBlock => ({ html: '<p><br></p>', isSpacer: true });
  if (itemsToInsert.length === 0) return blocks;

  const displayTitle = opts.groupDisplayTitle || itemsToInsert[0].title;
  const groupKey = `${opts.monthName}::${displayTitle.toUpperCase()}`;

  if (opts.includeGroupHeader) {
    blocks.push({
      html: `<p data-alt-group="${escapeAlteracaoHtml(groupKey)}"><strong>${escapeAlteracaoHtml(displayTitle)}</strong></p>`,
      keepWithNext: true,
    });
  }

  let lastRenderedSubtitleKey = opts.prevSubtitleInGroup
    ? stripDiacriticsUpper(opts.prevSubtitleInGroup)
    : '';

  itemsToInsert.forEach((item, idx) => {
    const isFirst = opts.isFirstItemInGroup && idx === 0;
    const effectiveSubtitle = cleanSubtitleAgainstTitle(displayTitle, item.subtitle);
    const subKey = stripDiacriticsUpper(effectiveSubtitle);
    const sameSubtitleAsPrevTableContinuation =
      !isFirst &&
      (Boolean(item.continueWithoutSubtitle) ||
        (item.kind === 'table' && subKey !== '' && subKey === lastRenderedSubtitleKey));

    const itemAttr = ` data-alt-item="${escapeAlteracaoHtml(item.id)}"`;
    const subAtomicId = item.kind === 'table' ? item.id : undefined;

    if (!sameSubtitleAsPrevTableContinuation) {
      if (isFirst) {
        if (effectiveSubtitle) {
          blocks.push({
            html: `<p${itemAttr}><strong>${escapeAlteracaoHtml(effectiveSubtitle)}</strong></p>`,
            keepWithNext: true,
            atomicGroupId: subAtomicId,
          });
        }
        blocks.push(spacer());
      } else {
        blocks.push(spacer());
        if (effectiveSubtitle) {
          blocks.push({
            html: `<p${itemAttr}><strong>${escapeAlteracaoHtml(effectiveSubtitle)}</strong></p>`,
            keepWithNext: true,
            atomicGroupId: subAtomicId,
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
        blocks.push({
          html: buildAlteracaoTableHtml(rowsHtml, item.id, colgroupHtml),
          atomicGroupId: item.id,
          tableMeta: { rowsHtml, colgroupHtml, headerRowHtml, itemId: item.id },
        });
      }
    } else {
      item.paragraphs.forEach((para) => {
        blocks.push({
          html: `<p${itemAttr}>${escapeAlteracaoHtml(para)}</p>`,
        });
      });
    }
  });

  return blocks;
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
  const comportamentoLines: ComportamentoDocLine[] = [];
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
  let lastRawLineForEntry: RawAlteracaoLine | null = null;
  let lastRawLineForComportamento: RawAlteracaoLine | null = null;
  let inComportamento = false;
  let inPart2 = false;
  let itemSeq = 0;

  const hasFurtherMonthsOrDatedBiAfter = (fromIdx: number): boolean => {
    for (let k = fromIdx + 1; k < bodyLines.length; k++) {
      const candidate = bodyLines[k];
      if (candidate.tableRows && candidate.tableRows.length > 0) return true;
      const t = cleanInlineWhitespace(candidate.text);
      if (!t) continue;
      if (isPart2Line(t)) return false;
      if (normalizeMonthHeading(t)) return true;
      if (/^[-–—]\s*(?:a\s+\d{1,2}|em\s+\d{1,2}|\d{1,2}[\/\.])/i.test(t)) return true;
      if (/\b(?:BI|BOL|BOLETIM|ADIT|PORTARIA)\s*N[º°o]/i.test(t)) return true;
    }
    return false;
  };

  const KEEP_HYPHEN_PREFIX_RE =
    /(?:^|[\s(])(sub|ex|vice|p[óo]s|pr[ée]|pr[óo]|anti|auto|contra|extra|infra|inter|intra|macro|micro|mini|multi|neo|pan|proto|pseudo|semi|sobre|super|supra|ultra|bem|mal|rec[ée]m|al[ée]m|aqu[ée]m|guarda|tenente|capit[ãa]o|major|general|sargento|cabo|soldado|primeiro|segundo|terceiro)-$/i;

  const TRAILING_CONNECTOR_RE =
    /(?:,|\(|\/|\b(?:de|da|do|das|dos|em|no|na|nos|nas|para|por|com|sem|ao|aos|à|às|e|ou|que|o|a|os|as|um|uma|pelo|pela|pelos|pelas|conforme|mediante|referente|relativo|segundo|sobre|sob|entre|at[ée]|ap[óo]s|desde|n[º°o]|nr))$/i;

  const joinContinuationText = (prevText: string, contText: string): string => {
    const cleanPrev = prevText.trimEnd();
    const cleanCont = contText.trimStart();
    if (!cleanPrev) return cleanCont;
    if (!cleanCont) return cleanPrev;
    // Rejoin soft-wrapped hyphenated words (e.g. "desig-" + "nação" -> "designação")
    if (
      /[A-Za-zÀ-ÿ]-$/.test(cleanPrev) &&
      /^[a-zà-ÿ]/.test(cleanCont) &&
      !KEEP_HYPHEN_PREFIX_RE.test(cleanPrev)
    ) {
      return `${cleanPrev.slice(0, -1)}${cleanCont}`;
    }
    return `${cleanPrev} ${cleanCont}`;
  };

  const looksLikeMidSentenceContinuation = (
    prevText: string,
    currRaw: RawAlteracaoLine,
    crossedPageBreak: boolean
  ): boolean => {
    const prevClean = prevText.trim();
    const currClean = cleanInlineWhitespace(currRaw.text);
    if (!prevClean || !currClean) return false;
    if (
      isEntryStartLine(currClean) ||
      normalizeMonthHeading(currClean) ||
      isPart1Line(currClean) ||
      isPart2Line(currClean) ||
      isSemAlteracaoLine(currClean) ||
      isComportamentoHeadingLine(currClean) ||
      isKnownMajorSectionTitle(currClean)
    ) {
      return false;
    }

    const prevEndedSentence =
      /[.;!?]$/.test(prevClean) && !ABBREV_END_RE.test(prevClean) && !/\d\.$/.test(prevClean);

    // 1. Hyphenated word split across line or page break
    if (/[A-Za-zÀ-ÿ]-$/.test(prevClean) && /^[a-zà-ÿ]/.test(currClean)) {
      return true;
    }

    // 2. Next line starts with lowercase or closing punctuation -> almost always continuation
    if (/^[a-zà-ÿ,;\)\]]/.test(currClean) && !currRaw.isBold) {
      return true;
    }

    // 3. Previous line ended with an open connector/preposition/comma/parenthesis
    if (!prevEndedSentence && TRAILING_CONNECTOR_RE.test(prevClean) && !currRaw.isBold) {
      return true;
    }

    // 4. Across a page break: if previous sentence was clearly NOT finished and next line isn't a bold heading
    if (
      crossedPageBreak &&
      !prevEndedSentence &&
      !/:$/.test(prevClean) &&
      !currRaw.isBold &&
      !isUppercaseHeadingCandidate(currClean)
    ) {
      return true;
    }

    return false;
  };

  const shouldBreakBeforeLine = (
    prevRaw: RawAlteracaoLine | null,
    currRaw: RawAlteracaoLine,
    prevText: string
  ): boolean => {
    const crossedPageBreak = Boolean(
      currRaw.skippedHeaderBefore || prevRaw?.crossPageAfter
    );

    // Linguistic continuation overrides false hard breaks caused by page boundaries or PDF-to-DOCX splits
    if (looksLikeMidSentenceContinuation(prevText, currRaw, crossedPageBreak)) {
      return false;
    }

    if (currRaw.hardBreakBefore === true) return true;
    if (!crossedPageBreak && prevRaw?.hardBreakAfter === true) return true;
    if (prevRaw?.hardBreakAfter === false) return false;

    // Cross-page PDF line wrap check after continuation headers were stripped
    if (
      prevRaw &&
      typeof prevRaw.pdfXEnd === 'number' &&
      typeof prevRaw.pdfRightMargin === 'number'
    ) {
      const remaining = prevRaw.pdfRightMargin - prevRaw.pdfXEnd;
      const nextWordW = currRaw.pdfFirstWordWidth ?? 28;
      return remaining > Math.max(28, nextWordW + 16);
    }
    return /[.;!?]$/.test(prevText) && !ABBREV_END_RE.test(prevText) && !/\d\.$/.test(prevText);
  };

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

    // Structured data table inside body (if already in 2ª PARTE, convert table rows back to part2 lines)
    if (raw.tableRows && raw.tableRows.length > 0) {
      inComportamento = false;
      lastRawLineForComportamento = null;
      if (inPart2) {
        for (const r of raw.tableRows) {
          const joined = r.map((c) => cleanInlineWhitespace(c)).filter(Boolean).join(' ');
          if (joined) part2Lines.push(joined);
        }
        continue;
      }

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
      lastRawLineForEntry = null;
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
      inComportamento = false;
      lastRawLineForComportamento = null;
      inPart2 = true;
      part2Lines.push('2ª PARTE');
      continue;
    }

    // Standalone Comportamento section at the end of 1ª Parte (right before 2ª Parte)
    if (inComportamento) {
      const prevComp = comportamentoLines[comportamentoLines.length - 1];
      if (
        prevComp &&
        !isComportamentoHeadingLine(prevComp.text) &&
        !isEntryStartLine(text) &&
        (isBiHeaderColonPrefix(prevComp.text) ||
          !shouldBreakBeforeLine(lastRawLineForComportamento, raw, prevComp.text))
      ) {
        prevComp.text = `${prevComp.text.replace(/\s+:$/, ':')} ${text}`;
      } else {
        comportamentoLines.push({
          text: isEntryStartLine(text) ? normalizeEntryColon(text) : text,
          isBold: Boolean(raw.isBold || isComportamentoHeadingLine(text)),
        });
      }
      lastRawLineForComportamento = raw;
      continue;
    }

    if (isAnyComportamentoLine(text) && !hasFurtherMonthsOrDatedBiAfter(i)) {
      inComportamento = true;
      currentEntryItem = null;
      lastRawLineForEntry = null;
      comportamentoLines.push({
        text: isEntryStartLine(text) ? normalizeEntryColon(text) : text,
        isBold: Boolean(raw.isBold || isComportamentoHeadingLine(text)),
      });
      lastRawLineForComportamento = raw;
      continue;
    }

    const maybeMonth = normalizeMonthHeading(text);
    if (maybeMonth) {
      currentMonthName = registerMonth(maybeMonth);
      lastTitleInMonth = '';
      currentTitle = '';
      currentSubtitle = '';
      currentEntryItem = null;
      lastRawLineForEntry = null;
      continue;
    }

    if (isSemAlteracaoLine(text)) {
      getActiveMonth();
      currentEntryItem = null;
      lastRawLineForEntry = null;
      continue;
    }

    // Mid-document COMPORTAMENTO heading: always isolate as its own standalone Title, never merged into previous BI
    if (isComportamentoHeadingLine(text)) {
      currentTitle = text.replace(/:$/, '').toUpperCase();
      lastTitleInMonth = currentTitle;
      lastKnownTitleOverall = currentTitle;
      currentSubtitle = '';
      currentEntryItem = null;
      lastRawLineForEntry = null;
      continue;
    }

    const lastPara =
      currentEntryItem && currentEntryItem.paragraphs.length > 0
        ? currentEntryItem.paragraphs[currentEntryItem.paragraphs.length - 1]
        : '';
    const crossedPageHere = Boolean(
      raw.skippedHeaderBefore || lastRawLineForEntry?.crossPageAfter
    );

    // If a continuation page repeats the already-active Title or Subtitle right after a page break,
    // skip the repeated header WITHOUT breaking or duplicating the ongoing entry!
    if (crossedPageHere && currentEntryItem && currentEntryItem.paragraphs.length > 0) {
      const normText = stripDiacriticsUpper(text);
      const activeTitleNorm = stripDiacriticsUpper(resolveActiveTitle());
      const activeSubtitleNorm = currentSubtitle ? stripDiacriticsUpper(currentSubtitle) : '';
      const activeMonthNorm = currentMonthName ? stripDiacriticsUpper(currentMonthName) : '';
      if (
        (activeTitleNorm && normText === activeTitleNorm) ||
        (activeSubtitleNorm && normText === activeSubtitleNorm) ||
        (activeMonthNorm && (normText === activeMonthNorm || normText === `${activeMonthNorm}:`))
      ) {
        continue;
      }
    }

    const prevParaEndedSentence =
      !lastPara || (/[.;!?]$/.test(lastPara) && !ABBREV_END_RE.test(lastPara));
    const prevParaEndsColon = /:$/.test(lastPara);
    const prevIsBiColon = isBiHeaderColonPrefix(lastPara);
    const isMidSentenceCont =
      Boolean(lastPara) && looksLikeMidSentenceContinuation(lastPara, raw, crossedPageHere);
    // Allow starting a new Title/Subtitle whenever we're NOT waiting for BI body text right after
    // "- a DD, BI Nº XX:", and NOT clearly continuing an unfinished sentence across a page/line break.
    const canStartHeading =
      !prevIsBiColon &&
      !isMidSentenceCont &&
      (!lastPara ||
        prevParaEndedSentence ||
        (!crossedPageHere && lastRawLineForEntry?.hardBreakAfter === true) ||
        raw.hardBreakBefore === true ||
        (!prevParaEndsColon && Boolean(raw.isBold)));

    const nextLine = i + 1 < bodyLines.length ? bodyLines[i + 1] : undefined;
    const nextStartsEntryOrTable = Boolean(
      nextLine && (Boolean(nextLine.tableRows) || isEntryStartLine(nextLine.text))
    );

    const consumeWrappedSubtitle = (initialRaw: RawAlteracaoLine, baseSubtitle: string): string => {
      let acc = baseSubtitle;
      let prevHeadingRaw = initialRaw;
      while (prevHeadingRaw.hardBreakAfter === false && i + 1 < bodyLines.length) {
        const cont = bodyLines[i + 1];
        if (!cont || cont.tableRows) break;
        const contText = cleanInlineWhitespace(cont.text);
        if (
          !contText ||
          isEntryStartLine(contText) ||
          isSemAlteracaoLine(contText) ||
          normalizeMonthHeading(contText) ||
          isPart1Line(contText) ||
          isPart2Line(contText) ||
          isAnyComportamentoLine(contText) ||
          splitTitleSubtitleDash(contText, true, Boolean(cont.isBold)) ||
          isKnownMajorSectionTitle(contText)
        ) {
          break;
        }
        acc = `${acc} ${contText}`;
        prevHeadingRaw = cont;
        i++;
      }
      return cleanInlineWhitespace(acc);
    };

    // 0. Guard: standalone "Férias" / "FÉRIAS" line is ALWAYS subtitle, NEVER title
    if (!prevIsBiColon && isNonTitleTopic(text) && !isEntryStartLine(text)) {
      const parentTitle = resolveActiveTitle();
      currentTitle = parentTitle;
      lastTitleInMonth = parentTitle;
      lastKnownTitleOverall = parentTitle;
      currentEntryItem = null;
      lastRawLineForEntry = null;

      if (
        nextLine &&
        !nextLine.tableRows &&
        !isEntryStartLine(nextLine.text) &&
        !isSemAlteracaoLine(nextLine.text) &&
        !normalizeMonthHeading(nextLine.text) &&
        !isPart2Line(nextLine.text) &&
        !/[.;!?]$/.test(nextLine.text) &&
        nextLine.text.length <= 160
      ) {
        i++;
        currentSubtitle = consumeWrappedSubtitle(
          nextLine,
          `${normalizeFeriasPrefix(text)} - ${cleanInlineWhitespace(nextLine.text)}`
        );
      } else {
        currentSubtitle = normalizeFeriasPrefix(text);
      }
      continue;
    }

    // 1. Check "TÍTULO - Subtítulo" on single line: Title in bold, EVERYTHING after dash is Subtitle in bold
    const splitDash = splitTitleSubtitleDash(
      text,
      !prevIsBiColon &&
        (Boolean(raw.isBold) ||
          Boolean(raw.boldSubstring) ||
          canStartHeading ||
          nextStartsEntryOrTable),
      Boolean(raw.isBold)
    );
    if (splitDash) {
      if (splitDash.isSubtitleOnly || !splitDash.title) {
        const parentTitle = resolveActiveTitle();
        currentTitle = parentTitle;
        lastTitleInMonth = parentTitle;
        lastKnownTitleOverall = parentTitle;
        currentSubtitle = cleanSubtitleAgainstTitle(
          parentTitle,
          consumeWrappedSubtitle(raw, splitDash.subtitle)
        );
      } else {
        currentTitle = splitDash.title;
        lastTitleInMonth = splitDash.title;
        lastKnownTitleOverall = splitDash.title;
        currentSubtitle = cleanSubtitleAgainstTitle(
          splitDash.title,
          consumeWrappedSubtitle(raw, splitDash.subtitle)
        );
      }
      currentEntryItem = null;
      lastRawLineForEntry = null;
      continue;
    }

    // 2. Check standalone Bold/Uppercase Title line (e.g., "INSTRUÇÃO" followed by Subtitle or table)
    const nextLooksLikeSubtitleOrEntry = Boolean(
      nextLine &&
        (Boolean(nextLine.tableRows) ||
          isEntryStartLine(nextLine.text) ||
          (nextLine.isBold && !isUppercaseHeadingCandidate(nextLine.text)))
    );
    const isStandaloneUpper =
      !prevIsBiColon &&
      (Boolean(raw.isBold) || canStartHeading || nextLooksLikeSubtitleOrEntry) &&
      isUppercaseHeadingCandidate(text);

    if (isStandaloneUpper) {
      currentTitle = text.toUpperCase();
      lastTitleInMonth = currentTitle;
      lastKnownTitleOverall = currentTitle;
      currentSubtitle = '';
      currentEntryItem = null;
      lastRawLineForEntry = null;

      // If this Title soft-wrapped onto the next line containing "REMAINDER - Subtitle"
      if (raw.hardBreakAfter === false && i + 1 < bodyLines.length && !bodyLines[i + 1].tableRows) {
        const wrappedNext = bodyLines[i + 1];
        const wrappedSplit = splitTitleSubtitleDash(
          wrappedNext.text,
          true,
          Boolean(wrappedNext.isBold)
        );
        if (wrappedSplit && wrappedSplit.title && !wrappedSplit.isSubtitleOnly) {
          currentTitle = `${currentTitle} ${wrappedSplit.title}`.toUpperCase();
          lastTitleInMonth = currentTitle;
          lastKnownTitleOverall = currentTitle;
          i++;
          currentSubtitle = cleanSubtitleAgainstTitle(
            currentTitle,
            consumeWrappedSubtitle(wrappedNext, wrappedSplit.subtitle)
          );
          continue;
        }
      }

      // Skip any immediately repeated duplicate Title line (bold or non-bold)
      while (
        i + 1 < bodyLines.length &&
        !bodyLines[i + 1].tableRows &&
        stripDiacriticsUpper(bodyLines[i + 1].text) === stripDiacriticsUpper(currentTitle)
      ) {
        i++;
      }

      const candSubLine = i + 1 < bodyLines.length ? bodyLines[i + 1] : undefined;
      const afterCandSubLine = i + 2 < bodyLines.length ? bodyLines[i + 2] : undefined;

      if (candSubLine && !candSubLine.tableRows) {
        const candClean = cleanInlineWhitespace(candSubLine.text);
        const candSplit = splitTitleSubtitleDash(candClean, true, Boolean(candSubLine.isBold));

        if (candSplit) {
          if (
            candSplit.isSubtitleOnly ||
            stripDiacriticsUpper(candSplit.title) === stripDiacriticsUpper(currentTitle)
          ) {
            // e.g. "INSTRUÇÃO" followed by "INSTRUÇÃO - 1º TAF" -> keep ONLY "1º TAF" as Subtitle
            i++;
            currentSubtitle = cleanSubtitleAgainstTitle(
              currentTitle,
              consumeWrappedSubtitle(candSubLine, candSplit.subtitle)
            );
          }
          // Else candSubLine is a DIFFERENT "TÍTULO2 - Subtítulo2" -> leave it for the next iteration!
        } else if (
          candClean &&
          !isEntryStartLine(candClean) &&
          !isSemAlteracaoLine(candClean) &&
          !normalizeMonthHeading(candClean) &&
          !isPart1Line(candClean) &&
          !isPart2Line(candClean) &&
          !isAnyComportamentoLine(candClean) &&
          !isKnownMajorSectionTitle(candClean) &&
          !/[.;!?]$/.test(candClean) &&
          candClean.length <= 220 &&
          (!isUppercaseHeadingCandidate(candClean) ||
            Boolean(
              afterCandSubLine &&
                (afterCandSubLine.tableRows || isEntryStartLine(afterCandSubLine.text))
            ))
        ) {
          i++;
          currentSubtitle = cleanSubtitleAgainstTitle(
            currentTitle,
            consumeWrappedSubtitle(candSubLine, candClean)
          );
        }
      }
      continue;
    }

    // 3. Check standalone bold Subtitle (or plain-text subtitle right before an entry start or table)
    if (
      canStartHeading &&
      !isEntryStartLine(text) &&
      !isSemAlteracaoLine(text) &&
      !/[.;!?,:]$/.test(text) &&
      text.length <= 200 &&
      (lastTitleInMonth || lastKnownTitleOverall) &&
      (raw.isBold ||
        (nextLine &&
          (Boolean(nextLine.tableRows) || isEntryStartLine(nextLine.text)) &&
          !/^[a-zà-ÿ]/.test(text) &&
          !/\b(?:BI\s*n[º°o]|publicado|portaria|conforme)\b/i.test(text)))
    ) {
      const parentTitle = resolveActiveTitle();
      if (stripDiacriticsUpper(text) === stripDiacriticsUpper(parentTitle)) {
        // Never duplicate the active Title as a Subtitle
        continue;
      }
      currentTitle = parentTitle;
      lastTitleInMonth = parentTitle;
      currentSubtitle = cleanSubtitleAgainstTitle(
        parentTitle,
        consumeWrappedSubtitle(raw, text)
      );
      currentEntryItem = null;
      lastRawLineForEntry = null;
      continue;
    }

    // 4. Entry paragraph starting with "- ..."
    if (isEntryStartLine(text)) {
      const normalized = normalizeEntryColon(text);
      const isNewDatedBiEntry =
        /^[-–—]\s*(?:a\s+\d{1,2}|em\s+\d{1,2}|de\s+\d{1,2}|no\s+dia\s+\d{1,2}|\d{1,2}[\/\.])/i.test(
          normalized
        ) || /\b(?:BI|BOL|BOLETIM|ADIT|ADITAMENTO|PORTARIA)\s*N[º°o]/i.test(normalized);

      // Keep undated sub-bullets inside their parent BI; if the previous line is "- a DD, BI Nº XX:",
      // pull this opening text right up after the colon.
      if (currentEntryItem && currentEntryItem.paragraphs.length > 0 && !isNewDatedBiEntry) {
        const lastIdx = currentEntryItem.paragraphs.length - 1;
        const prevLine = currentEntryItem.paragraphs[lastIdx];
        if (isBiHeaderColonPrefix(prevLine)) {
          const strippedLead = normalized.replace(/^[-–—]\s*/, '');
          currentEntryItem.paragraphs[lastIdx] = `${prevLine.replace(/\s+:$/, ':')} ${strippedLead}`;
        } else {
          currentEntryItem.paragraphs.push(normalized);
        }
        lastRawLineForEntry = raw;
        continue;
      }

      currentEntryItem = ensureCurrentEntryItem();
      currentEntryItem.paragraphs.push(normalized);
      lastRawLineForEntry = raw;
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

    // 6. Continuation line inside an entry:
    //    - ALWAYS pull BI body text up immediately after "- a XX, BI Nº YY:"
    //    - Otherwise distinguish soft wrap (ran out of space) vs intentional line break
    if (currentEntryItem && currentEntryItem.paragraphs.length > 0) {
      const idx = currentEntryItem.paragraphs.length - 1;
      const prev = currentEntryItem.paragraphs[idx];
      const cleanedCont = text.replace(/([0-9º°ª\)])\s+:(?=\s|$)/g, '$1:');

      // Prevent duplicated tail/line re-emission inside the same paragraph (e.g. overlapping PDF layers across pages)
      const normPrev = stripDiacriticsUpper(prev);
      const normCont = stripDiacriticsUpper(cleanedCont);
      if (
        normCont.length >= 24 &&
        (normPrev === normCont || normPrev.endsWith(normCont))
      ) {
        lastRawLineForEntry = raw;
        continue;
      }

      const isIntentionalBreak = shouldBreakBeforeLine(lastRawLineForEntry, raw, prev);

      if (/^:\s*/.test(cleanedCont)) {
        const afterColon = cleanedCont.replace(/^:\s*/, '');
        const trimmedPrev = prev.replace(/\s*:?\s*$/, ':');
        currentEntryItem.paragraphs[idx] = afterColon ? `${trimmedPrev} ${afterColon}` : trimmedPrev;
      } else if (isBiHeaderColonPrefix(prev)) {
        // Pull the opening text of the BI onto the SAME line immediately after "- a DD, BI Nº XX:"
        currentEntryItem.paragraphs[idx] = `${prev.replace(/\s+:$/, ':')} ${cleanedCont}`;
      } else if (isIntentionalBreak) {
        // Never leak a stray repeated non-bold copy of the active Title into the BI body
        if (stripDiacriticsUpper(cleanedCont) === stripDiacriticsUpper(resolveActiveTitle())) {
          lastRawLineForEntry = raw;
          continue;
        }
        // Source document intentionally started a new line (e.g., TAF/pensionista sub-lines)
        currentEntryItem.paragraphs.push(normalizeEntryColon(cleanedCont));
      } else if (/:$/.test(prev)) {
        currentEntryItem.paragraphs[idx] = `${prev.replace(/\s+:$/, ':')} ${cleanedCont}`;
      } else {
        // Soft wrap or cross-page sentence continuation -> join cleanly onto same paragraph
        currentEntryItem.paragraphs[idx] = joinContinuationText(prev, cleanedCont);
      }
      lastRawLineForEntry = raw;
      continue;
    }

    // Fallback: orphan line before any "- " bullet inside a section
    if (stripDiacriticsUpper(text) === stripDiacriticsUpper(resolveActiveTitle())) {
      continue;
    }
    currentEntryItem = ensureCurrentEntryItem();
    const norm = normalizeEntryColon(text);
    currentEntryItem.paragraphs.push(norm);
    lastRawLineForEntry = raw;
    currentEntryItem.previewLabel = currentEntryItem.subtitle || norm.slice(0, 70);
  }

  for (const item of items) {
    if (item.kind === 'entry' && item.paragraphs.length > 0) {
      item.paragraphs = item.paragraphs.map((p) => singularizeMilitaryGroupText(p));
      if (!item.subtitle) {
        item.previewLabel = item.paragraphs[0].slice(0, 70);
      }
    }
  }

  const structuredDoc: StructuredAlteracaoDoc = {
    items,
    monthOrder,
    comportamentoLines: comportamentoLines.length > 0 ? comportamentoLines : undefined,
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
