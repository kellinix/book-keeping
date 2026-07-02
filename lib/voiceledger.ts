// ── MTD ITSA types ────────────────────────────────────────────────────────────

export type IncomeSourceType = "self_employment" | "uk_property";
export type QuarterElection = "calendar" | "tax_year";
export type ReportingBasis = "detailed" | "simplified";
export type PeriodStatus = "open" | "submitted" | "locked";
export type AuditChangeSource = "user" | "ai" | "import" | "system";

export type IncomeSource = {
  id: string;
  user_id: string;
  business_id: string;
  name: string;
  source_type: IncomeSourceType;
  trading_name: string | null;
  commencement_date: string | null;
  cessation_date: string | null;
  quarter_election: QuarterElection;
  reporting_basis: ReportingBasis;
  created_at: string;
  updated_at: string;
};

export type TaxPeriod = {
  id: string;
  income_source_id: string;
  tax_year: string;
  quarter: 1 | 2 | 3 | 4;
  period_start: string;
  period_end: string;
  due_date: string;
  requires_bsas_gap: boolean;
  status: PeriodStatus;
  submitted_at: string | null;
  created_at: string;
};

export type MtdCategoryEntry = {
  id: string;
  vl_category: string;
  source_type: IncomeSourceType;
  mtd_income_box: string | null;
  mtd_expense_box: string | null;
};

// ── Category list ─────────────────────────────────────────────────────────────

export const VOICELEDGER_CATEGORIES = [
  "Revenue",
  "Software",
  "Marketing",
  "Contractor/Freelancer",
  "Office/Admin",
  "Travel",
  "Equipment",
  "Professional Services",
  "Bank Fees",
  "Tax",
  "Refund/Reversal",
  "Director Loan",
  "Transfer",
  "Other"
] as const;

export type VoiceLedgerCategory = (typeof VOICELEDGER_CATEGORIES)[number];
export type TransactionType = "income" | "expense";
export type TransactionSource = "manual" | "bank_upload" | "voice" | "receipt";
export type PaymentSource = "business_account" | "personal_account" | "business_credit_card" | "personal_credit_card" | "cash" | "other";
export type PaidBy = "company" | "director" | "owner" | "employee" | "contractor" | "other";
export type ReimbursementStatus = "not_applicable" | "owed_to_director" | "reimbursed" | "partially_reimbursed";

export const PAYMENT_SOURCE_LABELS: Record<PaymentSource, string> = {
  business_account: "Business bank account",
  personal_account: "Personal bank account",
  business_credit_card: "Business credit card",
  personal_credit_card: "Personal credit card",
  cash: "Cash",
  other: "Other"
};

export const PAID_BY_LABELS: Record<PaidBy, string> = {
  company: "Company",
  director: "Director / Owner",
  owner: "Owner",
  employee: "Employee",
  contractor: "Contractor",
  other: "Other"
};

export const REIMBURSEMENT_STATUS_LABELS: Record<ReimbursementStatus, string> = {
  not_applicable: "Not applicable",
  owed_to_director: "Owed to director",
  reimbursed: "Reimbursed",
  partially_reimbursed: "Partially reimbursed"
};

export type TransactionRecord = {
  id: string;
  transaction_date: string | null;
  description: string | null;
  merchant: string | null;
  /** @deprecated Use amount_pence for all new writes. amount (float) will be dropped in a future migration. */
  amount: number | string | null;
  /** Integer pence. Authoritative for all new transactions. */
  amount_pence: number | null;
  currency: string | null;
  type: TransactionType;
  category: string | null;
  payment_method: string | null;
  source: TransactionSource;
  notes: string | null;
  tax_deductible: boolean | null;
  confidence_score: number | string | null;
  // Payment source fields
  payment_source: PaymentSource | null;
  paid_by: PaidBy | null;
  // Reimbursement fields
  director_reimbursable: boolean | null;
  reimbursement_status: ReimbursementStatus | null;
  reimbursed_amount: number | string | null;
  reimbursed_date: string | null;
  reimbursement_notes: string | null;
  // MTD ITSA fields
  income_source_id: string | null;
  period_id: string | null;
  suggested_by_ai: boolean;
  user_confirmed: boolean;
  is_locked: boolean;
  created_at?: string | null;
};

export function isPersonalPaymentSource(source: PaymentSource | string | null | undefined): boolean {
  return source === "personal_account" || source === "personal_credit_card";
}

