"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "./Toast";

type ReceiptItem = {
  id: string;
  upload_id: string;
  key?: string;
  name?: string;
  url?: string;
};

export default function ReceiptUploader({ transactionId, onSaved }: { transactionId: string; onSaved?: () => void }) {
  const { toast } = useToast();
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data: recs, error: rErr } = await supabase.from("receipts").select("id, upload_id").eq("transaction_id", transactionId);
      if (rErr) throw rErr;
      const items: ReceiptItem[] = [];
      for (const r of recs ?? []) {
        const { data: upData, error: upErr } = await supabase.from("uploads").select("id, key, name").eq("id", r.upload_id).single();
        if (upErr) {
          // eslint-disable-next-line no-console
          console.error(upErr);
          continue;
        }
        const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(upData.key);
        const url = urlData?.publicUrl ?? "";
        items.push({ id: r.id, upload_id: upData.id, key: upData.key, name: upData.name, url });
      }
      setReceipts(items);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId]);

  const handleUpload = async (file?: File | null) => {
    const f = file;
    if (!f) return;
    setLoading(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error("Not authenticated");
      const ext = f.name.split('.').pop();
      const path = `receipts/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { data: uploadData, error: uploadErr } = await supabase.storage.from("uploads").upload(path, f, { cacheControl: '3600', upsert: false, contentType: f.type });
      if (uploadErr) throw uploadErr;

      // Insert metadata in uploads table
      const { data: upRow, error: upRowErr } = await supabase.from('uploads').insert({ user_id: user.id, key: uploadData.path ?? path, name: f.name, size: f.size, content_type: f.type }).select().single();
      if (upRowErr) throw upRowErr;

      // Insert into receipts table linking to transaction
      const { error: receiptErr } = await supabase.from('receipts').insert({ upload_id: upRow.id, transaction_id: transactionId });
      if (receiptErr) throw receiptErr;

      if (onSaved) onSaved();
      await load();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      toast("Upload failed", "error");
    }
    setLoading(false);
  };

  const handleRemove = async (item: ReceiptItem) => {
    if (removeConfirmId !== item.id) { setRemoveConfirmId(item.id); return; }
    setRemoveConfirmId(null);
    setLoading(true);
    try {
      // remove storage object
      if (item.key) {
        const { error: remErr } = await supabase.storage.from('uploads').remove([item.key]);
        if (remErr) console.error(remErr);
      }
      // delete uploads row
      await supabase.from('uploads').delete().eq('key', item.key);
      // delete receipt row
      await supabase.from('receipts').delete().eq('id', item.id);
      if (onSaved) onSaved();
      await load();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      toast("Delete failed", "error");
    }
    setLoading(false);
  };

  return (
    <div className="mt-2 border rounded p-3">
      <div className="text-sm font-medium mb-2">Receipts</div>
      <div className="mb-2">
        <input type="file" accept="image/*,application/pdf" onChange={(e) => handleUpload(e.target.files?.[0] ?? null)} />
      </div>
      {loading && <div className="mb-2 text-sm muted">Loading...</div>}
      <div className="space-y-2">
        {receipts.map((r) => (
          <div key={r.id} className="flex items-center justify-between p-2 border rounded">
            <div>
              <a href={r.url} target="_blank" rel="noreferrer" className="text-sm text-blue-600">{r.name}</a>
            </div>
            <div className="flex items-center gap-2">
              {removeConfirmId === r.id ? (
                <>
                  <button onClick={() => handleRemove(r)} className="text-sm text-red-600 px-2 py-1 border border-red-600 rounded">Confirm</button>
                  <button onClick={() => setRemoveConfirmId(null)} className="text-sm px-2 py-1 border rounded">Cancel</button>
                </>
              ) : (
                <button onClick={() => handleRemove(r)} className="text-sm text-red-600 px-2 py-1 border rounded">Delete</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
