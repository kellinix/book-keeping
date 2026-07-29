"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "../../../components/Toast";
import ReceiptUploader from "../../../components/ReceiptUploader";
import ReceiptScanner, { ReceiptDraft } from "../../../components/ReceiptScanner";
import TransactionForm from "../../../components/TransactionForm";
import UploadParser from "../../../components/UploadParser";
import VoiceRecorder from "../../../components/VoiceRecorder";
import { supabase } from "../../../lib/supabaseClient";
import { computeOutstandingAmount, formatCurrency, PAYMENT_SOURCE_LABELS, REIMBURSEMENT_STATUS_LABELS, TransactionRecord, TransactionSource, VOICELEDGER_CATEGORIES } from "../../../lib/voiceledger";
import { fetchAllTransactions } from "../../../lib/transactionQueries";

type Filters = { category: string; source: string; status: string; type: string; query: string; };
type ReimbursementFormState = { txId: string; originalAmount: number; alreadyReimbursed: number; currency: string; reimbursedAmount: string; reimbursedDate: string; notes: string; };
type EditFormState = { txId: string; description: string; };
type AddTab = "manual" | "receipt" | "voice" | "import";

const INPUT = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500";
const SELECT = "rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500";
const SOURCE_BADGES: Record<TransactionSource, { label: string; className: string }> = {
  bank_connection: { label: "Open Banking Sync", className: "bg-sky-50 text-sky-700" },
  bank_upload: { label: "Bank Statement", className: "bg-violet-50 text-violet-700" },
  manual: { label: "Manual", className: "bg-stone-100 text-stone-700" },
  receipt: { label: "Receipt Upload", className: "bg-amber-50 text-amber-700" },
  voice: { label: "Voice AI", className: "bg-teal-50 text-teal-700" }
};

function IconEdit() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  );
}

function IconDoc() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

