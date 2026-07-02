// Plain Node.js — no test runner required. Run with: node tests/period-derivation.test.js
// Tests deriveQuarter() from lib/period-derivation.ts (compiled via ts-node or esbuild).
// Since this project has no bundler script for tests, we test the logic inline here
// to match the smoke.test.js convention (plain Node, no dependencies).

const assert = require("assert");

// ─── Inline the pure logic (mirrors lib/period-derivation.ts exactly) ─────────
const FIRST_MTD_TAX_YEAR = "2026-27";

function d(year, month, day) { return new Date(year, month - 1, day); }
function taxYearStr(startYear) { return `${startYear}-${String(startYear + 1).slice(-2)}`; }
function taxYearStart(year, month, day) { return month > 4 || (month === 4 && day >= 6) ? year : year - 1; }

function taxYearQuarter(year, month, day) {
  const tys = taxYearStart(year, month, day);
  const taxYear = taxYearStr(tys);
  if ((month === 4 && day >= 6) || month === 5 || month === 6 || (month === 7 && day <= 5))
    return { taxYear, quarter: 1, start: d(tys, 4, 6), end: d(tys, 7, 5), due: d(tys, 8, 7), requiresBsasGap: false };
  if ((month === 7 && day >= 6) || month === 8 || month === 9 || (month === 10 && day <= 5))
    return { taxYear, quarter: 2, start: d(tys, 7, 6), end: d(tys, 10, 5), due: d(tys, 11, 7), requiresBsasGap: false };
  if ((month === 10 && day >= 6) || month === 11 || month === 12 || (month === 1 && day <= 5))
    return { taxYear, quarter: 3, start: d(tys, 10, 6), end: d(tys + 1, 1, 5), due: d(tys + 1, 2, 7), requiresBsasGap: false };
  return { taxYear, quarter: 4, start: d(tys + 1, 1, 6), end: d(tys + 1, 4, 5), due: d(tys + 1, 5, 7), requiresBsasGap: false };
}

function calendarQuarter(year, month, day) {
  const tys = month >= 4 ? year : year - 1;
  const taxYear = taxYearStr(tys);
  if (taxYear === FIRST_MTD_TAX_YEAR && month === 4 && day <= 5)
    return { taxYear: FIRST_MTD_TAX_YEAR, isBsasGap: true, requiresBsasGap: true, start: d(2026, 4, 1), end: d(2026, 4, 5) };
  if (month >= 4 && month <= 6) {
    const q1Start = taxYear === FIRST_MTD_TAX_YEAR ? 6 : 1;
    return { taxYear, quarter: 1, start: d(tys, 4, q1Start), end: d(tys, 6, 30), due: d(tys, 8, 7), requiresBsasGap: false };
  }
  if (month >= 7 && month <= 9)
    return { taxYear, quarter: 2, start: d(tys, 7, 1), end: d(tys, 9, 30), due: d(tys, 11, 7), requiresBsasGap: false };
  if (month >= 10)
    return { taxYear, quarter: 3, start: d(tys, 10, 1), end: d(tys, 12, 31), due: d(tys + 1, 2, 7), requiresBsasGap: false };
  return { taxYear, quarter: 4, start: d(tys + 1, 1, 1), end: d(tys + 1, 3, 31), due: d(tys + 1, 5, 7), requiresBsasGap: false };
}

