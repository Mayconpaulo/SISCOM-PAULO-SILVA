import type {
  BiBulletinMetadata,
  BiBulletinPageInput,
  BiDiscardedHomonymServer,
  BiExtractedOccurrenceServer,
  BiMilitaryTargetInput,
} from './biExtractionService.js';

const MONTH_NUMBER_TO_PT: Record<number, string> = {
  1: 'JANEIRO',
  2: 'FEVEREIRO',
  3: 'MARÇO',
  4: 'ABRIL',
  5: 'MAIO',
  6: 'JUNHO',
  7: 'JULHO',
  8: 'AGOSTO',
  9: 'SETEMBRO',
  10: 'OUTUBRO',
  11: 'NOVEMBRO',
  12: 'DEZEMBRO',
};

const MONTH_NAME_MAP: Record<string, string> = {
  JAN: 'JANEIRO',
  JANEIRO: 'JANEIRO',
  FEV: 'FEVEREIRO',
  FEVEREIRO: 'FEVEREIRO',
  MAR: 'MARÇO',
  MARCO: 'MARÇO',
  ABR: 'ABRIL',
  ABRIL: 'ABRIL',
  MAI: 'MAIO',
  MAIO: 'MAIO',
  JUN: 'JUNHO',
  JUNHO: 'JUNHO',
  JUL: 'JULHO',
  JULHO: 'JULHO',
  AGO: 'AGOSTO',
  AGOSTO: 'AGOSTO',
  SET: 'SETEMBRO',
  SETEMBRO: 'SETEMBRO',
  OUT: 'OUTUBRO',
  OUTUBRO: 'OUTUBRO',
  NOV: 'NOVEMBRO',
  NOVEMBRO: 'NOVEMBRO',
  DEZ: 'DEZEMBRO',
  DEZEMBRO: 'DEZEMBRO',
};

