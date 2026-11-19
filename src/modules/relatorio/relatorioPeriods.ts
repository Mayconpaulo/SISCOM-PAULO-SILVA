export interface RelatorioWeekPeriod {
  /** Unique stable key, e.g. "2026-08-14" (Friday ISO local date) */
  id: string;
  /** Offset in weeks relative to the current Friday→Thursday cycle (0 = current, +1 = next, -1 = previous) */
  weekOffset: number;
  /** Friday start date (local midnight) */
  startDate: Date;
  /** Thursday end date (local midnight) */
  endDate: Date;
  /** Institutional banner string, e.g. "14 A 20 AGOSTO 26" or "28 AGOSTO A 03 SETEMBRO 26" */
  headerLabel: string;
  /** Compact range label, e.g. "14/08 a 20/08/2026" */
  shortRange: string;
  /** Weekday range label, e.g. "Sex 14/08 → Qui 20/08" */
  weekdayRange: string;
  /** Contextual badge label for quick scanning */
  relativeTag: string;
  /** All 7 consecutive days from Friday to Thursday */
  days: RelatorioPeriodDay[];
}

export interface RelatorioPeriodDay {
  iso: string;
  weekdayShort: string;
  dayMonth: string;
  fullDate: string;
  date: Date;
}

const MONTHS_UPPER_PT = [
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

const WEEKDAYS_SHORT_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toLocalMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

function formatLocalIso(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function formatDdMm(date: Date): string {
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`;
}

export function formatDdMmYyyy(date: Date): string {
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

export function formatEventDateRange(start: Date, end: Date): string {
  const a = start.getTime() <= end.getTime() ? start : end;
  const b = start.getTime() <= end.getTime() ? end : start;

  if (formatLocalIso(a) === formatLocalIso(b)) {
    return formatDdMmYyyy(a);
  }
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return `${pad2(a.getDate())} a ${formatDdMmYyyy(b)}`;
  }
  if (a.getFullYear() === b.getFullYear()) {
    return `${formatDdMm(a)} a ${formatDdMmYyyy(b)}`;
  }
  return `${formatDdMmYyyy(a)} a ${formatDdMmYyyy(b)}`;
}

/**
 * Formats a Friday→Thursday range in the institutional 1º BI Mec (Es) header pattern:
 * - Same month/year:      "14 A 20 AGOSTO 26"
 * - Different month:      "28 AGOSTO A 03 SETEMBRO 26"
 * - Different year:       "26 DEZEMBRO 26 A 01 JANEIRO 27"
 */
export function formatHeaderPeriodLabel(start: Date, end: Date): string {
  const d1 = pad2(start.getDate());
  const d2 = pad2(end.getDate());
  const m1 = MONTHS_UPPER_PT[start.getMonth()];
  const m2 = MONTHS_UPPER_PT[end.getMonth()];
  const y1 = String(start.getFullYear()).slice(-2);
  const y2 = String(end.getFullYear()).slice(-2);

  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${d1} A ${d2} ${m2} ${y2}`;
  }
  if (start.getFullYear() === end.getFullYear()) {
    return `${d1} ${m1} A ${d2} ${m2} ${y2}`;
  }
  return `${d1} ${m1} ${y1} A ${d2} ${m2} ${y2}`;
}

/**
 * Finds the Friday that starts the active Friday→Thursday reporting cycle containing `referenceDate`.
 * Example:
 * - Fri..Thu all resolve to that cycle's Friday.
 */
export function getCurrentCycleFriday(referenceDate: Date = new Date()): Date {
  const today = toLocalMidnight(referenceDate);
  const dow = today.getDay(); // 0=Sun..4=Thu, 5=Fri, 6=Sat
  const daysSinceFriday = (dow - 5 + 7) % 7;
  return addDays(today, -daysSinceFriday);
}

function buildPeriodDays(friday: Date): RelatorioPeriodDay[] {
  const days: RelatorioPeriodDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(friday, i);
    days.push({
      iso: formatLocalIso(d),
      weekdayShort: WEEKDAYS_SHORT_PT[d.getDay()],
      dayMonth: formatDdMm(d),
      fullDate: formatDdMmYyyy(d),
      date: d,
    });
  }
  return days;
}

