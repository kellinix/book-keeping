import { NextResponse } from "next/server";
import { getUserFromAuthHeader } from "../../../lib/auth";
import { ensureProfileForUser } from "../../../lib/profiles";
import { reconciliationKey } from "../../../lib/reconciliation";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { trueLayerAccountRef } from "../../../lib/truelayer";
import { normalizeCategory } from "../../../lib/voiceledger";

const SOURCES = new Set(["manual", "voice", "receipt"]);
const PAYMENT_SOURCES = new Set(["business_account", "personal_account", "business_credit_card", "personal_credit_card", "cash", "other"]);
const PAID_BY = new Set(["company", "director", "owner", "employee", "contractor", "other"]);

function cleanTags(value: unknown) {
  const tags = Array.isArray(value) ? value : String(value ?? "").split(",");
  return Array.from(new Set(tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))).slice(0, 20);
}

function normalizeRow(input: Record<string, unknown>, userId: string) {
  const amount = Math.abs(Number(input.amount));
  const amountPence = Math.round(amount * 100);
  const type = input.type === "income" ? "income" : "expense";
  const paymentSource = PAYMENT_SOURCES.has(String(input.payment_source)) ? String(input.payment_source) : "business_account";
  const personalPayment = paymentSource === "personal_account" || paymentSource === "personal_credit_card";
  const source = SOURCES.has(String(input.source)) ? String(input.source) : "manual";
  const row = {
    user_id: userId,
    transaction_date: String(input.transaction_date ?? "").slice(0, 10),
    amount,
    amount_pence: amountPence,
    currency: String(input.currency || "GBP").toUpperCase().slice(0, 3),
    type,
    merchant: String(input.merchant || "").trim().slice(0, 200) || null,
    description: String(input.description || input.merchant || "").trim().slice(0, 500),
    category: normalizeCategory(input.category),
    source,
    notes: String(input.notes || "").trim().slice(0, 2000) || null,
    tags: cleanTags(input.tags),
    is_business: input.is_business !== false,
    bank_account_id: input.bank_account_id ? String(input.bank_account_id) : null,
    provider_account_ref: null as string | null,
    payment_source: paymentSource,
    paid_by: PAID_BY.has(String(input.paid_by)) ? String(input.paid_by) : personalPayment ? "director" : "company",
    tax_deductible: Boolean(input.tax_deductible) && input.is_business !== false,
    confidence_score: input.confidence_score == null ? null : Math.max(0, Math.min(1, Number(input.confidence_score))),
    suggested_by_ai: Boolean(input.suggested_by_ai),
    user_confirmed: true,
    director_reimbursable: Boolean(input.director_reimbursable) && type === "expense" && input.is_business !== false,
    reimbursement_status: Boolean(input.director_reimbursable) && type === "expense" && input.is_business !== false ? "owed_to_director" : "not_applicable"
  };
  return { ...row, reconciliation_key: reconciliationKey(row) };
}

export async function POST(req: Request) {
  try {
    const user = await getUserFromAuthHeader(req.headers.get("authorization"));
    if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureProfileForUser(user);
    const body = await req.json();
    const inputs: unknown[] = Array.isArray(body?.transactions) ? body.transactions : [body?.transaction ?? body];
    if (!inputs.length || inputs.length > 100) return NextResponse.json({ error: "Submit between 1 and 100 transactions" }, { status: 400 });

    const rows = inputs.map((item: unknown) => normalizeRow((item && typeof item === "object" ? item : {}) as Record<string, unknown>, user.id));
    const invalid = rows.find((row) => !row.reconciliation_key || !row.description || row.amount_pence <= 0);
    if (invalid) return NextResponse.json({ error: "Each transaction needs a valid date, positive amount, merchant or description, and currency" }, { status: 400 });

    const accountIds = Array.from(new Set(rows.map((row) => row.bank_account_id).filter(Boolean))) as string[];
    if (accountIds.length) {
      const { data: owned } = await supabaseAdmin.from("bank_accounts").select("id,provider_account_id").eq("user_id", user.id).in("id", accountIds);
      if ((owned || []).length !== accountIds.length) return NextResponse.json({ error: "Invalid account source" }, { status: 403 });
      const refs = new Map((owned || []).map((account) => [account.id, trueLayerAccountRef(account.provider_account_id)]));
      for (const row of rows) {
        if (!row.bank_account_id) continue;
        row.provider_account_ref = refs.get(row.bank_account_id) || null;
        row.reconciliation_key = reconciliationKey(row);
      }
    }

    const keys = rows.map((row) => row.reconciliation_key as string);
    const { data: existing } = await supabaseAdmin.from("transactions").select("reconciliation_key").eq("user_id", user.id).in("reconciliation_key", keys);
    const seen = new Set((existing || []).map((row) => row.reconciliation_key));
    const deduped = rows.filter((row) => {
      if (seen.has(row.reconciliation_key)) return false;
      seen.add(row.reconciliation_key);
      return true;
    });
    if (!deduped.length) return NextResponse.json({ data: [], imported: 0, skippedDuplicates: rows.length }, { status: 200 });
    const { data, error } = await supabaseAdmin.from("transactions").insert(deduped).select("id,source");
    if (error) throw error;
    return NextResponse.json({ data: data || [], imported: data?.length || 0, skippedDuplicates: rows.length - deduped.length }, { status: 201 });
  } catch (error) {
    console.error("Create transactions error", error);
    return NextResponse.json({ error: "Could not save transactions" }, { status: 500 });
  }
}