function stripAccentsUpper(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function cleanSpaces(value: string): string {
  return value.replace(/[ \t]+/g, ' ').trim();
}

function normalizeMonthPt(raw: string | undefined): string {
  if (!raw) return '';
  const norm = stripAccentsUpper(raw).replace(/[^A-Z]/g, '');
  return MONTH_NAME_MAP[norm] || '';
}

function normalizeRankGroup(rawRank: string): string {
  const u = stripAccentsUpper(rawRank).replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  if (!u) return '';
  if (/\b(?:GEN|GENERAL)\b/.test(u)) return 'GEN';
  if (/\b(?:TC|TEN\s*CEL|TENENTE\s*CORONEL)\b/.test(u)) return 'TC';
  if (/\b(?:CEL|CORONEL)\b/.test(u)) return 'CEL';
  if (/\b(?:MAJ|MAJOR)\b/.test(u)) return 'MAJ';
  if (/\b(?:CAP|CAPITAO)\b/.test(u)) return 'CAP';
  if (/\b1[º°O]?\s*TEN\b/.test(u)) return '1TEN';
  if (/\b2[º°O]?\s*TEN\b/.test(u)) return '2TEN';
  if (/\bTEN\b/.test(u)) return 'TEN';
  if (/\bASP\b/.test(u)) return 'ASP';
  if (/\b(?:ST|SUBTEN|S\s*TEN|SUBTENENTE)\b/.test(u)) return 'ST';
  if (/\b1[º°O]?\s*SGT\b/.test(u)) return '1SGT';
  if (/\b2[º°O]?\s*SGT\b/.test(u)) return '2SGT';
  if (/\b3[º°O]?\s*SGT\b/.test(u)) return '3SGT';
  if (/\bSGT\b/.test(u)) return 'SGT';
  if (/\b(?:CB|CABO)\b/.test(u)) return 'CB';
  if (/\b(?:SD|SOLDADO)\b/.test(u)) return 'SD';
  if (/\b(?:CAD|CADETE)\b/.test(u)) return 'CAD';
  if (/\b(?:AL|ALUNO)\b/.test(u)) return 'AL';
  return u;
}

function areRanksCompatible(targetRankGroup: string, foundRankGroup: string): boolean {
  if (!targetRankGroup || !foundRankGroup) return true;
  if (targetRankGroup === foundRankGroup) return true;
  if (targetRankGroup === 'SGT' && ['1SGT', '2SGT', '3SGT'].includes(foundRankGroup)) return true;
  if (foundRankGroup === 'SGT' && ['1SGT', '2SGT', '3SGT'].includes(targetRankGroup)) return true;
  if (targetRankGroup === 'TEN' && ['1TEN', '2TEN'].includes(foundRankGroup)) return true;
  if (foundRankGroup === 'TEN' && ['1TEN', '2TEN'].includes(targetRankGroup)) return true;
  return false;
}

// Matches standalone SisBol military personnel lines like:
// "2º Sgt EDSON DA SILVA CARDOSO", "Asp Of KAIO LEITE REIS BENTO", "Cad LUCAS SOUZA MONTEIRO", "Sd EV YSAC...", "ST RODRIGO..."
const MILITARY_RANK_PREFIX_RE =
  /^(?:Gen\s+(?:Ex|Div|Bda)|Cel|Ten\s+Cel|TC|Maj|Cap|1[º°o]\s*Ten|2[º°o]\s*Ten|Asp\s+Of|Asp|Cadete|Cad|Subten|S\s*Ten|ST|1[º°o]\s*Sgt|2[º°o]\s*Sgt|3[º°o]\s*Sgt|Sgt|Cb\s+(?:EV|EP|NB)|Cb|Sd\s+(?:EV|EP|NB|Rec)|Sd|Al\s+(?:NPOR|CPOR|EsSA|EsPCEx|IME|AMAN)|Al)\b/i;

const STANDALONE_MILITARY_LINE_RE =
  /^((?:Gen\s+(?:Ex|Div|Bda)|Cel|Ten\s+Cel|TC|Maj|Cap|1[º°o]\s*Ten|2[º°o]\s*Ten|Asp\s+Of|Asp|Cadete|Cad|Subten|S\s*Ten|ST|1[º°o]\s*Sgt|2[º°o]\s*Sgt|3[º°o]\s*Sgt|Sgt|Cb\s+(?:EV|EP|NB)|Cb|Sd\s+(?:EV|EP|NB|Rec)|Sd|Al\s+(?:NPOR|CPOR|EsSA|EsPCEx|IME|AMAN)|Al)(?:\s+(?:Inf|Cav|Art|Eng|Com|Int|MB|QMB|QCO|QAO|Med|Dent|Farm|Vet|Mnt|Armt|Sau|Av|Mus|Topo|EF|EP|EV|NB|STT|CET|OTC|R\/2|TM|Temp|Mnt\s+Armt|Mnt\s+Com|Mnt\s+Vtr|MB\/[A-Za-zÀ-ÿ\s]+))?)\s+([A-ZÀ-Ý][A-ZÀ-Ý\s'´`.\-]{4,})$/;

const CONTINUATION_HEADER_RE =
  /^\(?\s*Continua[çc][ãa]o\s+do\s+BI\s+(?:Nr|N[º°o]\.?)\s*\d+/i;

const PAGE_NUMBER_ONLY_RE = /^Pag\s*n[º°o]\.?\s*\d+$/i;

const PART_HEADER_RE = /^([1-4])[ªaº°]\s*Parte\b/i;

const PART_SUBHEADER_SET = new Set([
  'SERVICOS DIARIOS',
  'INSTRUCAO',
  'ASSUNTOS GERAIS E ADMINISTRATIVOS',
  'JUSTICA E DISCIPLINA',
]);

const EM_CONSEQUENCIA_START_RE =
  /^(?:\d+\.\s*)?Em\s+consequ[êe]ncia\b/i;

const EM_CONSEQUENCIA_SUBITEM_RE = /^[a-z]\)\s+/i;

const PUBLICATION_NOTE_RE =
  /^\((?:Por\s+n[ãa]o\s+ter\s+sido\s+publicado|Adt\s+da\s+DCEM|Aditamento|Bol\s+do\s+DGP|Bol\s+Ex|BI\s+n|Transcrito|Publicado|Republicado)/i;

const FOOTER_AUTH_TRIGGER_RE =
  /^(?:ASSINA\s*:|CONFERE\s+COM\s+O\s+ORIGINAL|CONFERIDO\s+E\s+AUTENTICADO|GEN\s+EX|POR\s+DELEGA[ÇC][ÃA]O)/i;

interface StreamLine {
  kind: 'text' | 'table';
  text: string;
  tableRows?: string[][];
  pageNumber: number;
}

interface ParsedSisbolNota {
  part: string;
  title: string;
  subtitle: string;
  entries: StreamLine[];
  sourcePages: number[];
}

function isStandaloneMilitaryLine(line: string): { rank: string; name: string } | null {
  const clean = cleanSpaces(line);
  if (!clean || clean.length > 110) return null;
  if (/[.,;:!?]$/.test(clean) && !/\b(?:JR|FILHO|NETO|SOBRINHO)\.?$/i.test(clean)) return null;
  if (/\b(?:da\s+\d+[ªa]\s*Cia|Cia\s+C\s+Ap|ministrada|realizada|apresentou|obteve|participaram|conforme|atrav[ée]s|em\s+consequ)/i.test(clean)) {
    return null;
  }

  const m = STANDALONE_MILITARY_LINE_RE.exec(clean);
  if (!m) return null;

  const rank = cleanSpaces(m[1]);
  const name = cleanSpaces(m[2]);
  // Name must be mostly uppercase words (>= 2 words)
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  const nonPrep = name.replace(/\b(?:de|da|do|das|dos|e)\b/g, '');
  if (nonPrep !== nonPrep.toUpperCase()) return null;
  return { rank, name };
}

function isSectionTitleInPart3Or4(line: string): { title: string } | null {
  const m = /^(\d+)\.\s+(.+)$/.exec(line);
  if (!m) return null;
  const text = cleanSpaces(m[2]);
  if (!text || text.length > 90) return null;
  if (/[.;!?]$/.test(text)) return null;
  if (/^Em\s+consequ/i.test(text)) return null;

  const norm = stripAccentsUpper(text);
  // Recognize standard SisBol 3ª/4ª Parte section headings (mostly ALL-CAPS, plus "SiCaPEx")
  const known = [
    /^ALTERACOES\s+DE\s+/,
    /^SERVICO\s+DE\s+SAUDE$/,
    /^FISCALIZACAO\s+ADMINISTRATIVA$/,
    /^SETOR\s+DE\s+PAGAMENTO/,
    /^DIVERSOS$/,
    /^SICAPEX$/,
    /^DISCIPLINA$/,
    /^JUSTICA$/,
    /^MOVIMENTACAO/,
    /^PROMOCOES/,
    /^COMPORTAMENTO/,
    /^INSTRUCAO/,
  ];
  if (known.some((re) => re.test(norm))) {
    return { title: text.toUpperCase() };
  }

  // Generic ALL-CAPS short numbered section header
  const withoutPrep = text.replace(/\b(?:de|da|do|das|dos|e|em)\b/g, '');
  const letters = withoutPrep.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length >= 4 && withoutPrep === withoutPrep.toUpperCase() && !/\d{2,}/.test(text)) {
    return { title: text.toUpperCase() };
  }
  return null;
}

function isSubtitleHeadingLine(line: string, part: string): { subtitle: string } | null {
  const clean = cleanSpaces(line);
  if (!clean || clean.length > 150) return null;
  if (/[.;,!?]$/.test(clean)) return null;
  if (/^Em\s+consequ/i.test(clean)) return null;
  if (isStandaloneMilitaryLine(clean)) return null;

  if (part === '2ª Parte') {
    const m = /^(\d+)\.\s+(.+)$/.exec(clean);
    if (!m) return null;
    const sub = cleanSpaces(m[2]);
    if (!sub || sub.length > 140) return null;
    // Reject numbered narrative sentences like "1. Foi prorrogado..." or "1. Através do..."
    if (
      /^(?:Foi|Foram|Atrav[ée]s|O\s+parecer|Parecer|Em\s+consequ|Conforme|Os\s+militares|O\s+militar|Ap[óo]s|Determino|Nomeio|Prorrogo|Retifico)\b/i.test(
        sub
      )
    ) {
      return null;
    }
    return { subtitle: sub };
  }

  if (part === '3ª Parte' || part === '4ª Parte') {
    const letterMatch = /^([a-z])\.\s+(.+)$/.exec(clean);
    if (letterMatch) {
      const sub = cleanSpaces(letterMatch[2]);
      if (!sub || sub.length > 140) return null;
      // Reject lettered body paragraphs like "a. Através do DIEx..." or "a. O custodiado..."
      if (
        /^(?:Atrav[ée]s|O\s+custodiado|A\s+OM|Foi|Foram|Em\s+consequ|Ap[óo]s|Conforme|Os\s+militares|O\s+militar)\b/i.test(
          sub
        )
      ) {
        return null;
      }
      return { subtitle: sub };
    }

    // In 4ª Parte, numbered items that are NOT "1. DISCIPLINA" / "2. JUSTIÇA" can be subtitles
    if (part === '4ª Parte') {
      const numMatch = /^(\d+)\.\s+(.+)$/.exec(clean);
      if (numMatch) {
        const sub = cleanSpaces(numMatch[2]);
        if (
          sub &&
          sub.length <= 130 &&
          !/^(?:Foi|Foram|Atrav[ée]s|O\s+parecer|Parecer|Em\s+consequ|Conforme|Os\s+militares|O\s+militar|Ap[óo]s)\b/i.test(
            sub
          )
        ) {
          return { subtitle: sub };
        }
      }
    }
  }

  return null;
}

/**
 * Checks whether the bulletin clearly follows the Brazilian Army SisBol format.
 */
export function isSisbolStructuredBulletin(pages: BiBulletinPageInput[]): boolean {
  const combined = pages.map((p) => p.text).join('\n');
  let partMatches = 0;
  if (/\b1[ªa]\s*Parte\b/i.test(combined)) partMatches++;
  if (/\b2[ªa]\s*Parte\b/i.test(combined)) partMatches++;
  if (/\b3[ªa]\s*Parte\b/i.test(combined)) partMatches++;
  if (/\b4[ªa]\s*Parte\b/i.test(combined)) partMatches++;

  const hasContHeader = /Continua[çc][ãa]o\s+do\s+BI\s+(?:Nr|N[º°o]\.?)/i.test(combined);
  const hasBoletimHeader = /BOLETIM\s+INTERNO/i.test(combined);
  return partMatches >= 2 || (partMatches >= 1 && (hasContHeader || hasBoletimHeader));
}

export function extractSisbolMetadata(
  fileName: string,
  pages: BiBulletinPageInput[],
  headerHints?: Partial<BiBulletinMetadata>
): BiBulletinMetadata {
  const firstPagesText = pages
    .slice(0, 2)
    .map((p) => p.text)
    .join('\n');

  let bulletinNumber = headerHints?.bulletinNumber || '';
  let bulletinDateIso = headerHints?.bulletinDateIso || '';
  let bulletinDay: number | null = headerHints?.bulletinDay ?? null;
  let bulletinMonth = headerHints?.bulletinMonth || '';
  let bulletinYear: number | null = headerHints?.bulletinYear ?? null;
  let omName = headerHints?.omName || '';

  if (!bulletinNumber) {
    const m =
      firstPagesText.match(
        /BOLETIM\s+INTERNO(?:\s+OSTENSIVO)?\s*(?:N[º°o]|NR\.?)?\s*0*(\d{1,4})(?:\s*\/\s*(20\d{2}))?/i
      ) ||
      firstPagesText.match(/Continua[çc][ãa]o\s+do\s+BI\s+(?:Nr|N[º°o]\.?)\s*0*(\d{1,4})/i) ||
      fileName.match(/(?:_|-)0*(\d{1,4})(?:_|-)boletim/i);
    if (m) {
      bulletinNumber = String(parseInt(m[1], 10));
      if (m[2] && !bulletinYear) bulletinYear = parseInt(m[2], 10);
    }
  }

  if (!bulletinDateIso) {
    const contDate = firstPagesText.match(
      /Continua[çc][ãa]o\s+do\s+BI\s+(?:Nr|N[º°o]\.?)\s*\d+\s*,\s*de\s+(\d{1,2})\/(\d{1,2})\/(20\d{2})/i
    );
    const longDate = firstPagesText.match(
      /\b(\d{1,2})\s+de\s+(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(20\d{2})\b/i
    );
    const fileDate = fileName.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);

    if (contDate) {
      bulletinDay = parseInt(contDate[1], 10);
      const mNum = parseInt(contDate[2], 10);
      bulletinYear = parseInt(contDate[3], 10);
      bulletinMonth = MONTH_NUMBER_TO_PT[mNum] || '';
      bulletinDateIso = `${bulletinYear}-${String(mNum).padStart(2, '0')}-${String(bulletinDay).padStart(2, '0')}`;
    } else if (longDate) {
      bulletinDay = parseInt(longDate[1], 10);
      bulletinMonth = normalizeMonthPt(longDate[2]);
      bulletinYear = parseInt(longDate[3], 10);
      const mEntry = Object.entries(MONTH_NUMBER_TO_PT).find(([, v]) => v === bulletinMonth);
      if (mEntry) {
        bulletinDateIso = `${bulletinYear}-${String(mEntry[0]).padStart(2, '0')}-${String(bulletinDay).padStart(2, '0')}`;
      }
    } else if (fileDate) {
      bulletinYear = parseInt(fileDate[1], 10);
      const mNum = parseInt(fileDate[2], 10);
      bulletinDay = parseInt(fileDate[3], 10);
      bulletinMonth = MONTH_NUMBER_TO_PT[mNum] || '';
      bulletinDateIso = `${bulletinYear}-${String(mNum).padStart(2, '0')}-${String(bulletinDay).padStart(2, '0')}`;
    }
  }

  if (!omName) {
    const omMatch = firstPagesText.match(
      /Continua[çc][ãa]o\s+do\s+BI\s+(?:Nr|N[º°o]\.?)\s*\d+\s*,\s*de\s+\d{1,2}\/\d{1,2}\/\d{4}\s*,\s*do\(a\)\s+([^)|]+?)(?:\)|\s*\|)/i
    );
    if (omMatch) {
      omName = cleanSpaces(omMatch[1]);
    }
  }

  return {
    bulletinNumber,
    bulletinDateIso,
    bulletinDay,
    bulletinMonth,
    bulletinYear,
    omName,
  };
}

/**
 * Converts paginated bulletin text into a clean continuous stream of lines & tables,
 * stripping SisBol page continuation headers and page numbers while preserving exact source page numbers.
 */
function buildCleanStream(pages: BiBulletinPageInput[]): StreamLine[] {
  const stream: StreamLine[] = [];

  for (const page of pages) {
    const rawLines = page.text.replace(/\r\n/g, '\n').split('\n');
    let inTable = false;
    let currentTableRows: string[][] = [];

    for (const rawLine of rawLines) {
      const line = cleanSpaces(rawLine);
      if (!line) continue;

      if (line === '[[TABELA_INICIO]]') {
        inTable = true;
        currentTableRows = [];
        continue;
      }
      if (line === '[[TABELA_FIM]]') {
        inTable = false;
        if (currentTableRows.length > 0) {
          stream.push({
            kind: 'table',
            text: '',
            tableRows: currentTableRows,
            pageNumber: page.pageNumber,
          });
        }
        currentTableRows = [];
        continue;
      }
      if (inTable) {
        const cells = line.split(/\s*\|\s*/).map((c) => cleanSpaces(c));
        if (cells.some((c) => c.length > 0)) {
          currentTableRows.push(cells);
        }
        continue;
      }

      // Strip SisBol continuation page header & standalone page numbers
      if (CONTINUATION_HEADER_RE.test(line)) continue;
      if (PAGE_NUMBER_ONLY_RE.test(line)) continue;
      // Strip "Quartel em ..., D de mês de AAAA" / BI cover lines only before 1ª Parte (handled in state machine)

      stream.push({
        kind: 'text',
        text: line,
        pageNumber: page.pageNumber,
      });
    }

    if (inTable && currentTableRows.length > 0) {
      stream.push({
        kind: 'table',
        text: '',
        tableRows: currentTableRows,
        pageNumber: page.pageNumber,
      });
    }
  }

  return stream;
}

/**
 * Segments the continuous SisBol stream into atomic Notas (Part -> Title -> Subtitle -> Sub-Nota),
 * respecting `Em consequência...` boundaries so multiple independent notas under one heading
 * (e.g., 6 DCEM blocks under "2. Aditamento da DCEM - Transcrição" or 2 blocks under
 * "3. ATIVIDADES DE ÉTICA E LIDERANÇA") are isolated with 100% precision.
 */
function segmentSisbolNotas(stream: StreamLine[]): ParsedSisbolNota[] {
  const notas: ParsedSisbolNota[] = [];

  let currentPart = '';
  let currentTitle = '';
  let currentSubtitle = '';
  let awaitingUnletteredSubtitle = false;
  let inEmConsequencia = false;
  let currentEntries: StreamLine[] = [];

  const flushNota = () => {
    if (!currentPart || currentEntries.length === 0) {
      currentEntries = [];
      inEmConsequencia = false;
      return;
    }
    const pageSet = new Set<number>();
    for (const e of currentEntries) pageSet.add(e.pageNumber);
    notas.push({
      part: currentPart,
      title: currentTitle || (currentPart === '2ª Parte' ? 'INSTRUÇÃO' : 'ASSUNTOS GERAIS E ADMINISTRATIVOS'),
      subtitle: currentSubtitle,
      entries: currentEntries,
      sourcePages: Array.from(pageSet).sort((a, b) => a - b),
    });
    currentEntries = [];
    inEmConsequencia = false;
  };

  for (let i = 0; i < stream.length; i++) {
    const item = stream[i];

    if (item.kind === 'table') {
      if (!currentPart) continue;
      if (inEmConsequencia) {
        // Table after an Em consequência starts a new sub-nota under the same heading
        flushNota();
      }
      awaitingUnletteredSubtitle = false;
      currentEntries.push(item);
      continue;
    }

    const line = item.text;

    // 1. Part transition (1ª Parte, 2ª Parte, 3ª Parte, 4ª Parte)
    const partMatch = PART_HEADER_RE.exec(line);
    if (partMatch && line.length <= 28) {
      flushNota();
      const num = partMatch[1];
      currentPart = `${num}ª Parte`;
      currentTitle =
        num === '1'
          ? 'SERVIÇOS DIÁRIOS'
          : num === '2'
            ? 'INSTRUÇÃO'
            : num === '3'
              ? 'ASSUNTOS GERAIS E ADMINISTRATIVOS'
              : 'JUSTIÇA E DISCIPLINA';
      currentSubtitle = '';
      awaitingUnletteredSubtitle = false;
      continue;
    }

    // Ignore cover header lines before 1ª Parte
    if (!currentPart) continue;

    // Stop at BI closing authentication/signature block in 4ª Parte
    if (currentPart === '4ª Parte' && FOOTER_AUTH_TRIGGER_RE.test(line)) {
      flushNota();
      break;
    }

    // Skip repeated Part subheader right below "2ª Parte" -> "INSTRUÇÃO", etc.
    if (
      currentEntries.length === 0 &&
      !currentSubtitle &&
      PART_SUBHEADER_SET.has(stripAccentsUpper(line))
    ) {
      if (currentPart === '2ª Parte') currentTitle = 'INSTRUÇÃO';
      continue;
    }

    // Skip "Sem Alteração" lines inside empty parts
    if (/^Sem\s+Altera[çc][ãa]o\.?$/i.test(line)) {
      continue;
    }

    // 2. Numbered Section Title in 3ª Parte / 4ª Parte (e.g. "2. ALTERAÇÕES DE SUBTENENTES E SARGENTOS", "3. SERVIÇO DE SAÚDE")
    if (currentPart === '3ª Parte' || currentPart === '4ª Parte') {
      const secTitle = isSectionTitleInPart3Or4(line);
      if (secTitle) {
        flushNota();
        currentTitle = secTitle.title;
        currentSubtitle = '';
        awaitingUnletteredSubtitle = true;
        continue;
      }
    }

    // 3. Explicit Subtitle Heading ("1. Instrução de Quadros", "b. Férias - Apresentação por Término")
    const subMatch = isSubtitleHeadingLine(line, currentPart);
    if (subMatch) {
      // Do NOT break mid-Em-consequência if a sub-item happens to look weird
      if (!inEmConsequencia || !EM_CONSEQUENCIA_SUBITEM_RE.test(line)) {
        flushNota();
        currentSubtitle = subMatch.subtitle;
        awaitingUnletteredSubtitle = false;
        continue;
      }
    }

    // 4. Unlettered subtitle right after a 3ª/4ª Parte section title (e.g., "Prorrogação de Julgamento de Processo Disciplinar")
    if (
      awaitingUnletteredSubtitle &&
      currentEntries.length === 0 &&
      line.length <= 120 &&
      !/[.;,!?]$/.test(line) &&
      !MILITARY_RANK_PREFIX_RE.test(line) &&
      !/^(?:Foi|Foram|O\s+militar|Os\s+militares|Ap[óo]s|Conforme|Atrav[ée]s|Em\s+retifica|Nomeio|Prorrogo|Determino|1\.\s)/i.test(
        line
      )
    ) {
      currentSubtitle = line;
      awaitingUnletteredSubtitle = false;
      continue;
    }
    awaitingUnletteredSubtitle = false;

    // 5. Track `Em consequência...` termination boundary
    if (EM_CONSEQUENCIA_START_RE.test(line)) {
      inEmConsequencia = true;
      currentEntries.push(item);
      continue;
    }

    if (inEmConsequencia) {
      // Lines belonging to the Em consequência block:
      // - Sub-items a), b), c)...
      // - Wrapped continuation lines of the previous Em consequência sentence
      const prevEntry = currentEntries[currentEntries.length - 1];
      const prevText = prevEntry?.kind === 'text' ? prevEntry.text : '';
      const prevFinished = /[.;!?]$/.test(prevText) && !/:\s*$/.test(prevText);
      const isSubItem = EM_CONSEQUENCIA_SUBITEM_RE.test(line);
      const looksLikeNewSubNotaStart =
        /^[-–—]\s+[A-ZÀ-Ý]/.test(line) ||
        /^(?:Foi|Foram|O\s+militar|Os\s+militares|Ap[óo]s|Conforme|Atrav[ée]s|Em\s+retifica|Nomeio|Prorrogo|Determino|1\.\s)/i.test(
          line
        );

      if (isSubItem || (!prevFinished && !looksLikeNewSubNotaStart)) {
        currentEntries.push(item);
        continue;
      }

      // Otherwise a brand new independent sub-nota has begun under the SAME Title + Subtitle!
      flushNota();
    }

    currentEntries.push(item);
  }

  flushNota();
  return notas;
}

/**
 * Joins PDF-wrapped prose lines inside a body segment into clean paragraphs while
 * preserving intentional paragraph breaks (dash headers, numbered observations,
 * "Observações:", parenthetical publication notes).
 */
function joinBodyLinesToParagraphs(lines: string[]): string {
  const paras: string[] = [];

  const startsNewParagraph = (line: string, prevPara: string): boolean => {
    if (!prevPara) return true;
    if (/^[-–—]\s+/.test(line)) return true;
    if (/^Observa[çc][õo]es\s*:/i.test(line)) return true;
    if (/^\d{1,5}\s*[-–—\.\)]\s+/.test(line)) return true;
    if (/^[a-z]\)\s+/i.test(line)) return true;
    if (PUBLICATION_NOTE_RE.test(line)) return true;
    if (/:$/.test(prevPara) && prevPara.length < 40) return true;
    // If previous line was a short bullet/heading like "- RELACIONAMENTO INICIAL" or "- Curso ..."
    if (/^[-–—]\s+/.test(prevPara) && !/,$/.test(prevPara)) return true;
    return false;
  };

  for (const raw of lines) {
    const line = cleanSpaces(raw);
    if (!line) continue;

    const prev = paras[paras.length - 1] || '';
    if (startsNewParagraph(line, prev)) {
      paras.push(line);
    } else {
      // Join wrapped line seamlessly (rejoin soft hyphenated word if needed)
      if (
        /[A-Za-zÀ-ÿ]-$/.test(prev) &&
        /^[a-zà-ÿ]/.test(line) &&
        !/(?:sub|ex|vice|p[óo]s|pr[ée]|anti|auto|contra|extra|inter|intra|semi|sobre|super)-$/i.test(prev)
      ) {
        paras[paras.length - 1] = `${prev.slice(0, -1)}${line}`;
      } else {
        paras[paras.length - 1] = `${prev} ${line}`;
      }
    }
  }

  return paras.join('\n').trim();
}

