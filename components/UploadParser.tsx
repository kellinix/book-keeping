"use client";

import { useEffect, useState } from "react";
import { useToast } from "./Toast";

type Preview = { rows: any[]; fields: string[]; upload?: { id?: string; key?: string } | null } | null;

type AccountType = "business_account" | "personal_account" | "business_credit_card" | "personal_credit_card";
type LinkedAccount = { id: string; display_name: string; currency: string; account_number_masked: string | null };

const ACCOUNT_TYPE_OPTIONS: { value: AccountType; label: string; warning?: string }[] = [
  { value: "business_account", label: "Business bank account" },
  { value: "personal_account", label: "Personal bank account used for business expenses", warning: "personal" },
  { value: "business_credit_card", label: "Business credit card" },
  { value: "personal_credit_card", label: "Personal credit card used for business expenses", warning: "personal" }
];

function inferFieldMapping(fLower: string): string {
  if (fLower.includes('date')) return 'Date';
  if (fLower.includes('desc') || fLower.includes('narr')) return 'Description';
  if (fLower === 'name' || fLower.includes('merchant') || fLower.includes('payee')) return 'Merchant';
  if (fLower.includes('local amount') || fLower.includes('balance')) return '';
  if (fLower.includes('local currency')) return '';
  // Use word-boundary regex to avoid matching 'creditor', 'accredited', etc.
  if (/\bcredit\b/.test(fLower) || fLower.includes('money in')) return 'Money In';
  if (/\bdebit\b/.test(fLower) || fLower.includes('money out')) return 'Money Out';
  if (fLower === 'amount') return 'Amount';
  if (fLower === 'currency') return 'Currency';
  return '';
}

const TARGET_FIELDS = [
  { value: '', label: 'Ignore' },
  { value: 'Date', label: 'Date' },
  { value: 'Description', label: 'Description' },
  { value: 'Merchant', label: 'Merchant' },
  { value: 'Money In', label: 'Money In' },
  { value: 'Money Out', label: 'Money Out' },
  { value: 'Amount', label: 'Amount' },
  { value: 'Currency', label: 'Currency' },
  { value: 'Reference', label: 'Reference' }
];

