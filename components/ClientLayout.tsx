"use client";

import { ToastProvider } from "./Toast";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