interface DecomposedNota {
  contentBeforeTable: string;
  tableRows: string[][];
  contentAfterTable: string;
  linkedPersonnel: Array<{ rank: string; name: string; raw: string; pageNumber: number }>;
  emConsequenciaText: string;
}

/**
 * Decomposes a single SisBol Nota into its exact Army anatomy:
 * 1. Text before table (`contentBeforeTable`)
 * 2. Table rows (`tableRows`)
 * 3. Text after table (`contentAfterTable`)
 * 4. Linked standalone military lines (`linkedPersonnel` — excluded from Folha body by default)
 * 5. Closing `Em consequência...` block (`emConsequenciaText` — excluded from Folha body by default)
 *
 * Also preserves parenthetical publication notes like "(Por não ter sido publicado em época oportuna)."
 * even when they appear right after the linked personnel list and before "Em consequência".
 */
function decomposeSisbolNota(nota: ParsedSisbolNota): DecomposedNota {
  const entries = nota.entries;

  // 1. Find where `Em consequência` starts
  let emcIdx = entries.length;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].kind === 'text' && EM_CONSEQUENCIA_START_RE.test(entries[i].text)) {
      emcIdx = i;
      break;
    }
  }

  const emcLines = entries
    .slice(emcIdx)
    .filter((e) => e.kind === 'text')
    .map((e) => e.text);
  const emConsequenciaText = joinBodyLinesToParagraphs(emcLines);

  // 2. Work backwards from emcIdx to separate trailing publication notes & linked military list
  const preEmc = entries.slice(0, emcIdx);
  const trailingPubNotes: string[] = [];
  let cursor = preEmc.length - 1;

  // Peel off any trailing publication notes right before Em consequência
  // (e.g. BI 20 p.5: "(Por não ter sido publicado em época oportuna)." sits AFTER the 60-person list!)
  while (
    cursor >= 0 &&
    preEmc[cursor].kind === 'text' &&
    PUBLICATION_NOTE_RE.test(preEmc[cursor].text)
  ) {
    trailingPubNotes.unshift(preEmc[cursor].text);
    cursor--;
  }

  // Peel off contiguous standalone military lines at the end of the nota (linked personnel block)
  const linkedPersonnel: Array<{ rank: string; name: string; raw: string; pageNumber: number }> = [];
  let splitIdx = cursor + 1;
  while (cursor >= 0 && preEmc[cursor].kind === 'text') {
    const parsedMil = isStandaloneMilitaryLine(preEmc[cursor].text);
    if (!parsedMil) break;
    linkedPersonnel.unshift({
      rank: parsedMil.rank,
      name: parsedMil.name,
      raw: preEmc[cursor].text,
      pageNumber: preEmc[cursor].pageNumber,
    });
    splitIdx = cursor;
    cursor--;
  }

  const bodyEntries = preEmc.slice(0, splitIdx);

  // 3. Split bodyEntries around the first structured table (if present)
  const firstTableIdx = bodyEntries.findIndex((e) => e.kind === 'table' && e.tableRows && e.tableRows.length > 0);

  if (firstTableIdx === -1) {
    const bodyLines = bodyEntries.filter((e) => e.kind === 'text').map((e) => e.text);
    bodyLines.push(...trailingPubNotes);
    return {
      contentBeforeTable: joinBodyLinesToParagraphs(bodyLines),
      tableRows: [],
      contentAfterTable: '',
      linkedPersonnel,
      emConsequenciaText,
    };
  }

  const beforeLines = bodyEntries
    .slice(0, firstTableIdx)
    .filter((e) => e.kind === 'text')
    .map((e) => e.text);

  // Merge consecutive table blocks (e.g. a table spanning a page break)
  const mergedTableRows: string[][] = [];
  let afterStartIdx = firstTableIdx;
  while (
    afterStartIdx < bodyEntries.length &&
    bodyEntries[afterStartIdx].kind === 'table' &&
    bodyEntries[afterStartIdx].tableRows
  ) {
    mergedTableRows.push(...bodyEntries[afterStartIdx].tableRows!);
    afterStartIdx++;
  }

  const afterLines = bodyEntries
    .slice(afterStartIdx)
    .filter((e) => e.kind === 'text')
    .map((e) => e.text);
  afterLines.push(...trailingPubNotes);

  return {
    contentBeforeTable: joinBodyLinesToParagraphs(beforeLines),
    tableRows: mergedTableRows,
    contentAfterTable: joinBodyLinesToParagraphs(afterLines),
    linkedPersonnel,
    emConsequenciaText,
  };
}