export default function UploadParser({ onImported }: { onImported?: () => void }) {
  const { toast } = useToast();
  const [preview, setPreview] = useState<Preview>(null);
  const [, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [accountType, setAccountType] = useState<AccountType>("business_account");
  const [isBusiness, setIsBusiness] = useState(true);
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccount[]>([]);
  const [bankAccountId, setBankAccountId] = useState("");

  useEffect(() => {
    import("../lib/supabaseClient").then(({ supabase }) => supabase.from("bank_accounts").select("id,display_name,currency,account_number_masked").order("display_name")).then(({ data }) => setLinkedAccounts((data ?? []) as LinkedAccount[]));
  }, []);

  const handleFile = (f: File | null) => {
    setFile(f);
    setPreview(null);
    setMapping({});
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) { toast("File must be 25 MB or smaller", "error"); return; }
    const fd = new FormData();
    fd.append("file", f);
    setLoading(true);
    import('../lib/supabaseClient')
      .then(async ({ supabase }) => {
        const sess = await supabase.auth.getSession();
        const token = sess?.data?.session?.access_token ?? null;
        return fetch("/api/uploads/preview", { method: "POST", body: fd, headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        const fields = data.fields ?? [];
        setPreview({ rows: data.rows ?? [], fields, upload: data.upload ?? null });
        const m: Record<string, string> = {};
        for (const fName of fields) m[fName] = inferFieldMapping(fName.toLowerCase().trim());
        setMapping(m);
      })
      .catch((e) => toast(e instanceof Error ? e.message : "Could not preview file", "error"))
      .finally(() => setLoading(false));
  };

  const handleImport = async () => {
    if (!preview) return;
    setLoading(true);

    // Build mapped rows according to user mapping
    const mappedRows = preview.rows.map((r) => {
      const out: Record<string, any> = {};
      for (const key of preview.fields) {
        const target = mapping[key] ?? '';
        if (!target) continue;
        out[target] = r[key];
      }
      return out;
    });

    // Get access token for server-side validation
    let token: string | null = null;
    try {
      const { supabase } = await import('../lib/supabaseClient');
      const sess = await supabase.auth.getSession();
      token = sess?.data?.session?.access_token ?? null;
    } catch (e) {
      token = null;
    }

    const res = await fetch("/api/uploads/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ rows: mappedRows, accountType, bankAccountId: bankAccountId || null, isBusiness })
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      toast("Import failed: " + (data?.error || res.statusText), "error");
      return;
    }
    toast(`Imported ${data.imported} rows${data.skippedDuplicates ? `, skipped ${data.skippedDuplicates} duplicate rows` : ""}${data.directorExpenses ? `, ${data.directorExpenses} marked as director paid` : ""}`, "success");
    setPreview(null);
    setFile(null);
    setMapping({});
    if (onImported) onImported();
  };

  const autoMap = () => {
    if (!preview) return;
    const m: Record<string, string> = {};
    for (const fName of preview.fields) m[fName] = inferFieldMapping(fName.toLowerCase().trim());
    setMapping(m);
  };

  const isPersonalAccount = accountType === "personal_account" || accountType === "personal_credit_card";

  return (
    <div className="card">
      <div className="mb-3">
        <h2 className="text-lg font-semibold">Bank statement import</h2>
        <p className="text-sm muted">CSV and XLSX up to 25 MB are supported. Preview and map columns before importing.</p>
      </div>

      {linkedAccounts.length > 0 && (
        <label className="mb-3 block text-sm font-medium">
          Match to a linked account (optional)
          <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900">
            <option value="">No linked account</option>
            {linkedAccounts.map((account) => <option key={account.id} value={account.id}>{account.display_name}{account.account_number_masked ? ` ${account.account_number_masked}` : ""} · {account.currency}</option>)}
          </select>
        </label>
      )}

      <div className="mb-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
        <div className="text-sm font-medium text-stone-800">Transaction use</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setIsBusiness(true)} className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${isBusiness ? "bg-teal-600 text-white" : "bg-white text-stone-600 hover:bg-stone-100"}`}>
            Business
          </button>
          <button type="button" onClick={() => setIsBusiness(false)} className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${!isBusiness ? "bg-fuchsia-600 text-white" : "bg-white text-stone-600 hover:bg-stone-100"}`}>
            Personal
          </button>
        </div>
        <p className="mt-2 text-xs text-stone-500">This status applies to every transaction in this import and can be changed later in the ledger.</p>
      </div>

      <div className="mb-3">
        <label className="block text-sm font-medium mb-1">What account is this statement from?</label>
        <div className="space-y-2">
          {ACCOUNT_TYPE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="accountType"
                value={opt.value}
                checked={accountType === opt.value}
                onChange={() => setAccountType(opt.value)}
                className="mt-0.5"
              />
              <span className="text-sm">{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      {isPersonalAccount && isBusiness && (
        <div className="mb-3 rounded border border-amber-800 bg-amber-950/40 p-3 text-sm text-amber-200">
          <p className="font-medium">Personal account selected</p>
          <p className="mt-1 text-amber-300/80">Imported business expense transactions will be marked as director paid and tracked for reimbursement. Only import transactions that are genuinely business-related. Personal spending should not be recorded as business expenses.</p>
        </div>
      )}

      {!isBusiness && (
        <div className="mb-3 rounded border border-fuchsia-200 bg-fuchsia-50 p-3 text-sm text-fuchsia-700">
          Personal transactions are kept in the ledger but excluded from business reports, allowable expenses, tax estimates, and tax CSV exports.
        </div>
      )}

      <label className="block text-sm mb-2">Upload CSV / XLSX</label>
      <input type="file" accept=".csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
      {loading && <div className="mt-2">Processing...</div>}
      {preview && (
        <div className="mt-3">
          <div className="flex items-center justify-between">
            <div className="text-sm muted">Preview ({preview.rows.length} rows){preview.upload?.key ? " · original file stored" : ""}</div>
            <div className="flex gap-2">
              <button onClick={autoMap} className="px-2 py-1 border rounded text-sm">Auto map</button>
              <button onClick={() => setMapping({})} className="px-2 py-1 border rounded text-sm">Clear mapping</button>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            <div className="text-sm font-medium">Column mapping</div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {preview.fields.map((f) => (
                <div key={f} className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 p-2">
                  <div className="text-sm text-stone-700">{f}</div>
                  <select value={mapping[f] ?? ''} onChange={(e) => setMapping(prev => ({ ...prev, [f]: e.target.value }))} className="ml-2 rounded-lg border border-stone-300 bg-white p-1 text-sm text-stone-800 focus:outline-none focus:border-teal-500">
                    {TARGET_FIELDS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-auto max-h-48 border rounded mt-2">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-stone-100">
                <tr>
                  {preview.fields.map((f) => (
                    <th key={f} className="p-2 text-left">{f}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 10).map((r, i) => (
                  <tr key={i} className="border-t">
                    {preview.fields.map((f) => (
                      <td key={f} className="p-2">{String(r[f] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2">
            <button onClick={handleImport} className="btn btn-accent">
              Import mapped rows
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
