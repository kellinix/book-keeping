import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getUserFromAuthHeader } from "../../../../lib/auth";
import { ensureProfileForUser } from "../../../../lib/profiles";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { normalizeCategory, parseMoney, VOICELEDGER_CATEGORIES } from "../../../../lib/voiceledger";
import { amountAppearsExplicitly, extractExplicitMoneyMentions } from "../../../../lib/voiceMoney";

const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const AUDIO_TYPES = new Set(["audio/webm", "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/m4a", "audio/ogg"]);
if (!OPENAI_KEY) {
  // eslint-disable-next-line no-console
  console.warn("OPENAI_API_KEY not set; transcription will be skipped");
}

function normalizePaymentSource(value: unknown): string {
  const s = String(value ?? "").toLowerCase().trim();
  if (s === "personal_account" || s === "personal account") return "personal_account";
  if (s === "personal_credit_card" || s === "personal credit card" || s === "personal card") return "personal_credit_card";
  if (s === "business_credit_card" || s === "business credit card") return "business_credit_card";
  if (s === "cash") return "cash";
  if (s === "other") return "other";
  return "business_account";
}

function normalizePaidBy(value: unknown, paymentSource: string): string {
  const s = String(value ?? "").toLowerCase().trim();
  if (s === "director") return "director";
  if (s === "owner") return "owner";
  if (s === "employee") return "employee";
  if (s === "contractor") return "contractor";
  if (s === "other") return "other";
  // Auto-infer from payment source if not explicitly set
  if (paymentSource === "personal_account" || paymentSource === "personal_credit_card") return "director";
  return "company";
}

function normalizeExtractedTransaction(value: any, transcription: string, today: string) {
  const amount = parseMoney(value?.amount);
  const merchant = String(value?.merchant ?? "").trim();
  const description = String(value?.description ?? merchant ?? transcription).trim();
  const category = normalizeCategory(value?.category);
  const paymentSource = normalizePaymentSource(value?.payment_source);
  const paidBy = normalizePaidBy(value?.paid_by, paymentSource);
  const isPersonalPayment = paymentSource === "personal_account" || paymentSource === "personal_credit_card";
  const directorReimbursable = isPersonalPayment && (value?.type !== "income");

  return {
    amount,
    category,
    confidence: Math.max(0, Math.min(1, Number(value?.confidence) || 0.65)),
    currency: String(value?.currency || "GBP").slice(0, 3).toUpperCase(),
    date: value?.date === "today" || !value?.date ? today : String(value.date).slice(0, 10),
    description: description || transcription,
    director_reimbursable: directorReimbursable,
    explanation: String(value?.explanation ?? "Suggested from the voice note. Review before saving."),
    merchant: merchant || null,
    paid_by: paidBy,
    payment_source: paymentSource,
    tax_deductible: Boolean(value?.tax_deductible),
    type: value?.type === "income" ? "income" : "expense",
    is_business: value?.is_business !== false
  };
}

