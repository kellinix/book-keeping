"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "./Toast";
import { isPersonalPaymentSource, PAID_BY_LABELS, PAYMENT_SOURCE_LABELS, PaidBy, PaymentSource, VOICELEDGER_CATEGORIES } from "../lib/voiceledger";

type Props = {
  onSaved?: () => void;
  initial?: Partial<{ amount: number; category: string; currency: string; date: string; description: string; merchant: string; taxDeductible: boolean; uploadId: string; isBusiness: boolean; type: "expense" | "income" }>;
};

type AccountOption = { id: string; display_name: string; currency: string; account_number_masked: string | null };

export default function TransactionForm({ onSaved, initial }: Props) {
  const { toast } = useToast();
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : "");
  const [category, setCategory] = useState(initial?.category ?? "Other");
  const [currency, setCurrency] = useState(initial?.currency ?? "GBP");
  const [date, setDate] = useState<string>(initial?.date || new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState(initial?.description ?? "");
  const [merchant, setMerchant] = useState(initial?.merchant ?? "");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [isBusiness, setIsBusiness] = useState(initial?.isBusiness ?? true);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [bankAccountId, setBankAccountId] = useState("");
  const [taxDeductible, setTaxDeductible] = useState(initial?.taxDeductible ?? false);
  const [type, setType] = useState<"expense" | "income">(initial?.type ?? "expense");
  const [paymentSource, setPaymentSource] = useState<PaymentSource>("business_account");
  const [paidBy, setPaidBy] = useState<PaidBy>("company");
  const [directorReimbursable, setDirectorReimbursable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<any>(null);
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    supabase.from("bank_accounts").select("id,display_name,currency,account_number_masked").order("display_name").then(({ data }) => {
      setAccounts((data ?? []) as AccountOption[]);
    });
  }, []);

  const handlePaymentSourceChange = (value: PaymentSource) => {
    setPaymentSource(value);
    if (isPersonalPaymentSource(value) && type === "expense") {
      setPaidBy("director");
      setDirectorReimbursable(true);
    } else if (!isPersonalPaymentSource(value)) {
      setPaidBy("company");
      setDirectorReimbursable(false);
    }
  };

  const handleTypeChange = (value: "expense" | "income") => {
    setType(value);
    if (value === "expense" && isPersonalPaymentSource(paymentSource)) {
      setDirectorReimbursable(true);
    } else if (value === "income") {
      setDirectorReimbursable(false);
    }
  };

  const requestSuggestion = async () => {
    if (!description && !merchant) return;
    setSuggesting(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const res = await fetch("/api/ai/categorize", {
        body: JSON.stringify({ amount: Number(amount), description, merchant }),
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        method: "POST"
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unable to suggest category");
      setSuggestion(data.suggestion);
      setCategory(data.suggestion.category ?? "Other");
      setTaxDeductible(Boolean(data.suggestion.tax_deductible));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      toast(error instanceof Error ? error.message : "Unable to suggest category", "error");
    } finally {
      setSuggesting(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);

    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) {
      setLoading(false);
      toast("Please sign in before saving transactions.", "error");
      return;
    }

    const reimbursementStatus = directorReimbursable && type === "expense" ? "owed_to_director" : "not_applicable";

    const response = await fetch("/api/transactions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ transaction: {
        amount: Number(amount),
        bank_account_id: bankAccountId || null,
        category,
        confidence_score: suggestion?.confidence ?? null,
        currency: currency.toUpperCase(),
        description,
        director_reimbursable: directorReimbursable,
        merchant,
        notes,
        tags,
        is_business: isBusiness,
        paid_by: paidBy,
        payment_source: paymentSource,
        reimbursement_status: reimbursementStatus,
        source: initial?.uploadId ? "receipt" : "manual",
        suggested_by_ai: Boolean(suggestion),
        tax_deductible: taxDeductible,
        transaction_date: date,
        type,
        user_confirmed: true
      } })
    });
    const result = await response.json().catch(() => ({}));
    const saved = result.data?.[0];

    setLoading(false);
    if (!response.ok) {
      toast(result.error || "Could not save transaction", "error");
      return;
    }
    if (!saved?.id) {
      toast("This transaction is already in the ledger.", "error");
      return;
    }

    if (initial?.uploadId && saved?.id) {
      const { error: receiptError } = await supabase.from("receipts").insert({ upload_id: initial.uploadId, transaction_id: saved.id });
      if (receiptError) toast("Transaction saved, but the receipt could not be linked.", "error");
    }

    setAmount("");
    setDescription("");
    setDirectorReimbursable(false);
    setMerchant("");
    setNotes("");
    setTags("");
    setBankAccountId("");
    setPaidBy("company");
    setPaymentSource("business_account");
    setSuggestion(null);
    setTaxDeductible(false);
    onSaved?.();
  };

  const isPaidPersonally = isPersonalPaymentSource(paymentSource) && type === "expense";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Manual transaction</h2>
        <p className="text-sm muted">Review all suggested fields before saving.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          Amount
          <input required value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 focus:outline-none focus:border-teal-500" />
        </label>
        <label className="block text-sm">
          Currency
          <input value={currency} onChange={(e) => setCurrency(e.target.value.slice(0, 3))} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 uppercase focus:outline-none focus:border-teal-500" />
        </label>
      </div>

      <label className="block text-sm">
        Account source
        <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 focus:outline-none focus:border-teal-500">
          <option value="">Custom / unlinked account</option>
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.display_name}{account.account_number_masked ? ` ${account.account_number_masked}` : ""} · {account.currency}</option>)}
        </select>
        <span className="mt-1 block text-xs muted">Selecting a linked account enables cross-source duplicate matching.</span>
      </label>

      <label className="block text-sm">
        Date
        <input required value={date} onChange={(e) => setDate(e.target.value)} type="date" className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 focus:outline-none focus:border-teal-500" />
      </label>

      <label className="block text-sm">
        Merchant or person
        <input value={merchant} onChange={(e) => setMerchant(e.target.value)} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 focus:outline-none focus:border-teal-500" />
      </label>

      <label className="block text-sm">
        Description
        <input required value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 focus:outline-none focus:border-teal-500" />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          Type
          <select value={type} onChange={(e) => handleTypeChange(e.target.value as "expense" | "income")} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 focus:outline-none focus:border-teal-500">
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </label>
        <label className="block text-sm">
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 focus:outline-none focus:border-teal-500">
            {VOICELEDGER_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          Payment source
          <select value={paymentSource} onChange={(e) => handlePaymentSourceChange(e.target.value as PaymentSource)} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 focus:outline-none focus:border-teal-500">
            {(Object.entries(PAYMENT_SOURCE_LABELS) as [PaymentSource, string][]).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Paid by
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value as PaidBy)} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 focus:outline-none focus:border-teal-500">
            {(Object.entries(PAID_BY_LABELS) as [PaidBy, string][]).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          checked={directorReimbursable}
          onChange={(e) => setDirectorReimbursable(e.target.checked)}
          type="checkbox"
        />
        Business expense paid personally
      </label>

      <label className="flex items-center gap-2 rounded-lg border border-stone-200 p-3 text-sm">
        <input checked={isBusiness} onChange={(e) => { setIsBusiness(e.target.checked); if (!e.target.checked) { setTaxDeductible(false); setDirectorReimbursable(false); } }} type="checkbox" />
        <span><strong>Business transaction</strong><span className="block text-xs muted">Turn off for personal tracking; personal items stay out of business tax treatment.</span></span>
      </label>

      {isPaidPersonally && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-medium">Paid personally</p>
          <p className="mt-1 text-amber-700">If you paid for a business cost using your personal account, it will be tracked as an amount the business may owe you. Only expenses incurred wholly and exclusively for business purposes should be recorded as business expenses.</p>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input checked={taxDeductible} onChange={(e) => setTaxDeductible(e.target.checked)} type="checkbox" />
        Suggested tax deductible
      </label>

      <label className="block text-sm">
        Tags
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="travel, client-a, recurring" className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 focus:outline-none focus:border-teal-500" />
      </label>

      <label className="block text-sm">
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 focus:outline-none focus:border-teal-500" />
      </label>

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-accent" disabled={loading}>
          {loading ? "Saving..." : "Save transaction"}
        </button>
        <button type="button" onClick={requestSuggestion} className="btn border border-stone-300 text-stone-700 hover:bg-stone-50" disabled={suggesting || (!description && !merchant)}>
          {suggesting ? "Suggesting..." : "Suggest category"}
        </button>
      </div>

      {suggestion && (
        <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
          <div>
            Suggested category: <strong>{suggestion.category}</strong> ({Math.round((suggestion.confidence ?? 0) * 100)}%)
          </div>
          <div>Suggested tax deductible: {suggestion.tax_deductible ? "Yes" : "No"}</div>
          <p className="mt-1 muted">{suggestion.explanation}</p>
        </div>
      )}

      <p className="text-xs muted">VoiceLedger helps you organise bookkeeping records. It does not provide tax, legal, or accounting advice. Speak to a qualified accountant for final treatment.</p>
    </form>
  );
}
