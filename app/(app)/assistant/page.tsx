"use client";

import { useRef, useState } from "react";

type FactSummary = {
  totalIncome?: number;
  totalExpenses?: number;
  net?: number;
  deductible?: number;
  transactionsCount?: number;
  period?: { start?: string; end?: string };
};

type TxSample = {
  date?: string;
  amount?: number;
  currency?: string;
  type?: string;
  category?: string | null;
  merchant?: string | null;
  description?: string | null;
  tax_deductible?: boolean;
};

const SUGGESTIONS = [
  "What's my net profit this month?",
  "How much have I spent on software?",
  "What are my tax-deductible expenses?",
  "Show me my director loan transactions",
  "What's my total income this year?",
  "Which category did I spend the most on?",
];

function fmt(n: number) {
  return `£${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export default function AssistantPage() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [facts, setFacts] = useState<FactSummary | null>(null);
  const [transactions, setTransactions] = useState<TxSample[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const ask = async (q = question) => {
    if (!q.trim()) return;
    setLoading(true);
    setAnswer(null);
    setFacts(null);
    setTransactions(null);
    setError(null);
    try {
      const { supabase } = await import("../../../lib/supabaseClient");
      const sess = await supabase.auth.getSession();
      const token = sess?.data?.session?.access_token ?? null;
      const res = await fetch("/api/assistant/query", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
      } else {
        const a = data.answer ?? data.llmText ?? null;
        const f = data.facts ?? null;
        const t = (data.transactions as TxSample[]) ?? null;
        setAnswer(a);
        setFacts(f);
        setTransactions(t);
      }
    } catch (_e) {
      setError("Request failed. Please try again.");
    }
    setLoading(false);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ask(); }
  };

  const pickSuggestion = (s: string) => {
    setQuestion(s);
    textareaRef.current?.focus();
  };

  const isLoanQuestion = question.toLowerCase().includes("loan");

  return (
    <div className="mx-auto max-w-2xl space-y-6">

      {/* Header */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-teal-700">AI Assistant</p>
        <h1 className="text-4xl font-bold text-stone-900" style={{ fontFamily: "Georgia, serif" }}>Ask AI</h1>
        <p className="muted text-sm">Ask questions about your transactions, expenses, or tax position in plain English.</p>
      </div>

      {/* Input card */}
      <div className="card space-y-3">
        <textarea
          ref={textareaRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKey}
          rows={3}
          placeholder={"e.g. \"How much have I spent on software this year?\" or \"What’s my net profit?\"" }
          className="w-full resize-none rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-900 placeholder-stone-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-colors"
        />

        {/* Suggestion pills */}
        {!answer && !loading && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => pickSuggestion(s)}
                className="rounded-full border border-stone-200 bg-white px-3 py-1 text-xs text-stone-600 transition-colors hover:border-teal-400 hover:text-teal-700"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs muted">Press <kbd className="rounded border border-stone-200 bg-stone-100 px-1.5 py-0.5 font-mono text-[10px]">⌘ Enter</kbd> to send</p>
          <button
            onClick={() => ask()}
            disabled={loading || !question.trim()}
            className="btn btn-accent gap-2 px-6 py-2.5 font-semibold shadow-sm disabled:opacity-50"
          >
            {loading ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Thinking…
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
                Ask
              </>
            )}
          </button>
        </div>
      </div>

      {/* Thinking animation */}
      {loading && (
        <div className="card flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100">
            <svg className="h-5 w-5 text-teal-700" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-stone-900">VoiceLedger is thinking…</p>
            <div className="mt-1.5 flex gap-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-teal-500" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {/* Answer */}
      {answer && !loading && (
        <div className="card space-y-5">
          {/* AI label */}
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-600">
              <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-teal-700">VoiceLedger AI</span>
          </div>

          {/* Answer text */}
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-stone-800">{answer}</div>

          {/* Facts grid */}
          {facts && (
            <div className="grid grid-cols-2 gap-3 border-t pt-4 sm:grid-cols-3" style={{ borderColor: "var(--border)" }}>
              {facts.period?.start && (
                <div className="rounded-xl bg-stone-50 px-3 py-2.5">
                  <div className="text-xs muted">Period</div>
                  <div className="mt-0.5 text-xs font-semibold text-stone-900">{facts.period.start}<br />→ {facts.period.end}</div>
                </div>
              )}
              {typeof facts.transactionsCount === "number" && (
                <div className="rounded-xl bg-stone-50 px-3 py-2.5">
                  <div className="text-xs muted">Transactions</div>
                  <div className="mt-0.5 text-sm font-bold text-stone-900">{facts.transactionsCount}</div>
                </div>
              )}
              {typeof facts.totalIncome === "number" && (
                <div className="rounded-xl bg-stone-50 px-3 py-2.5">
                  <div className="text-xs muted">{isLoanQuestion ? "Loan total" : "Total income"}</div>
                  <div className="mt-0.5 text-sm font-bold text-teal-700">{fmt(facts.totalIncome)}</div>
                </div>
              )}
              {!isLoanQuestion && typeof facts.totalExpenses === "number" && (
                <div className="rounded-xl bg-stone-50 px-3 py-2.5">
                  <div className="text-xs muted">Total expenses</div>
                  <div className="mt-0.5 text-sm font-bold text-rose-600">{fmt(facts.totalExpenses)}</div>
                </div>
              )}
              {!isLoanQuestion && typeof facts.net === "number" && (
                <div className="rounded-xl bg-stone-50 px-3 py-2.5">
                  <div className="text-xs muted">Net profit / loss</div>
                  <div className={`mt-0.5 text-sm font-bold ${facts.net >= 0 ? "text-teal-700" : "text-rose-600"}`}>{fmt(facts.net)}</div>
                </div>
              )}
              {typeof facts.deductible === "number" && (
                <div className="rounded-xl bg-stone-50 px-3 py-2.5">
                  <div className="text-xs muted">Tax deductible</div>
                  <div className="mt-0.5 text-sm font-bold text-stone-900">{fmt(facts.deductible)}</div>
                </div>
              )}
            </div>
          )}

          {/* Transactions table */}
          {transactions && transactions.length > 0 && (
            <div className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-stone-400">
                Matching transactions ({Math.min(transactions.length, 10)} of {transactions.length})
              </p>
              <div className="overflow-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
                <table className="w-full text-sm">
                  <thead style={{ background: "#f9f7f3" }}>
                    <tr className="text-left">
                      {["Date", "Amount", "Type", "Category", "Merchant"].map((h) => (
                        <th key={h} className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-stone-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.slice(0, 10).map((t, i) => (
                      <tr key={i} className="border-t hover:bg-stone-50/50 transition-colors" style={{ borderColor: "var(--border)" }}>
                        <td className="px-3 py-2.5 text-stone-600 whitespace-nowrap">{t.date}</td>
                        <td className="px-3 py-2.5 font-semibold whitespace-nowrap">
                          <span className={t.type === "income" ? "text-teal-700" : "text-rose-600"}>
                            {t.type === "income" ? "+" : "-"}{t.currency === "GBP" ? "£" : (t.currency ?? "")}{t.amount?.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${t.type === "income" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                            {t.type}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-stone-700">{t.category ?? "Uncategorised"}</td>
                        <td className="px-3 py-2.5 text-stone-600">{t.merchant ?? t.description ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Ask follow-up */}
          <div className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <button
              onClick={() => { setAnswer(null); setFacts(null); setTransactions(null); setQuestion(""); textareaRef.current?.focus(); }}
              className="text-xs text-stone-400 underline underline-offset-2 hover:text-teal-700 transition-colors"
            >
              Ask another question
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
