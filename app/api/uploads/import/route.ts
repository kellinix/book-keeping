import { NextResponse } from "next/server";
import { getUserFromAuthHeader } from "../../../../lib/auth";
import { ensureProfileForUser } from "../../../../lib/profiles";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { normalizeCategory, parseMoney } from "../../../../lib/voiceledger";

function normalizeStatementDate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const date = new Date(excelEpoch + value * 24 * 60 * 60 * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }

  const raw = String(value).trim();
  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const slashOrDashMatch = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/);
  if (slashOrDashMatch) {
    const [, firstPart, secondPart, yearPart] = slashOrDashMatch;
    const first = Number(firstPart);
    const second = Number(secondPart);
    const year = yearPart.length === 2 ? `20${yearPart}` : yearPart;

    // Bank statements for this app are UK-first. If only one side is possible,
    // still choose the valid interpretation; otherwise default to DD/MM/YYYY.
    const day = first > 12 ? first : second > 12 ? second : first;
    const month = first > 12 ? second : second > 12 ? first : second;

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function inferCategory(row: any, amount: number) {
  const rawCategory = String(row.Category ?? row.category ?? "").trim();
  const name = String(row.Name ?? row.Merchant ?? row.merchant ?? "").toLowerCase();
  const description = String(row.Description ?? row.description ?? "").toLowerCase();
  const notes = String(row["Notes and #tags"] ?? row.Notes ?? row.notes ?? "").toLowerCase();
  const type = String(row.Type ?? "").toLowerCase();

  if (amount > 0 && (notes.includes("loan") || description.includes("loan"))) return "Director Loan";
  if (type.includes("monzo-to-monzo") && rawCategory.toLowerCase() === "transfers") return "Director Loan";
  if (amount > 0 && (name.includes("github") || description.includes("github"))) return "Refund/Reversal";
  if (rawCategory.toLowerCase() === "transfers") return "Transfer";
  if (rawCategory.toLowerCase() === "bills" && (name.includes("github") || name.includes("openai") || name.includes("vercel"))) return "Software";
  if (rawCategory.toLowerCase() === "software") return "Software";

  return normalizeCategory(rawCategory);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { rows, accountType } = body || {};
  if (!rows || !Array.isArray(rows)) return NextResponse.json({ error: "Invalid rows" }, { status: 400 });

  const authHeader = req.headers.get('authorization');
  const user = await getUserFromAuthHeader(authHeader);
  const user_id = user?.id ?? null;
  if (!user_id) return NextResponse.json({ error: 'Unauthorized: missing or invalid bearer token' }, { status: 401 });
  await ensureProfileForUser(user);

  // Determine payment source from account type selection
  const validAccountTypes = ["business_account", "personal_account", "business_credit_card", "personal_credit_card"];
  const resolvedAccountType = validAccountTypes.includes(accountType) ? accountType : "business_account";
  const isPersonalAccount = resolvedAccountType === "personal_account" || resolvedAccountType === "personal_credit_card";

  const rowsToImport = rows.slice(0, 1000);
  const mapped = rowsToImport.map((r: any) => {
    const date = normalizeStatementDate(r.Date || r.date || r["Transaction Date"] || null);
    const desc = r.Description || r.description || r.Narrative || r.Reference || r.Merchant || r.Name || "";
    const inAmt = r["Money In"] || r["Credit"] || r.Credit || r["Amount In"];
    const outAmt = r["Money Out"] || r["Debit"] || r.Debit || r["Amount Out"];
    const amount = inAmt ? parseMoney(inAmt) : outAmt ? -Math.abs(parseMoney(outAmt)) : parseMoney(r.Amount || r.amount || 0);
    const txType = Number(amount) < 0 ? "expense" : "income";
    const directorReimbursable = isPersonalAccount && txType === "expense";

    return {
      amount: Math.abs(Number(amount)),
      category: inferCategory(r, amount),
      confidence_score: r.confidence_score ? Number(r.confidence_score) : null,
      currency: String(r.Currency || r.currency || "GBP").slice(0, 3).toUpperCase(),
      description: desc,
      director_reimbursable: directorReimbursable,
      merchant: r.Merchant || r.merchant || r.Name || null,
      notes: r.Reference || r.reference || r["Notes and #tags"] || null,
      paid_by: isPersonalAccount ? "director" : "company",
      payment_source: resolvedAccountType,
      reimbursement_status: directorReimbursable ? "owed_to_director" : "not_applicable",
      source: "bank_upload",
      tax_deductible: Boolean(r.tax_deductible),
      transaction_date: date,
      type: txType,
      user_id
    };
  }).filter((tx: any) => tx.transaction_date && tx.description && tx.amount > 0);

  if (!mapped.length) return NextResponse.json({ error: "No valid rows to import" }, { status: 400 });

  const { data: existing } = await supabaseAdmin
    .from("transactions")
    .select("transaction_date,description,amount,type")
    .eq("user_id", user_id)
    .in("transaction_date", Array.from(new Set(mapped.map((tx: any) => tx.transaction_date))));

  const seen = new Set((existing ?? []).map((tx: any) => `${tx.transaction_date}|${tx.description}|${Number(tx.amount).toFixed(2)}|${tx.type}`));
  const deduped = mapped.filter((tx: any) => {
    const key = `${tx.transaction_date}|${tx.description}|${Number(tx.amount).toFixed(2)}|${tx.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!deduped.length) return NextResponse.json({ imported: 0, skippedDuplicates: mapped.length, data: [] });

  const { data, error } = await supabaseAdmin.from("transactions").insert(deduped).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const directorExpenses = (data ?? []).filter((tx: any) => tx.director_reimbursable).length;
  return NextResponse.json({ imported: data?.length ?? 0, skippedDuplicates: mapped.length - deduped.length, directorExpenses, data });
}
