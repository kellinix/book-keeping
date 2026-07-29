import type { VoiceLedgerCategory } from "./voiceledger";

export type BankCategorizationInput = {
  amount: number;
  description?: string | null;
  merchant_name?: string | null;
  transaction_category?: string | null;
  transaction_type?: string | null;
};

export type BankCategorization = {
  category: VoiceLedgerCategory;
  confidence: number;
  taxDeductible: boolean;
  autoApproved: boolean;
  explanation: string;
};

const SAFE_ALLOWABLE = new Set<VoiceLedgerCategory>([
  "Software", "Marketing", "Contractor/Freelancer", "Office/Admin", "Professional Services", "Bank Fees"
]);

export function categorizeBankTransaction(tx: BankCategorizationInput, isBusinessAccount: boolean): BankCategorization {
  const text = `${tx.merchant_name || ""} ${tx.description || ""}`.toLowerCase();
  const provider = String(tx.transaction_category || "").toLowerCase();
  const transactionType = String(tx.transaction_type || "").toLowerCase();
  const income = tx.amount > 0 || /credit|deposit|income/.test(transactionType);

  let category: VoiceLedgerCategory = "Other";
  let confidence = 0.5;
  let explanation = "No reliable category rule matched.";
  const match = (nextCategory: VoiceLedgerCategory, nextConfidence: number, reason: string) => {
    category = nextCategory;
    confidence = nextConfidence;
    explanation = reason;
  };

  if (/returned[_ ]?(dd|direct debit)|chargeback|reversal|refund/.test(provider) || /returned (dd|direct debit)|chargeback|reversal|refund/.test(text)) {
    match("Refund/Reversal", 0.97, "Matched a refund, reversal, or returned payment.");
  } else if (/transfer|cash_withdrawal|cash_deposit/.test(provider) || /\btransfer\b|faster payment|save the change|round[ -]?up|\batm\b|cash withdrawal/.test(text)) {
    match("Transfer", 0.98, "Matched a transfer, cash movement, or savings round-up.");
  } else if (/fee|charge/.test(provider) || /bank fee|service charge|overdraft fee|interest charge/.test(text)) {
    match("Bank Fees", 0.98, "Matched a bank fee or account charge.");
  } else if (/\bhmrc\b|corporation tax|vat payment|income tax/.test(text) || /(^|_)tax($|_)/.test(provider)) {
    match("Tax", 0.96, "Matched an explicit tax payment.");
  } else if (/working tax credit|child tax credit|universal credit|benefit payment/.test(text)) {
    match("Other", 0.99, "Matched personal benefit or tax-credit income, not sales revenue.");
  } else if (/betfred|bet365|bingo|betropolis|virgin games|gaming ltd|casino|lottery/.test(text)) {
    match("Other", 0.99, "Matched gambling or gaming activity.");
  } else if (/client payment|invoice payment|sales receipt|customer payment|stripe payout|shopify payout/.test(text) || /sales|business_income/.test(provider)) {
    match("Revenue", 0.97, "Matched explicit customer or sales income.");
  } else if (/google ads|facebook ads|meta ads|instagram ad|tiktok ad|linkedin ads|mailchimp|marketing|advertising/.test(text)) {
    match("Marketing", 0.97, "Matched an advertising or marketing supplier.");
  } else if (/github|openai|vercel|microsoft 365|google workspace|adobe|slack|notion|dropbox|zoom|quickbooks|xero|intuit|software|hosting|domain/.test(text)) {
    match("Software", 0.97, "Matched a known software, hosting, or SaaS supplier.");
  } else if (/accountant|solicitor|lawyer|legal service|consulting|professional service/.test(text)) {
    match("Professional Services", 0.94, "Matched a professional-services supplier.");
  } else if (/contractor|freelancer|subcontractor/.test(text)) {
    match("Contractor/Freelancer", 0.94, "Matched a contractor or freelancer payment.");
  } else if (/stationery|office depot|post office|royal mail|printing|office supplies/.test(text)) {
    match("Office/Admin", 0.93, "Matched office, postage, printing, or administration costs.");
  } else if (/train|rail|uber|taxi|hotel|airbnb|airline|flight|parking|petrol|fuel|dvla|vehicle licence|vehicle license/.test(text)) {
    match("Travel", 0.86, "Matched travel or vehicle activity; business purpose still needs confirmation.");
  } else if (/currys|computer|laptop|monitor|equipment/.test(text)) {
    match("Equipment", 0.9, "Matched an equipment supplier; capital or personal treatment may need review.");
  } else if (/tesco|asda|morrisons|sainsbury|lidl|aldi|spar|mcdonald|home bargains|rent|energy|insurance|pets?|tails\.com/.test(text)) {
    match("Other", 0.88, "Matched common personal or mixed-use spending; no business category was assumed.");
  } else if (income && /salary|income/.test(provider)) {
    match("Other", 0.75, "Provider marked this as income, but it was not clearly customer revenue.");
  }

  const autoApproved = !isBusinessAccount || confidence >= 0.92;
  const taxDeductible = isBusinessAccount && !income && autoApproved && SAFE_ALLOWABLE.has(category);
  return { category, confidence, taxDeductible, autoApproved, explanation };
}
