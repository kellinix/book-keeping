"use client";

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "./Toast";

export type ReceiptDraft = { merchant: string; date: string; total: number | null; currency: string; description: string; category: string; tax_deductible: boolean; confidence: number; type: "expense" | "income"; is_business: boolean; uploadId?: string };

export default function ReceiptScanner({ onRead }: { onRead: (draft: ReceiptDraft) => void }) {
  const [reading, setReading] = useState(false);
  const { toast } = useToast();
  const read = async (file?: File) => {
    if (!file) return;
    setReading(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const body = new FormData(); body.append("file", file);
      const response = await fetch("/api/receipts/ocr", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not read receipt");
      onRead({ ...data.receipt, uploadId: data.upload?.id });
      toast("Receipt read — review the details before saving", "success");
    } catch (error) { toast(error instanceof Error ? error.message : "Could not read receipt", "error"); }
    finally { setReading(false); }
  };
  return <div className="space-y-3">
    <div><h2 className="text-lg font-semibold">Scan a receipt</h2><p className="text-sm muted">Use a clear image or PDF up to 25 MB. Files are processed ephemerally unless receipt retention is enabled by the server.</p></div>
    <label className="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-stone-300 p-8 text-center hover:border-teal-500 hover:bg-teal-50/40">
      <span className="text-3xl">📷</span><span className="mt-2 font-medium">{reading ? "Reading receipt…" : "Take photo or choose image"}</span>
      <input disabled={reading} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => read(e.target.files?.[0])} />
    </label>
  </div>;
}