function cleanFallbackMerchant(value: string) {
  return value
    .replace(/[,:;-]+$/g, "")
    .replace(/^(?:and|then|also|plus|another)\s+/i, "")
    .replace(/\s+(?:which|that)\s+(?:costs?|is|was)$/i, "")
    .replace(/\s+(?:costs?|cost|is|was|for|at|of)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackExtractTransactions(transcription: string, today: string) {
  const text = transcription.replace(/\s+/g, " ").trim();
  const amountMatches = extractExplicitMoneyMentions(text);

  // Detect personal payment language anywhere in the text
  const textLower = text.toLowerCase();
  const isPersonalCard = textLower.includes("personal card") || textLower.includes("personal credit card");
  const isPersonalAccount = textLower.includes("personal account") || textLower.includes("personal bank");
  const paymentSource = isPersonalCard ? "personal_credit_card" : isPersonalAccount ? "personal_account" : "business_account";
  const paidBy = (isPersonalCard || isPersonalAccount) ? "director" : "company";
  const directorReimbursable = isPersonalCard || isPersonalAccount;
  let previousAmountEnd = 0;

  return amountMatches.map((match) => {
    const leadingText = text.slice(previousAmountEnd, match.index).trim();
    previousAmountEnd = match.end;
    const merchant = cleanFallbackMerchant(leadingText);
    const currency = match.currency;
    const lowerMerchant = merchant.toLowerCase();
    const category = lowerMerchant.includes("instagram") || lowerMerchant.includes("tiktok")
      ? "Marketing"
      : lowerMerchant.includes("api") || lowerMerchant.includes("openai") || lowerMerchant.includes("sora") || lowerMerchant.includes("subscription")
        ? "Software"
        : "Other";

    return normalizeExtractedTransaction(
      {
        amount: match.amount,
        category,
        confidence: 0.45,
        currency,
        date: today,
        description: merchant,
        director_reimbursable: directorReimbursable,
        merchant,
        paid_by: paidBy,
        payment_source: paymentSource,
        tax_deductible: category !== "Other",
        type: "expense",
        explanation: "Fallback extraction from the transcript. Review before saving."
      },
      transcription,
      today
    );
  }).filter((item) => item.amount > 0 && item.description);
}

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file") as unknown as File;
  const authHeader = req.headers.get('authorization');
  const user = await getUserFromAuthHeader(authHeader);
  const user_id = user?.id ?? null;
  if (!user_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureProfileForUser(user);

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!user_id) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });
  if (!OPENAI_KEY) return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 500 });
  if (file.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: "Audio must be 25 MB or smaller. Record a shorter note and retry." }, { status: 413 });
  if (file.type && !AUDIO_TYPES.has(file.type)) return NextResponse.json({ error: "Unsupported audio format" }, { status: 415 });

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Raw audio is ephemeral by default. Opt in only when a documented retention
  // policy and user-facing consent are in place.
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  const key = `voices/${user_id}/${timestamp}-${safeName}`;
  let storedAudio = false;
  if (process.env.RETAIN_RAW_AUDIO === "true") try {
    const { error: uploadErr } = await supabaseAdmin.storage.from("uploads").upload(key, buffer, {
      contentType: file.type,
      upsert: false
    });
    if (uploadErr) {
      // eslint-disable-next-line no-console
      console.error("Storage upload error", uploadErr);
    } else {
      storedAudio = true;
      // Record upload metadata
      await supabaseAdmin.from("uploads").insert({
        user_id,
        key,
        name: file.name,
        size: buffer.length,
        content_type: file.type
      });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
  }

  let transcription = "";
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const fd = new FormData();
      fd.append("file", new Blob([buffer], { type: file.type }), file.name);
      fd.append("model", process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-transcribe");
      const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${OPENAI_KEY}` }, body: fd as any });
      const j = await resp.json();
      if (resp.ok) { transcription = j.text ?? j.transcript ?? ""; break; }
      if ((resp.status === 429 || resp.status >= 500) && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(5000, (2 ** attempt) * 1000)));
        continue;
      }
      return NextResponse.json({ error: resp.status === 429 ? "Voice AI is busy. Please retry shortly." : j.error?.message ?? "Transcription failed" }, { status: resp.status === 429 ? 429 : 502 });
    }
    if (!transcription) return NextResponse.json({ error: "OpenAI returned an empty transcription. Try a clearer or longer recording." }, { status: 422 });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("Transcription error", e);
    return NextResponse.json({ error: "Transcription request failed" }, { status: 502 });
  }

  // Ask OpenAI to extract structured transaction details from transcription
  let suggestions: any[] = [];
  if (transcription) {
    try {
      const client = new OpenAI({ apiKey: OPENAI_KEY });
      const today = new Date().toISOString().slice(0, 10);
      const prompt = `Extract bookkeeping transactions from this voice note.

Return one object per payment. Classify whether each item is a business transaction independently from how it was paid.

Rules:
- If the note mentions multiple payments, return multiple transaction objects. Do not merge them.
- Do not return a transaction if no amount can be found.
- Use ${today} for "today".
- Categories must be one of: ${VOICELEDGER_CATEGORIES.join(", ")}.
- Advertising, Instagram ads, TikTok ads, and social media ads should be Marketing.
- API subscriptions, OpenAI, Sora, Vercel, GitHub, and software services should be Software unless the wording clearly says refund.
- Use "suggested" and "review before saving"; do not make final tax claims.
- payment_source: detect phrases like "my personal card", "my personal account", "personal credit card", "my own account", "personally" → use "personal_account" or "personal_credit_card". Default to "business_account" if not mentioned.
- paid_by: if payment_source is personal, set to "director". If company card or business account, set to "company".
- director_reimbursable: set to true if payment_source is "personal_account" or "personal_credit_card" AND type is "expense".
- is_business: false only when the speaker explicitly describes the transaction as personal; otherwise true.

Voice note transcription:
"${transcription}"`;

      const completion = await client.chat.completions.create({
        model: process.env.OPENAI_EXTRACTION_MODEL || "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2000,
        response_format: { type: "json_schema", json_schema: { name: "voice_transactions", strict: true, schema: {
          type: "object", additionalProperties: false, required: ["transactions"], properties: { transactions: { type: "array", items: {
            type: "object", additionalProperties: false,
            required: ["amount","currency","type","date","merchant","description","category","tax_deductible","confidence","explanation","payment_source","paid_by","director_reimbursable","is_business"],
            properties: {
              amount: { type: "number" }, currency: { type: "string" }, type: { type: "string", enum: ["income","expense"] }, date: { type: "string" }, merchant: { type: "string" }, description: { type: "string" },
              category: { type: "string", enum: VOICELEDGER_CATEGORIES }, tax_deductible: { type: "boolean" }, confidence: { type: "number" }, explanation: { type: "string" },
              payment_source: { type: "string", enum: ["business_account","personal_account","business_credit_card","personal_credit_card","cash","other"] }, paid_by: { type: "string", enum: ["company","director","owner","employee","contractor","other"] }, director_reimbursable: { type: "boolean" }, is_business: { type: "boolean" }
            }
          } } }
        } } } as any,
        temperature: 0
      });
      const text = completion.choices?.[0]?.message?.content ?? "{}";
      const jsonText = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
      let parsed: any = null;
      try {
        parsed = JSON.parse(jsonText);
      } catch (e) {
        parsed = { transactions: [] };
      }
      const rawTransactions = Array.isArray(parsed?.transactions) ? parsed.transactions : parsed?.amount ? [parsed] : [];
      suggestions = rawTransactions
        .map((item: any) => normalizeExtractedTransaction(item, transcription, today))
        .filter((item: any) => item.amount > 0);

      const explicitMentions = extractExplicitMoneyMentions(transcription);
      if (explicitMentions.length > 1) {
        suggestions = suggestions.filter((item: any) => amountAppearsExplicitly(explicitMentions, item.amount));
      }

      if (!suggestions.length) {
        suggestions = fallbackExtractTransactions(transcription, today);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Extraction error", e);
      return NextResponse.json({ error: "Could not extract transaction details from the transcription", transcription }, { status: 502 });
    }
  }

  if (!suggestions.length) {
    return NextResponse.json(
      {
        error: "I transcribed the audio, but could not find any payment amounts. Try saying each transaction like: 'Instagram ads, 15 pounds.'",
        transcription
      },
      { status: 422 }
    );
  }

  return NextResponse.json({
    success: true,
    transcription,
    suggestion: suggestions[0],
    suggestions,
    key: storedAudio ? key : null,
    storedAudio
  });
}
