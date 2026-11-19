import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker } from 'tesseract.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type CrachaColumnRole =
  | 'posto'
  | 'nome_guerra'
  | 'nome_completo'
  | 'documento'
  | 'categoria'
  | 'ordem'
  | 'outro';

export const CRACHA_COLUMN_ROLE_LABELS: Record<CrachaColumnRole, string> = {
  posto: 'Posto/Graduação',
  nome_guerra: 'Nome de Guerra',
  nome_completo: 'Nome Completo',
  documento: 'Documento',
  categoria: 'OM / Função / Categoria',
  ordem: 'Ordem / Número',
  outro: 'Outro campo',
};

export interface CrachaDocumentColumn {
  id: string;
  label: string;
  sample: string;
  samples: string[];
  isGenericLabel: boolean;
  detectedRole: CrachaColumnRole;
  detectedRoleLabel: string;
  detectedBy: 'synonym' | 'content' | 'none';
  docSubKind?: 'cpf' | 'identidade' | 'outro';
}

export interface CrachaSuggestedMapping {
  identPrefixo: string;
  identPrincipal: string;
  identSecundario: string;
  identTop: string;
  identBottom: string;
  identBack: string;
  rpPrefixo: string;
  rpPrincipal: string;
  rpTop: string;
  rpBottom: string;
  rpBack: string;
}

