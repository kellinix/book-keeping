"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useToast } from "../../../components/Toast";
import { computeOutstandingAmount, isBalanceSheetCategory, isRefundCategory, PAYMENT_SOURCE_LABELS, REIMBURSEMENT_STATUS_LABELS, summarizeDirectorExpenses, summarizeTransactions } from "../../../lib/voiceledger";
import { estimateIncomeTax, IT_BANDS } from "../../../lib/income-tax-bands";

function fmtCurrency(amount: number, currency = "GBP") {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount); }
  catch { return `${currency} ${amount.toFixed(2)}`; }
}

const CAT_COLORS = ["#0d9488", "#92400e", "#7c3aed", "#0369a1", "#d97706", "#dc2626"];

function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const { toast } = useToast();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [business, setBusiness] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) { setLoading(false); return; }

      const { data: biz } = await supabase.from("businesses").select("*").eq("owner_id", user.id).maybeSingle();
      let currentBiz = biz;
      if (!currentBiz) {
        const { data: inserted } = await supabase.from("businesses").insert({ owner_id: user.id, name: `${user.email ?? "My"} Business`, base_currency: "GBP", corporation_tax_rate: 25 }).select().single();
        currentBiz = inserted;
      }
      if (!mounted) return;
      setBusiness(currentBiz);

      const { data: txs } = await supabase.from("transactions").select("*").eq("user_id", user.id);
      if (!mounted) return;
      setTransactions(txs ?? []);
      setLoading(false);
    };
    load();
    return () => { mounted = false; };
  }, []);

  const summary = useMemo(() => summarizeTransactions(transactions), [transactions]);
  const directorSummary = useMemo(() => summarizeDirectorExpenses(transactions), [transactions]);
  const directorTransactions = useMemo(() =>
    transactions.filter(t => t.type === "expense" && (t.payment_source === "personal_account" || t.payment_source === "personal_credit_card"))
      .sort((a, b) => (b.transaction_date ?? "").localeCompare(a.transaction_date ?? "")),
    [transactions]
  );

  // Last 12 months bar chart data
  const monthly = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - (11 - i));
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = `${d.toLocaleString(undefined, { month: "short" })} '${String(d.getFullYear()).slice(2)}`;
      const mTxs = transactions.filter(tx => {
        const raw = tx.transaction_date || tx.created_at;
        if (!raw) return false;
        const td = new Date(raw);
        return !isNaN(td.getTime()) && `${td.getFullYear()}-${String(td.getMonth() + 1).padStart(2, "0")}` === key;
      });
      let income = 0, expense = 0;
      for (const t of mTxs) {
        if (isBalanceSheetCategory(t.category)) continue;
        if (t.type === "income" && isRefundCategory(t.category)) expense = Math.max(0, expense - Number(t.amount || 0));
        else if (t.type === "income") income += Number(t.amount || 0);
        else expense += Number(t.amount || 0);
      }
      return { key, label, income, expense };
    });
  }, [transactions]);

  const topCategories = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of transactions) {
      if (t.type !== "expense" || isBalanceSheetCategory(t.category)) continue;
      const cat = t.category || "Uncategorised";
      map[cat] = (map[cat] || 0) + Number(t.amount || 0);
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [transactions]);

  const corpRate = Number(business?.corporation_tax_rate ?? 25);
  const isSoleTrader = business?.business_type === "sole_trader" || business?.business_type === "freelancer";
  const estimatedTax = isSoleTrader
    ? estimateIncomeTax(Math.max(0, summary.estimatedProfit))
    : Math.max(0, summary.estimatedProfit) * (corpRate / 100);
  const baseCurrency = business?.base_currency ?? "GBP";

  // Chart dimensions
  const W = 660, H = 240;
  const PAD = { left: 58, right: 10, top: 15, bottom: 48 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;
  const maxVal = Math.max(...monthly.flatMap(m => [m.income, m.expense]), 1);
  const niceCeil = Math.ceil(maxVal / 350) * 350 || 350;
  const yOf = (v: number) => PAD.top + cH - Math.min(v / niceCeil, 1) * cH;
  const mW = cW / 12;
  const bW = mW * 0.28;
  const xOf = (i: number) => PAD.left + i * mW + mW / 2;

  const exportCSV = () => {
    if (!transactions.length) { toast("No transactions to export", "info"); return; }
    const headers = ["id", "transaction_date", "description", "merchant", "amount", "currency", "type", "category", "payment_source", "source", "notes", "tax_deductible", "reimbursement_status", "reimbursed_amount"];
    const rows = transactions.map(t => headers.map(h => { const v = t[h]; if (v == null) return ""; return `"${String(v).replace(/"/g, '""')}"`;  }).join(","));
    downloadCSV([headers.join(","), ...rows].join("\n"), "transactions.csv");
    toast("CSV downloaded", "success");
  };

  const exportDirectorCSV = () => {
    if (!directorTransactions.length) { toast("No director expenses to export", "info"); return; }
    const headers = ["transaction_date", "merchant", "description", "category", "amount", "currency", "payment_source", "reimbursement_status", "reimbursed_amount", "outstanding_amount"];
    const rows = directorTransactions.map(t => {
      const outstanding = computeOutstandingAmount(t);
      return headers.map(h => {
        if (h === "outstanding_amount") return `"${outstanding.toFixed(2)}"`;
        const v = t[h]; if (v == null) return ""; return `"${String(v).replace(/"/g, '""')}"`;
      }).join(",");
    });
    downloadCSV([headers.join(","), ...rows].join("\n"), "director-expenses.csv");
    toast("Director CSV downloaded", "success");
  };

  const topCatTotal = topCategories.reduce((s, [, v]) => s + v, 0) || 1;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-stone-900" style={{ fontFamily: "Georgia, serif" }}>Reports</h1>
          <p className="muted text-sm">Detailed breakdown for review with your accountant.</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button className="flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 shadow-sm hover:bg-stone-50 transition-colors" style={{ borderColor: "var(--border)" }}>
            This tax year
            <svg className="h-4 w-4 text-stone-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          <button onClick={exportCSV} className="btn btn-accent gap-2 px-5 py-2.5 font-semibold shadow-sm">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {loading ? <div className="muted">Loading...</div> : (
        <div className="space-y-6">

          {/* Summary metrics */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="card">
              <div className="text-sm muted">Total income</div>
              <div className="mt-2 text-2xl font-bold text-teal-700">{fmtCurrency(summary.totalIncome, baseCurrency)}</div>
            </div>
            <div className="card">
              <div className="text-sm muted">Total expenses</div>
              <div className="mt-2 text-2xl font-bold text-rose-600">{fmtCurrency(summary.totalExpenses, baseCurrency)}</div>
            </div>
            <div className="card">
              <div className="text-sm muted">Net profit / loss</div>
              <div className={`mt-2 text-2xl font-bold ${summary.estimatedProfit >= 0 ? "text-teal-700" : "text-rose-600"}`}>{fmtCurrency(summary.estimatedProfit, baseCurrency)}</div>
            </div>
            <div className="card">
              <div className="text-sm muted">Tax deductible</div>
              <div className="mt-2 text-2xl font-bold text-stone-900">{fmtCurrency(summary.deductibleExpenses, baseCurrency)}</div>
            </div>
          </div>

          {/* Tax estimate card — income tax (banded) for sole traders, corp tax for ltd */}
          <div className="card flex items-start justify-between gap-6">
            <div>
              {isSoleTrader ? (
                <div className="text-sm muted">
                  Estimated income tax{" "}
                  <span className="font-semibold">(PA £{IT_BANDS.personalAllowance.toLocaleString()} / 20% / 40% / 45%)</span>
                </div>
              ) : (
                <div className="text-sm muted">
                  Estimated corporation tax <span className="font-semibold">({corpRate}%)</span>
                </div>
              )}
              <div className="mt-2 text-4xl font-bold text-stone-900">{fmtCurrency(estimatedTax, baseCurrency)}</div>
            </div>
            <div className="flex shrink-0 items-start gap-2 text-right">
              <svg className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
              <p className="max-w-[240px] text-xs muted leading-relaxed">
                {isSoleTrader
                  ? "Planning estimate only. Excludes Class 2/4 National Insurance. Not tax or legal advice. Confirm with a qualified accountant or "
                  : "Planning estimate only. Not tax or legal advice. Confirm with a qualified accountant or "}
                <a
                  href={isSoleTrader
                    ? "https://www.gov.uk/guidance/use-making-tax-digital-for-income-tax"
                    : "https://www.gov.uk/corporation-tax"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-teal-700 underline underline-offset-2"
                >
                  HMRC guidance
                </a>.
              </p>
            </div>
          </div>

          {/* Chart + Categories */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="card lg:col-span-2">
              <div className="mb-5">
                <h2 className="font-bold text-stone-900" style={{ fontFamily: "Georgia, serif" }}>Monthly income vs expenses</h2>
                <p className="text-sm muted">Last 12 months</p>
              </div>
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 200 }}>
                {[0, 0.25, 0.5, 0.75, 1].map((p) => {
                  const val = Math.round(niceCeil * p);
                  const y = yOf(val);
                  return (
                    <g key={p}>
                      <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#e8e0d0" strokeWidth={1} strokeDasharray={p === 0 ? "none" : "3 3"} />
                      <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize={9.5} fill="#a8a29e">£{val.toLocaleString()}</text>
                    </g>
                  );
                })}
                {monthly.map((m, i) => {
                  const cx = xOf(i);
                  const baseY = PAD.top + cH;
                  const incH = (m.income / niceCeil) * cH;
                  const expH = (m.expense / niceCeil) * cH;
                  return (
                    <g key={m.key}>
                      {m.income > 0 && <rect x={cx - bW - 1} y={baseY - incH} width={bW} height={incH} fill="#0d9488" opacity={0.85} rx={2} />}
                      {m.expense > 0 && <rect x={cx + 1} y={baseY - expH} width={bW} height={expH} fill="#fca5a5" rx={2} />}
                    </g>
                  );
                })}
                {monthly.map((m, i) => (
                  <text key={m.key} x={xOf(i)} y={H - 6} textAnchor="middle" fontSize={8.5} fill="#a8a29e">{m.label}</text>
                ))}
              </svg>
              <div className="mt-3 flex gap-5 text-xs muted">
                <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-teal-600" /> Income</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-rose-300" /> Expenses</span>
              </div>
            </div>

            <div className="card flex flex-col gap-5">
              <div>
                <h2 className="font-bold text-stone-900" style={{ fontFamily: "Georgia, serif" }}>Top expense categories</h2>
                {topCategories.length ? (
                  <div className="mt-4 space-y-4">
                    {topCategories.map(([cat, amt], idx) => {
                      const color = CAT_COLORS[idx % CAT_COLORS.length];
                      const pct = Math.round((amt / topCatTotal) * 100);
                      return (
                        <div key={cat}>
                          <div className="mb-1.5 flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2 font-medium text-stone-800">
                              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
                              {cat}
                            </span>
                            <span className="text-stone-600">{fmtCurrency(amt, baseCurrency)} <span className="muted text-xs">{pct}%</span></span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-stone-100">
                            <div className="h-1.5 rounded-full" style={{ width: `${Math.max(3, pct)}%`, background: color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="mt-3 text-sm muted">No expense categories yet.</p>}
              </div>

              {/* Summary */}
              <div className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
                <p className="mb-3 text-xs font-bold uppercase tracking-wider text-stone-400">Summary</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="muted">Total expenses</span>
                    <span className="font-semibold text-stone-900">{fmtCurrency(summary.totalExpenses, baseCurrency)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="muted">Deductible</span>
                    <span className="font-semibold text-teal-700">{fmtCurrency(summary.deductibleExpenses, baseCurrency)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Director / Owner Paid Business Expenses */}
          <div className="rounded-xl border border-amber-100 p-5" style={{ background: "#fffbeb" }}>
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
                <svg className="h-4 w-4 text-amber-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-bold text-amber-800">Director / Owner Paid Business Expenses</h2>
                  {directorTransactions.length > 0 && (
                    <button onClick={exportDirectorCSV} className="shrink-0 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50 transition-colors">Export CSV</button>
                  )}
                </div>
                <p className="text-sm text-amber-700">Business expenses paid from personal accounts. Confirm accounting treatment with your accountant.</p>
              </div>
            </div>

            <div className="mb-4 grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-stone-100 bg-white p-4 shadow-sm">
                <div className="text-xs font-medium text-stone-500">Paid personally</div>
                <div className="mt-2 text-2xl font-bold text-stone-900">{fmtCurrency(directorSummary.totalPaidPersonally, baseCurrency)}</div>
              </div>
              <div className="rounded-xl border border-stone-100 bg-white p-4 shadow-sm">
                <div className="text-xs font-medium text-teal-600">Reimbursed</div>
                <div className="mt-2 text-2xl font-bold text-stone-900">{fmtCurrency(directorSummary.totalReimbursed, baseCurrency)}</div>
              </div>
              <div className="rounded-xl border border-stone-100 bg-white p-4 shadow-sm">
                <div className="text-xs font-medium text-rose-600">Outstanding</div>
                <div className="mt-2 text-2xl font-bold text-stone-900">{fmtCurrency(directorSummary.outstanding, baseCurrency)}</div>
              </div>
            </div>

            {directorTransactions.length > 0 ? (
              <div className="overflow-auto rounded-xl border border-amber-100 bg-white">
                <table className="w-full text-sm">
                  <thead style={{ background: "#fffbeb" }}>
                    <tr className="text-left">
                      {["Date", "Merchant", "Description", "Category", "Amount", "Source", "Status", "Outstanding"].map(h => (
                        <th key={h} className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-amber-700">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {directorTransactions.map(t => {
                      const outstanding = computeOutstandingAmount(t);
                      const statusLabel = REIMBURSEMENT_STATUS_LABELS[t.reimbursement_status as keyof typeof REIMBURSEMENT_STATUS_LABELS] ?? t.reimbursement_status;
                      const sourceLabel = PAYMENT_SOURCE_LABELS[t.payment_source as keyof typeof PAYMENT_SOURCE_LABELS] ?? t.payment_source;
                      return (
                        <tr key={t.id} className="border-t border-amber-50">
                          <td className="px-3 py-2.5 whitespace-nowrap text-stone-700">{t.transaction_date}</td>
                          <td className="px-3 py-2.5 text-stone-700">{t.merchant || "—"}</td>
                          <td className="max-w-[160px] truncate px-3 py-2.5 text-stone-700">{t.description}</td>
                          <td className="px-3 py-2.5 text-stone-700">{t.category || "Other"}</td>
                          <td className="px-3 py-2.5 text-right font-semibold text-rose-600 whitespace-nowrap">{fmtCurrency(Number(t.amount ?? 0), t.currency ?? baseCurrency)}</td>
                          <td className="px-3 py-2.5 text-stone-500 text-xs">{sourceLabel}</td>
                          <td className="px-3 py-2.5">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${t.reimbursement_status === "reimbursed" ? "bg-teal-50 text-teal-700" : t.reimbursement_status === "partially_reimbursed" ? "bg-yellow-50 text-yellow-700" : "bg-amber-50 text-amber-700"}`}>
                              {statusLabel}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold whitespace-nowrap text-stone-900">{outstanding > 0 ? fmtCurrency(outstanding, t.currency ?? baseCurrency) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-stone-600">No director paid expenses recorded yet. Record the payment source as "Personal bank account" or "Personal credit card" to track these here.</p>
            )}

            <p className="mt-3 text-xs text-amber-600">Only expenses incurred wholly and exclusively for business purposes should be recorded as business expenses. VoiceLedger does not provide tax, legal, or accounting advice.</p>
          </div>

        </div>
      )}
    </div>
  );
}
