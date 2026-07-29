"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { formatCurrency, summarizeDirectorExpenses, summarizeTransactions, TransactionRecord } from "../../../lib/voiceledger";
import { fetchAllTransactions } from "../../../lib/transactionQueries";

function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = i > 0 ? pts[i - 1] : pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = i < pts.length - 2 ? pts[i + 2] : pts[i + 1];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function calcPct(current: number, prev: number): { pct: number; dir: "up" | "down" } | null {
  if (prev === 0 && current === 0) return null;
  if (prev === 0) return { pct: 100, dir: "up" };
  const change = ((current - prev) / Math.abs(prev)) * 100;
  if (Math.abs(change) < 0.5) return null;
  return { pct: Math.abs(Math.round(change)), dir: change > 0 ? "up" : "down" };
}

export default function DashboardPage() {
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [currency, setCurrency] = useState("GBP");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let mounted = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const load = async () => {
      setLoading(true);
      setLoadError("");
      try {
        const user = (await supabase.auth.getUser()).data.user;
        if (!user) return;
        const refresh = async () => {
          try {
            const [txs, { data: biz, error: businessError }] = await Promise.all([
              fetchAllTransactions(user.id),
              supabase.from("businesses").select("base_currency").eq("owner_id", user.id).order("created_at", { ascending: true }).limit(1).maybeSingle()
            ]);
            if (businessError) throw businessError;
            if (mounted) {
              setTransactions(txs);
              setCurrency(biz?.base_currency ?? "GBP");
              setLoadError("");
            }
          } catch (error) {
            if (mounted) setLoadError(error instanceof Error ? error.message : "The dashboard could not be loaded.");
          }
        };
        await refresh();
        // React Strict Mode mounts, cleans up, and mounts effects again in development.
        // Do not subscribe after an effect instance has already been cleaned up.
        if (!mounted) return;
        channel = supabase
          .channel(`dashboard-transactions-${user.id}-${crypto.randomUUID()}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "transactions", filter: `user_id=eq.${user.id}` }, () => { void refresh(); })
          .subscribe();
      } catch (error) {
        if (mounted) setLoadError(error instanceof Error ? error.message : "The dashboard could not be loaded.");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  const summary = useMemo(() => summarizeTransactions(transactions), [transactions]);
  const directorSummary = useMemo(() => summarizeDirectorExpenses(transactions), [transactions]);

  const chartData = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    return Array.from({ length: now.getMonth() + 1 }, (_, m) => {
      const key = `${year}-${String(m + 1).padStart(2, "0")}`;
      const label = new Date(year, m, 1).toLocaleString(undefined, { month: "short" });
      const monthTxs = transactions.filter(tx => (tx.transaction_date || "").slice(0, 7) === key);
      const monthSummary = summarizeTransactions(monthTxs);
      return { key, label, income: monthSummary.totalIncome, expense: monthSummary.deductibleExpenses };
    });
  }, [transactions]);

  const { incomePct, expensePct } = useMemo(() => {
    const now = new Date();
    const monthSummary = (ago: number) => {
      const d = new Date(now);
      d.setMonth(d.getMonth() - ago);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return summarizeTransactions(transactions.filter(tx => (tx.transaction_date || "").slice(0, 7) === key));
    };
    const current = monthSummary(0);
    const previous = monthSummary(1);
    return {
      incomePct: calcPct(current.totalIncome, previous.totalIncome),
      expensePct: calcPct(current.deductibleExpenses, previous.deductibleExpenses),
    };
  }, [transactions]);

  // SVG chart setup
  const W = 800, H = 260;
  const PAD = { left: 68, right: 20, top: 20, bottom: 36 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;
  const maxVal = Math.max(...chartData.flatMap(d => [d.income, d.expense]), 1);
  const niceCeil = Math.ceil(maxVal / 350) * 350 || 350;
  const xOf = (i: number) => PAD.left + (chartData.length > 1 ? (i / (chartData.length - 1)) * cW : cW / 2);
  const yOf = (v: number) => PAD.top + cH - Math.min((v / niceCeil), 1) * cH;
  const incPts = chartData.map((d, i) => ({ x: xOf(i), y: yOf(d.income) }));
  const expPts = chartData.map((d, i) => ({ x: xOf(i), y: yOf(d.expense) }));
  const incLine = smoothPath(incPts);
  const expLine = smoothPath(expPts);
  const incArea = incPts.length > 1 ? `${incLine} L ${incPts.at(-1)!.x.toFixed(1)} ${(PAD.top + cH).toFixed(1)} L ${PAD.left} ${(PAD.top + cH).toFixed(1)} Z` : "";
  const now = new Date();

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-teal-700">VoiceLedger</p>
          <h1 className="text-4xl font-bold text-stone-900" style={{ fontFamily: "Georgia, serif" }}>Dashboard</h1>
          <p className="muted text-sm">Estimated figures for planning purposes. Confirm with your accountant before acting.</p>
        </div>
        <Link href="/transactions" className="btn btn-accent gap-2 px-5 py-2.5 font-semibold shadow-sm">
          + Add transaction
        </Link>
      </div>

      {loading ? (
        <div className="card muted">Loading...</div>
      ) : loadError ? (
        <div className="card border-rose-200 bg-rose-50 text-rose-800">
          <p className="font-semibold">The dashboard could not be loaded</p>
          <p className="mt-1 text-sm">{loadError}</p>
          <button type="button" onClick={() => window.location.reload()} className="btn mt-3 border border-rose-300 bg-white text-rose-700">Try again</button>
        </div>
      ) : (
        <>
          {/* Metric cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MetricCard label="Business revenue" value={formatCurrency(summary.totalIncome, currency)} change={incomePct} positiveIsGood />
            <MetricCard label="Allowable expenses" value={formatCurrency(summary.deductibleExpenses, currency)} change={expensePct} positiveIsGood={false} />
            <MetricCard label="Net profit / loss" value={formatCurrency(summary.netAllowablePosition, currency)} helper="Revenue minus allowable expenses" highlight={summary.netAllowablePosition >= 0 ? "good" : "bad"} />
          </div>

          {/* Action cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="card flex items-center gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100">
                <svg className="h-5 w-5 text-amber-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-stone-900">Uncategorised transactions</h2>
                <p className="mt-0.5 text-sm muted">
                  {summary.uncategorisedCount > 0
                    ? `${summary.uncategorisedCount} transaction${summary.uncategorisedCount !== 1 ? "s" : ""} need a category.`
                    : "All transactions are categorised."}
                </p>
                {summary.uncategorisedCount > 0 && (
                  <Link href="/transactions" className="mt-1 inline-block text-xs text-teal-700 underline underline-offset-2">Review now</Link>
                )}
              </div>
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${summary.uncategorisedCount > 0 ? "bg-amber-500" : "bg-teal-600"}`}>
                {summary.uncategorisedCount}
              </div>
            </div>

            <div className="card flex items-center gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-teal-100">
                <svg className="h-5 w-5 text-teal-700" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-stone-900">Tax deductible expenses</h2>
                <p className="mt-0.5 text-sm muted">Expenses marked as tax deductible. Review with your accountant.</p>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xl font-bold text-teal-700">{formatCurrency(summary.deductibleExpenses, currency)}</div>
                <Link href="/reports" className="text-xs font-medium text-teal-700 hover:underline">Full report →</Link>
              </div>
            </div>
          </div>

          {/* Director paid expenses */}
          {directorSummary.totalPaidPersonally > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-amber-800">Director paid expenses</h2>
                  <p className="mt-0.5 text-xs text-amber-600">Business expenses paid from a personal account. Confirm treatment with your accountant.</p>
                </div>
                <Link href="/reports" className="shrink-0 text-xs font-medium text-amber-700 underline underline-offset-2">Full breakdown</Link>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <div><div className="text-xs text-amber-600">Paid personally</div><div className="mt-1 text-xl font-bold text-amber-800">{formatCurrency(directorSummary.totalPaidPersonally, currency)}</div></div>
                <div><div className="text-xs text-teal-600">Reimbursed</div><div className="mt-1 text-xl font-bold text-teal-700">{formatCurrency(directorSummary.totalReimbursed, currency)}</div></div>
                <div><div className="text-xs text-rose-600">Outstanding</div><div className="mt-1 text-xl font-bold text-rose-600">{formatCurrency(directorSummary.outstanding, currency)}</div></div>
              </div>
            </div>
          )}

          {/* Chart */}
          <div className="card">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-stone-900" style={{ fontFamily: "Georgia, serif" }}>Revenue vs Allowable Expenses</h2>
                <p className="text-sm muted">{now.getFullYear()} · Business transactions only</p>
              </div>
              <span className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs text-stone-500" style={{ background: "#f9f7f3" }}>This year</span>
            </div>

            {chartData.length > 0 ? (
              <>
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 220 }}>
                  {/* Grid lines + Y labels */}
                  {[0, 0.25, 0.5, 0.75, 1].map((p) => {
                    const val = Math.round(niceCeil * p);
                    const y = yOf(val);
                    return (
                      <g key={p}>
                        <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#e8e0d0" strokeWidth={1} />
                        <text x={PAD.left - 8} y={y + 4} textAnchor="end" fontSize={10.5} fill="#a8a29e">
                          £{val.toLocaleString()}
                        </text>
                      </g>
                    );
                  })}
                  {/* Area under income */}
                  {incArea && <path d={incArea} fill="rgba(13,148,136,0.07)" />}
                  {/* Lines */}
                  {incPts.length > 1 && <path d={incLine} fill="none" stroke="#0d9488" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />}
                  {expPts.length > 1 && <path d={expLine} fill="none" stroke="#dc2626" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />}
                  {/* Dots */}
                  {incPts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="#0d9488" stroke="white" strokeWidth={1.5} />)}
                  {expPts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="#dc2626" stroke="white" strokeWidth={1.5} />)}
                  {/* X labels */}
                  {chartData.map((d, i) => (
                    <text key={d.label} x={xOf(i)} y={H - 6} textAnchor="middle" fontSize={10.5} fill="#a8a29e">{d.label}</text>
                  ))}
                </svg>
                <div className="mt-3 flex gap-5 text-xs muted">
                  <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-teal-600" /> Revenue</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-red-600" /> Allowable expenses</span>
                </div>
              </>
            ) : (
              <p className="py-8 text-center muted text-sm">No transactions recorded this year yet.</p>
            )}
          </div>

          {/* Recent transactions */}
          <div className="card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-stone-900" style={{ fontFamily: "Georgia, serif" }}>Recent transactions</h2>
              <Link href="/transactions" className="text-sm font-medium text-teal-700 hover:underline">View all →</Link>
            </div>
            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {transactions.slice(0, 8).map((tx) => {
                const initial = (tx.description || tx.merchant || "?").trim()[0].toUpperCase();
                const isIncome = tx.type === "income";
                return (
                  <div key={tx.id} className="flex items-center gap-4 py-3.5">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${isIncome ? "bg-teal-100 text-teal-700" : "bg-rose-100 text-rose-600"}`}>
                      {initial}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-stone-900">{tx.description || tx.merchant || "Untitled"}</div>
                      <div className="flex items-center gap-2 text-xs muted">
                        <span>{tx.transaction_date} · {tx.category || "Uncategorised"}</span>
                        <span className={`rounded-full px-2 py-0.5 font-medium ${tx.is_business !== false ? "bg-teal-50 text-teal-700" : "bg-fuchsia-50 text-fuchsia-700"}`}>
                          {tx.is_business !== false ? "Business" : "Personal"}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`font-semibold ${isIncome ? "text-teal-700" : "text-stone-800"}`}>
                        {isIncome ? "+" : ""}{formatCurrency(Number(tx.amount ?? 0), tx.currency ?? currency)}
                      </span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${isIncome ? "bg-teal-50 text-teal-700" : "bg-rose-50 text-rose-600"}`}>
                        {isIncome ? "Income" : "Expense"}
                      </span>
                    </div>
                  </div>
                );
              })}
              {!transactions.length && (
                <p className="py-6 text-center muted text-sm">No transactions yet. <Link href="/transactions" className="text-teal-700 underline underline-offset-2">Add your first one.</Link></p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value, helper, change, positiveIsGood, highlight }: {
  label: string;
  value: string;
  helper?: string;
  change?: { pct: number; dir: "up" | "down" } | null;
  positiveIsGood?: boolean;
  highlight?: "good" | "bad";
}) {
  const isGoodChange = change && ((change.dir === "up" && positiveIsGood) || (change.dir === "down" && !positiveIsGood));
  const isBadChange = change && ((change.dir === "down" && positiveIsGood) || (change.dir === "up" && !positiveIsGood));
  return (
    <div className="card">
      <div className="text-sm muted">{label}</div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className={`text-2xl font-bold ${highlight === "good" ? "text-teal-700" : highlight === "bad" ? "text-rose-600" : "text-stone-900"}`}>
          {value}
        </div>
        {change && (
          <span className={`mb-0.5 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${isGoodChange ? "bg-emerald-50 text-emerald-700" : isBadChange ? "bg-rose-50 text-rose-600" : "bg-stone-100 text-stone-500"}`}>
            {change.dir === "up" ? "↗" : "↘"} {change.dir === "up" ? "+" : "−"}{change.pct}%
          </span>
        )}
      </div>
      {helper && <div className="mt-1 text-xs muted">{helper}</div>}
    </div>
  );
}
