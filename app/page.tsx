"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

const CREAM = "#f5f0e8";
const CREAM_ALT = "#e8e0d0";
const DARK = "#1c1917";
const MUTED = "#78716c";
const TEAL = "#0d9488";
const TEAL_DARK = "#0a7469";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/dashboard");
    });
  }, [router]);

  return (
    <div style={{ background: CREAM, color: DARK, fontFamily: "system-ui, -apple-system, sans-serif", minHeight: "100vh" }}>

      {/* ── Marketing Navbar ── */}
      <nav style={{ borderBottom: `1px solid ${CREAM_ALT}`, background: CREAM }} className="sticky top-0 z-50">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div style={{ height: 44, width: 180, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <img src="/logo.png" alt="VoiceLedger" style={{ height: 140, width: 140, objectFit: "contain", flexShrink: 0 }} />
          </div>
          <div className="hidden items-center gap-8 md:flex">
            <a href="#how-it-works" className="text-sm hover:opacity-70 transition-opacity" style={{ color: MUTED }}>How it works</a>
            <a href="#features" className="text-sm hover:opacity-70 transition-opacity" style={{ color: MUTED }}>Features</a>
            <a href="#pricing" className="text-sm hover:opacity-70 transition-opacity" style={{ color: MUTED }}>Pricing</a>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/auth/login" className="text-sm font-medium px-4 py-2 rounded-lg border transition-colors hover:opacity-80" style={{ borderColor: CREAM_ALT, color: DARK }}>
              Sign in
            </Link>
            <Link href="/auth/register" className="text-sm font-medium px-4 py-2 rounded-lg text-white transition-opacity hover:opacity-90" style={{ background: TEAL }}>
              Get started free
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="mx-auto max-w-6xl px-6 py-16 lg:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <span className="inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider mb-6" style={{ background: "#d4ede9", color: TEAL_DARK }}>
              For UK small businesses
            </span>
            <h1 className="text-5xl font-serif font-bold leading-tight lg:text-6xl" style={{ color: DARK, fontFamily: "Georgia, 'Times New Roman', serif" }}>
              Your books,<br />
              <span style={{ color: TEAL }}>sorted.</span><br />
              No stress.
            </h1>
            <p className="mt-6 text-lg leading-relaxed" style={{ color: MUTED }}>
              Just speak or upload — VoiceLedger handles the categorising, tax tagging, and reporting. No spreadsheets. No accountant jargon.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/auth/register" className="inline-flex items-center gap-2 rounded-lg px-6 py-3 text-base font-semibold text-white shadow-sm transition-opacity hover:opacity-90" style={{ background: TEAL }}>
                Get started free →
              </Link>
              <a href="#how-it-works" className="inline-flex items-center gap-2 rounded-lg border px-6 py-3 text-base font-medium transition-colors hover:opacity-70" style={{ borderColor: "#c8bfaf", color: DARK }}>
                See how it works
              </a>
            </div>
            <p className="mt-5 text-sm" style={{ color: MUTED }}>
              No credit card needed · Free to try · Cancel anytime
            </p>
          </div>

          {/* App UI mockup */}
          <div className="flex justify-center lg:justify-end">
            <div className="w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden" style={{ background: "#0f1724", border: "1px solid #1e293b" }}>
              <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid #1e293b" }}>
                <span className="w-3 h-3 rounded-full bg-rose-500/70" />
                <span className="w-3 h-3 rounded-full bg-amber-500/70" />
                <span className="w-3 h-3 rounded-full bg-teal-500/70" />
                <span className="ml-2 text-xs text-slate-500">VoiceLedger</span>
              </div>
              <div className="p-6 space-y-4">
                <div className="text-xs text-slate-500 uppercase tracking-wider">Add a transaction</div>
                <div className="flex flex-col items-center py-6 gap-4">
                  <button className="w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105" style={{ background: "linear-gradient(135deg, #0ea5a4, #14b8a6)" }}>
                    <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z"/>
                    </svg>
                  </button>
                  <p className="text-sm text-slate-300 text-center">Tap to record an expense</p>
                  <p className="text-xs text-slate-500 text-center">Say something like:<br /><span className="text-slate-400 italic">"£48 for Adobe Creative Cloud, paid from my personal card"</span></p>
                </div>
                <div className="border-t pt-4 space-y-2" style={{ borderColor: "#1e293b" }}>
                  {[
                    { label: "Adobe CC", cat: "Software", amt: "–£48.00", color: "text-rose-300" },
                    { label: "Client invoice", cat: "Income", amt: "+£1,200.00", color: "text-teal-300" },
                    { label: "Office supplies", cat: "Office", amt: "–£23.50", color: "text-rose-300" },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "#1a2438" }}>
                      <div>
                        <div className="text-xs font-medium text-slate-200">{row.label}</div>
                        <div className="text-xs text-slate-500">{row.cat}</div>
                      </div>
                      <span className={`text-sm font-medium ${row.color}`}>{row.amt}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Social proof bar ── */}
      <section style={{ background: CREAM_ALT }}>
        <div className="mx-auto max-w-6xl px-6 py-8 text-center">
          <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-6">
            <div className="flex gap-1 text-amber-400 text-lg">★★★★★</div>
            <span className="text-base" style={{ color: DARK }}>
              Trusted by sole traders, freelancers, and limited company directors across the UK
            </span>
            <span className="text-sm font-semibold" style={{ color: TEAL }}>4.8 / 5 — from 340+ business owners</span>
          </div>
        </div>
      </section>

      {/* ── Three simple steps ── */}
      <section id="how-it-works" className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-serif font-bold lg:text-4xl" style={{ fontFamily: "Georgia, serif", color: DARK }}>Three simple steps</h2>
          <p className="mt-3 text-lg" style={{ color: MUTED }}>No training needed. No accountant on call.</p>
        </div>
        <div className="grid gap-10 md:grid-cols-3">
          {[
            {
              num: "1",
              title: "Add your transactions",
              desc: "Speak a voice note, upload a bank statement, or type it in manually. VoiceLedger accepts all three.",
              icon: (
                <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" style={{ color: TEAL }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                </svg>
              )
            },
            {
              num: "2",
              title: "We sort everything",
              desc: "AI suggests the category and whether it's tax deductible. You stay in control — approve or adjust with one click.",
              icon: (
                <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" style={{ color: TEAL }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
              )
            },
            {
              num: "3",
              title: "See your numbers",
              desc: "Income, expenses, net profit, and an income tax estimate — all in one place, ready for your accountant or quarterly MTD update.",
              icon: (
                <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" style={{ color: TEAL }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              )
            }
          ].map((step) => (
            <div key={step.num} className="flex flex-col items-start gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white shrink-0" style={{ background: TEAL }}>
                  {step.num}
                </span>
                {step.icon}
              </div>
              <h3 className="text-xl font-semibold" style={{ color: DARK }}>{step.title}</h3>
              <p className="text-base leading-relaxed" style={{ color: MUTED }}>{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features grid ── */}
      <section id="features" style={{ background: CREAM_ALT }}>
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-serif font-bold lg:text-4xl" style={{ fontFamily: "Georgia, serif", color: DARK }}>Everything you need,<br />nothing you don't</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: "🎙️",
                title: "Voice notes",
                desc: "Say what you spent and let AI extract the transaction — amount, merchant, category, date, and whether it was paid from your own pocket."
              },
              {
                icon: "📄",
                title: "Bank statement import",
                desc: "Upload a CSV or XLSX from any UK bank. Columns are auto-mapped, categories suggested, and duplicates skipped."
              },
              {
                icon: "🏷️",
                title: "Smart categorisation",
                desc: "AI suggests a category and tax deductibility for every transaction. You review and approve — nothing is saved without your say-so."
              },
              {
                icon: "📊",
                title: "Reports & tax estimates",
                desc: "Income, expenses, net profit, and an income and expense summary — formatted for a conversation with your accountant or quarterly MTD update."
              },
              {
                icon: "💳",
                title: "Paid from your own pocket?",
                desc: "Track business costs paid from personal accounts. See exactly what the business owes you and mark reimbursements when they happen."
              },
              {
                icon: "🇬🇧",
                title: "Built for the UK",
                desc: "Built for sole traders and freelancers first. Uses UK tax categories, GBP by default, and is being prepared for Making Tax Digital for Income Tax (MTD ITSA)."
              }
            ].map((feat) => (
              <div key={feat.title} className="rounded-xl p-6 shadow-sm" style={{ background: CREAM, border: `1px solid #d6cfbe` }}>
                <div className="text-3xl mb-4">{feat.icon}</div>
                <h3 className="text-lg font-semibold mb-2" style={{ color: DARK }}>{feat.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: MUTED }}>{feat.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-serif font-bold lg:text-4xl" style={{ fontFamily: "Georgia, serif", color: DARK }}>What business owners say</h2>
        </div>
        <div className="grid gap-8 md:grid-cols-2">
          <div className="rounded-xl p-8" style={{ background: CREAM_ALT, border: `1px solid #d6cfbe` }}>
            <div className="flex gap-1 text-amber-400 text-sm mb-4">★★★★★</div>
            <p className="text-base leading-relaxed mb-6" style={{ color: DARK }}>
              "I used to dread doing my books every month. With VoiceLedger, I just tap a button and say what I've spent. It takes minutes, not hours — and I actually know where my money's going now."
            </p>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm" style={{ background: TEAL }}>S</div>
              <div>
                <div className="font-semibold text-sm" style={{ color: DARK }}>Sarah M.</div>
                <div className="text-xs" style={{ color: MUTED }}>Freelance Photographer, Bristol</div>
              </div>
            </div>
          </div>
          <div className="rounded-xl p-8" style={{ background: CREAM_ALT, border: `1px solid #d6cfbe` }}>
            <div className="flex gap-1 text-amber-400 text-sm mb-4">★★★★★</div>
            <p className="text-base leading-relaxed mb-6" style={{ color: DARK }}>
              "The bank import is brilliant. It even catches when I've paid something from my own account and tracks what the business owes me. My accountant said my records have never been cleaner."
            </p>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm" style={{ background: TEAL }}>J</div>
              <div>
                <div className="font-semibold text-sm" style={{ color: DARK }}>James T.</div>
                <div className="text-xs" style={{ color: MUTED }}>Plumbing & Heating, Manchester</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing placeholder ── */}
      <section id="pricing" style={{ background: CREAM_ALT }}>
        <div className="mx-auto max-w-6xl px-6 py-20 text-center">
          <h2 className="text-3xl font-serif font-bold lg:text-4xl mb-4" style={{ fontFamily: "Georgia, serif", color: DARK }}>Simple, honest pricing</h2>
          <p className="text-lg mb-8" style={{ color: MUTED }}>Start free. No credit card needed.</p>
          <div className="inline-block rounded-2xl p-8 shadow-sm text-left" style={{ background: CREAM, border: `1px solid #d6cfbe`, minWidth: "280px" }}>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: TEAL }}>Free plan</div>
            <div className="text-4xl font-bold mb-1" style={{ color: DARK }}>£0</div>
            <div className="text-sm mb-6" style={{ color: MUTED }}>forever, no card required</div>
            <ul className="space-y-2 text-sm mb-8" style={{ color: DARK }}>
              {["Voice notes", "Bank statement import", "Smart categorisation", "Reports & tax estimate", "Director paid expense tracking"].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span style={{ color: TEAL }}>✓</span> {f}
                </li>
              ))}
            </ul>
            <Link href="/auth/register" className="block w-full text-center rounded-lg py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ background: TEAL }}>
              Get started free →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="mx-auto max-w-6xl px-6 py-24 text-center">
        <h2 className="text-4xl font-serif font-bold lg:text-5xl mb-4" style={{ fontFamily: "Georgia, serif", color: DARK }}>
          Stop dreading your<br />bookkeeping
        </h2>
        <p className="text-lg mb-10 max-w-xl mx-auto" style={{ color: MUTED }}>
          Thousands of UK business owners are keeping cleaner books in less time. Join them — it takes 2 minutes to get started.
        </p>
        <Link href="/auth/register" className="inline-flex items-center gap-2 rounded-lg px-8 py-4 text-lg font-semibold text-white shadow-md transition-opacity hover:opacity-90" style={{ background: TEAL }}>
          Get started free →
        </Link>
        <p className="mt-5 text-sm" style={{ color: MUTED }}>
          No credit card · Cancel anytime · UK company, UK support
        </p>
      </section>

      {/* ── Footer ── */}
      <footer style={{ borderTop: `1px solid ${CREAM_ALT}`, background: CREAM }}>
        <div className="mx-auto max-w-6xl px-6 py-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-bold text-lg" style={{ color: DARK }}>VoiceLedger</span>
          <p className="text-xs max-w-lg" style={{ color: MUTED }}>
            Suggested category labels, tax deductibility flags, and financial estimates are for planning purposes only and do not constitute tax, accounting, or legal advice. Always confirm with a qualified accountant or HMRC guidance before acting.
          </p>
          <div className="flex gap-4 text-xs" style={{ color: MUTED }}>
            <Link href="/auth/login" className="hover:opacity-70">Sign in</Link>
            <Link href="/auth/register" className="hover:opacity-70">Register</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