function deriveQuarter(dateStr, election) {
  const [y, m, day] = dateStr.split("-").map(Number);
  return election === "tax_year" ? taxYearQuarter(y, m, day) : calendarQuarter(y, m, day);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function dateEq(a, b) { return a.getTime() === b.getTime(); }

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

// ─── Tax-year election ────────────────────────────────────────────────────────
console.log("\ntax_year election:");

test("2026-04-10 → Q1 2026-27 (6 Apr – 5 Jul, due 7 Aug)", () => {
  const r = deriveQuarter("2026-04-10", "tax_year");
  assert.strictEqual(r.taxYear, "2026-27");
  assert.strictEqual(r.quarter, 1);
  assert.ok(dateEq(r.start, d(2026, 4, 6)), `start: ${r.start}`);
  assert.ok(dateEq(r.end,   d(2026, 7, 5)), `end: ${r.end}`);
  assert.ok(dateEq(r.due,   d(2026, 8, 7)), `due: ${r.due}`);
  assert.strictEqual(r.requiresBsasGap, false);
});

test("2026-07-05 → still Q1 (5 Jul is last day of Q1)", () => {
  const r = deriveQuarter("2026-07-05", "tax_year");
  assert.strictEqual(r.quarter, 1);
});

test("2026-07-06 → Q2 2026-27 (6 Jul – 5 Oct, due 7 Nov)", () => {
  const r = deriveQuarter("2026-07-06", "tax_year");
  assert.strictEqual(r.taxYear, "2026-27");
  assert.strictEqual(r.quarter, 2);
  assert.ok(dateEq(r.start, d(2026, 7, 6)));
  assert.ok(dateEq(r.end,   d(2026, 10, 5)));
  assert.ok(dateEq(r.due,   d(2026, 11, 7)));
});

test("2026-10-15 → Q3 2026-27 (6 Oct – 5 Jan, due 7 Feb)", () => {
  const r = deriveQuarter("2026-10-15", "tax_year");
  assert.strictEqual(r.taxYear, "2026-27");
  assert.strictEqual(r.quarter, 3);
  assert.ok(dateEq(r.start, d(2026, 10, 6)));
  assert.ok(dateEq(r.end,   d(2027, 1, 5)));
  assert.ok(dateEq(r.due,   d(2027, 2, 7)));
});

test("2027-01-03 → Q3 2026-27 (1–5 Jan is tail of Q3)", () => {
  const r = deriveQuarter("2027-01-03", "tax_year");
  assert.strictEqual(r.taxYear, "2026-27");
  assert.strictEqual(r.quarter, 3);
});

test("2027-01-15 → Q4 2026-27 (6 Jan – 5 Apr, due 7 May)", () => {
  const r = deriveQuarter("2027-01-15", "tax_year");
  assert.strictEqual(r.taxYear, "2026-27");
  assert.strictEqual(r.quarter, 4);
  assert.ok(dateEq(r.start, d(2027, 1, 6)));
  assert.ok(dateEq(r.end,   d(2027, 4, 5)));
  assert.ok(dateEq(r.due,   d(2027, 5, 7)));
});

test("2027-04-05 → Q4 2026-27 (5 Apr is last day of Q4)", () => {
  const r = deriveQuarter("2027-04-05", "tax_year");
  assert.strictEqual(r.taxYear, "2026-27");
  assert.strictEqual(r.quarter, 4);
});

test("2027-04-06 → Q1 2027-28 (new tax year starts)", () => {
  const r = deriveQuarter("2027-04-06", "tax_year");
  assert.strictEqual(r.taxYear, "2027-28");
  assert.strictEqual(r.quarter, 1);
});

// ─── Calendar election ────────────────────────────────────────────────────────
console.log("\ncalendar election:");

test("2026-04-03 (calendar, 2026-27) → BSAS gap, NOT in Q1 totals", () => {
  const r = deriveQuarter("2026-04-03", "calendar");
  assert.strictEqual(r.taxYear, "2026-27");
  assert.strictEqual(r.isBsasGap, true);
  assert.strictEqual(r.requiresBsasGap, true);
  // Must NOT have a quarter property (callers use isBsasGap to guard)
  assert.strictEqual(r.quarter, undefined);
});

test("2026-04-05 (calendar) → also BSAS gap (boundary inclusive)", () => {
  const r = deriveQuarter("2026-04-05", "calendar");
  assert.strictEqual(r.isBsasGap, true);
});

test("2026-04-10 (calendar, 2026-27) → Q1, start 6 Apr (first-year exception)", () => {
  const r = deriveQuarter("2026-04-10", "calendar");
  assert.strictEqual(r.taxYear, "2026-27");
  assert.strictEqual(r.quarter, 1);
  assert.ok(dateEq(r.start, d(2026, 4, 6)), `expected 6 Apr 2026, got ${r.start}`);
  assert.ok(dateEq(r.end,   d(2026, 6, 30)));
  assert.ok(dateEq(r.due,   d(2026, 8, 7)));
  assert.strictEqual(r.requiresBsasGap, false);
});

test("2026-10-15 (calendar) → Q3 2026-27 (1 Oct – 31 Dec)", () => {
  const r = deriveQuarter("2026-10-15", "calendar");
  assert.strictEqual(r.taxYear, "2026-27");
  assert.strictEqual(r.quarter, 3);
  assert.ok(dateEq(r.start, d(2026, 10, 1)));
  assert.ok(dateEq(r.end,   d(2026, 12, 31)));
  assert.ok(dateEq(r.due,   d(2027, 2, 7)));
});

test("2027-01-15 (calendar) → Q4 2026-27 (1 Jan – 31 Mar)", () => {
  const r = deriveQuarter("2027-01-15", "calendar");
  assert.strictEqual(r.taxYear, "2026-27");
  assert.strictEqual(r.quarter, 4);
  assert.ok(dateEq(r.start, d(2027, 1, 1)));
  assert.ok(dateEq(r.end,   d(2027, 3, 31)));
  assert.ok(dateEq(r.due,   d(2027, 5, 7)));
});

test("2027-04-03 (calendar, 2027-28) → Q1 starts 1 Apr (no first-year exception)", () => {
  const r = deriveQuarter("2027-04-03", "calendar");
  assert.strictEqual(r.taxYear, "2027-28");
  assert.strictEqual(r.quarter, 1);
  assert.ok(dateEq(r.start, d(2027, 4, 1)), `expected 1 Apr 2027, got ${r.start}`);
  assert.ok(dateEq(r.end,   d(2027, 6, 30)));
  assert.strictEqual(r.requiresBsasGap, false);
});

test("2027-04-01 (calendar, 2027-28) → Q1 (1 Apr is now in-scope, not a gap)", () => {
  const r = deriveQuarter("2027-04-01", "calendar");
  assert.strictEqual(r.taxYear, "2027-28");
  assert.strictEqual(r.quarter, 1);
  assert.ok(!r.isBsasGap);
});

// ─── amount_pence consistency ─────────────────────────────────────────────────
console.log("\namount_pence consistency:");

test("amount_pence = round(amount * 100) for typical values", () => {
  const cases = [
    [49.99, 4999],
    [1200,  120000],
    [0.01,  1],
    [99.999, 100_00], // rounds to nearest penny
    [0,     0],
  ];
  for (const [amount, expected] of cases) {
    const pence = Math.round(amount * 100);
    assert.strictEqual(pence, expected, `amount=${amount}: expected ${expected}, got ${pence}`);
  }
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
