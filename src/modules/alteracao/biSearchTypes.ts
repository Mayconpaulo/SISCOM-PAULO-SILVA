import {
  AlteracaoHeaderExtract,
  MONTHS_UPPER,
  ParsedAlteracaoSectionItem,
  StructuredAlteracaoDoc,
} from './alteracaoFormatter';

export interface BiSearchMilitaryProfile {
  nomeCompleto: string;
  postoGraduacao: string;
  nomeGuerra: string;
  subunidade: string;
  identidade: string;
  qasQms: string;
}

export interface BiBulletinPage {
  pageNumber: number;
  text: string;
  usedOcr?: boolean;
}

export interface BiQueuedFile {
  id: string;
  file: File;
  fileName: string;
  fileSize: number;
  status: 'queued' | 'reading' | 'ocr' | 'analyzing' | 'done' | 'error';
  progressText?: string;
  errorMessage?: string;
  pages?: BiBulletinPage[];
  bulletinNumber?: string;
  bulletinDateIso?: string;
  bulletinMonth?: string;
  occurrencesCount?: number;
  homonymsCount?: number;
}

export interface BiOccurrenceItem {
  id: string;
  fileId: string;
  fileName: string;
  title: string;
  subtitle: string;
  bulletinPart: string;
  bulletinNumber: string;
  bulletinDateIso: string;
  bulletinDay: number | null;
  bulletinMonth: string;
  bulletinYear: number | null;
  contentText: string;
  personnelListText: string;
  emConsequenciaText: string;
  tableRows: string[][];
  sourcePages: number[];
  matchConfidence: 'confirmada' | 'conferir';
  matchReason: string;
  matchedExcerpt: string;
  // User review flags
  selected: boolean;
  includePersonnelList: boolean;
  includeEmConsequencia: boolean;
  includeTable: boolean;
}

export interface BiDiscardedHomonymItem {
  id: string;
  fileId: string;
  fileName: string;
  bulletinNumber: string;
  nameFound: string;
  rankFound: string;
  pageNumber: number;
  bulletinPart: string;
  reason: string;
}

export interface BiProviderStatus {
  provider: 'openai' | 'gemini' | 'none';
  configured: boolean;
  openaiConfigured: boolean;
  geminiConfigured: boolean;
}

export interface BiSemesterSelection {
  half: '1' | '2';
  year: number;
}

export function getSemesterLabels(sel: BiSemesterSelection): {
  semestre: string;
  periodo: string;
  months: readonly string[];
} {
  if (sel.half === '2') {
    return {
      semestre: `2º Semestre de ${sel.year}`,
      periodo: `01/07/${sel.year} a 31/12/${sel.year}`,
      months: MONTHS_UPPER.slice(6, 12),
    };
  }
  return {
    semestre: `1º Semestre de ${sel.year}`,
    periodo: `01/01/${sel.year} a 30/06/${sel.year}`,
    months: MONTHS_UPPER.slice(0, 6),
  };
}

/**
 * Formats the BI reference prefix in the exact Folha 26.1 standard:
 * "- a 5, BI Nº 2:" or "- a 30, BI Nº 20:"
 */
export function formatBiReferencePrefix(
  day: number | null,
  bulletinNumber: string
): string {
  const num = bulletinNumber.trim();
  if (day !== null && day >= 1 && day <= 31 && num) {
    return `- a ${day}, BI Nº ${num}:`;
  }
  if (day !== null && day >= 1 && day <= 31) {
    return `- a ${day}:`;
  }
  if (num) {
    return `- BI Nº ${num}:`;
  }
  return '-';
}

/**
 * Splits verbatim content into paragraphs while keeping intentional line breaks intact.
 */
function splitVerbatimParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{1,}/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0);
}

/**
 * Builds the exact paragraph array for one occurrence (verbatim, no rewording).
 */
