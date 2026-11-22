import { GoogleGenAI, Type, type Schema } from '@google/genai';

export interface BiMilitaryTargetInput {
  nomeCompleto: string;
  postoGraduacao?: string;
  nomeGuerra?: string;
  subunidade?: string;
  identidade?: string;
  qasQms?: string;
}

export interface BiBulletinPageInput {
  pageNumber: number;
  text: string;
  usedOcr?: boolean;
}

export interface BiExtractRequestPayload {
  military: BiMilitaryTargetInput;
  bulletin: {
    fileName: string;
    pages: BiBulletinPageInput[];
  };
  options?: {
    includeFirstPart?: boolean;
  };
}

export interface BiBulletinMetadata {
  bulletinNumber: string;
  bulletinDateIso: string;
  bulletinDay: number | null;
  bulletinMonth: string;
  bulletinYear: number | null;
  omName: string;
}

export interface BiExtractedOccurrenceServer {
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
}

export interface BiDiscardedHomonymServer {
  nameFound: string;
  rankFound: string;
  pageNumber: number;
  bulletinPart: string;
  reason: string;
}

export interface BiExtractServiceResult {
  providerUsed: 'openai' | 'gemini';
  modelUsed: string;
  bulletinMeta: BiBulletinMetadata;
  occurrences: BiExtractedOccurrenceServer[];
  discardedHomonyms: BiDiscardedHomonymServer[];
}

export type AiProviderKind = 'openai' | 'gemini' | 'none';

const VALID_MONTHS = new Set([
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
]);

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

function isUsableSecret(val: string | undefined): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  if (/^MY_[A-Z0-9_]+$/i.test(trimmed)) return null;
  if (/^your[_-]/i.test(trimmed)) return null;
  return trimmed;
}

export function getBiAiProviderStatus(): {
  provider: AiProviderKind;
  configured: boolean;
  openaiConfigured: boolean;
  geminiConfigured: boolean;
} {
  const openaiConfigured = Boolean(isUsableSecret(process.env.OPENAI_API_KEY));
  const geminiConfigured = Boolean(
    isUsableSecret(process.env.GEMINI_API_KEY) || isUsableSecret(process.env.API_KEY)
  );
  const provider: AiProviderKind = openaiConfigured
    ? 'openai'
    : geminiConfigured
      ? 'gemini'
      : 'none';
  return {
    provider,
    configured: provider !== 'none',
    openaiConfigured,
    geminiConfigured,
  };
}

function normalizeMonthPt(raw: string | undefined, isoDate?: string): string {
  if (raw) {
    const norm = stripAccentsUpper(raw).replace(/[^A-Z]/g, '');
    if (MONTH_NAME_MAP[norm]) return MONTH_NAME_MAP[norm];
  }
  if (isoDate) {
    const m = isoDate.match(/^\d{4}-(\d{2})-\d{2}$/);
    if (m) {
      const monthNum = parseInt(m[1], 10);
      if (MONTH_NUMBER_TO_PT[monthNum]) return MONTH_NUMBER_TO_PT[monthNum];
    }
  }
  return '';
}

function normalizeBiNumber(raw: string | undefined): string {
  if (!raw) return '';
  const cleaned = raw.trim().replace(/^n[º°o\.]?\s*/i, '');
  const match = cleaned.match(/^0*(\d{1,4})(?:\/\d{2,4})?$/);
  if (match) return String(parseInt(match[1], 10));
  return cleaned;
}

/**
 * Lightweight hint extractor from page 1 / fileName so metadata is never lost even on unusual layouts.
 */
