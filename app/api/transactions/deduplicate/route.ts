import { NextResponse } from "next/server";
import { getUserIdFromAuthHeader } from "../../../../lib/auth";
import { reconciliationKey } from "../../../../lib/reconciliation";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { isTrueLayerSandbox } from "../../../../lib/truelayer";
import { amountAppearsExplicitly, extractExplicitMoneyMentions } from "../../../../lib/voiceMoney";

type BankRow = {
  id: string;
  transaction_date: string;
  amount: number | string | null;
  amount_pence: number | null;
  currency: string | null;
  type: string;
  merchant: string | null;
  description: string | null;
  bank_account_id: string | null;
  provider_account_ref: string | null;
  payment_source: string | null;
  tax_deductible: boolean | null;
  user_confirmed: boolean;
  tags: string[] | null;
  notes: string | null;
  created_at: string | null;
};

async function fetchBankRows(userId: string) {
  const rows: BankRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from("transactions")
      .select("id,transaction_date,amount,amount_pence,currency,type,merchant,description,bank_account_id,provider_account_ref,payment_source,tax_deductible,user_confirmed,tags,notes,created_at")
      .eq("user_id", userId)
      .eq("source", "bank_connection")
      .eq("excluded_from_reports", false)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as BankRow[]));
    if ((data ?? []).length < pageSize) break;
  }
  return rows;
}

async function fetchVoiceArtifacts(userId: string) {
  const artifacts: Array<{ id: string; description: string; amount: number }> = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin.from("transactions").select("id,description,amount,amount_pence").eq("user_id", userId).eq("source", "voice").eq("excluded_from_reports", false).range(from, from + pageSize - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      const description = String(row.description || "");
      const mentions = extractExplicitMoneyMentions(description);
      const amount = row.amount_pence != null ? row.amount_pence / 100 : Number(row.amount || 0);
      if (mentions.length > 1 && !amountAppearsExplicitly(mentions, amount)) artifacts.push({ id: row.id, description, amount });
    }
    if ((data ?? []).length < pageSize) break;
  }
  return artifacts;
}

function duplicateGroups(rows: BankRow[]) {
  const groups = new Map<string, BankRow[]>();
  for (const row of rows) {
    const key = reconciliationKey(row);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return Array.from(groups.values()).filter((group) => group.length > 1);
}

function qualityScore(row: BankRow) {
  return (row.tax_deductible ? 100 : 0) + (row.user_confirmed ? 20 : 0) + (row.merchant ? 10 : 0) + ((row.tags?.length ?? 0) ? 5 : 0) + (row.notes ? 2 : 0);
}

export async function GET(req: Request) {
  const userId = await getUserIdFromAuthHeader(req.headers.get("authorization"));
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isTrueLayerSandbox()) return NextResponse.json({ error: "Automatic duplicate cleanup is restricted to TrueLayer sandbox data" }, { status: 403 });
  try {
    const [groups, voiceArtifacts] = await Promise.all([duplicateGroups(await fetchBankRows(userId)), fetchVoiceArtifacts(userId)]);
    const duplicateRows = groups.reduce((sum, group) => sum + group.length - 1, 0);
    const { count: excludedRows } = await supabaseAdmin.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("excluded_from_reports", true).in("excluded_reason", ["sandbox_duplicate", "voice_amount_artifact"]);
    return NextResponse.json({
      groups: groups.length,
      duplicateRows,
      voiceArtifactRows: voiceArtifacts.length,
      excludedRows: excludedRows ?? 0,
      samples: groups.slice(0, 5).map((group) => ({ date: group[0].transaction_date, description: group[0].description, amount: group[0].amount_pence != null ? group[0].amount_pence / 100 : Number(group[0].amount || 0), count: group.length }))
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not inspect duplicates" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const userId = await getUserIdFromAuthHeader(req.headers.get("authorization"));
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isTrueLayerSandbox()) return NextResponse.json({ error: "Automatic duplicate cleanup is restricted to TrueLayer sandbox data" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  try {
    if (body?.action === "restore") {
      const { count, error } = await supabaseAdmin.from("transactions").update({ excluded_from_reports: false, duplicate_of_id: null, excluded_reason: null }, { count: "exact" }).eq("user_id", userId).eq("excluded_from_reports", true).in("excluded_reason", ["sandbox_duplicate", "voice_amount_artifact"]);
      if (error) throw error;
      return NextResponse.json({ restored: count ?? 0 });
    }
    if (body?.action !== "exclude" || body?.confirmation !== "EXCLUDE_SANDBOX_DUPLICATES") return NextResponse.json({ error: "Explicit duplicate-cleanup confirmation is required" }, { status: 400 });

    const [groups, voiceArtifacts] = await Promise.all([duplicateGroups(await fetchBankRows(userId)), fetchVoiceArtifacts(userId)]);
    let excluded = 0;
    for (let offset = 0; offset < groups.length; offset += 20) {
      await Promise.all(groups.slice(offset, offset + 20).map(async (group) => {
        const ordered = [...group].sort((a, b) => qualityScore(b) - qualityScore(a) || String(a.created_at || "").localeCompare(String(b.created_at || "")));
        const [canonical, ...duplicates] = ordered;
        const { error } = await supabaseAdmin.from("transactions").update({ excluded_from_reports: true, duplicate_of_id: canonical.id, excluded_reason: "sandbox_duplicate", updated_at: new Date().toISOString() }).eq("user_id", userId).in("id", duplicates.map((row) => row.id));
        if (error) throw error;
        excluded += duplicates.length;
      }));
    }
    if (voiceArtifacts.length) {
      const { error } = await supabaseAdmin.from("transactions").update({ excluded_from_reports: true, excluded_reason: "voice_amount_artifact", updated_at: new Date().toISOString() }).eq("user_id", userId).in("id", voiceArtifacts.map((row) => row.id));
      if (error) throw error;
      excluded += voiceArtifacts.length;
    }
    return NextResponse.json({ excluded, groups: groups.length, voiceArtifacts: voiceArtifacts.length, recoverable: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not reconcile duplicates" }, { status: 500 });
  }
}