export function buildOccurrenceParagraphs(occ: BiOccurrenceItem): string[] {
  const prefix = formatBiReferencePrefix(occ.bulletinDay, occ.bulletinNumber);
  const contentParas = splitVerbatimParagraphs(occ.contentText);

  const result: string[] = [];
  if (contentParas.length > 0) {
    const first = contentParas[0];
    // Avoid doubling prefix if user manually typed "- a 5, BI Nº 2:" inside contentText
    if (/^[-–—]\s*(?:a\s+\d{1,2}\s*,?\s*)?BI\s*N[º°o]/i.test(first)) {
      result.push(first);
    } else {
      result.push(`${prefix} ${first}`);
    }
    for (let i = 1; i < contentParas.length; i++) {
      result.push(contentParas[i]);
    }
  } else if (occ.tableRows.length > 0) {
    result.push(prefix);
  }

  if (occ.includePersonnelList && occ.personnelListText.trim()) {
    const listLines = splitVerbatimParagraphs(occ.personnelListText);
    for (const line of listLines) {
      result.push(line);
    }
  }

  if (occ.includeEmConsequencia && occ.emConsequenciaText.trim()) {
    const emcLines = splitVerbatimParagraphs(occ.emConsequenciaText);
    for (const line of emcLines) {
      result.push(line);
    }
  }

  return result;
}

/**
 * Formats a single occurrence into copyable plain text matching Folha 26.1 structure.
 */
export function formatSingleOccurrencePlainText(occ: BiOccurrenceItem): string {
  const lines: string[] = [];
  if (occ.title.trim()) lines.push(occ.title.trim().toUpperCase());
  if (occ.subtitle.trim()) lines.push(occ.subtitle.trim());
  const paragraphs = buildOccurrenceParagraphs(occ);
  if (paragraphs.length > 0) {
    lines.push('');
    lines.push(...paragraphs);
  }
  if (occ.includeTable && occ.tableRows.length > 0) {
    lines.push('');
    for (const row of occ.tableRows) {
      lines.push(row.join(' | '));
    }
  }
  return lines.join('\n');
}

function getOccurrenceSortValue(occ: BiOccurrenceItem): [number, number, number] {
  const dateMs = occ.bulletinDateIso ? Date.parse(`${occ.bulletinDateIso}T00:00:00`) : Number.MAX_SAFE_INTEGER;
  const biNum = parseInt(occ.bulletinNumber.replace(/\D/g, ''), 10);
  const firstPage = occ.sourcePages[0] ?? 9999;
  return [
    Number.isFinite(dateMs) ? dateMs : Number.MAX_SAFE_INTEGER,
    Number.isFinite(biNum) ? biNum : 9999,
    firstPage,
  ];
}

export function sortOccurrencesChronologically(list: BiOccurrenceItem[]): BiOccurrenceItem[] {
  return [...list].sort((a, b) => {
    const [aDate, aBi, aPage] = getOccurrenceSortValue(a);
    const [bDate, bBi, bPage] = getOccurrenceSortValue(b);
    if (aDate !== bDate) return aDate - bDate;
    if (aBi !== bBi) return aBi - bBi;
    return aPage - bPage;
  });
}

/**
 * Builds plain-text full semester transcription (including "<MÊS>: Sem Alteração" for empty months).
 */
