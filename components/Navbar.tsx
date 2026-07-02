"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/transactions", label: "Transactions" },
  { href: "/reports", label: "Reports" },
  { href: "/assistant", label: "Ask AI" },
];

export default function Navbar() {
  const [user, setUser] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then((res) => {
      if (!mounted) return;
      setUser(res.data.user ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => { mounted = false; listener?.subscription.unsubscribe(); };
  }, []);

  // Close menu on route change
  useEffect(() => { setOpen(false); }, [pathname]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setOpen(false);
  };

  return (
    <nav className="sticky top-0 z-50 border-b bg-[#f5f0e8]/95 backdrop-blur-sm" style={{ borderColor: "#e5ddd0" }}>
      <div className="flex items-center justify-between px-4 py-2.5 md:px-6 md:py-3">

        {/* Logo */}
        <Link href="/" className="shrink-0" onClick={() => setOpen(false)}>
          <div style={{ height: 38, width: 150, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <img src="/logo.png" alt="VoiceLedger" style={{ height: 124, width: 124, objectFit: "contain", flexShrink: 0 }} />
          </div>
        </Link>

        {/* Desktop nav links */}
        {user && (
          <div className="hidden items-center gap-5 md:flex">
            {NAV_LINKS.map(({ href, label }) => (
              <Link key={href} href={href}
                className={`text-sm transition-colors hover:text-stone-900 ${pathname === href ? "font-semibold text-stone-900" : "text-stone-500"}`}>
                {label}
              </Link>
            ))}
          </div>
        )}

        {/* Desktop right side */}
        <div className="hidden items-center gap-3 md:flex">
          {user ? (
            <>
              <span className="text-sm text-stone-500">{user.email}</span>
              <Link href="/settings" className="flex items-center gap-1 text-sm text-stone-500 transition-colors hover:text-stone-900">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.43l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Settings
              </Link>
              <button onClick={signOut} className="btn btn-accent gap-1.5 px-3 py-1.5 text-sm">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                </svg>
                Sign out
              </button>
            </>
          ) : (
            <div className="flex gap-2">
              <Link href="/auth/login" className="rounded-lg border px-3 py-1.5 text-sm text-stone-700 transition-colors hover:bg-stone-100" style={{ borderColor: "#e5ddd0" }}>Sign in</Link>
              <Link href="/auth/register" className="btn btn-accent text-sm">Sign up</Link>
            </div>
          )}
        </div>

        {/* Mobile right: active page label + hamburger */}
        <div className="flex items-center gap-3 md:hidden">
          {user && (
            <span className="text-sm font-semibold text-stone-900">
              {NAV_LINKS.find(l => l.href === pathname)?.label ?? ""}
            </span>
          )}
          {user ? (
            <button onClick={() => setOpen((v) => !v)} className="flex h-9 w-9 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-100 transition-colors" aria-label="Menu">
              {open ? (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              )}
            </button>
          ) : (
            <Link href="/auth/login" className="btn btn-accent text-sm px-4 py-1.5">Sign in</Link>
          )}
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {open && user && (
        <div className="border-t md:hidden" style={{ borderColor: "#e5ddd0", background: "#f5f0e8" }}>
          <div className="px-4 py-3 space-y-1">
            {NAV_LINKS.map(({ href, label }) => (
              <Link key={href} href={href}
                className={`flex items-center rounded-xl px-4 py-3 text-sm transition-colors ${pathname === href ? "bg-white font-semibold text-stone-900 shadow-sm" : "text-stone-600 hover:bg-white/60"}`}>
                {label}
              </Link>
            ))}
          </div>
          <div className="border-t px-4 py-3 space-y-1" style={{ borderColor: "#e5ddd0" }}>
            <Link href="/settings"
              className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm text-stone-600 transition-colors hover:bg-white/60">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.43l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </Link>
            <div className="px-4 py-2 text-xs text-stone-400 truncate">{user.email}</div>
            <button onClick={signOut}
              className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-sm text-rose-600 transition-colors hover:bg-rose-50">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
              </svg>
              Sign out
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
