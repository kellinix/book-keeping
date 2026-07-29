export type ReconciliationInput = {
  transaction_date?: string | null;
  amount?: number | string | null;
  amount_pence?: number | null;
  currency?: string | null;
  type?: string | null;
  merchant?: string | null;
  description?: string | null;
  bank_account_id?: string | null;
  provider_account_ref?: string | null;
  payment_source?: string | null;
};

export function normalizeMerchant(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(limited|ltd|plc|inc|company|co)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

export function reconciliationKey(tx: ReconciliationInput): string | null {
  const date = String(tx.transaction_date ?? "").slice(0, 10);
  const amountPence = tx.amount_pence ?? Math.round(Math.abs(Number(tx.amount ?? 0)) * 100);
  const merchant = normalizeMerchant(tx.merchant || tx.description);
  // Provider account references remain stable when an OAuth connection is
  // renewed. Internal bank_account UUIDs do not, so they are only a fallback.
  const account = tx.provider_account_ref || tx.bank_account_id || tx.payment_source || "unknown";
  const currency = String(tx.currency || "GBP").toUpperCase().slice(0, 3);
  const type = tx.type === "income" ? "income" : "expense";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isSafeInteger(amountPence) || amountPence <= 0 || !merchant) return null;
  return [date, amountPence, currency, type, account, merchant].join("|");
}
