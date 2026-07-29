"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "./Toast";

type Account = {
  id: string;
  display_name: string;
  account_type: string;
  currency: string;
  account_number_masked: string | null;
  is_business: boolean;
};
type Connection = {
  id: string;
  provider_name: string;
  status: string;
  consent_expires_at: string | null;
  last_synced_at: string | null;
  bank_accounts: Account[];
};

export default function BankConnections() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [configured, setConfigured] = useState(true);
  const [sandbox, setSandbox] = useState(false);
  const [busy, setBusy] = useState("");
  const { toast } = useToast();

  const auth = async (): Promise<Record<string, string>> => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
  const load = useCallback(async () => {
    const response = await fetch("/api/bank-connections", { headers: await auth() });
    const data = await response.json();
    if (response.ok) {
      setConnections(data.connections);
      setConfigured(data.configured);
      setSandbox(Boolean(data.sandbox));
    } else toast(data.error || "Could not load bank connections", "error");
  }, [toast]);

  useEffect(() => {
    load();
    const result = new URLSearchParams(window.location.search).get("bank");
    if (result === "connected") toast("Bank connected. Classify each account before its transactions enter reports.", "success");
    if (result === "error") toast("Bank connection was not completed", "error");
  }, [load, toast]);

  const connect = async () => {
    setBusy("connect");
    const response = await fetch("/api/bank-connections/connect", { method: "POST", headers: await auth() });
    const data = await response.json();
    setBusy("");
    if (!response.ok) return toast(data.error, "error");
    window.location.assign(data.url);
  };
  const sync = async (id: string) => {
    setBusy(id);
    const response = await fetch(`/api/bank-connections/${id}/sync`, { method: "POST", headers: await auth() });
    const data = await response.json();
    setBusy("");
    if (!response.ok) return toast(data.error, "error");
    toast(`Imported ${data.imported}; auto-categorised ${data.autoCategorized ?? 0}; ${data.needsReview ?? 0} need review; ${data.skipped} already present.`, "success");
    load();
  };
  const classify = async (account: Account, isBusiness: boolean, syncAfterId?: string) => {
    const label = isBusiness ? "Business" : "Personal";
    const prompt = syncAfterId
      ? `Re-run automatic categorisation for ${account.display_name}? Existing synced rows will be recalculated and safe high-confidence matches will be approved.`
      : `Mark ${account.display_name} as ${label}? Existing synced rows will be reclassified, removed from reports, and returned to the review queue.`;
    if (!window.confirm(prompt)) return;
    setBusy(account.id);
    const response = await fetch(`/api/bank-accounts/${account.id}`, {
      method: "PATCH",
      headers: { ...(await auth()), "Content-Type": "application/json" },
      body: JSON.stringify({ isBusiness, applyToExisting: true })
    });
    const data = await response.json();
    setBusy("");
    if (!response.ok) return toast(data.error || "Could not classify account", "error");
    if (syncAfterId) {
      toast(`Reset ${data.updatedTransactions} rows for automatic categorisation. Syncing now…`, "info");
      await sync(syncAfterId);
      return;
    }
    toast(`${account.display_name} marked ${label}; ${data.updatedTransactions} transactions are ready for automatic categorisation.`, "success");
    load();
  };
  const disconnect = async (id: string) => {
    if (!window.confirm("Disconnect this bank? Imported transactions will remain.")) return;
    setBusy(id);
    const response = await fetch(`/api/bank-connections/${id}`, { method: "DELETE", headers: await auth() });
    setBusy("");
    if (!response.ok) return toast("Could not disconnect bank", "error");
    toast("Bank disconnected", "success");
    load();
  };
  const reconcileSandboxDuplicates = async () => {
    setBusy("deduplicate");
    const previewResponse = await fetch("/api/transactions/deduplicate", { headers: await auth() });
    const preview = await previewResponse.json();
    if (!previewResponse.ok) { setBusy(""); return toast(preview.error || "Could not inspect duplicates", "error"); }
    const affected = Number(preview.duplicateRows || 0) + Number(preview.voiceArtifactRows || 0);
    if (!affected) { setBusy(""); return toast("No sandbox reconciliation issues found", "success"); }
    if (!window.confirm(`Found ${preview.duplicateRows} duplicate bank rows and ${preview.voiceArtifactRows} invalid voice-extraction rows. Exclude them from reports? Nothing will be deleted and the action can be restored.`)) { setBusy(""); return; }
    const response = await fetch("/api/transactions/deduplicate", { method: "POST", headers: { ...(await auth()), "Content-Type": "application/json" }, body: JSON.stringify({ action: "exclude", confirmation: "EXCLUDE_SANDBOX_DUPLICATES" }) });
    const data = await response.json();
    setBusy("");
    if (!response.ok) return toast(data.error || "Could not reconcile duplicates", "error");
    toast(`Excluded ${data.excluded} sandbox reconciliation issues from reports.`, "success");
  };
  const restoreSandboxDuplicates = async () => {
    if (!window.confirm("Restore all sandbox rows previously excluded as duplicates?")) return;
    setBusy("restore-duplicates");
    const response = await fetch("/api/transactions/deduplicate", { method: "POST", headers: { ...(await auth()), "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore" }) });
    const data = await response.json();
    setBusy("");
    if (!response.ok) return toast(data.error || "Could not restore duplicates", "error");
    toast(`Restored ${data.restored} sandbox rows.`, "success");
  };

  return <section className="card space-y-4 lg:col-span-2">
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-stone-900">Bank connections</h2>
          {sandbox && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700">TrueLayer sandbox</span>}
        </div>
        <p className="mt-0.5 text-xs muted">New bank transactions stay out of reports until reviewed.</p>
      </div>
      <button onClick={connect} disabled={busy === "connect" || !configured} className="btn btn-accent px-4 py-2 text-sm">{busy === "connect" ? "Opening bank…" : "+ Connect bank"}</button>
    </div>
    {!configured && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">TrueLayer sandbox credentials have not been configured on the server. See <code>.env.local.example</code>.</div>}
    {configured && !connections.length && <p className="text-sm muted">No bank accounts connected yet.</p>}
    {connections.map((connection) => <div key={connection.id} className="rounded-xl border border-stone-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><p className="font-medium text-stone-900">{connection.provider_name}</p><span className={`rounded-full px-2 py-0.5 text-xs ${connection.status === "active" ? "bg-teal-50 text-teal-700" : "bg-amber-50 text-amber-700"}`}>{connection.status}</span></div>
          <div className="mt-3 space-y-2">
            {connection.bank_accounts.map((account) => <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-stone-50 p-3">
              <div><p className="text-sm font-medium text-stone-800">{account.display_name} {account.account_number_masked}</p><p className="text-xs muted">{account.currency} · Account use</p><button type="button" onClick={() => classify(account, account.is_business, connection.id)} className="mt-1 text-xs text-sky-700 underline underline-offset-2">Re-run automatic categorisation</button></div>
              <div className="flex rounded-lg border border-stone-200 bg-white p-1">
                <button type="button" disabled={busy === account.id} onClick={() => classify(account, false)} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${!account.is_business ? "bg-fuchsia-600 text-white" : "text-stone-500 hover:bg-stone-50"}`}>Personal</button>
                <button type="button" disabled={busy === account.id} onClick={() => classify(account, true)} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${account.is_business ? "bg-teal-600 text-white" : "text-stone-500 hover:bg-stone-50"}`}>Business</button>
              </div>
            </div>)}
          </div>
          <p className="mt-2 text-xs muted">{connection.last_synced_at ? `Last synced ${new Date(connection.last_synced_at).toLocaleString()}` : "Not synced yet"}{connection.consent_expires_at ? ` · Consent expires ${new Date(connection.consent_expires_at).toLocaleDateString()}` : ""}</p>
        </div>
        <div className="flex gap-2"><button onClick={() => sync(connection.id)} disabled={busy === connection.id} className="btn border border-stone-300 px-3 py-1.5 text-sm">{busy === connection.id ? "Syncing…" : "Sync now"}</button><button onClick={() => disconnect(connection.id)} disabled={busy === connection.id} className="btn px-3 py-1.5 text-sm text-red-600">Disconnect</button></div>
      </div>
    </div>)}
    {sandbox && connections.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50 p-3">
      <div><p className="text-sm font-semibold text-violet-800">Sandbox reconciliation</p><p className="text-xs text-violet-700">Find exact bank duplicates and invalid multi-amount voice fragments. Rows are soft-excluded, never deleted.</p></div>
      <div className="flex gap-2"><button onClick={reconcileSandboxDuplicates} disabled={Boolean(busy)} className="btn border border-violet-300 bg-white px-3 py-1.5 text-xs text-violet-700 disabled:opacity-50">{busy === "deduplicate" ? "Checking…" : "Clean sandbox data"}</button><button onClick={restoreSandboxDuplicates} disabled={Boolean(busy)} className="btn px-3 py-1.5 text-xs text-violet-600 disabled:opacity-50">Restore excluded</button></div>
    </div>}
    <p className="text-xs muted">VoiceLedger never receives your bank password. Access can be revoked here or from your bank.</p>
  </section>;
}