function detectBulletinHeaderHints(
  fileName: string,
  pages: BiBulletinPageInput[]
): Partial<BiBulletinMetadata> {
  const hints: Partial<BiBulletinMetadata> = {};
  const firstPagesText = pages
    .slice(0, 2)
    .map((p) => p.text)
    .join('\n');

  // Detect BI number like "BOLETIM INTERNO Nº 2/2026" or "BI Nr 20, de 30/01/2026"
  const biNumMatch =
    firstPagesText.match(
      /BOLETIM\s+INTERNO(?:\s+OSTENSIVO)?\s*(?:N[º°o]|NR\.?)?\s*0*(\d{1,4})(?:\s*\/\s*(20\d{2}))?/i
    ) ||
    firstPagesText.match(/\bBI\s*(?:N[º°o]|NR\.?)\s*0*(\d{1,4})\b/i) ||
    fileName.match(/(?:_|-)0*(\d{1,4})(?:_|-)boletim/i);

  if (biNumMatch) {
    hints.bulletinNumber = String(parseInt(biNumMatch[1], 10));
    if (biNumMatch[2]) {
      hints.bulletinYear = parseInt(biNumMatch[2], 10);
    }
  }

  // Detect date like "5 de janeiro de 2026" or "30/01/2026" or "2026-01-30" in filename
  const longDateMatch = firstPagesText.match(
    /\b(\d{1,2})\s+de\s+(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(20\d{2})\b/i
  );
  if (longDateMatch) {
    const day = parseInt(longDateMatch[1], 10);
    const monthPt = normalizeMonthPt(longDateMatch[2]);
    const year = parseInt(longDateMatch[3], 10);
    const monthIdx = Object.entries(MONTH_NUMBER_TO_PT).find(([, v]) => v === monthPt)?.[0];
    if (day >= 1 && day <= 31 && monthPt && monthIdx) {
      hints.bulletinDay = day;
      hints.bulletinMonth = monthPt;
      hints.bulletinYear = year;
      hints.bulletinDateIso = `${year}-${String(monthIdx).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  } else {
    const slashDateMatch = firstPagesText.match(/\bde\s+(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/i);
    if (slashDateMatch) {
      const day = parseInt(slashDateMatch[1], 10);
      const monthNum = parseInt(slashDateMatch[2], 10);
      const year = parseInt(slashDateMatch[3], 10);
      const monthPt = MONTH_NUMBER_TO_PT[monthNum];
      if (day >= 1 && day <= 31 && monthPt) {
        hints.bulletinDay = day;
        hints.bulletinMonth = monthPt;
        hints.bulletinYear = year;
        hints.bulletinDateIso = `${year}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    } else {
      const fileIsoMatch = fileName.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
      if (fileIsoMatch) {
        const year = parseInt(fileIsoMatch[1], 10);
        const monthNum = parseInt(fileIsoMatch[2], 10);
        const day = parseInt(fileIsoMatch[3], 10);
        const monthPt = MONTH_NUMBER_TO_PT[monthNum];
        if (day >= 1 && day <= 31 && monthPt) {
          hints.bulletinDay = day;
          hints.bulletinMonth = monthPt;
          hints.bulletinYear = year;
          hints.bulletinDateIso = `${year}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
      }
    }
  }

  return hints;
}

function buildSystemInstruction(includeFirstPart: boolean): string {
  return [
    'Você é um especialista sênior em documentação militar do Exército Brasileiro (Folhas de Alterações e Boletins Internos — BI), atuando no sistema SISCOM.',
    'Sua tarefa é analisar o texto integral paginado de um Boletim Interno (BI) e localizar TODAS as alterações referentes EXCLUSIVAMENTE ao militar pesquisado, retornando JSON estrito conforme o schema fornecido.',
    '',
    'REGRAS OBRIGATÓRIAS E INEGOCIÁVEIS:',
    '1. FIDELIDADE INTEGRAL AO TEXTO ORIGINAL (VERBATIM):',
    '   - Preserve integralmente o texto original da alteração: NÃO resuma, NÃO reescreva, NÃO corrija ortografia ou gramática (ex.: se o BI escrever "Tranporte", mantenha "Tranporte"), NÃO invente datas, números ou palavras ausentes.',
    '   - Se a alteração atravessar uma quebra de página (ex.: fim da página 3 continuando no topo da página 4), REMOVA APENAS o cabeçalho/rodapé repetitivo de continuação do boletim (ex.: "(Continuação do BI Nr 20, de 30/01/2026, do(a) ... Pag nº 172)") e una perfeitamente a frase partida sem cortar nem duplicar nenhuma palavra.',
    '   - Se houver notas entre parênteses como "(Por não ter sido publicado em época oportuna)." ou referências a outros boletins/aditamentos como "(Adt da DCEM 4K ao Bol do DGP nº 041, de 10 ABR 26)" ou "Observações:", PRESERVE-AS integralmente no contentText.',
    '',
    '2. TÍTULO E SUBTÍTULO (SEM CONFUNDIR E SEM PREFIXO NUMERADO):',
    '   - Identifique a estrutura real da seção do BI sem depender de um layout rígido (os BIs variam entre OMs: podem ter ou não numeração, podem ter ou não tabelas, podem citar outros boletins).',
    '   - title: Título principal da seção EM MAIÚSCULAS, removendo prefixos de enumeração (ex.: "2. ALTERAÇÕES DE SUBTENENTES E SARGENTOS" -> "ALTERAÇÕES DE SUBTENENTES E SARGENTOS"; "INSTRUÇÃO" -> "INSTRUÇÃO"; "3. SERVIÇO DE SAÚDE" -> "SERVIÇO DE SAÚDE").',
    '   - subtitle: Assunto/subtítulo específico daquela matéria, removendo prefixos de letra/número (ex.: "b. Férias - Apresentação por Término" -> "Férias - Apresentação por Término"; "1. Instrução de Quadros" -> "Instrução de Quadros"; "a. Aditamento da DCEM - Transcrição" -> "Aditamento da DCEM - Transcrição"). Se não houver subtítulo distinto, deixe "".',
    '   - REGRA DE FÉRIAS: "Férias" NUNCA é title isolado — é SEMPRE subtitle (ex.: title="ALTERAÇÕES DE SUBTENENTES E SARGENTOS", subtitle="Férias - Apresentação por Término").',
    '   - NUNCA coloque o subtítulo dentro do title nem repita o title dentro do subtitle.',
    '',
    '3. SEPARAÇÃO ENTRE TEXTO PRINCIPAL, LISTA LONGA DE MILITARES, "EM CONSEQUÊNCIA" E TABELAS:',
    '   - contentText: O texto integral da matéria (narrativa principal + notas/observações + transcrições de boletins externos). NÃO inclua aqui a linha isolada contendo apenas o nome do militar quando o texto já disser "O militar nominado a seguir..." (a menos que o nome faça parte da própria frase corrida). NÃO inclua aqui uma lista extensa de vários militares nem o fecho administrativo "Em consequência...", pois esses vão nos campos dedicados abaixo.',
    '   - personnelListText: Quando o assunto listar múltiplos militares (ex.: lista de participantes de uma instrução, ordem de missão, turma), copie aqui a LISTA COMPLETA VERBATIM (uma linha por militar ou exatamente como aparece no BI). Se o assunto citar apenas o militar pesquisado isoladamente (1 militar) ou não houver lista de nomes, deixe "".',
    '   - emConsequenciaText: Quando a matéria terminar com o bloco administrativo "Em consequência..." / "Em consequência: a) ... b) ...", copie-o integralmente aqui. Se não houver, deixe "".',
    '   - tableRows: Quando a matéria contiver uma tabela estruturada (ex.: Aditamento da DCEM, resultado de TAF/inspeção em colunas), preencha tableRows como matriz 2D [cabeçalho, ...linhas referentes ao militar pesquisado] preservando literalmente as células. Caso contrário, retorne [].',
    '',
    '4. IDENTIFICAÇÃO RIGOROSA E FILTRO ANTI-HOMÔNIMO:',
    '   - NUNCA misture alterações de militares diferentes.',
    '   - Compare Nome Completo, Posto/Graduação, Nome de Guerra, Subunidade/Cia e Identidade (quando fornecidos).',
    '   - matchConfidence = "confirmada": quando houver identificação inequívoca do militar pesquisado (ex.: nome completo coincide, ou posto/graduação + nome de guerra + subunidade coincidem sem conflito).',
    '   - matchConfidence = "conferir": quando houver DÚVIDA real (ex.: o BI cita apenas "Sgt CARDOSO" sem nome completo ou sem subunidade, podendo ser o pesquisado ou outro sargento de mesmo nome de guerra). Nesses casos, inclua em occurrences com matchConfidence="conferir" e explique o motivo em matchReason.',
    '   - discardedHomonyms: Quando aparecer claramente OUTRO militar com sobrenome/nome de guerra parecido (ex.: pesquisando "2º Sgt EDSON DA SILVA CARDOSO", aparecem "Sd CARDOSO", "Cb FELIPHE CARDOSO CORDEIRO PEREIRA", "3º Sgt ADEMIR CARDOSO FERREIRA JUNIOR"), NÃO inclua em occurrences; registre-os em discardedHomonyms com nome, posto, página e motivo do descarte.',
    '',
    includeFirstPart
      ? '5. PARTES DO BOLETIM: Analise todas as partes do BI (1ª, 2ª, 3ª e 4ª Partes), incluindo 1ª Parte (Serviços Diários) conforme solicitado.'
      : '5. PARTES DO BOLETIM: Analise prioritariamente 2ª Parte (Instrução), 3ª Parte (Assuntos Gerais e Administrativos) e 4ª Parte (Justiça e Disciplina). IGNORE a 1ª Parte (Serviços Diários / Escala de Serviço), pois escalas de serviço diário não integram Folhas de Alterações (se o sobrenome aparecer na 1ª Parte como outro militar ou escala, pode apenas ignorar ou registrar em discardedHomonyms se for homônimo).',
    '',
    '6. SEQUÊNCIA E PÁGINAS DE ORIGEM:',
    '   - Preserve a ordem exata em que as alterações aparecem no boletim.',
    '   - Informe em sourcePages TODOS os números de página (inteiros 1-indexados conforme marcadores [[PAGINA N]]) em que aquela ocorrência aparece (incluindo início do texto, continuação e lista de nomes).',
    '   - Se o militar pesquisado não tiver nenhuma ocorrência válida neste BI, retorne occurrences: [].',
  ].join('\n');
}

function buildUserPrompt(
  military: BiMilitaryTargetInput,
  fileName: string,
  pages: BiBulletinPageInput[],
  headerHints: Partial<BiBulletinMetadata>,
  chunkInfo?: { index: number; total: number }
): string {
  const profileLines = [
    `- Nome pesquisado: ${military.nomeCompleto}`,
    military.postoGraduacao ? `- Posto/Graduação: ${military.postoGraduacao}` : null,
    military.nomeGuerra ? `- Nome de Guerra: ${military.nomeGuerra}` : null,
    military.subunidade ? `- Subunidade/Cia: ${military.subunidade}` : null,
    military.identidade ? `- Identidade: ${military.identidade}` : null,
    military.qasQms ? `- QAS/QMS: ${military.qasQms}` : null,
  ].filter(Boolean);

  const hintLines = [
    headerHints.bulletinNumber ? `- Nº BI detectado no cabeçalho: ${headerHints.bulletinNumber}` : null,
    headerHints.bulletinDateIso ? `- Data detectada no cabeçalho: ${headerHints.bulletinDateIso}` : null,
    chunkInfo ? `- Segmento de leitura: parte ${chunkInfo.index} de ${chunkInfo.total}` : null,
  ].filter(Boolean);

  const pagesText = pages
    .map((p) => `[[PAGINA ${p.pageNumber}]]\n${p.text}`)
    .join('\n\n');

  return [
    'DADOS DO MILITAR PESQUISADO:',
    ...profileLines,
    '',
    `ARQUIVO DO BOLETIM: ${fileName}`,
    ...(hintLines.length > 0 ? ['METADADOS INICIAIS DETECTADOS (conferir no texto):', ...hintLines, ''] : ['']),
    'TEXTO INTEGRAL PAGINADO DO BOLETIM INTERNO:',
    pagesText,
  ].join('\n');
}

const GEMINI_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    bulletinMeta: {
      type: Type.OBJECT,
      properties: {
        bulletinNumber: { type: Type.STRING },
        bulletinDateIso: { type: Type.STRING },
        bulletinDay: { type: Type.INTEGER, nullable: true },
        bulletinMonth: { type: Type.STRING },
        bulletinYear: { type: Type.INTEGER, nullable: true },
        omName: { type: Type.STRING },
      },
      required: ['bulletinNumber', 'bulletinDateIso', 'bulletinMonth', 'omName'],
    },
    occurrences: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          subtitle: { type: Type.STRING },
          bulletinPart: { type: Type.STRING },
          bulletinNumber: { type: Type.STRING },
          bulletinDateIso: { type: Type.STRING },
          bulletinDay: { type: Type.INTEGER, nullable: true },
          bulletinMonth: { type: Type.STRING },
          bulletinYear: { type: Type.INTEGER, nullable: true },
          contentText: { type: Type.STRING },
          personnelListText: { type: Type.STRING },
          emConsequenciaText: { type: Type.STRING },
          tableRows: {
            type: Type.ARRAY,
            items: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          sourcePages: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
          },
          matchConfidence: {
            type: Type.STRING,
            enum: ['confirmada', 'conferir'],
          },
          matchReason: { type: Type.STRING },
          matchedExcerpt: { type: Type.STRING },
        },
        required: [
          'title',
          'subtitle',
          'bulletinPart',
          'bulletinNumber',
          'bulletinDateIso',
          'bulletinMonth',
          'contentText',
          'personnelListText',
          'emConsequenciaText',
          'tableRows',
          'sourcePages',
          'matchConfidence',
          'matchReason',
          'matchedExcerpt',
        ],
      },
    },
    discardedHomonyms: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          nameFound: { type: Type.STRING },
          rankFound: { type: Type.STRING },
          pageNumber: { type: Type.INTEGER },
          bulletinPart: { type: Type.STRING },
          reason: { type: Type.STRING },
        },
        required: ['nameFound', 'rankFound', 'pageNumber', 'bulletinPart', 'reason'],
      },
    },
  },
  required: ['bulletinMeta', 'occurrences', 'discardedHomonyms'],
};

const OPENAI_JSON_SCHEMA = {
  name: 'bi_extraction_result',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      bulletinMeta: {
        type: 'object',
        additionalProperties: false,
        properties: {
          bulletinNumber: { type: 'string' },
          bulletinDateIso: { type: 'string' },
          bulletinDay: { type: ['integer', 'null'] },
          bulletinMonth: { type: 'string' },
          bulletinYear: { type: ['integer', 'null'] },
          omName: { type: 'string' },
        },
        required: [
          'bulletinNumber',
          'bulletinDateIso',
          'bulletinDay',
          'bulletinMonth',
          'bulletinYear',
          'omName',
        ],
      },
      occurrences: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            subtitle: { type: 'string' },
            bulletinPart: { type: 'string' },
            bulletinNumber: { type: 'string' },
            bulletinDateIso: { type: 'string' },
            bulletinDay: { type: ['integer', 'null'] },
            bulletinMonth: { type: 'string' },
            bulletinYear: { type: ['integer', 'null'] },
            contentText: { type: 'string' },
            personnelListText: { type: 'string' },
            emConsequenciaText: { type: 'string' },
            tableRows: {
              type: 'array',
              items: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            sourcePages: {
              type: 'array',
              items: { type: 'integer' },
            },
            matchConfidence: {
              type: 'string',
              enum: ['confirmada', 'conferir'],
            },
            matchReason: { type: 'string' },
            matchedExcerpt: { type: 'string' },
          },
          required: [
            'title',
            'subtitle',
            'bulletinPart',
            'bulletinNumber',
            'bulletinDateIso',
            'bulletinDay',
            'bulletinMonth',
            'bulletinYear',
            'contentText',
            'personnelListText',
            'emConsequenciaText',
            'tableRows',
            'sourcePages',
            'matchConfidence',
            'matchReason',
            'matchedExcerpt',
          ],
        },
      },
      discardedHomonyms: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            nameFound: { type: 'string' },
            rankFound: { type: 'string' },
            pageNumber: { type: 'integer' },
            bulletinPart: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['nameFound', 'rankFound', 'pageNumber', 'bulletinPart', 'reason'],
        },
      },
    },
    required: ['bulletinMeta', 'occurrences', 'discardedHomonyms'],
  },
};

interface RawAiChunkResponse {
  bulletinMeta?: Partial<BiBulletinMetadata>;
  occurrences?: Partial<BiExtractedOccurrenceServer>[];
  discardedHomonyms?: Partial<BiDiscardedHomonymServer>[];
}

function normalizeOpenAiModelName(raw: string | undefined): string {
  if (!raw) return '';
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
  if (!cleaned) return '';
  if (cleaned === 'gpt4o' || cleaned === 'gpt-4o') return 'gpt-4o';
  if (cleaned === 'gpt4o-mini' || cleaned === 'gpt-4o-mini') return 'gpt-4o-mini';
  if (cleaned === 'gpt4.1' || cleaned === 'gpt-4.1') return 'gpt-4.1';
  if (cleaned === 'gpt4.1-mini' || cleaned === 'gpt-4.1-mini') return 'gpt-4.1-mini';
  if (cleaned === 'gpt4.1-nano' || cleaned === 'gpt-4.1-nano') return 'gpt-4.1-nano';
  return cleaned;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientAiError(statusOrMsg: number | string): boolean {
  if (typeof statusOrMsg === 'number') {
    return statusOrMsg === 429 || statusOrMsg === 500 || statusOrMsg === 502 || statusOrMsg === 503 || statusOrMsg === 504;
  }
  return /\b(?:429|500|502|503|504)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|rate limit|timeout|ECONNRESET|fetch failed/i.test(
    statusOrMsg
  );
}

async function callOpenAiExtract(
  apiKey: string,
  systemInstruction: string,
  userPrompt: string
): Promise<{ raw: RawAiChunkResponse; modelUsed: string }> {
  const configuredModel = normalizeOpenAiModelName(process.env.OPENAI_MODEL);
  const candidateModels = Array.from(
    new Set([configuredModel, 'gpt-4o-mini', 'gpt-4o'].filter(Boolean))
  );

  let lastErr: unknown = null;

  for (const model of candidateModels) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          signal: AbortSignal.timeout(90_000),
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: userPrompt },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: OPENAI_JSON_SCHEMA,
            },
          }),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          const err = new Error(`OpenAI HTTP ${response.status}: ${errText.slice(0, 300)}`);
          lastErr = err;

          // Retry once on transient rate-limit / server errors
          if (attempt === 0 && isTransientAiError(response.status)) {
            await sleep(900);
            continue;
          }
          // Try next candidate model if this model alias is unavailable/not found
          if (response.status === 404 || /model_not_found|does not exist|unsupported model/i.test(errText)) {
            break;
          }
          throw err;
        }

        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error(`OpenAI (${model}) retornou resposta vazia.`);
        }

        const parsed = JSON.parse(content) as RawAiChunkResponse;
        return { raw: parsed, modelUsed: model };
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === 0 && isTransientAiError(msg)) {
          await sleep(900);
          continue;
        }
        if (/HTTP 404|model_not_found|does not exist|unsupported model/i.test(msg)) {
          break;
        }
        throw err;
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('Falha ao consultar API OpenAI.');
}

async function callGeminiExtract(
  apiKey: string,
  systemInstruction: string,
  userPrompt: string
): Promise<{ raw: RawAiChunkResponse; modelUsed: string }> {
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 90_000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const candidateModels = Array.from(
    new Set(
      [
        (process.env.GEMINI_BI_MODEL || '').trim(),
        'gemini-4-hydrogen',
        'gemini-3.1-flash-lite',
      ].filter(Boolean)
    )
  );

  let lastErr: unknown = null;
  for (const model of candidateModels) {
    const isGemini4 = /^gemini-4-/i.test(model);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const config: {
          systemInstruction: string;
          responseMimeType: string;
          responseSchema: Schema;
          temperature?: number;
        } = {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: GEMINI_RESPONSE_SCHEMA,
        };
        // Gemini 4 models prohibit deprecated sampling parameters (temperature, topP, topK)
        if (!isGemini4) {
          config.temperature = 0;
        }

        const response = await ai.models.generateContent({
          model,
          contents: userPrompt,
          config,
        });
        const text = response.text;
        if (!text) {
          throw new Error(`Modelo ${model} retornou resposta vazia.`);
        }
        const parsed = JSON.parse(text) as RawAiChunkResponse;
        return { raw: parsed, modelUsed: model };
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === 0 && isTransientAiError(msg)) {
          await sleep(1000);
          continue;
        }
        // Fall through to next model alias only when model name is unsupported/not found
        if (/not found|404|unsupported|invalid model|deprecated/i.test(msg)) {
          break;
        }
        throw err;
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('Falha ao consultar API Gemini.');
}

function splitPagesIntoChunks(
  pages: BiBulletinPageInput[],
  maxCharsPerChunk = 110_000
): BiBulletinPageInput[][] {
  const totalChars = pages.reduce((acc, p) => acc + p.text.length, 0);
  if (totalChars <= maxCharsPerChunk || pages.length <= 28) {
    return [pages];
  }

  const chunks: BiBulletinPageInput[][] = [];
  let start = 0;
  while (start < pages.length) {
    let chars = 0;
    let end = start;
    while (end < pages.length && (end === start || (chars + pages[end].text.length <= maxCharsPerChunk && end - start < 24))) {
      chars += pages[end].text.length;
      end++;
    }
    chunks.push(pages.slice(start, end));
    if (end >= pages.length) break;
    // Keep 2-page overlap so cross-page alterations are never severed
    start = Math.max(start + 1, end - 2);
  }
  return chunks;
}

function cleanHeadingPrefix(raw: string): string {
  return raw
    .replace(/^\s*(?:\d+\s*[\.\-\)]\s*|[a-z]\s*[\.\)]\s*)/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferAlteracoesSectionTitleByRank(postoGraduacao?: string): string {
  const norm = stripAccentsUpper(postoGraduacao || '');
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

function isNonTitleFeriasTopic(value: string): boolean {
  const u = stripAccentsUpper(value).replace(/[:.\-\s]+$/g, '');
  return u === 'FERIAS' || /^FERIAS(\s|$|-)/.test(u);
}

function normalizeAndMergeResults(
  chunkOutputs: RawAiChunkResponse[],
  headerHints: Partial<BiBulletinMetadata>,
  maxPageNumber: number,
  postoGraduacao?: string
): {
  bulletinMeta: BiBulletinMetadata;
  occurrences: BiExtractedOccurrenceServer[];
  discardedHomonyms: BiDiscardedHomonymServer[];
} {
  let metaNum = headerHints.bulletinNumber || '';
  let metaIso = headerHints.bulletinDateIso || '';
  let metaDay: number | null = headerHints.bulletinDay ?? null;
  let metaMonth = headerHints.bulletinMonth || '';
  let metaYear: number | null = headerHints.bulletinYear ?? null;
  let metaOm = '';

  for (const out of chunkOutputs) {
    const m = out.bulletinMeta;
    if (!m) continue;
    if (!metaNum && m.bulletinNumber) metaNum = normalizeBiNumber(m.bulletinNumber);
    if (!metaIso && m.bulletinDateIso && /^\d{4}-\d{2}-\d{2}$/.test(m.bulletinDateIso.trim())) {
      metaIso = m.bulletinDateIso.trim();
    }
    if (metaDay === null && typeof m.bulletinDay === 'number' && m.bulletinDay >= 1 && m.bulletinDay <= 31) {
      metaDay = m.bulletinDay;
    }
    if (!metaMonth && m.bulletinMonth) {
      metaMonth = normalizeMonthPt(m.bulletinMonth, metaIso);
    }
    if (metaYear === null && typeof m.bulletinYear === 'number' && m.bulletinYear >= 1950 && m.bulletinYear <= 2100) {
      metaYear = m.bulletinYear;
    }
    if (!metaOm && m.omName) metaOm = m.omName.trim();
  }

  // Derive day/month/year from ISO if any piece missing
  if (metaIso && /^\d{4}-\d{2}-\d{2}$/.test(metaIso)) {
    const [yStr, mStr, dStr] = metaIso.split('-');
    if (metaYear === null) metaYear = parseInt(yStr, 10);
    if (!metaMonth) metaMonth = MONTH_NUMBER_TO_PT[parseInt(mStr, 10)] || '';
    if (metaDay === null) metaDay = parseInt(dStr, 10);
  }

  const bulletinMeta: BiBulletinMetadata = {
    bulletinNumber: metaNum,
    bulletinDateIso: metaIso,
    bulletinDay: metaDay,
    bulletinMonth: VALID_MONTHS.has(metaMonth) ? metaMonth : '',
    bulletinYear: metaYear,
    omName: metaOm,
  };

  const seenOccKeys = new Set<string>();
  const occurrences: BiExtractedOccurrenceServer[] = [];

  for (const out of chunkOutputs) {
    for (const rawOcc of out.occurrences || []) {
      const contentText = (rawOcc.contentText || '').trim();
      const tableRows = Array.isArray(rawOcc.tableRows)
        ? rawOcc.tableRows
            .filter((row) => Array.isArray(row) && row.some((c) => typeof c === 'string' && c.trim().length > 0))
            .map((row) => row.map((c) => (typeof c === 'string' ? c.trim() : '')))
        : [];
      if (!contentText && tableRows.length === 0) continue;

      let rawTitle = cleanHeadingPrefix(rawOcc.title || '').toUpperCase();
      let rawSubtitle = cleanHeadingPrefix(rawOcc.subtitle || '');

      // Enforce Formatar Alteração standard: "Férias" is NEVER a standalone Title
      if (rawTitle && isNonTitleFeriasTopic(rawTitle)) {
        const feriasLabel = rawTitle.replace(/^F[ÉE]RIAS\b/i, 'Férias');
        rawSubtitle = rawSubtitle
          ? /^f[ée]rias\b/i.test(rawSubtitle)
            ? rawSubtitle.replace(/^f[ée]rias\b/i, 'Férias')
            : `${feriasLabel} - ${rawSubtitle}`
          : feriasLabel;
        rawTitle = inferAlteracoesSectionTitleByRank(postoGraduacao);
      }

      if (rawTitle && stripAccentsUpper(rawSubtitle) === stripAccentsUpper(rawTitle)) {
        rawSubtitle = '';
      }

      const occBiNum = normalizeBiNumber(rawOcc.bulletinNumber) || bulletinMeta.bulletinNumber;
      const occIso =
        rawOcc.bulletinDateIso && /^\d{4}-\d{2}-\d{2}$/.test(rawOcc.bulletinDateIso.trim())
          ? rawOcc.bulletinDateIso.trim()
          : bulletinMeta.bulletinDateIso;
      let occDay =
        typeof rawOcc.bulletinDay === 'number' && rawOcc.bulletinDay >= 1 && rawOcc.bulletinDay <= 31
          ? rawOcc.bulletinDay
          : bulletinMeta.bulletinDay;
      let occMonth = normalizeMonthPt(rawOcc.bulletinMonth, occIso) || bulletinMeta.bulletinMonth;
      let occYear =
        typeof rawOcc.bulletinYear === 'number' && rawOcc.bulletinYear >= 1950 && rawOcc.bulletinYear <= 2100
          ? rawOcc.bulletinYear
          : bulletinMeta.bulletinYear;

      if (occIso && /^\d{4}-\d{2}-\d{2}$/.test(occIso)) {
        const [yStr, mStr, dStr] = occIso.split('-');
        if (occYear === null) occYear = parseInt(yStr, 10);
        if (!occMonth) occMonth = MONTH_NUMBER_TO_PT[parseInt(mStr, 10)] || '';
        if (occDay === null) occDay = parseInt(dStr, 10);
      }

      const sourcePages = Array.from(
        new Set(
          (Array.isArray(rawOcc.sourcePages) ? rawOcc.sourcePages : [])
            .map((n) => Math.floor(Number(n)))
            .filter((n) => Number.isFinite(n) && n >= 1 && n <= maxPageNumber)
        )
      ).sort((a, b) => a - b);

      const dedupKey = `${stripAccentsUpper(rawTitle)}|${stripAccentsUpper(rawSubtitle)}|${stripAccentsUpper(contentText.slice(0, 120))}`;
      if (seenOccKeys.has(dedupKey)) continue;
      seenOccKeys.add(dedupKey);

      occurrences.push({
        title: rawTitle || 'ASSUNTOS GERAIS E ADMINISTRATIVOS',
        subtitle: rawSubtitle,
        bulletinPart: (rawOcc.bulletinPart || '').trim(),
        bulletinNumber: occBiNum,
        bulletinDateIso: occIso,
        bulletinDay: occDay,
        bulletinMonth: VALID_MONTHS.has(occMonth) ? occMonth : '',
        bulletinYear: occYear,
        contentText,
        personnelListText: (rawOcc.personnelListText || '').trim(),
        emConsequenciaText: (rawOcc.emConsequenciaText || '').trim(),
        tableRows,
        sourcePages,
        matchConfidence: rawOcc.matchConfidence === 'conferir' ? 'conferir' : 'confirmada',
        matchReason: (rawOcc.matchReason || '').trim(),
        matchedExcerpt: (rawOcc.matchedExcerpt || '').trim(),
      });
    }
  }

  // Sort occurrences by first source page to preserve original BI sequence
  occurrences.sort((a, b) => (a.sourcePages[0] ?? 9999) - (b.sourcePages[0] ?? 9999));

  const seenHomonyms = new Set<string>();
  const discardedHomonyms: BiDiscardedHomonymServer[] = [];
  for (const out of chunkOutputs) {
    for (const h of out.discardedHomonyms || []) {
      const nameFound = (h.nameFound || '').trim();
      if (!nameFound) continue;
      const pageNumber = Math.max(1, Math.min(maxPageNumber, Math.floor(Number(h.pageNumber) || 1)));
      const key = `${stripAccentsUpper(nameFound)}|${pageNumber}`;
      if (seenHomonyms.has(key)) continue;
      seenHomonyms.add(key);
      discardedHomonyms.push({
        nameFound,
        rankFound: (h.rankFound || '').trim(),
        pageNumber,
        bulletinPart: (h.bulletinPart || '').trim(),
        reason: (h.reason || 'Outro militar com sobrenome/nome semelhante').trim(),
      });
    }
  }
  discardedHomonyms.sort((a, b) => a.pageNumber - b.pageNumber);

  return { bulletinMeta, occurrences, discardedHomonyms };
}

export async function extractAlterationsFromBulletin(
  payload: BiExtractRequestPayload
): Promise<BiExtractServiceResult> {
  const openaiKey = isUsableSecret(process.env.OPENAI_API_KEY);
  const geminiKey =
    isUsableSecret(process.env.GEMINI_API_KEY) || isUsableSecret(process.env.API_KEY);

  if (!openaiKey && !geminiKey) {
    throw new Error(
      'Nenhuma chave de IA configurada no servidor. Configure OPENAI_API_KEY ou GEMINI_API_KEY nas variáveis de ambiente (Secrets) do projeto.'
    );
  }

  let providerUsed: 'openai' | 'gemini' = openaiKey ? 'openai' : 'gemini';
  const includeFirstPart = Boolean(payload.options?.includeFirstPart);
  const systemInstruction = buildSystemInstruction(includeFirstPart);
  const headerHints = detectBulletinHeaderHints(payload.bulletin.fileName, payload.bulletin.pages);
  const chunks = splitPagesIntoChunks(payload.bulletin.pages);

  const chunkOutputs: RawAiChunkResponse[] = [];
  let modelUsed = '';

  for (let i = 0; i < chunks.length; i++) {
    const prompt = buildUserPrompt(
      payload.military,
      payload.bulletin.fileName,
      chunks[i],
      headerHints,
      chunks.length > 1 ? { index: i + 1, total: chunks.length } : undefined
    );

    let res: { raw: RawAiChunkResponse; modelUsed: string };
    if (providerUsed === 'openai' && openaiKey) {
      try {
        res = await callOpenAiExtract(openaiKey, systemInstruction, prompt);
      } catch (openAiErr) {
        if (geminiKey) {
          const reason = openAiErr instanceof Error ? openAiErr.message : String(openAiErr);
          console.warn(
            `[BI Extract] OpenAI indisponível (${reason.slice(0, 160)}). Alternando automaticamente para Gemini.`
          );
          providerUsed = 'gemini';
          res = await callGeminiExtract(geminiKey, systemInstruction, prompt);
        } else {
          throw openAiErr;
        }
      }
    } else {
      res = await callGeminiExtract(geminiKey!, systemInstruction, prompt);
    }

    modelUsed = res.modelUsed;
    chunkOutputs.push(res.raw);
  }

  const maxPageNumber = Math.max(1, ...payload.bulletin.pages.map((p) => p.pageNumber));
  const merged = normalizeAndMergeResults(
    chunkOutputs,
    headerHints,
    maxPageNumber,
    payload.military.postoGraduacao
  );

  return {
    providerUsed,
    modelUsed,
    bulletinMeta: merged.bulletinMeta,
    occurrences: merged.occurrences,
    discardedHomonyms: merged.discardedHomonyms,
  };
}
