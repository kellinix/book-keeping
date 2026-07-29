"use client";

import { useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "./Toast";
import { PaidBy, PaymentSource, VOICELEDGER_CATEGORIES } from "../lib/voiceledger";

type VoiceSuggestion = {
  amount: number;
  category: string;
  confidence?: number;
  currency?: string;
  date?: string;
  description?: string;
  explanation?: string;
  merchant?: string | null;
  tax_deductible?: boolean;
  type?: "income" | "expense";
  payment_source?: PaymentSource;
  paid_by?: PaidBy;
  director_reimbursable?: boolean;
  is_business?: boolean;
};

function formatTime(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const BAR_HEIGHTS = [16, 26, 36, 28, 20, 32, 18, 30, 24, 14];
const BAR_DELAYS  = [0, 0.1, 0.2, 0.05, 0.15, 0.08, 0.18, 0.03, 0.12, 0.22];

const INPUT = "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20";

export default function VoiceRecorder({ onSaved }: { onSaved?: () => void }) {
  const { toast } = useToast();
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<VoiceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordedBytesRef = useRef(0);

  const updateSuggestion = (index: number, patch: Partial<VoiceSuggestion>) => {
    setSuggestions((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const removeSuggestion = (index: number) => {
    setSuggestions((current) => current.filter((_, i) => i !== index));
  };

  const start = async () => {
    try {
      setError(null);
      setTranscription(null);
      setSuggestions([]);
      setAudioUrl(null);
      setRecordingSeconds(0);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      recordedBytesRef.current = 0;

      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
          recordedBytesRef.current += event.data.size;
          if (recordedBytesRef.current >= 23 * 1024 * 1024 && mediaRecorder.state === "recording") {
            setError("Recording stopped before the secure 25 MB upload limit. Review or save this note, then record the remainder separately.");
            mediaRecorder.stop();
            setRecording(false);
          }
        }
      };

      mediaRecorder.onstop = async () => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        setRecording(false);
        mediaRecorder.stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioUrl(URL.createObjectURL(blob));
        setLoading(true);

        try {
          const session = await supabase.auth.getSession();
          const token = session.data.session?.access_token ?? null;
          const formData = new FormData();
          formData.append("file", blob, `voice-${Date.now()}.webm`);

          const response = await fetch("/api/voice/transcribe", {
            body: formData,
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            method: "POST"
          });
          const data = await response.json();

          if (!response.ok) {
            setError(data.error ?? "Voice transcription failed");
            setTranscription(data.transcription ?? null);
            setSuggestions([]);
            return;
          }

          const nextSuggestions: VoiceSuggestion[] = ((data.suggestions ?? (data.suggestion ? [data.suggestion] : [])) as VoiceSuggestion[])
            .map((item) => ({
              ...item,
              amount: Number(item.amount) || 0,
              currency: item.currency ?? "GBP",
              director_reimbursable: Boolean(item.director_reimbursable),
              paid_by: item.paid_by ?? "company",
              payment_source: item.payment_source ?? "business_account",
              is_business: item.is_business !== false,
              type: item.type === "income" ? ("income" as const) : ("expense" as const)
            }))
            .filter((item) => item.amount > 0);

          setTranscription(data.transcription ?? "");
          setSuggestions(nextSuggestions);
          if (!nextSuggestions.length) {
            setError("I transcribed the audio, but could not extract any non-zero transaction amounts.");
          }
        } catch (caughtError) {
          // eslint-disable-next-line no-console
          console.error(caughtError);
          setError("Voice transcription failed. Check the dev server console for details.");
        } finally {
          setLoading(false);
        }
      };

      mediaRecorder.start(1000);
      setRecording(true);
      timerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch (caughtError) {
      // eslint-disable-next-line no-console
      console.error("Could not start recording", caughtError);
      toast("Unable to access microphone. Please allow microphone access and try again.", "error");
    }
  };

  const stop = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const saveTransactions = async () => {
    const validSuggestions = suggestions.filter((item) => Number(item.amount) > 0);
    if (!validSuggestions.length) { toast("No valid extracted transactions to save.", "error"); return; }

    setLoading(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error("Please sign in before saving transactions.");

      const rows = validSuggestions.map((item) => {
        const reimbursable = Boolean(item.director_reimbursable) && (item.type === "expense");
        return {
          amount: Number(item.amount),
          amount_pence: Math.round(Number(item.amount) * 100),
          category: item.category || "Other",
          confidence_score: item.confidence ?? null,
          currency: (item.currency ?? "GBP").toUpperCase(),
          description: item.description || item.merchant || transcription || "Voice note",
          director_reimbursable: reimbursable,
          merchant: item.merchant ?? null,
          is_business: item.is_business !== false,
          notes: transcription,
          paid_by: item.paid_by ?? "company",
          payment_source: item.payment_source ?? "business_account",
          reimbursement_status: reimbursable ? "owed_to_director" : "not_applicable",
          source: "voice",
          suggested_by_ai: true,
          tax_deductible: Boolean(item.tax_deductible),
          transaction_date: item.date || new Date().toISOString().slice(0, 10),
          type: item.type || "expense",
          user_confirmed: true
        };
      });

      const response = await fetch("/api/transactions", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ transactions: rows }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not save voice transactions");

      toast(`Saved ${result.imported} transaction${result.imported === 1 ? "" : "s"}${result.skippedDuplicates ? `; skipped ${result.skippedDuplicates} duplicate${result.skippedDuplicates === 1 ? "" : "s"}` : ""}`, "success");
      setError(null);
      setTranscription(null);
      setSuggestions([]);
      setAudioUrl(null);
      onSaved?.();
    } catch (caughtError) {
      // eslint-disable-next-line no-console
      console.error(caughtError);
      toast(caughtError instanceof Error ? caughtError.message : "Save failed", "error");
    } finally {
      setLoading(false);
    }
  };

  const discard = () => {
    setTranscription(null);
    setSuggestions([]);
    setAudioUrl(null);
    setError(null);
  };

  return (
    <div className="card">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-stone-900">Voice note</h2>
        <p className="text-sm muted">Record one or more payments, then review each extracted transaction before saving.</p>
        {!recording && !loading && !suggestions.length && (
          <p className="mt-1.5 text-xs muted">
            Examples: "I paid Edwin £80 from my personal account for social media management." · "I paid £12.99 for Canva using my personal card."
          </p>
        )}
      </div>

      {/* ── Recording active state ── */}
      {recording ? (
        <div className="flex flex-col items-center gap-5 py-6">
          {/* Pulsing mic button */}
          <div className="relative flex items-center justify-center">
            <span className="absolute inline-flex h-20 w-20 animate-ping rounded-full bg-rose-400/20" />
            <span className="absolute inline-flex h-16 w-16 animate-ping rounded-full bg-rose-400/30" style={{ animationDuration: "1.2s" }} />
            <button
              onClick={stop}
              className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full bg-rose-500 text-white shadow-lg transition-colors hover:bg-rose-600 active:scale-95"
              title="Tap to stop recording"
            >
              <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v6a2 2 0 0 0 4 0V5a2 2 0 0 0-2-2z" />
                <path d="M19 11a1 1 0 0 1 1 1 8 8 0 0 1-7 7.938V22h2a1 1 0 0 1 0 2H9a1 1 0 0 1 0-2h2v-2.062A8 8 0 0 1 4 12a1 1 0 0 1 2 0 6 6 0 0 0 12 0 1 1 0 0 1 1-1z" />
              </svg>
            </button>
          </div>

          {/* Animated audio bars */}
          <div className="flex items-end gap-[3px]" style={{ height: 40 }}>
            {BAR_HEIGHTS.map((h, i) => (
              <div
                key={i}
                className="audio-bar"
                style={{
                  height: h,
                  animationDelay: `${BAR_DELAYS[i]}s`,
                  animationDuration: `${0.6 + (i % 3) * 0.15}s`,
                }}
              />
            ))}
          </div>

          {/* Timer + label */}
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
              <span className="font-mono text-sm font-semibold text-rose-600">{formatTime(recordingSeconds)}</span>
            </div>
            <p className="text-xs muted">Tap the mic to stop recording</p>
          </div>
        </div>
      ) : loading ? (
        /* ── Processing state ── */
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-teal-50">
            <svg className="h-6 w-6 animate-spin text-teal-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-stone-900">Transcribing your note…</p>
            <p className="text-xs muted">AI is extracting transactions from your recording</p>
          </div>
          {audioUrl && <audio src={audioUrl} controls className="mt-1 h-8 w-full max-w-xs" />}
        </div>
      ) : (
        /* ── Idle / record button ── */
        !suggestions.length && (
          <button
            onClick={start}
            className="flex w-full items-center justify-center gap-3 rounded-xl border-2 border-dashed border-teal-200 bg-teal-50/50 px-4 py-6 text-sm font-semibold text-teal-700 transition-colors hover:border-teal-400 hover:bg-teal-50 active:scale-[0.99]"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-600 text-white shadow">
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v6a2 2 0 0 0 4 0V5a2 2 0 0 0-2-2z" />
                <path d="M19 11a1 1 0 0 1 1 1 8 8 0 0 1-7 7.938V22h2a1 1 0 0 1 0 2H9a1 1 0 0 1 0-2h2v-2.062A8 8 0 0 1 4 12a1 1 0 0 1 2 0 6 6 0 0 0 12 0 1 1 0 0 1 1-1z" />
              </svg>
            </span>
            Tap to record voice note
          </button>
        )
      )}

      {/* ── Error ── */}
      {error && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {/* ── Transcription ── */}
      {transcription && !loading && (
        <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-400">Transcription</p>
          <p className="text-sm text-stone-700">{transcription}</p>
        </div>
      )}

      {/* ── Extracted transaction cards ── */}
      {suggestions.length > 0 && (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-semibold text-stone-900">Review extracted transactions</p>
          {suggestions.map((item, index) => (
            <div key={`${item.description}-${index}`} className="rounded-xl border border-stone-200 bg-stone-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-stone-800">Transaction {index + 1}</span>
                <button onClick={() => removeSuggestion(index)} className="rounded-lg border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-100 transition-colors">
                  Remove
                </button>
              </div>

              <label className="mb-2 block text-xs font-medium text-stone-600">
                Description
                <input value={item.description ?? ""} onChange={(e) => updateSuggestion(index, { description: e.target.value })} className={INPUT} />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-medium text-stone-600">
                  Amount
                  <input value={item.amount} onChange={(e) => updateSuggestion(index, { amount: Number(e.target.value) })} type="number" min="0" step="0.01" className={INPUT} />
                </label>
                <label className="block text-xs font-medium text-stone-600">
                  Currency
                  <input value={item.currency ?? "GBP"} onChange={(e) => updateSuggestion(index, { currency: e.target.value.slice(0, 3).toUpperCase() })} className={`${INPUT} uppercase`} />
                </label>
                <label className="block text-xs font-medium text-stone-600">
                  Type
                  <select value={item.type ?? "expense"} onChange={(e) => updateSuggestion(index, { type: e.target.value as "income" | "expense" })} className={INPUT}>
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </select>
                </label>
                <label className="block text-xs font-medium text-stone-600">
                  Category
                  <select value={item.category ?? "Other"} onChange={(e) => updateSuggestion(index, { category: e.target.value })} className={INPUT}>
                    {VOICELEDGER_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </label>
                <label className="col-span-2 block text-xs font-medium text-stone-600">
                  Payment source
                  <select value={item.payment_source ?? "business_account"} onChange={(e) => {
                    const src = e.target.value as PaymentSource;
                    const isPersonal = src === "personal_account" || src === "personal_credit_card";
                    updateSuggestion(index, { payment_source: src, paid_by: isPersonal ? "director" : "company", director_reimbursable: isPersonal && item.type === "expense" });
                  }} className={INPUT}>
                    <option value="business_account">Business bank account</option>
                    <option value="personal_account">Personal bank account</option>
                    <option value="business_credit_card">Business credit card</option>
                    <option value="personal_credit_card">Personal credit card</option>
                    <option value="cash">Cash</option>
                    <option value="other">Other</option>
                  </select>
                </label>
              </div>

              <div className="mt-3 flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-xs text-stone-600">
                  <input checked={item.is_business !== false} onChange={(e) => updateSuggestion(index, { is_business: e.target.checked, tax_deductible: e.target.checked ? item.tax_deductible : false })} type="checkbox" className="rounded" />
                  Business transaction
                </label>
                <label className="flex items-center gap-2 text-xs text-stone-600">
                  <input checked={Boolean(item.tax_deductible)} onChange={(e) => updateSuggestion(index, { tax_deductible: e.target.checked })} type="checkbox" className="rounded" />
                  Tax deductible
                </label>
                <label className="flex items-center gap-2 text-xs text-stone-600">
                  <input checked={Boolean(item.director_reimbursable)} onChange={(e) => updateSuggestion(index, { director_reimbursable: e.target.checked })} type="checkbox" className="rounded" />
                  Paid personally (business owes me)
                </label>
              </div>

              {item.director_reimbursable && item.type === "expense" && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  This will be tracked as an outstanding reimbursement owed to the director/owner.
                </div>
              )}

              {item.explanation && <p className="mt-2 text-xs muted">{item.explanation}</p>}
            </div>
          ))}
        </div>
      )}

      {/* ── Action buttons ── */}
      {(suggestions.length > 0 || audioUrl) && !loading && (
        <div className="mt-4 flex gap-2">
          {suggestions.length > 0 && (
            <button onClick={saveTransactions} disabled={loading} className="btn btn-accent gap-2 px-5 py-2.5 font-semibold shadow-sm disabled:opacity-60">
              Save {suggestions.length > 1 ? `${suggestions.length} transactions` : "transaction"}
            </button>
          )}
          <button onClick={discard} className="btn border border-stone-300 bg-white px-5 py-2.5 text-stone-700 hover:bg-stone-50 transition-colors">
            Discard
          </button>
        </div>
      )}

      {/* ── Idle record button (when suggestions exist, offer re-record) ── */}
      {suggestions.length > 0 && !recording && !loading && (
        <button onClick={start} className="mt-2 flex items-center gap-2 text-xs text-stone-500 underline underline-offset-2 hover:text-teal-700 transition-colors">
          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z" />
          </svg>
          Record another note
        </button>
      )}
    </div>
  );
}
