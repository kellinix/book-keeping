import { NextResponse } from "next/server";
import { getUserIdFromAuthHeader } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { decryptToken, encryptToken, refreshAccessToken, trueLayerAccountRef, trueLayerGet } from "../../../../../lib/truelayer";
import { reconciliationKey } from "../../../../../lib/reconciliation";
import { categorizeBankTransaction } from "../../../../../lib/bankCategorization";

type BankTx = { transaction_id: string; timestamp: string; description: string; amount: number; currency: string; transaction_type?: string; merchant_name?: string; transaction_category?: string };

function isExpense(tx: BankTx) {
  const transactionType = String(tx.transaction_type || "").toLowerCase();
  if (/debit|withdrawal/.test(transactionType)) return true;
  if (/credit|deposit|income/.test(transactionType)) return false;
  return tx.amount < 0;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userId = await getUserIdFromAuthHeader(req.headers.get("authorization"));
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: connection } = await supabaseAdmin.from("bank_connections").select("*,bank_accounts(*)").eq("id", params.id).eq("user_id", userId).single();
  if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  const { data: syncLog } = await supabaseAdmin.from("sync_logs").insert({ user_id: userId, connection_id: connection.id, status: "running" }).select("id").single();
  try {
    if (connection.consent_expires_at && new Date(connection.consent_expires_at).getTime() <= Date.now()) {
      await supabaseAdmin.from("bank_connections").update({ status: "disconnected" }).eq("id", connection.id);
      throw new Error("Bank consent has expired. Reconnect the account to continue syncing.");
    }
    let accessToken = decryptToken(connection.access_token_encrypted);
    if (new Date(connection.expires_at).getTime() < Date.now() + 60_000) {
      if (!connection.refresh_token_encrypted) throw new Error("Bank connection needs reconnecting");
      const refreshed = await refreshAccessToken(decryptToken(connection.refresh_token_encrypted));
      accessToken = refreshed.access_token;
      await supabaseAdmin.from("bank_connections").update({ access_token_encrypted: encryptToken(accessToken), refresh_token_encrypted: refreshed.refresh_token ? encryptToken(refreshed.refresh_token) : connection.refresh_token_encrypted, expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(), status: "active" }).eq("id", connection.id);
    }
    let imported = 0; let skipped = 0; let autoCategorized = 0; let needsReview = 0;
    for (const account of connection.bank_accounts || []) {
      const accountRef = trueLayerAccountRef(account.provider_account_id);
      const isBusinessAccount = account.is_business === true;
      const result = await trueLayerGet<BankTx>(`/accounts/${encodeURIComponent(account.provider_account_id)}/transactions`, accessToken).catch(() => trueLayerGet<BankTx>(`/cards/${encodeURIComponent(account.provider_account_id)}/transactions`, accessToken));
      // Providers can occasionally return the same transaction more than once
      // in a page. Keep one canonical row per transaction within this account.
      const uniqueTransactions = Array.from(new Map(result.results.map((tx) => [tx.transaction_id, tx])).values());
      skipped += result.results.length - uniqueTransactions.length;
      const ids = uniqueTransactions.map((tx) => tx.transaction_id);
      const { data: existing } = ids.length ? await supabaseAdmin.from("transactions").select("external_transaction_id,user_confirmed").eq("user_id", userId).eq("provider_account_ref", accountRef).in("external_transaction_id", ids) : { data: [] };
      const seen = new Set((existing || []).map((row) => row.external_transaction_id));
      // Re-map existing imports too, so improvements to the mapper are applied on
      // the next sync without duplicating transactions.
      const reviewableExistingIds = new Set((existing || []).filter((row) => row.user_confirmed === false).map((row) => row.external_transaction_id));
      const existingTransactions = uniqueTransactions.filter((tx) => reviewableExistingIds.has(tx.transaction_id));
      for (const tx of existingTransactions) {
        const categorization = categorizeBankTransaction(tx, isBusinessAccount);
        const { error: mappingError } = await supabaseAdmin.from("transactions").update({
          category: categorization.category,
          confidence_score: categorization.confidence,
          ai_explanation: categorization.explanation,
          merchant: tx.merchant_name || tx.description || null,
          tax_deductible: categorization.taxDeductible,
          user_confirmed: categorization.autoApproved
        }).eq("user_id", userId).eq("provider_account_ref", accountRef).eq("external_transaction_id", tx.transaction_id).eq("user_confirmed", false);
        if (mappingError) throw mappingError;
        if (categorization.autoApproved) autoCategorized += 1; else needsReview += 1;
      }
      const rows = uniqueTransactions.filter((tx) => !seen.has(tx.transaction_id)).map((tx) => {
        const expense = isExpense(tx);
        const description = tx.description || tx.merchant_name || "Bank transaction";
        const categorization = categorizeBankTransaction(tx, isBusinessAccount);
        if (categorization.autoApproved) autoCategorized += 1; else needsReview += 1;
        const row = {
          user_id: userId,
          transaction_date: tx.timestamp.slice(0, 10),
          description,
          merchant: tx.merchant_name || description,
          amount: Math.abs(tx.amount),
          amount_pence: Math.round(Math.abs(tx.amount) * 100),
          currency: tx.currency || account.currency || "GBP",
          type: expense ? "expense" : "income",
          category: categorization.category,
          confidence_score: categorization.confidence,
          ai_explanation: categorization.explanation,
          payment_source: isBusinessAccount ? "business_account" : "personal_account",
          paid_by: isBusinessAccount ? "company" : "owner",
          reimbursement_status: "not_applicable",
          source: "bank_connection",
          external_transaction_id: tx.transaction_id,
          bank_account_id: account.id,
          provider_account_ref: accountRef,
          is_business: isBusinessAccount,
          tax_deductible: categorization.taxDeductible,
          tags: [],
          user_confirmed: categorization.autoApproved,
          suggested_by_ai: false
        };
        return { ...row, reconciliation_key: reconciliationKey(row) };
      });
      skipped += uniqueTransactions.length - rows.length;
      if (rows.length) {
        // Insert individually so a concurrent sync racing on one row cannot
        // roll back the rest of the account batch.
        const dates = Array.from(new Set(rows.map((row) => row.transaction_date)));
        const { data: candidates } = await supabaseAdmin.from("transactions").select("id,transaction_date,amount,amount_pence,currency,type,merchant,description,bank_account_id,provider_account_ref,payment_source,external_transaction_id").eq("user_id", userId).eq("excluded_from_reports", false).in("transaction_date", dates);
        for (const row of rows) {
          const matching = (candidates || []).find((candidate) => reconciliationKey(candidate) === row.reconciliation_key);
          if (matching) {
            const { error: reconcileError } = await supabaseAdmin.from("transactions").update({ bank_account_id: account.id, provider_account_ref: accountRef, external_transaction_id: row.external_transaction_id, reconciliation_key: row.reconciliation_key }).eq("id", matching.id).eq("user_id", userId);
            if (reconcileError) throw reconcileError;
            skipped += 1;
            continue;
          }
          const { error } = await supabaseAdmin.from("transactions").insert(row);
          if (error?.code === "23505") { skipped += 1; continue; }
          if (error) throw error;
          imported += 1;
        }
      }
    }
    await supabaseAdmin.from("bank_connections").update({ last_synced_at: new Date().toISOString(), status: "active" }).eq("id", connection.id);
    if (syncLog?.id) await supabaseAdmin.from("sync_logs").update({ status: "success", finished_at: new Date().toISOString(), imported_count: imported, duplicate_count: skipped }).eq("id", syncLog.id);
    return NextResponse.json({ imported, skipped, autoCategorized, needsReview });
  } catch (error) {
    console.error("Bank sync error", error); await supabaseAdmin.from("bank_connections").update({ status: "error" }).eq("id", connection.id);
    if (syncLog?.id) await supabaseAdmin.from("sync_logs").update({ status: "failed", finished_at: new Date().toISOString(), error_message: error instanceof Error ? error.message.slice(0, 500) : "Bank sync failed" }).eq("id", syncLog.id);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Bank sync failed" }, { status: 500 });
  }
}
