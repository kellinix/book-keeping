"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

const FEATURES = [
  "Voice & upload expense logging",
  "Auto-categorisation for UK businesses",
  "Tax deductible tracking & estimates",
  "Accountant-ready CSV exports",
];

function CheckIcon() {
  return (
    <svg className="h-5 w-5 shrink-0 text-teal-500" viewBox="0 0 24 24" fill="currentColor">
      <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
    </svg>
  );
}

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setLoading(true);
    setError(null);
    const { error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });
    setLoading(false);
    if (err) { setError(err.message); return; }
    setSuccess(true);
    setTimeout(() => router.push("/dashboard"), 1200);
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
  };

  const INPUT = "w-full rounded-xl border border-stone-200 bg-white px-4 py-3.5 text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors";

  return (
    <div className="flex min-h-screen">
      {/* Left dark panel */}
      <div className="hidden lg:flex lg:w-[55%] flex-col justify-between px-14 py-10" style={{ background: "#161614", color: "#fff" }}>
        <div>
          <div style={{ height: 50, width: 200, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <img src="/logo.png" alt="VoiceLedger" style={{ height: 160, width: 160, objectFit: "contain", flexShrink: 0, filter: "brightness(0) invert(1)" }} />
          </div>
        </div>
        <div className="space-y-8">
          <div>
            <p className="mb-5 text-xs font-semibold uppercase tracking-widest text-teal-500">For UK Small Businesses</p>
            <h1 className="text-5xl leading-tight" style={{ fontFamily: "Georgia, serif" }}>
              Your books,{" "}
              <span style={{ color: "#2dd4bf" }}>sorted.</span>
              <br />
              No stress.
            </h1>
            <p className="mt-5 max-w-sm text-base leading-relaxed" style={{ color: "#9ca3af" }}>
              Just speak or upload — VoiceLedger handles the categorising, the tax estimates, and the tidy ledger your accountant needs.
            </p>
          </div>
          <ul className="space-y-3">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-3 text-sm" style={{ color: "#d1d5db" }}>
                <CheckIcon /> {f}
              </li>
            ))}
          </ul>
        </div>
        <p className="max-w-xs text-sm italic" style={{ color: "#6b7280" }}>
          "Finally, bookkeeping that doesn't feel like punishment."
          <span className="mt-1 block not-italic" style={{ color: "#4b5563" }}>— UK freelancer, 2026</span>
        </p>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12" style={{ background: "#f5f0e8" }}>
        <div className="w-full max-w-md">
          {/* Tab pills */}
          <div className="mb-8 flex items-center rounded-full bg-white p-1 shadow-sm" style={{ border: "1px solid #e8e0d0" }}>
            <span className="flex-1 rounded-full py-2.5 text-center text-sm font-semibold text-white" style={{ background: "#1c1917" }}>
              Create account
            </span>
            <Link href="/auth/login" className="flex-1 rounded-full py-2.5 text-center text-sm font-medium text-stone-500 hover:text-stone-700 transition-colors">
              Sign in
            </Link>
          </div>

          <h2 className="text-3xl font-bold text-stone-900" style={{ fontFamily: "Georgia, serif" }}>Create an account</h2>
          <p className="mt-1.5 text-sm text-stone-500">Start your free account — no credit card needed.</p>

          {success ? (
            <div className="mt-6 rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-800">
              Account created! Redirecting to dashboard…
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-stone-700">Full name</label>
                <input
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={INPUT}
                  autoComplete="name"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-stone-700">Email address</label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className={INPUT}
                  autoComplete="email"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-stone-700">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className={`${INPUT} pr-11`}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <svg className="h-4.5 w-4.5 h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                      </svg>
                    ) : (
                      <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-stone-400">Use at least 8 characters.</p>
              </div>

              {error && <p className="rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl py-4 text-sm font-semibold text-white transition-colors disabled:opacity-60"
                style={{ background: "#0d9488" }}
              >
                {loading ? "Creating account…" : <>Create account <span className="text-base">→</span></>}
              </button>
            </form>
          )}

          {!success && (
            <>
              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t" style={{ borderColor: "#e8e0d0" }} />
                </div>
                <div className="relative flex justify-center">
                  <span className="px-3 text-xs text-stone-400" style={{ background: "#f5f0e8" }}>or</span>
                </div>
              </div>

              <button
                onClick={handleGoogle}
                disabled={googleLoading}
                className="flex w-full items-center justify-center gap-3 rounded-xl border bg-white py-3.5 text-sm font-medium text-stone-700 shadow-sm transition-colors hover:bg-stone-50 disabled:opacity-60"
                style={{ borderColor: "#e8e0d0" }}
              >
                <svg viewBox="0 0 24 24" width="18" height="18">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                {googleLoading ? "Redirecting…" : "Continue with Google"}
              </button>

              <p className="mt-5 text-center text-sm text-stone-500">
                Already have an account?{" "}
                <Link href="/auth/login" className="font-bold text-stone-900 hover:text-teal-700 transition-colors">
                  Sign in
                </Link>
              </p>
              <p className="mt-4 text-center text-xs text-stone-400">
                By creating an account you agree to our{" "}
                <Link href="/terms" className="underline underline-offset-2 hover:text-stone-600">Terms</Link>
                {" "}and{" "}
                <Link href="/privacy" className="underline underline-offset-2 hover:text-stone-600">Privacy Policy</Link>.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
