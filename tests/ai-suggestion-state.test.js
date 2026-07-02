// Plain Node.js — run with: node tests/ai-suggestion-state.test.js
// Tests summarizeTransactions confirmedOnly behaviour and amount_pence preference.

const assert = require("assert");

// ─── Inline summarizeTransactions logic (mirrors lib/voiceledger.ts) ──────────

function parseMoney(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value).replace(/\((.*)\)/, "-$1").replace(/[^0-9.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseMoneyFromRecord(tx) {
  if (tx.amount_pence != null) return tx.amount_pence / 100;
  return parseMoney(tx.amount);
}

const BALANCE_SHEET_CATS = new Set(["Director Loan", "Transfer"]);
const REFUND_CAT = "Refund/Reversal";

function isBalanceSheetCategory(cat) { return BALANCE_SHEET_CATS.has(cat ?? ""); }
function isRefundCategory(cat) { return cat === REFUND_CAT; }

function summarizeTransactions(transactions, options = {}) {
  const { confirmedOnly = true } = options;
  const eligible = confirmedOnly ? transactions.filter(tx => tx.user_confirmed !== false) : transactions;
  const pl = eligible.filter(tx => !isBalanceSheetCategory(tx.category));
  const totalIncome = pl.reduce((s, tx) => tx.type !== "income" || isRefundCategory(tx.category) ? s : s + parseMoneyFromRecord(tx), 0);
  const grossExpenses = pl.reduce((s, tx) => tx.type === "expense" ? s + parseMoneyFromRecord(tx) : s, 0);
  const expenseRefunds = pl.reduce((s, tx) => tx.type === "income" && isRefundCategory(tx.category) ? s + parseMoneyFromRecord(tx) : s, 0);
  const totalExpenses = Math.max(0, grossExpenses - expenseRefunds);
  const deductibleExpenses = eligible.reduce(
    (s, tx) => tx.type === "expense" && tx.tax_deductible && !isBalanceSheetCategory(tx.category) ? s + parseMoneyFromRecord(tx) : s, 0
  );
  return { totalIncome, totalExpenses, deductibleExpenses, estimatedProfit: totalIncome - totalExpenses };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓  ${name}`); passed++; }
  catch (err) { console.error(`  ✗  ${name}\n     ${err.message}`); failed++; }
}

// ─── Tests ────────────────────────────────────────────────────────────────────
console.log("\nconfirmedOnly filtering:");

const confirmed = { type: "income", category: "Revenue",  amount: 500,  amount_pence: null, tax_deductible: false, user_confirmed: true };
const pending   = { type: "income", category: "Revenue",  amount: 200,  amount_pence: null, tax_deductible: false, user_confirmed: false };
const confirmedExp = { type: "expense", category: "Software", amount: 100, amount_pence: null, tax_deductible: true, user_confirmed: true };
const pendingExp   = { type: "expense", category: "Software", amount: 50,  amount_pence: null, tax_deductible: true, user_confirmed: false };

test("confirmedOnly=true (default) excludes user_confirmed=false transactions", () => {
  const s = summarizeTransactions([confirmed, pending, confirmedExp, pendingExp]);
  assert.strictEqual(s.totalIncome, 500, `totalIncome: expected 500, got ${s.totalIncome}`);
  assert.strictEqual(s.totalExpenses, 100, `totalExpenses: expected 100, got ${s.totalExpenses}`);
  assert.strictEqual(s.deductibleExpenses, 100);
});

test("confirmedOnly=false includes all transactions (AI review screen)", () => {
  const s = summarizeTransactions([confirmed, pending, confirmedExp, pendingExp], { confirmedOnly: false });
  assert.strictEqual(s.totalIncome, 700);
  assert.strictEqual(s.totalExpenses, 150);
  assert.strictEqual(s.deductibleExpenses, 150);
});

test("all confirmed → same result with confirmedOnly=true or false", () => {
  const txs = [confirmed, confirmedExp];
  const a = summarizeTransactions(txs, { confirmedOnly: true });
  const b = summarizeTransactions(txs, { confirmedOnly: false });
  assert.strictEqual(a.totalIncome, b.totalIncome);
  assert.strictEqual(a.totalExpenses, b.totalExpenses);
});

test("empty confirmed set → zeroes (not NaN)", () => {
  const s = summarizeTransactions([pending, pendingExp]);
  assert.strictEqual(s.totalIncome, 0);
  assert.strictEqual(s.totalExpenses, 0);
  assert.strictEqual(s.estimatedProfit, 0);
  assert.ok(!isNaN(s.totalIncome) && !isNaN(s.totalExpenses));
});

console.log("\namount_pence preference:");

test("amount_pence takes precedence over amount when both present", () => {
  const tx = { type: "income", category: "Revenue", amount: 100, amount_pence: 9999, tax_deductible: false, user_confirmed: true };
  const s = summarizeTransactions([tx]);
  assert.strictEqual(s.totalIncome, 99.99, `expected 99.99 (from pence), got ${s.totalIncome}`);
});

test("falls back to amount when amount_pence is null", () => {
  const tx = { type: "income", category: "Revenue", amount: 49.99, amount_pence: null, tax_deductible: false, user_confirmed: true };
  const s = summarizeTransactions([tx]);
  assert.ok(Math.abs(s.totalIncome - 49.99) < 0.001, `expected ~49.99, got ${s.totalIncome}`);
});

test("amount_pence=0 is used (not treated as falsy)", () => {
  // A zero-value transaction stored as 0 pence should read as £0, not fall back to amount
  const tx = { type: "expense", category: "Bank Fees", amount: 5, amount_pence: 0, tax_deductible: false, user_confirmed: true };
  const s = summarizeTransactions([tx]);
  assert.strictEqual(s.totalExpenses, 0);
});

console.log("\nbalance-sheet categories still excluded:");

test("Director Loan excluded from income/expense totals regardless of confirmed status", () => {
  const tx = { type: "expense", category: "Director Loan", amount: 1000, amount_pence: null, tax_deductible: false, user_confirmed: true };
  const s = summarizeTransactions([tx]);
  assert.strictEqual(s.totalExpenses, 0);
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