export function formatAllSelectedPlainText(
  occurrences: BiOccurrenceItem[],
  semester: BiSemesterSelection
): string {
  const { months } = getSemesterLabels(semester);
  const selected = sortOccurrencesChronologically(occurrences.filter((o) => o.selected));

  const out: string[] = ['1ª PARTE:', ''];

  const allMonths: string[] = [...months];
  for (const occ of selected) {
    if (occ.bulletinMonth && !allMonths.includes(occ.bulletinMonth)) {
      allMonths.push(occ.bulletinMonth);
    }
  }

  for (const month of allMonths) {
    out.push(`${month}:`);
    const monthItems = selected.filter((o) => o.bulletinMonth === month);
    if (monthItems.length === 0) {
      out.push('- Sem Alteração');
      out.push('');
      continue;
    }

    // Group by title within the month
    const byTitle = new Map<string, BiOccurrenceItem[]>();
    for (const item of monthItems) {
      const key = item.title.trim().toUpperCase() || 'ASSUNTOS GERAIS E ADMINISTRATIVOS';
      const arr = byTitle.get(key) || [];
      arr.push(item);
      byTitle.set(key, arr);
    }

    for (const [title, group] of byTitle.entries()) {
      out.push(title);
      for (const occ of group) {
        if (occ.subtitle.trim()) out.push(occ.subtitle.trim());
        out.push(...buildOccurrenceParagraphs(occ));
        if (occ.includeTable && occ.tableRows.length > 0) {
          for (const row of occ.tableRows) {
            out.push(row.join(' | '));
          }
        }
        out.push('');
      }
    }
  }

  return out.join('\n').trim();
}

/**
 * Converts approved BI occurrences into a full StructuredAlteracaoDoc ready for
 * renderBlocksFromStructuredDoc() and the live A4 editor (100% verbatim, with empty months as Sem Alteração).
 */
export function buildStructuredAlteracaoFromBiOccurrences(params: {
  military: BiSearchMilitaryProfile;
  occurrences: BiOccurrenceItem[];
  semester: BiSemesterSelection;
}): {
  structuredDoc: StructuredAlteracaoDoc;
  headerExtract: AlteracaoHeaderExtract;
  semestre: string;
  periodo: string;
} {
  const { military, semester } = params;
  const { semestre, periodo, months } = getSemesterLabels(semester);
  const selected = sortOccurrencesChronologically(
    params.occurrences.filter((o) => o.selected)
  );

  const monthOrder: string[] = [...months];
  for (const occ of selected) {
    if (occ.bulletinMonth && !monthOrder.includes(occ.bulletinMonth)) {
      monthOrder.push(occ.bulletinMonth);
    }
  }

  const items: ParsedAlteracaoSectionItem[] = [];
  let seq = 1;

  for (const occ of selected) {
    const month = occ.bulletinMonth || months[0];
    const title = occ.title.trim().toUpperCase() || 'ASSUNTOS GERAIS E ADMINISTRATIVOS';
    const subtitle = occ.subtitle.trim();
    const paragraphs = buildOccurrenceParagraphs(occ);

    if (paragraphs.length > 0) {
      items.push({
        id: `bi-item-${seq++}`,
        kind: 'entry',
        month,
        title,
        subtitle,
        previewLabel: subtitle || paragraphs[0].slice(0, 70),
        paragraphs,
      });
    }

    if (occ.includeTable && occ.tableRows.length > 0) {
      const firstCellPreview =
        occ.tableRows[0]
          ?.filter((c) => c.trim().length > 0)
          .slice(0, 3)
          .join(' · ') || 'Tabela';
      const cols = Math.max(...occ.tableRows.map((r) => r.length));
      items.push({
        id: `bi-table-${seq++}`,
        kind: 'table',
        month,
        title,
        subtitle,
        previewLabel: `Tabela (${occ.tableRows.length}×${cols}): ${firstCellPreview}`.slice(0, 80),
        paragraphs: [],
        tableRows: occ.tableRows,
      });
    }
  }

  const headerExtract: AlteracaoHeaderExtract = {
    nomeCompleto: military.nomeCompleto.trim() || undefined,
    nomeGuerra: military.nomeGuerra.trim() || undefined,
    postoGraduacao: military.postoGraduacao.trim() || undefined,
    identidade: military.identidade.trim() || undefined,
    qasQms: military.qasQms.trim() || undefined,
    semestre,
    periodo,
  };

  const structuredDoc: StructuredAlteracaoDoc = {
    items,
    monthOrder,
    part2Lines: [],
    extractedHeader: headerExtract,
  };

  return {
    structuredDoc,
    headerExtract,
    semestre,
    periodo,
  };
}