export interface ExtractedCrachaDocument {
  fileName: string;
  sourceKind: 'tabela' | 'lista' | 'ocr';
  hasExplicitHeader: boolean;
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
  identPrefixo: CrachaSlotRef;
  identPrincipal: CrachaSlotRef;
  identSecundario: CrachaSlotRef;
  identTop: CrachaSlotRef;
  identBottom: CrachaSlotRef;
  identBack: CrachaSlotRef;
  rpPrefixo: CrachaSlotRef;
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

export function composePrefixedText(prefix: string, main: string): string {
  const p = cleanCellText(prefix);
  const m = cleanCellText(main);
  if (!p) return m;
  if (!m) return p;
  const pNorm = stripDiacriticsUpper(p);
  const mNorm = stripDiacriticsUpper(m);
  if (mNorm === pNorm || mNorm.startsWith(`${pNorm} `)) {
    return m;
  }
  return `${p} ${m}`;
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

// ==================== SYNONYM & CONTENT CLASSIFICATION ====================

const RANK_PREFIX_RE =
  /^(?:GEN(?:\s+(?:EX|DIV|BDA))?|CEL|TEN\s*CEL|TC|MAJ|CAP|1[º°O]?\s*TEN|2[º°O]?\s*TEN|ASP(?:\s*OF)?|ST|SUB\s*TEN|SUBTEN|1[º°O]?\s*SGT|2[º°O]?\s*SGT|3[º°O]?\s*SGT|CB|SD(?:\s*(?:EP|EV|NB|RCR))?|AL|CAD|SR\.?|SRA\.?)\s+/i;

const RANK_EXACT_RE =
  /^(?:GEN(?:\s+(?:EX|DIV|BDA))?|CEL|TEN\.?\s*CEL\.?|TC|MAJ|CAP|1[º°O]?\s*TEN|2[º°O]?\s*TEN|ASP(?:\s*OF)?|ST|SUB\s*TEN|SUBTEN|1[º°O]?\s*SGT|2[º°O]?\s*SGT|3[º°O]?\s*SGT|SGT|CB|SD(?:\s*(?:EP|EV|NB|RCR))?|AL|CAD|CIVIL|SC|SERVIDOR\s+CIVIL)\.?$/i;

const CPF_VALUE_RE = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/;
const CPF_DIGITS_RE = /^\d{11}$/;
const IDT_HYPHEN_RE = /^\d{5,11}-[A-Z0-9]{1,2}$/i;
const IDT_GENERIC_RE = /^(?:\d{7,12}|[A-Z]{2,3}[-\s]?\d{5,10}|\d{2}\.\d{3}\.\d{3}-[A-Z0-9])$/i;

const NAME_PARTICLES = new Set(['DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'D']);

interface RoleClassificationResult {
  role: CrachaColumnRole;
  docSubKind?: 'cpf' | 'identidade' | 'outro';
}

interface ColumnSynonymRule {
  role: CrachaColumnRole;
  patterns: RegExp[];
  exclude?: RegExp;
}

const COLUMN_SYNONYM_RULES: ColumnSynonymRule[] = [
  // 1. Nome de Guerra (check before Nome Completo and Posto so "NOME DE GUERRA" never falls into generic NOME)
  {
    role: 'nome_guerra',
    patterns: [
      /\bGUERRA\b/,
      /\bN\.?\s*GUERRA\b/,
      /\bNOM\.?\s*GUERRA\b/,
      /\bN\s*DE\s*GUERRA\b/,
      /^NG$/,
      /\bAPELIDO\b/,
    ],
  },
  // 2. Documento (CPF / Identidade / RG / Matrícula — check before Ordem so "NR IDT" / "N CPF" match Documento)
  {
    role: 'documento',
    patterns: [
      /\bCPF\b/,
      /\bIDENTIDADE\b/,
      /\bIDT\b/,
      /\bID\.?\s*MIL(?:ITAR)?\b/,
      /^ID$/,
      /\bRG\b/,
      /\bDOCUMENTO\b/,
      /\bDOC\.?\b/,
      /\bMATRICULA\b/,
      /\bSARAM\b/,
      /\bSIAPE\b/,
      /\bPREC(?:[-\s]?CP)?\b/,
      /\bREGISTRO\b/,
      /\bPASSAPORTE\b/,
      /\bCNH\b/,
    ],
  },
  // 3. Posto / Graduação (exclude compound columns like "POSTO E NOME")
  {
    role: 'posto',
    patterns: [
      /\bPOSTO\b/,
      /\bGRADUACAO\b/,
      /\bGRAD\.?\b/,
      /\bP\s*\/\s*G\b/,
      /\bP\s*-\s*G\b/,
      /^PG$/,
      /^PST$/,
      /\bPATENTE\b/,
    ],
    exclude: /\b(NOME|GUERRA)\b/,
  },
  // 4. Nome Completo
  {
    role: 'nome_completo',
    patterns: [
      /\bNOME\b/,
      /\bMILITAR\b/,
      /\bSERVIDOR\b/,
      /\bPARTICIPANTE\b/,
      /\bFUNCIONARIO\b/,
      /\bCOLABORADOR\b/,
      /\bPERMISSIONARIO\b/,
      /\bVISITANTE\b/,
      /\bINTEGRANTE\b/,
      /\bALUNO\b/,
      /\bCANDIDATO\b/,
      /\bTITULAR\b/,
      /\bBENEFICIARIO\b/,
      /\bCONDUTOR\b/,
      /\bMOTORISTA\b/,
      /\bPESSOA\b/,
    ],
    exclude: /\bGUERRA\b/,
  },
  // 5. Ordem / Número
  {
    role: 'ordem',
    patterns: [
      /\bORDEM\b/,
      /\bORD\.?\b/,
      /^NR\.?$/,
      /^N[º°O.]?$/,
      /^NO\.?$/,
      /\bNRO\.?\b/,
      /\bNUMERO\b/,
      /^NUM\.?$/,
      /\bSEQ(?:UENCIA)?\.?\b/,
      /\bITEM\b/,
      /^#$/,
      /\bCRACHA\b/,
    ],
  },
  // 6. OM / Função / Setor / Categoria
  {
    role: 'categoria',
    patterns: [
      /\bOM\b/,
      /\bUNIDADE\b/,
      /\bSUBUNIDADE\b/,
      /^SU$/,
      /\bCIA\b/,
      /\bCOMPANHIA\b/,
      /\bPELOTAO\b/,
      /\bBATERIA\b/,
      /\bESQUADRAO\b/,
      /\bSETOR\b/,
      /\bSECAO\b/,
      /\bSEC\.?\b/,
      /\bDIVISAO\b/,
      /\bFUNCAO\b/,
      /\bCARGO\b/,
      /\bEMPRESA\b/,
      /\bORGAO\b/,
      /\bCATEGORIA\b/,
      /\bVINCULO\b/,
      /\bEQUIPE\b/,
      /\bDESTINO\b/,
      /\bLOCAL\b/,
      /\bATIVIDADE\b/,
      /\bQUADRO\b/,
      /\bARMA\b/,
      /\bSERVICO\b/,
      /\bQMS\b/,
      /\bESPECIALIDADE\b/,
      /\bPLACA\b/,
      /\bVEICULO\b/,
    ],
  },
];

function detectDocSubKindFromLabel(normLabel: string): 'cpf' | 'identidade' | 'outro' {
  if (/\bCPF\b/.test(normLabel)) return 'cpf';
  if (/\b(IDENTIDADE|IDT|RG|ID\.?\s*MIL)\b/.test(normLabel) || normLabel === 'ID') {
    return 'identidade';
  }
  return 'outro';
}

export function classifyHeaderBySynonym(rawLabel: string): RoleClassificationResult {
  const norm = stripDiacriticsUpper(rawLabel);
  if (!norm) return { role: 'outro' };

  for (const rule of COLUMN_SYNONYM_RULES) {
    if (rule.exclude && rule.exclude.test(norm)) continue;
    if (rule.patterns.some((re) => re.test(norm))) {
      return {
        role: rule.role,
        docSubKind: rule.role === 'documento' ? detectDocSubKindFromLabel(norm) : undefined,
      };
    }
  }
  return { role: 'outro' };
}

function classifyColumnByContent(values: string[]): RoleClassificationResult {
  const nonEmpty = values.map(cleanCellText).filter(Boolean).slice(0, 15);
  if (nonEmpty.length === 0) return { role: 'outro' };

  const ratio = (pred: (v: string) => boolean) =>
    nonEmpty.filter(pred).length / nonEmpty.length;

  // 1. Military ranks (Posto / Graduação)
  if (ratio((v) => RANK_EXACT_RE.test(v)) >= 0.5) {
    return { role: 'posto' };
  }

  // 2. CPF
  if (ratio((v) => CPF_VALUE_RE.test(v) || CPF_DIGITS_RE.test(v.replace(/\D/g, '')) && /^\d[\d.\-\s]{10,14}$/.test(v)) >= 0.5) {
    return { role: 'documento', docSubKind: 'cpf' };
  }

  // 3. Identidade / RG / Matrícula
  if (ratio((v) => IDT_HYPHEN_RE.test(v) || IDT_GENERIC_RE.test(v)) >= 0.5) {
    return { role: 'documento', docSubKind: 'identidade' };
  }

  // 4. Ordem / Sequential small numbers
  if (ratio((v) => /^\d{1,4}[º°.)\-]?$/.test(v)) >= 0.7) {
    return { role: 'ordem' };
  }

  // 5. Full names (>= 2 alphabetic words, not pure numbers or ranks)
  const isWordAlpha = (w: string) => /^[A-Za-zÀ-ÿ'.-]{2,}$/.test(w);
  if (
    ratio((v) => {
      if (RANK_EXACT_RE.test(v) || /\d{3,}/.test(v)) return false;
      const words = v.split(/\s+/).filter(Boolean);
      return words.length >= 2 && words.filter(isWordAlpha).length >= 2 && v.length >= 7;
    }) >= 0.5
  ) {
    return { role: 'nome_completo' };
  }

  // 6. Single-word (or short 2-word) war names (avoid constant repeated labels like "ATIVA")
  const distinctCount = new Set(nonEmpty.map((v) => stripDiacriticsUpper(v))).size;
  if (
    (nonEmpty.length === 1 || distinctCount >= Math.min(2, nonEmpty.length)) &&
    ratio((v) => {
      if (RANK_EXACT_RE.test(v) || /\d/.test(v)) return false;
      const words = v.split(/\s+/).filter(Boolean);
      return words.length >= 1 && words.length <= 2 && /^[A-Za-zÀ-ÿ'.\s-]{2,26}$/.test(v);
    }) >= 0.6
  ) {
    return { role: 'nome_guerra' };
  }

  return { role: 'outro' };
}

function classifyCrachaColumn(
  label: string,
  isGenericLabel: boolean,
  sampleValues: string[]
): {
  detectedRole: CrachaColumnRole;
  detectedRoleLabel: string;
  detectedBy: 'synonym' | 'content' | 'none';
  docSubKind?: 'cpf' | 'identidade' | 'outro';
} {
  if (!isGenericLabel) {
    const bySynonym = classifyHeaderBySynonym(label);
    if (bySynonym.role !== 'outro') {
      return {
        detectedRole: bySynonym.role,
        detectedRoleLabel: CRACHA_COLUMN_ROLE_LABELS[bySynonym.role],
        detectedBy: 'synonym',
        docSubKind: bySynonym.docSubKind,
      };
    }
  }

  const byContent = classifyColumnByContent(sampleValues);
  if (byContent.role !== 'outro') {
    return {
      detectedRole: byContent.role,
      detectedRoleLabel: CRACHA_COLUMN_ROLE_LABELS[byContent.role],
      detectedBy: 'content',
      docSubKind: byContent.docSubKind,
    };
  }

  return {
    detectedRole: 'outro',
    detectedRoleLabel: CRACHA_COLUMN_ROLE_LABELS.outro,
    detectedBy: 'none',
  };
}

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
  const withoutCpf = text.replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, ' ');
  const labeled = withoutCpf.match(
    /\b(?:IDENTIDADE|IDT|RG)\s*[:\-]?\s*([A-Z0-9.\-\/]{5,18})\b/i
  );
  if (labeled) return cleanCellText(labeled[1]);
  const hyphenId = withoutCpf.match(/\b\d{7,11}-\d\b/);
  if (hyphenId) return hyphenId[0];
  return '';
}

// ==================== FAITHFUL HEADER DETECTION & NORMALIZATION ====================

function stripLeadingTitleBanners(rows: RawCellWithMeta[][]): RawCellWithMeta[][] {
  let start = 0;
  const maxStrip = Math.min(3, Math.max(0, rows.length - 2));
  while (start < maxStrip) {
    const curr = rows[start];
    const currNonEmpty = curr.filter((c) => c.text.length > 0);
    if (currNonEmpty.length !== 1) break;

    const rest = rows.slice(start + 1, start + 6);
    const restMultiColCount = rest.filter(
      (r) => r.filter((c) => c.text.length > 0).length >= 2
    ).length;

    if (restMultiColCount >= Math.min(2, rest.length)) {
      start++;
    } else {
      break;
    }
  }
  return rows.slice(start);
}

function isRowDataLike(row: RawCellWithMeta[]): boolean {
  const nonEmpty = row.map((c) => c.text).filter(Boolean);
  if (nonEmpty.length === 0) return false;
  return nonEmpty.some(
    (txt) =>
      CPF_VALUE_RE.test(txt) ||
      IDT_HYPHEN_RE.test(txt) ||
      RANK_EXACT_RE.test(txt) ||
      /^\d{1,4}[º°.)]?$/.test(txt) ||
      /^\d{2}\/\d{2}\/\d{2,4}$/.test(txt)
  );
}

function detectExplicitHeaderRow(compact: RawCellWithMeta[][]): boolean {
  if (compact.length < 2) return false;
  const row0 = compact[0];
  const nonEmpty0 = row0.map((c) => c.text).filter(Boolean);
  if (nonEmpty0.length === 0) return false;

  // Never treat a row containing CPF, Identidade, or standalone military ranks (e.g. "3º SGT") as a header
  if (isRowDataLike(row0)) return false;

  // 1. Direct synonym match on any cell in row 0
  const synonymHits = nonEmpty0.filter(
    (txt) => classifyHeaderBySynonym(txt).role !== 'outro'
  ).length;
  if (synonymHits >= 1) return true;

  // 2. Structural heuristic for non-standard headers (e.g. "Código | Descrição | Obs"):
  //    All row 0 cells are short non-numeric labels (<= 36 chars, contain letters, no long numbers)
  //    AND at least one row below contains numbers / CPFs / ranks / noticeably longer names
  const allShortLabels =
    nonEmpty0.length >= 2 &&
    nonEmpty0.every(
      (txt) =>
        txt.length <= 36 &&
        /[A-Za-zÀ-ÿ]/.test(txt) &&
        !/\d{3,}/.test(txt) &&
        txt.split(/\s+/).length <= 4
    );

  if (allShortLabels) {
    const sampleDataRows = compact.slice(1, 6);
    const dataRowsHaveDataTraits = sampleDataRows.some(
      (r) =>
        isRowDataLike(r) ||
        r.some((c) => c.text.length > 0 && /\d/.test(c.text))
    );
    if (dataRowsHaveDataTraits) return true;
  }

  return false;
}

function normalizeTabularRows(
  matrix: RawCellWithMeta[][],
  fileName: string,
  sourceKind: 'tabela' | 'lista' | 'ocr'
): ExtractedCrachaDocument {
  const cleanedRows: RawCellWithMeta[][] = matrix
    .map((r) =>
      r.map((c): RawCellWithMeta => ({
        text: cleanCellText(c.text),
        boldSubstring: c.boldSubstring,
      }))
    )
    .filter((r) => r.some((c) => c.text.length > 0));

  if (cleanedRows.length === 0) {
    throw new Error('Nenhum dado legível encontrado no documento.');
  }

  // Strip full-width title banner rows sitting above the actual table header row
  const withoutBanners = stripLeadingTitleBanners(cleanedRows);

  const maxCols = Math.max(...withoutBanners.map((r) => r.length));
  const padded: RawCellWithMeta[][] = withoutBanners.map((r) => {
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

  // Faithful header extraction: ONLY row 0, or generic "Coluna 1..N" when headerless
  const hasExplicitHeader = detectExplicitHeaderRow(compact);
  const row0 = compact[0];

  const headerMeta = Array.from({ length: colCount }, (_, idx) => {
    if (hasExplicitHeader && row0[idx]?.text) {
      return { label: row0[idx].text, isGenericLabel: false };
    }
    return { label: `Coluna ${idx + 1}`, isGenericLabel: true };
  });

  const dataRowsRaw = hasExplicitHeader ? compact.slice(1) : compact;

  // Deduplicate repeated header rows (very common on pages 2..N of exported PDFs)
  const headerNormCells = headerMeta.map((h) => stripDiacriticsUpper(h.label));
  const headerSig = headerNormCells.join('|');
  const filteredDataRows = dataRowsRaw.filter((row) => {
    if (hasExplicitHeader) {
      const rowNormCells = row.map((c) => stripDiacriticsUpper(c.text));
      if (rowNormCells.join('|') === headerSig) return false;
      // Also catch repeated headers where 1 cell had minor OCR/spacing variance (>= 75% match)
      const nonEmptyHeaderCount = headerMeta.filter((h) => !h.isGenericLabel).length;
      if (nonEmptyHeaderCount >= 2) {
        let matches = 0;
        for (let i = 0; i < colCount; i++) {
          if (!headerMeta[i].isGenericLabel && rowNormCells[i] === headerNormCells[i]) {
            matches++;
          }
        }
        if (matches / nonEmptyHeaderCount >= 0.75) return false;
      }
    }
    return row.some((c) => c.text.length > 0);
  });

  if (filteredDataRows.length === 0) {
    throw new Error('O documento contém apenas cabeçalhos e nenhuma linha de dados.');
  }

  // Build ONLY real extracted columns with mandatory examples from the row(s) below + synonym classification
  const columns: CrachaDocumentColumn[] = headerMeta.map((meta, idx) => {
    const id = `col_${idx}`;
    const colValues = filteredDataRows.map((r) => r[idx]?.text || '');
    const nonEmptyValues = colValues.filter(Boolean);
    const sample = nonEmptyValues[0] || '';
    const samples: string[] = [];
    for (const val of nonEmptyValues) {
      if (!samples.includes(val)) samples.push(val);
      if (samples.length >= 3) break;
    }

    const classification = classifyCrachaColumn(meta.label, meta.isGenericLabel, nonEmptyValues);

    return {
      id,
      label: meta.label,
      sample,
      samples,
      isGenericLabel: meta.isGenericLabel,
      detectedRole: classification.detectedRole,
      detectedRoleLabel: classification.detectedRoleLabel,
      detectedBy: classification.detectedBy,
      docSubKind: classification.docSubKind,
    };
  });

  const rows: Record<string, string>[] = filteredDataRows.map((row) => {
    const rec: Record<string, string> = {};
    columns.forEach((col, idx) => {
      rec[col.id] = row[idx]?.text || '';
    });
    return rec;
  });

  // Auto-map slots based strictly on synonym/content-classified real columns
  const colPosto = columns.find((c) => c.detectedRole === 'posto')?.id || '';
  const colWarName = columns.find((c) => c.detectedRole === 'nome_guerra')?.id || '';
  const colFullName = columns.find((c) => c.detectedRole === 'nome_completo')?.id || '';
  const colDocIdt =
    columns.find((c) => c.detectedRole === 'documento' && c.docSubKind === 'identidade')?.id || '';
  const colDocCpf =
    columns.find((c) => c.detectedRole === 'documento' && c.docSubKind === 'cpf')?.id || '';
  const colDocAny = columns.find((c) => c.detectedRole === 'documento')?.id || '';
  const colOrd = columns.find((c) => c.detectedRole === 'ordem')?.id || '';

  // Flexible Prefix + Principal default:
  // If Posto/Grad exists alongside Nome de Guerra (or Nome Completo), prefill Prefixo = Posto and Principal = Nome de Guerra (or Nome Completo)
  const preferredMainName =
    (colPosto && colWarName ? colWarName : '') ||
    colWarName ||
    colFullName ||
    columns.find(
      (c) =>
        c.id !== colPosto &&
        c.detectedRole !== 'ordem' &&
        c.detectedRole !== 'documento'
    )?.id ||
    columns[0]?.id ||
    '';

  const identPrefixo =
    colPosto && preferredMainName && colPosto !== preferredMainName ? colPosto : '';
  const identPrincipal = preferredMainName;

  const identSecundario =
    colDocIdt ||
    colDocCpf ||
    colDocAny ||
    (columns.length === 2
      ? columns.find(
          (c) =>
            c.id !== identPrincipal &&
            c.id !== identPrefixo &&
            c.detectedRole !== 'ordem' &&
            c.detectedRole !== 'posto'
        )?.id || ''
      : '');

  const rpPrincipal = colOrd || colWarName || colFullName || columns[0]?.id || '';
  const rpPrefixo =
    !colOrd && colPosto && rpPrincipal && colPosto !== rpPrincipal ? colPosto : '';

  return {
    fileName,
    sourceKind,
    hasExplicitHeader,
    columns,
    rows,
    suggestedMapping: {
      identPrefixo,
      identPrincipal,
      identSecundario,
      identTop: '',
      identBottom: '',
      identBack: '',
      rpPrefixo,
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

// ==================== DOCX PARSER (via JSZip — Direct XML Tree Walking) ====================

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function getXmlLocalName(el: Element): string {
  return el.localName || el.nodeName.replace(/^.*:/, '');
}

function getDirectWordChildren(parent: Element, targetLocalName: string): Element[] {
  const out: Element[] = [];
  for (const child of Array.from(parent.children)) {
    const name = getXmlLocalName(child);
    if (name === targetLocalName) {
      out.push(child);
    } else if (name === 'sdt' || name === 'sdtContent' || name === 'ins' || name === 'customXml') {
      out.push(...getDirectWordChildren(child, targetLocalName));
    }
  }
  return out;
}

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
    let text = '';
    for (const child of Array.from(r.children)) {
      const cName = getXmlLocalName(child);
      if (cName === 't') {
        text += child.textContent || '';
      } else if (cName === 'tab' || cName === 'br' || cName === 'cr') {
        text += ' ';
      }
    }
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

function parseDocxTableElement(tbl: Element): RawCellWithMeta[][] {
  const trs = getDirectWordChildren(tbl, 'tr');
  const matrix: RawCellWithMeta[][] = [];

  for (const tr of trs) {
    const tcs = getDirectWordChildren(tr, 'tc');
    const rowCells: RawCellWithMeta[] = [];
    const vMergeContinuations: number[] = [];

    for (const tc of tcs) {
      // Read ONLY direct paragraphs inside this cell (never absorb nested table cells)
      const directPs = getDirectWordChildren(tc, 'p').map(readDocxParagraphWithBold);
      const mergedText = cleanCellText(directPs.map((x) => x.text).filter(Boolean).join(' '));
      const boldSub = directPs.find((x) => x.boldSubstring)?.boldSubstring;

      const tcPr = getDirectWordChildren(tc, 'tcPr')[0];
      const gridSpanEl = tcPr ? getDirectWordChildren(tcPr, 'gridSpan')[0] : undefined;
      const spanVal = Math.max(
        1,
        parseInt(
          gridSpanEl?.getAttribute('w:val') ?? gridSpanEl?.getAttribute('val') ?? '1',
          10
        ) || 1
      );

      const vMergeEl = tcPr ? getDirectWordChildren(tcPr, 'vMerge')[0] : undefined;
      const vMergeVal = vMergeEl
        ? (vMergeEl.getAttribute('w:val') ?? vMergeEl.getAttribute('val') ?? 'continue').toLowerCase()
        : null;
      const isVMergeContinue = vMergeEl !== undefined && vMergeVal !== 'restart';

      const colStartIdx = rowCells.length;
      rowCells.push({ text: mergedText, boldSubstring: boldSub });
      if (isVMergeContinue && !mergedText) {
        vMergeContinuations.push(colStartIdx);
      }

      for (let s = 1; s < spanVal; s++) {
        rowCells.push({ text: '' });
      }
    }

    const hasRealContent = rowCells.some((c) => c.text.length > 0);
    if (hasRealContent) {
      // Propagate vertically merged cell values cleanly on data rows (never copy row 0 header into row 1)
      if (matrix.length >= 2 && vMergeContinuations.length > 0) {
        const prevRow = matrix[matrix.length - 1];
        for (const cIdx of vMergeContinuations) {
          if (prevRow[cIdx]?.text) {
            rowCells[cIdx] = { text: prevRow[cIdx].text };
          }
        }
      }
      matrix.push(rowCells);
    }
  }

  return matrix;
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

  const walkContainer = (container: Element) => {
    for (const child of Array.from(container.children)) {
      const localName = getXmlLocalName(child);
      if (localName === 'tbl') {
        const matrix = parseDocxTableElement(child);
        if (matrix.length > 0) tables.push(matrix);
      } else if (localName === 'p') {
        const pMeta = readDocxParagraphWithBold(child);
        if (pMeta.text) lines.push(pMeta);
      } else if (
        localName === 'sdt' ||
        localName === 'sdtContent' ||
        localName === 'ins' ||
        localName === 'customXml'
      ) {
        walkContainer(child);
      }
    }
  };

  walkContainer(body);

  return { tables, lines };
}

// ==================== PDF PARSER (Ruled Vector Grids + Band-Aligned Borderless + OCR) ====================

interface PdfChunk {
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
  hLinesDesc: number[];
  vLinesAsc: number[];
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
  if (chunks.length === 0) return { text: '' };
  // Group chunks into visual lines (top-to-bottom), then sort left-to-right inside each line
  const byY = [...chunks].sort((a, b) => b.y - a.y || a.x - b.x);
  const yLines: PdfChunk[][] = [];
  for (const ch of byY) {
    const last = yLines[yLines.length - 1];
    if (!last || Math.abs(last[0].y - ch.y) > 3.8) {
      yLines.push([ch]);
    } else {
      last.push(ch);
    }
  }

  const lineTexts: string[] = [];
  let boldRun = '';
  let firstBold = '';
  let boldCount = 0;

  for (const line of yLines) {
    const sorted = [...line].sort((a, b) => a.x - b.x);
    let text = '';
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i];
      const prev = i > 0 ? sorted[i - 1] : null;
      if (
        prev &&
        c.x - (prev.x + prev.width) > 1.6 &&
        !text.endsWith(' ') &&
        !c.text.startsWith(' ')
      ) {
        text += ' ';
      }
      text += c.text;
      if (c.bold) {
        boldRun += (boldRun && !boldRun.endsWith(' ') && !c.text.startsWith(' ') ? ' ' : '') + c.text;
      } else if (boldRun.trim()) {
        boldCount++;
        firstBold = cleanCellText(boldRun);
        boldRun = '';
      }
    }
    const cleanedLine = cleanCellText(text);
    if (cleanedLine) lineTexts.push(cleanedLine);
  }
  if (boldRun.trim()) {
    boldCount++;
    firstBold = cleanCellText(boldRun);
  }

  return {
    text: cleanCellText(lineTexts.join(' ')),
    boldSubstring: boldCount === 1 ? firstBold : undefined,
  };
}

/**
 * Detects vector-drawn table grids on a PDF page so centered headers, wrapped cells,
 * and empty cells preserve exact column alignment.
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
        if (dx > pageWidth * 0.94 && (yMid < pageHeight * 0.02 || yMid > pageHeight * 0.98)) {
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
        if (dy > pageHeight * 0.94 && (xMid < pageWidth * 0.02 || xMid > pageWidth * 0.98)) {
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
      if (absW > pageWidth * 0.94 && absH > pageHeight * 0.92) {
        return;
      }
      // Thin filled rectangles are commonly used as cell border rules
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
      if (pendingSegs.length <= 5 && boxW > pageWidth * 0.94 && boxH > pageHeight * 0.92) {
        return;
      }
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

    // Horizontal-ruled tables (parallel horizontal rules without vertical column lines)
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

    return grids.sort((a, b) => b.maxY - a.maxY);
  } catch {
    return [];
  }
}

interface ColumnBand {
  minX: number;
  maxX: number;
  center: number;
}

function buildColumnBandsFromSegments(
  rowsSegs: Array<Array<{ xStart: number; xEnd: number; meta: RawCellWithMeta }>>
): ColumnBand[] {
  if (rowsSegs.length === 0) return [];

  // Find dominant segment count among rows (prefer data rows 1..N when >= 2 rows)
  const countFreq = new Map<number, number>();
  const bodyRows = rowsSegs.length >= 3 ? rowsSegs.slice(1) : rowsSegs;
  for (const r of bodyRows) {
    if (r.length >= 2) {
      countFreq.set(r.length, (countFreq.get(r.length) || 0) + 1);
    }
  }
  let targetCols = 0;
  let maxFreq = 0;
  for (const [cols, freq] of countFreq.entries()) {
    if (freq > maxFreq || (freq === maxFreq && cols > targetCols)) {
      maxFreq = freq;
      targetCols = cols;
    }
  }

  // If multiple rows share the exact target column count, derive clean non-overlapping bands per column index
  const referenceRows =
    targetCols >= 2 ? bodyRows.filter((r) => r.length === targetCols) : [];

  if (referenceRows.length >= 2) {
    const bands: ColumnBand[] = [];
    for (let c = 0; c < targetCols; c++) {
      const xs = referenceRows.map((r) => r[c].xStart);
      const xe = referenceRows.map((r) => r[c].xEnd);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xe);
      bands.push({ minX, maxX, center: (minX + maxX) / 2 });
    }
    // Verify bands are strictly ordered left-to-right
    const ordered = bands.every((b, idx) => idx === 0 || b.center > bands[idx - 1].center + 6);
    if (ordered) return bands;
  }

  // Fallback: merge overlapping X-intervals across all segments
  const allSegs = rowsSegs
    .flat()
    .map((s) => ({ minX: s.xStart, maxX: Math.max(s.xEnd, s.xStart + 4) }))
    .sort((a, b) => a.minX - b.minX);

  const merged: ColumnBand[] = [];
  for (const seg of allSegs) {
    const prev = merged[merged.length - 1];
    if (prev && seg.minX <= prev.maxX + 4) {
      prev.maxX = Math.max(prev.maxX, seg.maxX);
      prev.center = (prev.minX + prev.maxX) / 2;
    } else {
      merged.push({
        minX: seg.minX,
        maxX: seg.maxX,
        center: (seg.minX + seg.maxX) / 2,
      });
    }
  }

  if (merged.length >= 2 && merged.length <= 16) {
    return merged;
  }

  // Final fallback: cluster xStart values
  const anchors = clusterValues(
    rowsSegs.flatMap((r) => r.map((s) => s.xStart)),
    16
  ).sort((a, b) => a - b);

  return anchors.map((a, idx) => ({
    minX: a,
    maxX: idx < anchors.length - 1 ? anchors[idx + 1] - 4 : a + 60,
    center: a,
  }));
}

function assignSegmentToBand(
  seg: { xStart: number; xEnd: number },
  bands: ColumnBand[]
): number {
  const segCenter = (seg.xStart + seg.xEnd) / 2;
  let bestCol = 0;
  let bestOverlap = -1;
  let bestDist = Infinity;

  for (let c = 0; c < bands.length; c++) {
    const b = bands[c];
    const overlap = Math.min(seg.xEnd, b.maxX) - Math.max(seg.xStart, b.minX);
    const dist = Math.abs(segCenter - b.center);
    if (overlap > 0) {
      if (overlap > bestOverlap || (overlap === bestOverlap && dist < bestDist)) {
        bestOverlap = overlap;
        bestDist = dist;
        bestCol = c;
      }
    } else if (bestOverlap <= 0 && dist < bestDist) {
      bestDist = dist;
      bestCol = c;
    }
  }

  return bestCol;
}

function buildMatrixFromRuledGrid(
  grid: DetectedPdfGrid,
  chunks: PdfChunk[],
  pageWidth: number
): RawCellWithMeta[][] | null {
  const numRows = grid.hLinesDesc.length - 1;
  if (numRows < 2) return null;

  const regionChunks = chunks.filter(
    (ch) =>
      ch.x + ch.width * 0.5 >= grid.minX - 6 &&
      ch.x <= grid.maxX + 6 &&
      ch.y >= grid.minY - 5 &&
      ch.y <= grid.maxY + 5
  );
  if (regionChunks.length === 0) return null;

  let colBoundariesAsc = grid.vLinesAsc;
  if (colBoundariesAsc.length < 3) {
    // Horizontal-ruled table without vertical dividers: infer column boundaries via horizontal bands
    const yLines: PdfChunk[][] = [];
    const sortedByY = [...regionChunks].sort((a, b) => b.y - a.y || a.x - b.x);
    for (const ch of sortedByY) {
      const last = yLines[yLines.length - 1];
      if (!last || Math.abs(last[0].y - ch.y) > 3.8) yLines.push([ch]);
      else last.push(ch);
    }

    const gapThresh = Math.max(11, pageWidth * 0.018);
    const rowsSegs = yLines
      .map((line) => splitRowChunksIntoColumns(line, gapThresh))
      .filter((segs) => segs.length >= 2)
      .map((segs) =>
        segs.map((s) => ({
          xStart: s[0].x,
          xEnd: s[s.length - 1].x + s[s.length - 1].width,
          meta: chunksToCellMeta(s),
        }))
      );

    const bands = buildColumnBandsFromSegments(rowsSegs);
    if (bands.length < 2) return null;

    colBoundariesAsc = [grid.minX - 2];
    for (let i = 1; i < bands.length; i++) {
      colBoundariesAsc.push((bands[i - 1].maxX + bands[i].minX) / 2);
    }
    colBoundariesAsc.push(grid.maxX + 2);
  }

  const numCols = colBoundariesAsc.length - 1;
  if (numCols < 2) return null;

  const cells: PdfChunk[][][] = Array.from({ length: numRows }, () =>
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

    const probeX = ch.x + Math.min(ch.width, 18) * 0.45;
    let cIdx = colBoundariesAsc.findIndex(
      (xLeft, idx) =>
        idx < numCols &&
        probeX >= xLeft - 2.5 &&
        probeX <= colBoundariesAsc[idx + 1] + 2.5
    );
    if (cIdx < 0) {
      let bestDist = Infinity;
      for (let c = 0; c < numCols; c++) {
        const midX = (colBoundariesAsc[c] + colBoundariesAsc[c + 1]) / 2;
        const d = Math.abs(probeX - midX);
        if (d < bestDist) {
          bestDist = d;
          cIdx = c;
        }
      }
    }

    if (rIdx >= 0 && rIdx < numRows && cIdx >= 0 && cIdx < numCols) {
      cells[rIdx][cIdx].push(ch);
    }
  }

  const matrix: RawCellWithMeta[][] = cells
    .map((row) => row.map((cellChunks) => chunksToCellMeta(cellChunks)))
    .filter((row) => row.some((c) => c.text.length > 0));

  return matrix.length >= 2 ? matrix : null;
}

async function parsePdfFile(
  file: File
): Promise<{ tables: RawCellWithMeta[][][]; lines: RawCellWithMeta[]; usedOcr: boolean }> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;

  const ruledTables: RawCellWithMeta[][][] = [];
  const borderlessRowGroups: { chunks: PdfChunk[]; pageWidth: number }[] = [];
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

    // Priority 1: Vector-ruled table grids on this page
    const grids = await detectPdfRuledGrids(page, viewport.width, viewport.height);
    let pageFoundRuledTable = false;
    for (const grid of grids) {
      const matrix = buildMatrixFromRuledGrid(grid, chunks, viewport.width);
      if (matrix && matrix.length >= 2) {
        ruledTables.push(matrix);
        pageFoundRuledTable = true;
      }
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
      if (!pageFoundRuledTable) {
        borderlessRowGroups.push({ chunks: r, pageWidth: viewport.width });
      }
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

  if (ruledTables.length > 0) {
    return { tables: ruledTables, lines, usedOcr: false };
  }

  // Priority 2: Band-aligned borderless PDF tables (handles centered headers vs left-aligned body)
  const borderlessTables: RawCellWithMeta[][][] = [];
  let idx = 0;
  while (idx < borderlessRowGroups.length) {
    const gapThresh = Math.max(12, borderlessRowGroups[idx].pageWidth * 0.02);
    const segs = splitRowChunksIntoColumns(borderlessRowGroups[idx].chunks, gapThresh);
    if (segs.length < 2) {
      idx++;
      continue;
    }

    const candidateSegs: { xStart: number; xEnd: number; meta: RawCellWithMeta }[][] = [];
    let scan = idx;
    while (scan < borderlessRowGroups.length) {
      const rowSegs = splitRowChunksIntoColumns(borderlessRowGroups[scan].chunks, gapThresh);
      if (rowSegs.length < 2) break;
      candidateSegs.push(
        rowSegs.map((s) => ({
          xStart: s[0].x,
          xEnd: s[s.length - 1].x + s[s.length - 1].width,
          meta: chunksToCellMeta(s),
        }))
      );
      scan++;
    }

    if (candidateSegs.length >= 2) {
      const bands = buildColumnBandsFromSegments(candidateSegs);
      if (bands.length >= 2 && bands.length <= 16) {
        const matrix: RawCellWithMeta[][] = candidateSegs.map((row) => {
          const out = Array.from({ length: bands.length }, (): RawCellWithMeta => ({ text: '' }));
          for (const seg of row) {
            const bestCol = assignSegmentToBand(seg, bands);
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
        borderlessTables.push(matrix);
        idx = scan;
        continue;
      }
    }
    idx++;
  }

  return { tables: borderlessTables, lines, usedOcr: false };
}

// ==================== UNSTRUCTURED / KEY-VALUE LINE PARSER ====================

function parseFreeLinesIntoTable(lines: RawCellWithMeta[]): RawCellWithMeta[][] {
  const cleanLines = lines.map((l) => ({ ...l, text: cleanCellText(l.text) })).filter((l) => l.text);
  if (cleanLines.length === 0) return [];

  // 1. Delimited text (CSV / TSV / semicolon / pipe)
  const delim = detectDelimiter(cleanLines.map((l) => l.text));
  if (delim) {
    return parseDelimitedText(cleanLines.map((l) => l.text).join('\n'), delim);
  }

  // 2. Key: Value blocks (e.g., Nome: ...\nCPF: ...\nIdentidade: ...)
  const kvMatches = cleanLines.filter((l) =>
    /^(?:NOME(?:\s+COMPLETO)?|NOME\s+DE\s+GUERRA|POSTO(?:\s*\/\s*GRAD(?:UA[ÇC][ÃA]O)?)?|P\/G|IDENTIDADE|IDT|CPF|RG|FUN[ÇC][ÃA]O|CARGO|OM|SETOR)\s*:/i.test(
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
      return [
        keysOrder.map((k) => ({ text: k })),
        ...records.map((rec) =>
          keysOrder.map((k) => ({ text: rec[stripDiacriticsUpper(k)] || '' }))
        ),
      ];
    }
  }

  // 3. Fallback: person-per-line list (no table detected)
  const personRows: RawCellWithMeta[][] = [
    [
      { text: 'Posto/Grad' },
      { text: 'Nome Completo' },
      { text: 'Nome de Guerra' },
      { text: 'Identidade' },
      { text: 'CPF' },
    ],
  ];

  for (const line of cleanLines) {
    const raw = line.text.replace(/^(?:\d+\s*[-.)]\s*|[-–—•*]\s*)/, '').trim();
    if (!raw) continue;
    if (classifyHeaderBySynonym(raw).role !== 'outro' && raw.split(/\s+/).length <= 4) {
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
    // Only inspect direct rows belonging to this table (avoid nested table leakage)
    const trs = Array.from(tbl.querySelectorAll('tr')).filter((tr) => tr.closest('table') === tbl);
    const matrix: RawCellWithMeta[][] = [];
    for (const tr of trs) {
      const cells = Array.from(tr.children).filter(
        (el) => el.tagName === 'TD' || el.tagName === 'TH'
      );
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

function effectiveTableColCount(table: RawCellWithMeta[][]): number {
  const counts = table
    .map((r) => r.length)
    .filter((n) => n >= 2);
  if (counts.length === 0) return Math.max(...table.map((r) => r.length), 0);
  const freq = new Map<number, number>();
  for (const c of counts) freq.set(c, (freq.get(c) || 0) + 1);
  let best = counts[0];
  let bestFreq = 0;
  for (const [k, v] of freq.entries()) {
    if (v > bestFreq || (v === bestFreq && k > best)) {
      bestFreq = v;
      best = k;
    }
  }
  return best;
}

function mergeLargestCompatibleTables(tables: RawCellWithMeta[][][]): RawCellWithMeta[][] {
  if (tables.length === 0) return [];
  const grouped: RawCellWithMeta[][][][] = [];
  for (const t of tables) {
    const cols = effectiveTableColCount(t);
    const prev = grouped[grouped.length - 1];
    if (prev && effectiveTableColCount(prev[0]) === cols) {
      prev.push(t);
    } else {
      grouped.push([t]);
    }
  }

  let bestMerged: RawCellWithMeta[][] = tables[0];
  let bestScore = -1;
  for (const grp of grouped) {
    const merged: RawCellWithMeta[][] = grp.flat();
    const cols = effectiveTableColCount(merged);
    // Prefer tables with more rows and >= 2 real columns
    const score = merged.length * (cols >= 2 ? 10 : 1);
    if (score > bestScore) {
      bestScore = score;
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
    const directRows = Array.from(tbl.children).filter(
      (el) => el.nodeName === 'table:table-row' || el.localName === 'table-row'
    );
    const rows =
      directRows.length > 0
        ? directRows
        : Array.from(tbl.getElementsByTagName('table:table-row'));
    for (const tr of rows) {
      const cells = Array.from(tr.children).filter(
        (el) => el.nodeName === 'table:table-cell' || el.localName === 'table-cell'
      );
      const rowCells: RawCellWithMeta[] = [];
      for (const tc of cells) {
        const span = Math.max(
          1,
          parseInt(tc.getAttribute('table:number-columns-spanned') || '1', 10) || 1
        );
        const ps = Array.from(tc.getElementsByTagName('text:p'));
        const text = cleanCellText(ps.map((p) => p.textContent || '').join(' '));
        rowCells.push({ text });
        for (let s = 1; s < span; s++) rowCells.push({ text: '' });
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
  let score = doc.rows.length > 0 ? 1 : 0;
  if (doc.columns.some((c) => c.detectedRole === 'nome_completo')) score += 10;
  if (doc.columns.some((c) => c.detectedRole === 'nome_guerra')) score += 8;
  if (doc.columns.some((c) => c.detectedRole === 'posto')) score += 4;
  return score;
}

function scoreDocumentAsSecondaryIdSource(doc: ImportedCrachaSource): number {
  let score = 0;
  if (doc.columns.some((c) => c.detectedRole === 'documento' && c.docSubKind === 'identidade')) {
    score += 10;
  }
  if (doc.columns.some((c) => c.detectedRole === 'documento' && c.docSubKind === 'cpf')) {
    score += 8;
  }
  if (doc.columns.some((c) => c.detectedRole === 'documento')) {
    score += 4;
  }
  return score;
}

function pickPreferredIdCol(doc: ImportedCrachaSource): string {
  return (
    doc.columns.find((c) => c.id === doc.suggestedMapping.identSecundario)?.id ||
    doc.columns.find((c) => c.detectedRole === 'documento')?.id ||
    doc.columns[0]?.id ||
    ''
  );
}

export function buildInitialMultiMapping(
  sources: ImportedCrachaSource[]
): CrachaMultiMapping {
  if (sources.length === 0) {
    return {
      identPrefixo: EMPTY_SLOT_REF,
      identPrincipal: EMPTY_SLOT_REF,
      identSecundario: EMPTY_SLOT_REF,
      identTop: EMPTY_SLOT_REF,
      identBottom: EMPTY_SLOT_REF,
      identBack: EMPTY_SLOT_REF,
      rpPrefixo: EMPTY_SLOT_REF,
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

  if (sources.length > 1) {
    const primaryHasId = scoreDocumentAsSecondaryIdSource(primaryDoc) > 0;
    const bestOtherIdDoc = sources
      .filter((s) => s.id !== primaryDoc.id)
      .sort(
        (a, b) => scoreDocumentAsSecondaryIdSource(b) - scoreDocumentAsSecondaryIdSource(a)
      )[0];

    if (!primaryHasId && bestOtherIdDoc && scoreDocumentAsSecondaryIdSource(bestOtherIdDoc) > 0) {
      secDoc = bestOtherIdDoc;
      secColId = pickPreferredIdCol(bestOtherIdDoc);
    } else if (!secColId && bestOtherIdDoc) {
      secDoc = bestOtherIdDoc;
      secColId = pickPreferredIdCol(bestOtherIdDoc);
    }
  }

  return {
    identPrefixo: primaryDoc.suggestedMapping.identPrefixo
      ? { docId: primaryDoc.id, colId: primaryDoc.suggestedMapping.identPrefixo }
      : EMPTY_SLOT_REF,
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
    rpPrefixo: primaryDoc.suggestedMapping.rpPrefixo
      ? { docId: primaryDoc.id, colId: primaryDoc.suggestedMapping.rpPrefixo }
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
    identPrefixo: validateSlot(prev.identPrefixo, defaults.identPrefixo),
    identPrincipal: validateSlot(prev.identPrincipal, defaults.identPrincipal),
    identSecundario: validateSlot(prev.identSecundario, defaults.identSecundario),
    identTop: validateSlot(prev.identTop, EMPTY_SLOT_REF),
    identBottom: validateSlot(prev.identBottom, EMPTY_SLOT_REF),
    identBack: validateSlot(prev.identBack, EMPTY_SLOT_REF),
    rpPrefixo: validateSlot(prev.rpPrefixo, defaults.rpPrefixo),
    rpPrincipal: validateSlot(prev.rpPrincipal, defaults.rpPrincipal),
    rpTop: validateSlot(prev.rpTop, EMPTY_SLOT_REF),
    rpBottom: validateSlot(prev.rpBottom, EMPTY_SLOT_REF),
    rpBack: validateSlot(prev.rpBack, EMPTY_SLOT_REF),
  };

  if (nextSources.length > 1) {
    const newest = nextSources[nextSources.length - 1];
    const secSrc = byId.get(next.identSecundario.docId);
    const secHasIdLabel = secSrc ? scoreDocumentAsSecondaryIdSource(secSrc) > 0 : false;
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
    const val = (row[col.id] || '').trim();
    if (!val) continue;
    if (col.detectedRole === 'nome_completo') {
      nameCandidates.unshift(val);
    } else if (col.detectedRole === 'nome_guerra') {
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
  const prefixSlot =
    targetMode === 'identificacao' ? mapping.identPrefixo : mapping.rpPrefixo;
  const fallbackSlot =
    targetMode === 'identificacao' ? mapping.identSecundario : mapping.rpTop;

  const primaryDoc =
    byId.get(primarySlot.docId) ||
    byId.get(prefixSlot.docId) ||
    byId.get(fallbackSlot.docId) ||
    sources[0];

  const baseRows = primaryDoc.rows.slice(0, 200);
  const baseProfiles = baseRows.map((r) => extractRowMatchProfile(primaryDoc, r));

  const relevantSlots =
    targetMode === 'identificacao'
      ? [
          mapping.identPrefixo,
          mapping.identPrincipal,
          mapping.identSecundario,
          mapping.identTop,
          mapping.identBottom,
          mapping.identBack,
        ]
      : [
          mapping.rpPrefixo,
          mapping.rpPrincipal,
          mapping.rpTop,
          mapping.rpBottom,
          mapping.rpBack,
        ];

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
    const identComposed = composePrefixedText(
      readSlotValue(mapping.identPrefixo, idx),
      readSlotValue(mapping.identPrincipal, idx)
    );
    const rpComposed = composePrefixedText(
      readSlotValue(mapping.rpPrefixo, idx),
      readSlotValue(mapping.rpPrincipal, idx)
    );

    if (targetMode === 'identificacao') {
      const backVal = readSlotValue(mapping.identBack, idx);
      return {
        nomeCompleto: identComposed,
        cpf: readSlotValue(mapping.identSecundario, idx),
        rpTexto: rpComposed,
        topTextOverride: readSlotValue(mapping.identTop, idx),
        bottomTextOverride: readSlotValue(mapping.identBottom, idx),
        versoIgual: !(mapping.identBack.docId && mapping.identBack.colId),
        versoTexto: backVal,
      };
    }

    const backVal = readSlotValue(mapping.rpBack, idx);
    return {
      nomeCompleto: identComposed,
      cpf: readSlotValue(mapping.identSecundario, idx),
      rpTexto: rpComposed,
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