export default function TransactionsPage() {
  const { toast } = useToast();
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("Software");
  const [filters, setFilters] = useState<Filters>({ category: "", query: "", source: "", status: "", type: "" });
  const [reimbursementForm, setReimbursementForm] = useState<ReimbursementFormState | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addTab, setAddTab] = useState<AddTab>("manual");
  const [receiptOpenId, setReceiptOpenId] = useState<string | null>(null);
  const [receiptDraft, setReceiptDraft] = useState<ReceiptDraft | null>(null);

  const load = async () => {
    setLoading(true);
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) { setTransactions([]); setLoading(false); return; }
    try {
      const data = await fetchAllTransactions(user.id);
      setTransactions(data);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (filters.type && tx.type !== filters.type) return false;
      if (filters.source && tx.source !== filters.source) return false;
      if (filters.status === "business" && tx.is_business === false) return false;
      if (filters.status === "personal" && tx.is_business !== false) return false;
      if (filters.status === "review" && tx.user_confirmed !== false) return false;
      if (filters.category && (tx.category || "Uncategorised") !== filters.category) return false;
      if (!query) return true;
      return [tx.description, tx.merchant, tx.category, tx.notes, tx.payment_method].some((v) => String(v ?? "").toLowerCase().includes(query));
    });
  }, [filters, transactions]);

  const selectedRows = filtered.filter((tx) => selected.has(tx.id));

  const callTransactionApi = async (id: string, method: "PATCH" | "DELETE", body?: Record<string, unknown>) => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    const response = await fetch(`/api/transactions/${id}`, {
      body: body ? JSON.stringify(body) : undefined,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      method
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error ?? "Transaction update failed");
    }
  };

  const updateTransaction = async (id: string, body: Record<string, unknown>) => {
    try {
      await callTransactionApi(id, "PATCH", body);
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Update failed", "error");
    }
  };

  const deleteTransaction = async (id: string) => {
    try {
      await callTransactionApi(id, "DELETE");
      setSelected((c) => { const n = new Set(c); n.delete(id); return n; });
      setDeleteConfirmId(null);
      toast("Transaction deleted", "success");
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Delete failed", "error");
    }
  };

  const bulkUpdate = async (body: Record<string, unknown>) => {
    if (!selectedRows.length) return;
    await Promise.all(selectedRows.map((tx) => callTransactionApi(tx.id, "PATCH", body)));
    setSelected(new Set());
    await load();
  };

  const openReimbursementForm = (tx: TransactionRecord) => {
    const outstanding = computeOutstandingAmount(tx);
    const alreadyReimbursed = Number(tx.reimbursed_amount ?? 0);
    setReimbursementForm({
      txId: tx.id, originalAmount: Number(tx.amount ?? 0), alreadyReimbursed,
      currency: tx.currency ?? "GBP",
      reimbursedAmount: outstanding > 0 ? String(outstanding.toFixed(2)) : String(Number(tx.amount ?? 0).toFixed(2)),
      reimbursedDate: new Date().toISOString().slice(0, 10), notes: ""
    });
  };

  const submitReimbursement = async () => {
    if (!reimbursementForm) return;
    const { txId, originalAmount, alreadyReimbursed, reimbursedAmount, reimbursedDate, notes } = reimbursementForm;
    const reimbursed = Number(reimbursedAmount);
    if (!reimbursed || reimbursed <= 0) { toast("Please enter a valid reimbursement amount.", "error"); return; }
    const cumulativeReimbursed = alreadyReimbursed + reimbursed;
    const status = cumulativeReimbursed < originalAmount ? "partially_reimbursed" : "reimbursed";
    try {
      await callTransactionApi(txId, "PATCH", { reimbursed_amount: cumulativeReimbursed, reimbursed_date: reimbursedDate, reimbursement_notes: notes || null, reimbursement_status: status, director_reimbursable: true });
      setReimbursementForm(null);
      toast("Reimbursement saved", "success");
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Reimbursement update failed", "error");
    }
  };

  const handleAdded = () => { load(); setAddOpen(false); };
  const categories = Array.from(new Set(transactions.map((tx) => tx.category || "Uncategorised"))).sort();
  const TAB_LABELS: Record<AddTab, string> = { manual: "Manual", receipt: "Receipt", voice: "Voice note", import: "Bank import" };

  return (
    <div className="space-y-5">

      {/* Page header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-bold text-stone-900" style={{ fontFamily: "Georgia, serif" }}>Transactions</h1>
          <p className="mt-1 text-sm muted">Review and categorise records before they flow into reports.</p>
        </div>
        <button onClick={() => setAddOpen(true)} className="btn btn-accent gap-2 px-5 py-2.5 text-sm font-semibold shadow-sm">
          + Add transaction
        </button>
      </div>

      {/* Add transaction modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 py-10 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border bg-white shadow-2xl" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
              <div className="flex gap-1">
                {(["manual", "receipt", "voice", "import"] as AddTab[]).map((tab) => (
                  <button key={tab} onClick={() => setAddTab(tab)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${addTab === tab ? "bg-stone-100 text-stone-900" : "text-stone-500 hover:text-stone-900"}`}>
                    {TAB_LABELS[tab]}
                  </button>
                ))}
              </div>
              <button onClick={() => setAddOpen(false)} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-5">
              {addTab === "manual" && <TransactionForm onSaved={handleAdded} />}
              {addTab === "receipt" && (receiptDraft ? <div className="space-y-4"><button className="text-sm text-teal-700 hover:underline" onClick={() => setReceiptDraft(null)}>← Scan a different receipt</button><TransactionForm initial={{ amount: receiptDraft.total ?? undefined, category: receiptDraft.category, currency: receiptDraft.currency, date: receiptDraft.date, description: receiptDraft.description, merchant: receiptDraft.merchant, taxDeductible: receiptDraft.tax_deductible, uploadId: receiptDraft.uploadId, isBusiness: receiptDraft.is_business, type: receiptDraft.type }} onSaved={() => { setReceiptDraft(null); handleAdded(); }} /></div> : <ReceiptScanner onRead={setReceiptDraft} />)}
              {addTab === "voice" && <VoiceRecorder onSaved={handleAdded} />}
              {addTab === "import" && <UploadParser onImported={handleAdded} />}
            </div>
          </div>
        </div>
      )}

      {/* Reimbursement modal */}
      {reimbursementForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-xl" style={{ borderColor: "var(--border)" }}>
            <h2 className="mb-1 text-lg font-semibold text-stone-900">Mark as reimbursed</h2>
            <p className="mb-5 text-sm muted">Original: {formatCurrency(reimbursementForm.originalAmount, reimbursementForm.currency)}</p>
            <label className="mb-4 block text-sm font-medium text-stone-700">
              Reimbursed amount ({reimbursementForm.currency})
              <input type="number" step="0.01" min="0" value={reimbursementForm.reimbursedAmount} onChange={(e) => setReimbursementForm((f) => f ? { ...f, reimbursedAmount: e.target.value } : f)} className={`${INPUT} mt-1`} />
              {Number(reimbursementForm.reimbursedAmount) > 0 && Number(reimbursementForm.reimbursedAmount) < reimbursementForm.originalAmount && (
                <p className="mt-1 text-xs text-amber-700">Partial — outstanding will be {formatCurrency(reimbursementForm.originalAmount - Number(reimbursementForm.reimbursedAmount), reimbursementForm.currency)}</p>
              )}
            </label>
            <label className="mb-4 block text-sm font-medium text-stone-700">
              Date
              <input type="date" value={reimbursementForm.reimbursedDate} onChange={(e) => setReimbursementForm((f) => f ? { ...f, reimbursedDate: e.target.value } : f)} className={`${INPUT} mt-1`} />
            </label>
            <label className="mb-5 block text-sm font-medium text-stone-700">
              Notes (optional)
              <input value={reimbursementForm.notes} onChange={(e) => setReimbursementForm((f) => f ? { ...f, notes: e.target.value } : f)} placeholder="e.g. Bank transfer ref 12345" className={`${INPUT} mt-1`} />
            </label>
            <div className="flex gap-2">
              <button onClick={submitReimbursement} className="btn btn-accent">Save reimbursement</button>
              <button onClick={() => setReimbursementForm(null)} className="btn border border-stone-300 text-stone-700 hover:bg-stone-50">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit description modal */}
      {editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border bg-white p-6 shadow-xl" style={{ borderColor: "var(--border)" }}>
            <h2 className="mb-4 text-lg font-semibold text-stone-900">Edit description</h2>
            <input autoFocus value={editForm.description}
              onChange={(e) => setEditForm((f) => f ? { ...f, description: e.target.value } : f)}
              onKeyDown={(e) => { if (e.key === "Enter") { updateTransaction(editForm.txId, { description: editForm.description }); setEditForm(null); } if (e.key === "Escape") setEditForm(null); }}
              className={`${INPUT} mb-5`} />
            <div className="flex gap-2">
              <button onClick={() => { updateTransaction(editForm.txId, { description: editForm.description }); setEditForm(null); }} className="btn btn-accent">Save</button>
              <button onClick={() => setEditForm(null)} className="btn border border-stone-300 text-stone-700 hover:bg-stone-50">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt modal */}
      {receiptOpenId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border bg-white p-6 shadow-xl" style={{ borderColor: "var(--border)" }}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-stone-900">Receipts</h2>
              <button onClick={() => setReceiptOpenId(null)} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <ReceiptUploader transactionId={receiptOpenId} onSaved={load} />
          </div>
        </div>
      )}

      {/* Filters */}
      <section className="card">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative lg:col-span-2">
            <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input value={filters.query} onChange={(e) => setFilters((c) => ({ ...c, query: e.target.value }))} placeholder="Search ledger" className={`${INPUT} pl-9`} />
          </div>
          <select value={filters.type} onChange={(e) => setFilters((c) => ({ ...c, type: e.target.value }))} className={SELECT}>
            <option value="">All types</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>
          <select value={filters.source} onChange={(e) => setFilters((c) => ({ ...c, source: e.target.value }))} className={SELECT}>
            <option value="">All sources</option>
            <option value="manual">Manual</option>
            <option value="bank_upload">Bank upload</option>
            <option value="bank_connection">Connected bank</option>
            <option value="voice">Voice</option>
            <option value="receipt">Receipt</option>
          </select>
          <select value={filters.category} onChange={(e) => setFilters((c) => ({ ...c, category: e.target.value }))} className={`${SELECT} lg:col-span-2`}>
            <option value="">All categories</option>
            {categories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </select>
          <select value={filters.status} onChange={(e) => setFilters((c) => ({ ...c, status: e.target.value }))} className={SELECT}>
            <option value="">Business + personal</option>
            <option value="business">Business only</option>
            <option value="personal">Personal only</option>
            <option value="review">Needs review</option>
          </select>
          <div className="flex gap-2 lg:col-span-2">
            <select value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} className={`${SELECT} min-w-0 flex-1`}>
              {VOICELEDGER_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            </select>
            <button onClick={() => bulkUpdate({ category: bulkCategory })} disabled={!selectedRows.length} className="btn border border-stone-300 text-stone-700 hover:bg-stone-50 disabled:opacity-40">Bulk categorise</button>
            <button onClick={() => bulkUpdate({ tax_deductible: true, user_confirmed: true })} disabled={!selectedRows.length} className="btn border border-stone-300 text-stone-700 hover:bg-stone-50 disabled:opacity-40">Mark deductible</button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => bulkUpdate({ is_business: true, user_confirmed: true })} disabled={!selectedRows.length} className="btn border border-teal-200 text-teal-700 hover:bg-teal-50 disabled:opacity-40">Mark business</button>
            <button onClick={() => bulkUpdate({ is_business: false, user_confirmed: true })} disabled={!selectedRows.length} className="btn border border-fuchsia-200 text-fuchsia-700 hover:bg-fuchsia-50 disabled:opacity-40">Mark personal</button>
            <button onClick={() => bulkUpdate({ user_confirmed: true })} disabled={!selectedRows.length} className="btn border border-sky-200 text-sky-700 hover:bg-sky-50 disabled:opacity-40">Confirm</button>
          </div>
        </div>
      </section>

      {/* Ledger */}
      <section className="card overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div>
            <h2 className="font-semibold text-stone-900">Ledger</h2>
            <p className="text-sm muted">{filtered.length} visible · {selectedRows.length} selected</p>
          </div>
          <button onClick={() => setSelected(new Set())} disabled={!selectedRows.length} className="btn border border-stone-300 text-stone-700 hover:bg-stone-50 disabled:opacity-40">Clear selection</button>
        </div>

        {loading ? (
          <div className="p-5 muted">Loading...</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead style={{ background: "#f9f7f3" }}>
                <tr className="text-left">
                  <th className="p-3 pl-5"><input checked={filtered.length > 0 && selectedRows.length === filtered.length} onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((tx) => tx.id)) : new Set())} type="checkbox" /></th>
                  {["Date", "Description", "Type", "Category", "Amount", "Source", "Tax status", "Paid from", "Reimbursement", "Deductible", "Actions"].map((h) => (
                    <th key={h} className="p-3 text-xs font-semibold uppercase tracking-wide text-stone-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((tx) => {
                  const isPersonal = tx.payment_source === "personal_account" || tx.payment_source === "personal_credit_card";
                  const outstanding = computeOutstandingAmount(tx);
                  const canReimburse = isPersonal && tx.type === "expense" && tx.reimbursement_status !== "reimbursed";
                  const statusLabel = tx.reimbursement_status ? REIMBURSEMENT_STATUS_LABELS[tx.reimbursement_status] : null;
                  const paidFromLabel = tx.payment_source ? PAYMENT_SOURCE_LABELS[tx.payment_source] : "—";
                  return (
                    <tr key={tx.id} className={`border-b transition-colors hover:bg-stone-50/50 ${isPersonal ? "bg-amber-50/30" : ""}`} style={{ borderColor: "var(--border)" }}>
                      <td className="p-3 pl-5">
                        <input checked={selected.has(tx.id)} type="checkbox" onChange={(e) => setSelected((c) => {
                          const n = new Set(c);
                          if (e.target.checked) n.add(tx.id); else n.delete(tx.id);
                          return n;
                        })} />
                      </td>
                      <td className="p-3 whitespace-nowrap text-stone-600">{tx.transaction_date}</td>
                      <td className="max-w-[200px] p-3">
                        <div className="font-medium text-stone-900">{tx.description || "Untitled"}</div>
                        {(tx.merchant || tx.notes) && <div className="text-xs muted truncate">{tx.merchant || tx.notes}</div>}
                        {tx.source === "bank_connection" && Number(tx.confidence_score || 0) > 0 && (
                          <span title={tx.ai_explanation || "Automatic category match"} className={`mt-1 inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ${Number(tx.confidence_score) >= 0.92 ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-700"}`}>
                            Auto-category {Math.round(Number(tx.confidence_score) * 100)}%
                          </span>
                        )}
                        {tx.user_confirmed === false && <span className="mt-1 inline-flex rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Needs review · excluded from reports</span>}
                      </td>
                      <td className="p-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tx.type === "income" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                          {tx.type === "income" ? "Income" : "Expense"}
                        </span>
                      </td>
                      <td className="p-3">
                        <select value={tx.category || "Other"} onChange={(e) => updateTransaction(tx.id, { category: e.target.value, user_confirmed: true })}
                          className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs text-stone-800 focus:outline-none focus:border-teal-500">
                          {VOICELEDGER_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                      </td>
                      <td className={`p-3 whitespace-nowrap font-semibold ${tx.type === "income" ? "text-teal-700" : "text-stone-900"}`}>
                        {tx.type === "income" ? "+" : ""}{formatCurrency(Number(tx.amount ?? 0), tx.currency ?? "GBP")}
                      </td>
                      <td className="p-3">
                        {tx.source ? (
                          <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${SOURCE_BADGES[tx.source].className}`}>{SOURCE_BADGES[tx.source].label}</span>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => updateTransaction(tx.id, { is_business: tx.is_business === false, user_confirmed: true })}
                          aria-label={`Mark ${tx.description || "transaction"} as ${tx.is_business !== false ? "personal" : "business"}`}
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${tx.is_business !== false ? "bg-teal-50 text-teal-700 hover:bg-teal-100" : "bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100"}`}
                        >
                          {tx.is_business !== false ? "Business" : "Personal"}
                        </button>
                      </td>
                      <td className="p-3 text-xs text-stone-600">
                        {isPersonal ? (
                          <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Paid personally</span>
                        ) : (
                          <span className="text-stone-500">{paidFromLabel}</span>
                        )}
                      </td>
                      <td className="p-3 text-xs">
                        {isPersonal && tx.type === "expense" ? (
                          <div className="space-y-0.5">
                            <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${tx.reimbursement_status === "reimbursed" ? "bg-teal-50 text-teal-700" : tx.reimbursement_status === "partially_reimbursed" ? "bg-yellow-50 text-yellow-700" : "bg-amber-50 text-amber-700"}`}>
                              {statusLabel ?? "Pending"}
                            </span>
                            {outstanding > 0 && <div className="text-rose-600">Owes {formatCurrency(outstanding, tx.currency ?? "GBP")}</div>}
                          </div>
                        ) : <span className="text-stone-400">—</span>}
                      </td>
                      <td className="p-3">
                        <input checked={tx.is_business !== false && Boolean(tx.tax_deductible)} disabled={tx.is_business === false} onChange={(e) => updateTransaction(tx.id, { tax_deductible: e.target.checked, user_confirmed: true })} type="checkbox"
                          title={tx.is_business === false ? "Personal transactions cannot be allowable expenses" : "Mark as allowable expense"}
                          className="h-4 w-4 rounded border-stone-300 text-teal-600 focus:ring-teal-500 disabled:cursor-not-allowed disabled:opacity-40" />
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1.5">
                          <button onClick={() => setEditForm({ txId: tx.id, description: tx.description || "" })}
                            className="inline-flex items-center gap-1 rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs text-stone-700 transition-colors hover:bg-stone-50">
                            <IconEdit /> Edit
                          </button>
                          {canReimburse && (
                            <button onClick={() => openReimbursementForm(tx)}
                              className="inline-flex items-center gap-1 rounded-lg border border-amber-300 px-2.5 py-1.5 text-xs text-amber-700 transition-colors hover:bg-amber-50">
                              {tx.reimbursement_status === "partially_reimbursed" ? "Update" : "Reimburse"}
                            </button>
                          )}
                          {deleteConfirmId === tx.id ? (
                            <div className="flex gap-1">
                              <button onClick={() => deleteTransaction(tx.id)} className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700 hover:bg-rose-100">
                                <IconTrash /> Confirm
                              </button>
                              <button onClick={() => setDeleteConfirmId(null)} className="inline-flex items-center rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs text-stone-700 hover:bg-stone-50">Cancel</button>
                            </div>
                          ) : (
                            <button onClick={() => setDeleteConfirmId(tx.id)} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs text-rose-600 transition-colors hover:bg-rose-50">
                              <IconTrash /> Delete
                            </button>
                          )}
                          <button onClick={() => setReceiptOpenId(receiptOpenId === tx.id ? null : tx.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs text-stone-700 transition-colors hover:bg-stone-50">
                            <IconDoc /> Receipt
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!filtered.length && (
                  <tr><td className="p-5 muted" colSpan={12}>No transactions match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