function getRelativeTag(weekOffset: number): string {
  if (weekOffset === 0) return 'Semana atual';
  if (weekOffset === 1) return 'Próxima semana';
  if (weekOffset === -1) return 'Semana anterior';
  if (weekOffset > 1) return `Em ${weekOffset} semanas`;
  return `Há ${Math.abs(weekOffset)} semanas`;
}

export function buildRelatorioWeekPeriod(
  weekOffset: number,
  referenceDate: Date = new Date()
): RelatorioWeekPeriod {
  const baseFriday = getCurrentCycleFriday(referenceDate);
  const startDate = addDays(baseFriday, weekOffset * 7);
  const endDate = addDays(startDate, 6); // Thursday

  const headerLabel = formatHeaderPeriodLabel(startDate, endDate);
  const shortRange = `${formatDdMm(startDate)} a ${formatDdMmYyyy(endDate)}`;
  const weekdayRange = `Sex ${formatDdMm(startDate)} → Qui ${formatDdMm(endDate)}`;

  return {
    id: formatLocalIso(startDate),
    weekOffset,
    startDate,
    endDate,
    headerLabel,
    shortRange,
    weekdayRange,
    relativeTag: getRelativeTag(weekOffset),
    days: buildPeriodDays(startDate),
  };
}

/**
 * Generates a contiguous window of Friday→Thursday weekly periods.
 */
export function getRelatorioWeekPeriods(
  startOffset: number,
  count: number,
  referenceDate: Date = new Date()
): RelatorioWeekPeriod[] {
  const list: RelatorioWeekPeriod[] = [];
  for (let i = 0; i < count; i++) {
    list.push(buildRelatorioWeekPeriod(startOffset + i, referenceDate));
  }
  return list;
}

function normalizeMonthToken(raw: string): number {
  const clean = raw
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const normalizedMonths = MONTHS_UPPER_PT.map((m) =>
    m.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  );
  return normalizedMonths.findIndex((m) => m === clean || m.startsWith(clean));
}

function parseYearToken(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return new Date().getFullYear();
  return n < 100 ? 2000 + n : n;
}

/**
 * Attempts to derive the 7 days (Fri..Thu) matching a stored institutional header string,
 * such as "14 A 20 AGOSTO 26" or "28 AGOSTO A 03 SETEMBRO 26".
 */
export function findPeriodDaysFromHeader(
  headerLabel: string,
  referenceDate: Date = new Date()
): RelatorioPeriodDay[] {
  const text = (headerLabel || '').trim().toUpperCase();

  // Pattern 1: "14 A 20 AGOSTO 26"
  const sameMonthMatch = text.match(/^(\d{1,2})\s+A\s+(\d{1,2})\s+([A-ZÇÃÕÁÉÍÓÚ]+)\s+(\d{2,4})$/);
  if (sameMonthMatch) {
    const day1 = Number(sameMonthMatch[1]);
    const monthIdx = normalizeMonthToken(sameMonthMatch[3]);
    const year = parseYearToken(sameMonthMatch[4]);
    if (monthIdx >= 0 && day1 >= 1 && day1 <= 31) {
      return buildPeriodDays(new Date(year, monthIdx, day1));
    }
  }

  // Pattern 2: "28 AGOSTO A 03 SETEMBRO 26" or "26 DEZEMBRO 26 A 01 JANEIRO 27"
  const crossMonthMatch = text.match(
    /^(\d{1,2})\s+([A-ZÇÃÕÁÉÍÓÚ]+)(?:\s+(\d{2,4}))?\s+A\s+(\d{1,2})\s+([A-ZÇÃÕÁÉÍÓÚ]+)\s+(\d{2,4})$/
  );
  if (crossMonthMatch) {
    const day1 = Number(crossMonthMatch[1]);
    const month1 = normalizeMonthToken(crossMonthMatch[2]);
    const year2 = parseYearToken(crossMonthMatch[6]);
    const year1 = crossMonthMatch[3]
      ? parseYearToken(crossMonthMatch[3])
      : month1 === 11
        ? year2 - 1
        : year2;
    if (month1 >= 0 && day1 >= 1 && day1 <= 31) {
      return buildPeriodDays(new Date(year1, month1, day1));
    }
  }

  // Fallback to current Friday→Thursday cycle
  return buildRelatorioWeekPeriod(0, referenceDate).days;
}