export function computeOutstandingAmount(tx: Pick<TransactionRecord, "amount" | "reimbursed_amount" | "reimbursement_status">): number {
  if (tx.reimbursement_status === "reimbursed") return 0;
  if (tx.reimbursement_status === "partially_reimbursed") {
    return Math.max(0, parseMoney(tx.amount) - parseMoney(tx.reimbursed_amount));
  }
  if (tx.reimbursement_status === "owed_to_director") return parseMoney(tx.amount);
  return 0;
}

export function formatCurrency(amount: number, currency = "GBP") {
  try {
    return new Intl.NumberFormat(undefined, {
      currency,
      style: "currency"
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function parseMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value)
    .replace(/\((.*)\)/, "-$1")
    .replace(/[^0-9.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Prefers amount_pence (integer pence ÷ 100) over the legacy float amount field. */
export function parseMoneyFromRecord(tx: { amount?: number | string | null; amount_pence?: number | null }): number {
  if (tx.amount_pence != null) return tx.amount_pence / 100;
  return parseMoney(tx.amount);
}

export function summarizeTransactions(
  transactions: Array<Pick<TransactionRecord, "amount" | "amount_pence" | "type" | "category" | "tax_deductible" | "user_confirmed">>,
  options: { confirmedOnly?: boolean } = {}
) {
  const { confirmedOnly = true } = options;
  // When confirmedOnly, exclude AI-suggested transactions not yet reviewed by the user.
  const eligible = confirmedOnly ? transactions.filter((tx) => tx.user_confirmed !== false) : transactions;
  const profitAndLossTransactions = eligible.filter((tx) => !isBalanceSheetCategory(tx.category));
  const totalIncome = profitAndLossTransactions.reduce((sum, tx) => {
    if (tx.type !== "income" || isRefundCategory(tx.category)) return sum;
    return sum + parseMoneyFromRecord(tx);
  }, 0);
  const grossExpenses = profitAndLossTransactions.reduce((sum, tx) => sum + (tx.type === "expense" ? parseMoneyFromRecord(tx) : 0), 0);
  const expenseRefunds = profitAndLossTransactions.reduce((sum, tx) => {
    if (tx.type !== "income" || !isRefundCategory(tx.category)) return sum;
    return sum + parseMoneyFromRecord(tx);
  }, 0);
  const totalExpenses = Math.max(0, grossExpenses - expenseRefunds);
  const deductibleExpenses = eligible.reduce(
    (sum, tx) => sum + (tx.type === "expense" && tx.tax_deductible && !isBalanceSheetCategory(tx.category) ? parseMoneyFromRecord(tx) : 0),
    0
  );
  const uncategorisedCount = eligible.filter((tx) => !tx.category || tx.category === "Other").length;

  return {
    deductibleExpenses,
    estimatedProfit: totalIncome - totalExpenses,
    totalExpenses,
    totalIncome,
    uncategorisedCount
  };
}

export function summarizeDirectorExpenses(transactions: Array<Pick<TransactionRecord, "amount" | "type" | "payment_source" | "director_reimbursable" | "reimbursement_status" | "reimbursed_amount">>) {
  const personalExpenses = transactions.filter(
    (tx) => tx.type === "expense" && isPersonalPaymentSource(tx.payment_source)
  );
  const totalPaidPersonally = personalExpenses.reduce((sum, tx) => sum + parseMoney(tx.amount), 0);
  const outstanding = personalExpenses.reduce((sum, tx) => sum + computeOutstandingAmount(tx), 0);
  const totalReimbursed = Math.max(0, totalPaidPersonally - outstanding);
  const unreimbursedCount = personalExpenses.filter(
    (tx) => tx.reimbursement_status === "owed_to_director" || tx.reimbursement_status === "partially_reimbursed"
  ).length;

  return { totalPaidPersonally, totalReimbursed, outstanding, unreimbursedCount };
}

export function normalizeCategory(category: unknown): VoiceLedgerCategory {
  const value = String(category ?? "").trim();
  return (VOICELEDGER_CATEGORIES as readonly string[]).includes(value) ? (value as VoiceLedgerCategory) : "Other";
}

export function isBalanceSheetCategory(category: unknown) {
  const normalized = normalizeCategory(category);
  return normalized === "Director Loan" || normalized === "Transfer";
}

export function isRefundCategory(category: unknown) {
  return normalizeCategory(category) === "Refund/Reversal";
}
