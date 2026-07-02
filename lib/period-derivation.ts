// MTD ITSA quarterly period derivation.
// All dates use local midnight (no time component) to avoid DST edge cases.
// Due dates per HMRC: Q1→7 Aug, Q2→7 Nov, Q3→7 Feb, Q4→7 May (both elections).

export type QuarterElection = "calendar" | "tax_year";

export type QuarterResult = {
  taxYear: string;             // e.g. '2026-27'
  quarter: 1 | 2 | 3 | 4;
  start: Date;
  end: Date;
  due: Date;
  requiresBsasGap: false;
};

// 1–5 April in the first MTD year (2026/27) is not covered by quarterly updates.
// These five days must be reported via a Balancing Statement Adjustment (BSAS).
// Only applies to the calendar-quarter election in 2026/27.
export type BsasGapResult = {
  taxYear: "2026-27";
  isBsasGap: true;
  requiresBsasGap: true;
  start: Date; // 1 Apr 2026
  end: Date;   // 5 Apr 2026
};

export type DeriveQuarterResult = QuarterResult | BsasGapResult;

// First tax year in which MTD ITSA quarterly updates are mandatory (income > £50k).
const FIRST_MTD_TAX_YEAR = "2026-27";

function d(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day);
}

function taxYearStr(startYear: number): string {
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

/** Returns the start year of the UK tax year (6 Apr Y → 5 Apr Y+1) containing `date`. */
function taxYearStart(year: number, month: number, day: number): number {
  return month > 4 || (month === 4 && day >= 6) ? year : year - 1;
}

function taxYearQuarter(year: number, month: number, day: number): QuarterResult {
  const tys = taxYearStart(year, month, day);
  const taxYear = taxYearStr(tys);

  // Q1: 6 Apr – 5 Jul   due 7 Aug
  if ((month === 4 && day >= 6) || month === 5 || month === 6 || (month === 7 && day <= 5)) {
    return { taxYear, quarter: 1, start: d(tys, 4, 6), end: d(tys, 7, 5), due: d(tys, 8, 7), requiresBsasGap: false };
  }
  // Q2: 6 Jul – 5 Oct   due 7 Nov
  if ((month === 7 && day >= 6) || month === 8 || month === 9 || (month === 10 && day <= 5)) {
    return { taxYear, quarter: 2, start: d(tys, 7, 6), end: d(tys, 10, 5), due: d(tys, 11, 7), requiresBsasGap: false };
  }
  // Q3: 6 Oct – 5 Jan   due 7 Feb
  if ((month === 10 && day >= 6) || month === 11 || month === 12 || (month === 1 && day <= 5)) {
    return { taxYear, quarter: 3, start: d(tys, 10, 6), end: d(tys + 1, 1, 5), due: d(tys + 1, 2, 7), requiresBsasGap: false };
  }
  // Q4: 6 Jan – 5 Apr   due 7 May
  return { taxYear, quarter: 4, start: d(tys + 1, 1, 6), end: d(tys + 1, 4, 5), due: d(tys + 1, 5, 7), requiresBsasGap: false };
}

function calendarQuarter(year: number, month: number, day: number): DeriveQuarterResult {
  // Tax year for calendar quarters: Apr-Dec in year Y → Y-(Y+1); Jan-Mar in Y → (Y-1)-Y
  const tys = month >= 4 ? year : year - 1;
  const taxYear = taxYearStr(tys);

  // 2026/27 BSAS gap: 1–5 Apr 2026 falls between the end of 2025/26 and the start
  // of the first MTD quarterly window. Transactions here need BSAS treatment — do NOT
  // silently roll them into Q1 totals.
  if (taxYear === FIRST_MTD_TAX_YEAR && month === 4 && day <= 5) {
    return { taxYear: FIRST_MTD_TAX_YEAR, isBsasGap: true, requiresBsasGap: true, start: d(2026, 4, 1), end: d(2026, 4, 5) };
  }

  // Q1: Apr – Jun   due 7 Aug
  // First-year (2026/27) exception: Q1 starts 6 Apr not 1 Apr.
  if (month >= 4 && month <= 6) {
    const q1Start = taxYear === FIRST_MTD_TAX_YEAR ? 6 : 1;
    return { taxYear, quarter: 1, start: d(tys, 4, q1Start), end: d(tys, 6, 30), due: d(tys, 8, 7), requiresBsasGap: false };
  }
  // Q2: Jul – Sep   due 7 Nov
  if (month >= 7 && month <= 9) {
    return { taxYear, quarter: 2, start: d(tys, 7, 1), end: d(tys, 9, 30), due: d(tys, 11, 7), requiresBsasGap: false };
  }
  // Q3: Oct – Dec   due 7 Feb
  if (month >= 10) {
    return { taxYear, quarter: 3, start: d(tys, 10, 1), end: d(tys, 12, 31), due: d(tys + 1, 2, 7), requiresBsasGap: false };
  }
  // Q4: Jan – Mar   due 7 May
  return { taxYear, quarter: 4, start: d(tys + 1, 1, 1), end: d(tys + 1, 3, 31), due: d(tys + 1, 5, 7), requiresBsasGap: false };
}

/**
 * Derives the MTD quarterly period for a given date and election type.
 *
 * Calendar-quarter Q1 in 2026/27 starts 6 Apr (not 1 Apr) due to the first-year
 * exception. Dates 1–5 Apr 2026 return a BsasGapResult — callers must handle this
 * case rather than including those transactions in normal period totals.
 *
 * Quarterly updates are CUMULATIVE (year-to-date), not per-period deltas.
 * Submission will recompute from the start of the tax year each quarter.
 */
export function deriveQuarter(dateStr: string, election: QuarterElection): DeriveQuarterResult {
  // Parse as local date (YYYY-MM-DD) without timezone conversion
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  return election === "tax_year"
    ? taxYearQuarter(year, month, day)
    : calendarQuarter(year, month, day);
}

export function isBsasGap(result: DeriveQuarterResult): result is BsasGapResult {
  return (result as BsasGapResult).isBsasGap === true;
}
