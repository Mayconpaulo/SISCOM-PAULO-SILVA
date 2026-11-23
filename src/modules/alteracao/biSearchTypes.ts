import {
  AlteracaoHeaderExtract,
  MONTHS_UPPER,
  ParsedAlteracaoSectionItem,
  StructuredAlteracaoDoc,
  applyServiceTimeToPart2Lines,
  formatPtBrDateLong,
  singularizeMilitaryGroupText,
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
  contentAfterTable: string;
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
  closingDateIso: string;
  months: readonly string[];
} {
  if (sel.half === '2') {
    return {
      semestre: `2º Semestre de ${sel.year}`,
      periodo: `01/07/${sel.year} a 31/12/${sel.year}`,
      closingDateIso: `${sel.year}-12-31`,
      months: MONTHS_UPPER.slice(6, 12),
    };
  }
  return {
    semestre: `1º Semestre de ${sel.year}`,
    periodo: `01/01/${sel.year} a 30/06/${sel.year}`,
    closingDateIso: `${sel.year}-06-30`,
    months: MONTHS_UPPER.slice(0, 6),
  };
}

function stripDiacriticsUpperLocal(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function inferDefaultSectionTitle(postoGraduacao?: string): string {
  const norm = stripDiacriticsUpperLocal(postoGraduacao || '');
  if (/\b(?:GEN|CEL|TEN\s*CEL|MAJ|CAP|1[º°O]?\s*TEN|2[º°O]?\s*TEN|ASP|OFICIAL)\b/.test(norm)) {
    return 'ALTERAÇÕES DE OFICIAIS';
  }
  if (/\b(?:SUBTEN|ST|S\s*TEN|1[º°O]?\s*SGT|2[º°O]?\s*SGT|3[º°O]?\s*SGT|SARGENTO)\b/.test(norm)) {
    return 'ALTERAÇÕES DE SUBTENENTES E SARGENTOS';
  }
  if (/\b(?:CB|CABO|SD|SOLDADO)\b/.test(norm)) {
    return 'ALTERAÇÕES DE CABOS E SOLDADOS';
  }
  return 'ASSUNTOS GERAIS E ADMINISTRATIVOS';
}

/**
 * Normalizes BI occurrence title/subtitle to match Formatar Alteração standard:
 * - Title always UPPERCASE
 * - "Férias" is never a standalone Title (always a Subtitle under ALTERAÇÕES DE ...)
 * - Never duplicates Title inside Subtitle
 */
export function normalizeBiOccurrenceHeading(
  rawTitle: string,
  rawSubtitle: string,
  postoGraduacao?: string
): { title: string; subtitle: string } {
  let title = rawTitle.trim().toUpperCase();
  let subtitle = rawSubtitle.trim();

  const normTitle = stripDiacriticsUpperLocal(title).replace(/[:.\-\s]+$/g, '');
  if (normTitle === 'FERIAS' || /^FERIAS(\s|$|-)/.test(normTitle)) {
    const feriasFixed = title.replace(/^F[ÉE]RIAS\b/i, 'Férias');
    subtitle = subtitle
      ? /^f[ée]rias\b/i.test(subtitle)
        ? subtitle.replace(/^f[ée]rias\b/i, 'Férias')
        : `${feriasFixed} - ${subtitle}`
      : feriasFixed;
    title = inferDefaultSectionTitle(postoGraduacao);
  }

  if (!title) {
    title = inferDefaultSectionTitle(postoGraduacao);
  }

  if (subtitle && stripDiacriticsUpperLocal(subtitle) === stripDiacriticsUpperLocal(title)) {
    subtitle = '';
  }

  return { title, subtitle };
}

/**
 * Formats the BI reference prefix in the exact Folha 26.1 / Formatar Alteração standard:
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
 * Builds the exact paragraph segments for one occurrence:
 * - beforeTable: opening paragraphs (with "- a DD, BI Nº NN:" inline on line 1, matching Formatar Alteração)
 * - afterTable: paragraphs that appear AFTER the table (e.g. DCEM Observações + Adt da DCEM) + optional lists
 * Applies Formatar Alteração's singularization when personnelList is excluded so individual Folhas read naturally.
 */
export function buildOccurrenceParagraphSegments(occ: BiOccurrenceItem): {
  beforeTable: string[];
  afterTable: string[];
} {
  const prefix = formatBiReferencePrefix(occ.bulletinDay, occ.bulletinNumber);
  const shouldSingularize = !occ.includePersonnelList;
  const formatPara = (p: string) => (shouldSingularize ? singularizeMilitaryGroupText(p) : p);

  const rawBefore = splitVerbatimParagraphs(occ.contentText);
  const beforeTable: string[] = [];

  if (rawBefore.length > 0) {
    const first = rawBefore[0];
    if (/^[-–—]\s*(?:a\s+\d{1,2}\s*,?\s*)?BI\s*N[º°o]/i.test(first)) {
      beforeTable.push(formatPara(first));
    } else {
      beforeTable.push(formatPara(`${prefix} ${first}`));
    }
    for (let i = 1; i < rawBefore.length; i++) {
      beforeTable.push(formatPara(rawBefore[i]));
    }
  } else if (occ.tableRows.length > 0 || occ.contentAfterTable.trim()) {
    beforeTable.push(prefix);
  }

  const afterTable: string[] = [];
  const hasVisibleTable = occ.includeTable && occ.tableRows.length > 0;
  const rawAfter = splitVerbatimParagraphs(occ.contentAfterTable || '');

  // If there is a visible table, keep post-table text right AFTER the table (exact Army Folha layout).
  // If table is hidden/absent, append post-table paragraphs seamlessly to beforeTable.
  const targetForAfter = hasVisibleTable ? afterTable : beforeTable;

  for (const line of rawAfter) {
    targetForAfter.push(formatPara(line));
  }

  if (occ.includePersonnelList && occ.personnelListText.trim()) {
    const listLines = splitVerbatimParagraphs(occ.personnelListText);
    for (const line of listLines) {
      targetForAfter.push(line);
    }
  }

  if (occ.includeEmConsequencia && occ.emConsequenciaText.trim()) {
    const emcLines = splitVerbatimParagraphs(occ.emConsequenciaText);
    for (const line of emcLines) {
      targetForAfter.push(line);
    }
  }

  return { beforeTable, afterTable };
}

/**
 * Legacy helper returning all paragraphs concatenated (for quick previews).
 */
export function buildOccurrenceParagraphs(occ: BiOccurrenceItem): string[] {
  const { beforeTable, afterTable } = buildOccurrenceParagraphSegments(occ);
  return [...beforeTable, ...afterTable];
}

/**
 * Formats a single occurrence into copyable plain text matching Folha 26.1 / Army structure
 * (preserving exact before-table -> table -> after-table order).
 */
export function formatSingleOccurrencePlainText(occ: BiOccurrenceItem): string {
  const { title, subtitle } = normalizeBiOccurrenceHeading(occ.title, occ.subtitle);
  const { beforeTable, afterTable } = buildOccurrenceParagraphSegments(occ);
  const lines: string[] = [];
  if (title) lines.push(title);
  if (subtitle) lines.push(subtitle);
  if (beforeTable.length > 0) {
    lines.push('');
    lines.push(...beforeTable);
  }
  if (occ.includeTable && occ.tableRows.length > 0) {
    lines.push('');
    for (const row of occ.tableRows) {
      lines.push(row.join(' | '));
    }
  }
  if (afterTable.length > 0) {
    lines.push('');
    lines.push(...afterTable);
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
 * Builds plain-text full semester transcription matching Formatar Alteração layout
 * (including "<MÊS>:\n\n- Sem Alteração" for empty months and 2ª PARTE).
 */
export function formatAllSelectedPlainText(
  occurrences: BiOccurrenceItem[],
  semester: BiSemesterSelection,
  postoGraduacao?: string
): string {
  const { months, closingDateIso } = getSemesterLabels(semester);
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
    out.push('');
    const monthItems = selected.filter((o) => o.bulletinMonth === month);
    if (monthItems.length === 0) {
      out.push('- Sem Alteração');
      out.push('');
      continue;
    }

    // Group by normalized title within the month
    const byTitle = new Map<string, { displayTitle: string; items: { occ: BiOccurrenceItem; subtitle: string }[] }>();
    for (const item of monthItems) {
      const { title, subtitle } = normalizeBiOccurrenceHeading(
        item.title,
        item.subtitle,
        postoGraduacao
      );
      const key = stripDiacriticsUpperLocal(title);
      let grp = byTitle.get(key);
      if (!grp) {
        grp = { displayTitle: title, items: [] };
        byTitle.set(key, grp);
      }
      grp.items.push({ occ: item, subtitle });
    }

    for (const grp of byTitle.values()) {
      out.push(grp.displayTitle);
      for (const { occ, subtitle } of grp.items) {
        const { beforeTable, afterTable } = buildOccurrenceParagraphSegments(occ);
        if (subtitle) out.push(subtitle);
        out.push('');
        out.push(...beforeTable);
        if (occ.includeTable && occ.tableRows.length > 0) {
          out.push('');
          for (const row of occ.tableRows) {
            out.push(row.join(' | '));
          }
        }
        if (afterTable.length > 0) {
          out.push('');
          out.push(...afterTable);
        }
        out.push('');
      }
    }
  }

  const part2Lines = applyServiceTimeToPart2Lines([], '', {
    datePtBr: formatPtBrDateLong(closingDateIso),
  });
  out.push(...part2Lines);

  return out.join('\n').trim();
}

/**
 * Converts approved BI occurrences into a full StructuredAlteracaoDoc ready for
 * renderBlocksFromStructuredDoc() and the live A4 editor — 100% aligned with
 * the Formatar Alteração standard (1ª PARTE, all 6 months with Sem Alteração,
 * inline "- a X, BI Nº Y:", singularization, in-place tables + post-table notes, and standard 2ª PARTE).
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
  closingDateIso: string;
} {
  const { military, semester } = params;
  const { semestre, periodo, closingDateIso, months } = getSemesterLabels(semester);
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
    const { title, subtitle } = normalizeBiOccurrenceHeading(
      occ.title,
      occ.subtitle,
      military.postoGraduacao
    );
    const { beforeTable, afterTable } = buildOccurrenceParagraphSegments(occ);

    if (beforeTable.length > 0) {
      items.push({
        id: `bi-item-${seq++}`,
        kind: 'entry',
        month,
        title,
        subtitle,
        previewLabel: subtitle || beforeTable[0].slice(0, 70),
        paragraphs: beforeTable,
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

    if (afterTable.length > 0) {
      items.push({
        id: `bi-after-${seq++}`,
        kind: 'entry',
        month,
        title,
        subtitle,
        previewLabel: afterTable[0].slice(0, 70),
        paragraphs: afterTable,
        continueWithoutSubtitle: true,
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

  // Populate standard 2ª PARTE (exact same standard as Formatar Alteração)
  const standardPart2Lines = applyServiceTimeToPart2Lines([], '', {
    datePtBr: formatPtBrDateLong(closingDateIso),
  });

  const structuredDoc: StructuredAlteracaoDoc = {
    items,
    monthOrder,
    part2Lines: standardPart2Lines,
    extractedHeader: headerExtract,
  };

  return {
    structuredDoc,
    headerExtract,
    semestre,
    periodo,
    closingDateIso,
  };
}