interface TargetMatchProfile {
  fullNameNorm: string;
  fullNameTokens: string[];
  warNameNorm: string;
  rankGroup: string;
  subunidadeNorm: string;
  identidadeDigits: string;
  surnameToken: string;
}

function buildTargetMatchProfile(military: BiMilitaryTargetInput): TargetMatchProfile {
  const fullNameNorm = stripAccentsUpper(military.nomeCompleto || '').replace(/[^A-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const stopWords = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E']);
  const fullNameTokens = fullNameNorm.split(' ').filter((w) => w.length >= 2 && !stopWords.has(w));

  const warRaw = stripAccentsUpper(military.nomeGuerra || '').replace(/[^A-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const surnameToken = warRaw || fullNameTokens[fullNameTokens.length - 1] || '';

  return {
    fullNameNorm,
    fullNameTokens,
    warNameNorm: warRaw,
    rankGroup: normalizeRankGroup(military.postoGraduacao || ''),
    subunidadeNorm: stripAccentsUpper(military.subunidade || ''),
    identidadeDigits: (military.identidade || '').replace(/\D/g, ''),
    surnameToken,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsWholePhrase(haystackNorm: string, phraseNorm: string): boolean {
  if (!phraseNorm) return false;
  const re = new RegExp(`(?:^|[^A-Z])${escapeRegExp(phraseNorm)}(?:$|[^A-Z])`);
  return re.test(haystackNorm);
}

/**
 * Checks whether a candidate person (rank + name) matches the target military,
 * is an ambiguous partial match ("conferir"), or is a homonym (different military).
 */
function classifyPersonCandidate(
  candidateRank: string,
  candidateName: string,
  target: TargetMatchProfile,
  extraContextNorm = ''
): 'exact' | 'ambiguous' | 'homonym' | 'unrelated' {
  const nameNorm = stripAccentsUpper(candidateName).replace(/[^A-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!nameNorm) return 'unrelated';

  const candRankGroup = normalizeRankGroup(candidateRank);
  const rankOk = areRanksCompatible(target.rankGroup, candRankGroup);

  // 1. Exact full-name match (when target has >= 2 tokens)
  if (target.fullNameTokens.length >= 2 && containsWholePhrase(nameNorm, target.fullNameNorm)) {
    return rankOk ? 'exact' : 'ambiguous';
  }

  // 2. Check if candidate shares the target's war name / surname token
  const keyToken = target.surnameToken;
  if (!keyToken || keyToken.length < 3 || !containsWholePhrase(nameNorm, keyToken)) {
    return 'unrelated';
  }

  // Candidate contains the target's surname/war name!
  const stopWords = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E']);
  const candTokens = nameNorm.split(' ').filter((w) => w.length >= 2 && !stopWords.has(w));

  // If user only searched by a single name (e.g. just "CARDOSO")
  if (target.fullNameTokens.length === 1) {
    if (!rankOk) return 'homonym';
    if (target.subunidadeNorm && extraContextNorm && containsWholePhrase(extraContextNorm, target.subunidadeNorm)) {
      return 'exact';
    }
    return 'ambiguous';
  }

  // User provided full name (e.g. "EDSON DA SILVA CARDOSO"):
  // If candidate ONLY has 1 word (war name like "2º Sgt CARDOSO" or "Cb CARDOSO")
  if (candTokens.length === 1) {
    if (!rankOk) return 'homonym';
    // Same rank + war name only -> require manual review unless SU also confirms? Still safer as 'conferir'
    return 'ambiguous';
  }

  // Candidate has a full multi-word name (e.g. "ADEMIR CARDOSO FERREIRA JUNIOR" or "FELIPHE CARDOSO CORDEIRO PEREIRA")
  const firstNameMatches = candTokens[0] === target.fullNameTokens[0];
  if (!firstNameMatches) {
    return 'homonym';
  }

  // First name AND surname match! Check if all target significant tokens appear in candidate
  const allTargetTokensPresent = target.fullNameTokens.every((t) => candTokens.includes(t));
  if (allTargetTokensPresent) {
    return rankOk ? 'exact' : 'ambiguous';
  }

  return 'homonym';
}

/**
 * Filters a multi-person table so only the header row(s) and rows belonging to the target military
 * are kept (exact SisBol behavior for DCEM / TAF / inspection tables).
 * For commission tables where the military appears inside each sub-unit group, preserves sub-unit context.
 */
function filterTableRowsForTarget(
  tableRows: string[][],
  target: TargetMatchProfile
): string[][] {
  if (tableRows.length <= 2) return tableRows;

  // Check if this is a standard tabular listing with a header row (e.g. POSTO | IDT | NOME | ...)
  const headerTextNorm = stripAccentsUpper(tableRows[0].join(' '));
  const looksLikeHeaderRow =
    /\b(?:POSTO|GRAD|NOME|IDT|IDENTIDADE|OM\s+ORIGEM|LEGENDA|PARECER|NOTA|CONCEITO|SUBUNIDADE)\b/.test(
      headerTextNorm
    );

  if (looksLikeHeaderRow) {
    const matchingRows = tableRows.slice(1).filter((row) => {
      const joinedNorm = stripAccentsUpper(row.join(' '));
      const joinedDigits = row.join('').replace(/\D/g, '');
      if (target.identidadeDigits.length >= 7 && joinedDigits.includes(target.identidadeDigits)) {
        return true;
      }
      if (target.fullNameNorm && containsWholePhrase(joinedNorm, target.fullNameNorm)) {
        return true;
      }
      return false;
    });
    if (matchingRows.length > 0 && matchingRows.length < tableRows.length - 1) {
      return [tableRows[0], ...matchingRows];
    }
  }

  return tableRows;
}

export interface SisbolParseResult {
  isSisbol: boolean;
  bulletinMeta: BiBulletinMetadata;
  occurrences: BiExtractedOccurrenceServer[];
  discardedHomonyms: BiDiscardedHomonymServer[];
  totalNotasScanned: number;
}

/**
 * Deterministic Army SisBol extractor:
 * Replicates the exact Folha de Alterações extraction method used by the Brazilian Army's SisBol:
 * - Parses 1ª/2ª/3ª/4ª Partes, Section Titles, Subtitles, and independent Sub-Notas
 * - Strips page continuation headers seamlessly across page breaks
 * - Isolates linked personnel list & "Em consequência" from the verbatim body
 * - Preserves tables in exact position (contentText -> tableRows -> contentAfterTable)
 * - Preserves publication notes like "(Por não ter sido publicado em época oportuna)."
 * - Applies strict anti-homonym filtering and logs all discarded homonyms
 */
export function parseSisbolBulletin(params: {
  military: BiMilitaryTargetInput;
  fileName: string;
  pages: BiBulletinPageInput[];
  includeFirstPart: boolean;
  headerHints?: Partial<BiBulletinMetadata>;
}): SisbolParseResult {
  const { military, fileName, pages, includeFirstPart, headerHints } = params;
  const bulletinMeta = extractSisbolMetadata(fileName, pages, headerHints);
  const isSisbol = isSisbolStructuredBulletin(pages);

  if (!isSisbol) {
    return {
      isSisbol: false,
      bulletinMeta,
      occurrences: [],
      discardedHomonyms: [],
      totalNotasScanned: 0,
    };
  }

  const stream = buildCleanStream(pages);
  const notas = segmentSisbolNotas(stream);
  const target = buildTargetMatchProfile(military);

  const occurrences: BiExtractedOccurrenceServer[] = [];
  const discardedHomonyms: BiDiscardedHomonymServer[] = [];
  const seenHomonymKeys = new Set<string>();

  const recordHomonym = (
    nameFound: string,
    rankFound: string,
    pageNumber: number,
    bulletinPart: string,
    reason: string
  ) => {
    const key = `${stripAccentsUpper(nameFound)}|${pageNumber}`;
    if (seenHomonymKeys.has(key)) return;
    seenHomonymKeys.add(key);
    discardedHomonyms.push({
      nameFound: cleanSpaces(nameFound),
      rankFound: cleanSpaces(rankFound),
      pageNumber,
      bulletinPart,
      reason,
    });
  };

  // Scan 1ª Parte for homonyms (for transparent audit report) if 1ª Parte is excluded
  if (!includeFirstPart && target.surnameToken.length >= 3) {
    for (const nota of notas) {
      if (nota.part !== '1ª Parte') continue;
      for (const entry of nota.entries) {
        const lineText = entry.kind === 'table' ? (entry.tableRows || []).flat().join(' | ') : entry.text;
        const normLine = stripAccentsUpper(lineText);
        if (!containsWholePhrase(normLine, target.surnameToken)) continue;
        // Extract rank + name mention in 1ª Parte
        const m = new RegExp(
          `((?:Gen|Cel|TC|Maj|Cap|1[º°o]?\\s*Ten|2[º°o]?\\s*Ten|Asp|ST|1[º°o]?\\s*Sgt|2[º°o]?\\s*Sgt|3[º°o]?\\s*Sgt|Sgt|Cb|Sd)(?:\\s+EV|\\s+EP)?)\\s+([A-ZÀ-Ý\\s]*${escapeRegExp(target.surnameToken)}[A-ZÀ-Ý\\s]*)`,
          'i'
        ).exec(lineText);
        if (m) {
          recordHomonym(
            cleanSpaces(m[2]).split(',')[0].trim(),
            cleanSpaces(m[1]),
            entry.pageNumber,
            '1ª Parte',
            '1ª Parte (Serviços Diários / Escala) ignorada por padrão'
          );
        }
      }
    }
  }

  for (const nota of notas) {
    if (!includeFirstPart && nota.part === '1ª Parte') continue;

    const decomposed = decomposeSisbolNota(nota);
    const fullContextNorm = stripAccentsUpper(
      `${decomposed.contentBeforeTable} ${decomposed.contentAfterTable}`
    );

    let bestMatchKind: 'none' | 'exact' | 'table_unlinked' | 'ambiguous' = 'none';
    let matchReason = '';
    let matchedExcerpt = '';

    // 1. Check Linked Personnel Block (PRIMARY SisBol mechanism!)
    for (const person of decomposed.linkedPersonnel) {
      const cls = classifyPersonCandidate(person.rank, person.name, target, fullContextNorm);
      if (cls === 'exact') {
        bestMatchKind = 'exact';
        matchReason = `Vinculação direta na nota do BI (${person.raw})`;
        matchedExcerpt = person.raw;
      } else if (cls === 'ambiguous') {
        if (bestMatchKind === 'none') {
          bestMatchKind = 'ambiguous';
          matchReason = `Identificação parcial na lista vinculada (${person.raw}) — conferir antes de incluir`;
          matchedExcerpt = person.raw;
        }
      } else if (cls === 'homonym') {
        recordHomonym(
          person.name,
          person.rank,
          person.pageNumber,
          nota.part,
          `Outro militar (${person.rank} ${person.name})`
        );
      }
    }

    // 2. Check Structured Table Rows (e.g. DCEM table or Fiscalização commission table)
    if (decomposed.tableRows.length > 0) {
      for (const row of decomposed.tableRows) {
        const rowJoined = row.join(' ');
        const rowNorm = stripAccentsUpper(rowJoined);
        const rowDigits = rowJoined.replace(/\D/g, '');

        const idMatch =
          target.identidadeDigits.length >= 7 && rowDigits.includes(target.identidadeDigits);
        const fullNameInRow =
          target.fullNameTokens.length >= 2 && containsWholePhrase(rowNorm, target.fullNameNorm);

        if (idMatch || fullNameInRow) {
          if (bestMatchKind === 'exact') {
            // Already confirmed via linked personnel (e.g. BI 71 DCEM table + linked 2º Sgt EDSON DA SILVA CARDOSO)
            if (idMatch) {
              matchReason = `Nome completo e Identidade (${target.identidadeDigits}) confirmados na tabela e na vinculação da nota`;
            }
          } else if (decomposed.linkedPersonnel.length === 0) {
            // Table-only mention WITHOUT linked military in the nota footer (exact case of BI 36 p.10!)
            bestMatchKind = 'table_unlinked';
            matchReason =
              'Militar citado em tabela no corpo da matéria, sem vinculação individual no rodapé da nota (o SisBol omite automaticamente casos sem vinculação; marque se desejar incluir).';
            matchedExcerpt = row.filter(Boolean).join(' | ');
          } else {
            bestMatchKind = 'exact';
            matchReason = idMatch
              ? `Identidade ${target.identidadeDigits} e nome completo confirmados na tabela`
              : `Nome completo confirmado na tabela (${row.filter(Boolean).join(' | ')})`;
            matchedExcerpt = row.filter(Boolean).join(' | ');
          }
        } else if (target.surnameToken.length >= 3 && containsWholePhrase(rowNorm, target.surnameToken)) {
          // Possible homonym inside table
          const rankCell = row.find((c) => MILITARY_RANK_PREFIX_RE.test(c)) || '';
          const nameCell = row.find((c) => containsWholePhrase(stripAccentsUpper(c), target.surnameToken)) || rowJoined;
          const cls = classifyPersonCandidate(rankCell, nameCell, target, fullContextNorm);
          if (cls === 'homonym') {
            recordHomonym(
              nameCell,
              rankCell,
              nota.sourcePages[0] ?? 1,
              nota.part,
              `Outro militar na tabela (${rankCell} ${nameCell})`.trim()
            );
          } else if (cls === 'ambiguous' && bestMatchKind === 'none') {
            bestMatchKind = 'ambiguous';
            matchReason = `Menção parcial em tabela (${row.filter(Boolean).join(' | ')}) — conferir antes de incluir`;
            matchedExcerpt = row.filter(Boolean).join(' | ');
          }
        }
      }
    }

    // 3. Check Inline Body Narrative (for notas where the military is named directly in prose, e.g. Sindicância / Função / Portaria)
    if (bestMatchKind === 'none') {
      const bodyText = `${decomposed.contentBeforeTable}\n${decomposed.contentAfterTable}`;
      const bodyNorm = stripAccentsUpper(bodyText);
      const bodyDigits = bodyText.replace(/\D/g, '');

      const idMatch =
        target.identidadeDigits.length >= 7 && bodyDigits.includes(target.identidadeDigits);
      const fullNameMatch =
        target.fullNameTokens.length >= 2 && containsWholePhrase(bodyNorm, target.fullNameNorm);

      if (idMatch || fullNameMatch) {
        bestMatchKind = 'exact';
        matchReason = idMatch
          ? `Nome e identidade confirmados no corpo da matéria`
          : `Nome completo confirmado no corpo da matéria`;
        matchedExcerpt = military.nomeCompleto;
      } else if (target.surnameToken.length >= 3 && containsWholePhrase(bodyNorm, target.surnameToken)) {
        // Check inline rank + war name / name mentions
        const inlineRe = new RegExp(
          `((?:Gen|Cel|Ten\\s+Cel|TC|Maj|Cap|1[º°o]?\\s*Ten|2[º°o]?\\s*Ten|Asp\\s+Of|Asp|ST|1[º°o]?\\s*Sgt|2[º°o]?\\s*Sgt|3[º°o]?\\s*Sgt|Sgt|Cb|Sd)(?:\\s+EV|\\s+EP)?)\\s+([A-ZÀ-Ý][A-ZÀ-Ýa-zà-ÿ'´\\-]+(?:\\s+[A-ZÀ-Ý][A-ZÀ-Ýa-zà-ÿ'´\\-]+){0,5})`,
          'g'
        );
        let m: RegExpExecArray | null;
        while ((m = inlineRe.exec(bodyText)) !== null) {
          const foundRank = cleanSpaces(m[1]);
          const foundName = cleanSpaces(m[2]);
          if (!containsWholePhrase(stripAccentsUpper(foundName), target.surnameToken)) continue;
          const cls = classifyPersonCandidate(foundRank, foundName, target, bodyNorm);
          if (cls === 'exact') {
            bestMatchKind = 'exact';
            matchReason = `Identificação confirmada no texto (${foundRank} ${foundName})`;
            matchedExcerpt = `${foundRank} ${foundName}`;
            break;
          } else if (cls === 'ambiguous' && bestMatchKind === 'none') {
            bestMatchKind = 'ambiguous';
            matchReason = `Menção parcial no texto (${foundRank} ${foundName}) — conferir antes de incluir`;
            matchedExcerpt = `${foundRank} ${foundName}`;
          } else if (cls === 'homonym') {
            recordHomonym(
              foundName,
              foundRank,
              nota.sourcePages[0] ?? 1,
              nota.part,
              `Outro militar citado no texto (${foundRank} ${foundName})`
            );
          }
        }
      }
    }

    if (bestMatchKind === 'none') continue;

    // Build final occurrence matching exact SisBol Folha output!
    const filteredTable = filterTableRowsForTarget(decomposed.tableRows, target);
    const personnelListText =
      decomposed.linkedPersonnel.length > 1
        ? decomposed.linkedPersonnel.map((p) => p.raw).join('\n')
        : '';

    occurrences.push({
      title: nota.title,
      subtitle: nota.subtitle,
      bulletinPart: nota.part,
      bulletinNumber: bulletinMeta.bulletinNumber,
      bulletinDateIso: bulletinMeta.bulletinDateIso,
      bulletinDay: bulletinMeta.bulletinDay,
      bulletinMonth: bulletinMeta.bulletinMonth,
      bulletinYear: bulletinMeta.bulletinYear,
      contentText: decomposed.contentBeforeTable,
      contentAfterTable: decomposed.contentAfterTable,
      personnelListText,
      emConsequenciaText: decomposed.emConsequenciaText,
      tableRows: filteredTable,
      sourcePages: nota.sourcePages,
      matchConfidence: bestMatchKind === 'exact' ? 'confirmada' : 'conferir',
      matchReason,
      matchedExcerpt,
    });
  }

  discardedHomonyms.sort((a, b) => a.pageNumber - b.pageNumber);

  return {
    isSisbol: true,
    bulletinMeta,
    occurrences,
    discardedHomonyms,
    totalNotasScanned: notas.length,
  };
}
