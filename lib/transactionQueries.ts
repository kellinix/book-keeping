import { supabase } from "./supabaseClient";
import { TransactionRecord } from "./voiceledger";

const PAGE_SIZE = 1000;

function isMissingExcludedColumn(error: { code?: string; message?: string; details?: string } | null) {
  if (!error) return false;
  const text = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return (error.code === "42703" || error.code === "PGRST204") && text.includes("excluded_from_reports");
}

/** Fetches the complete ledger in stable pages instead of silently stopping at PostgREST's row cap. */
export async function fetchAllTransactions(userId: string, options: { includeExcluded?: boolean } = {}) {
  const transactions: TransactionRecord[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const fetchPage = (filterExcluded: boolean) => {
      let query = supabase
        .from("transactions")
        .select("*")
        .eq("user_id", userId)
        .order("transaction_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (filterExcluded) query = query.eq("excluded_from_reports", false);
      return query;
    };

    let { data, error } = await fetchPage(!options.includeExcluded);
    // Keep older deployments usable while the additive schema migration is pending.
    // With the old schema there cannot be excluded rows yet, so the unfiltered result is equivalent.
    if (!options.includeExcluded && isMissingExcludedColumn(error)) {
      ({ data, error } = await fetchPage(false));
    }
    if (error) throw error;
    const page = (data ?? []) as TransactionRecord[];
    transactions.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return transactions;
}
