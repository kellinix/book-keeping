import { NextResponse } from "next/server";
import { getUserIdFromAuthHeader } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { normalizeCategory, VOICELEDGER_CATEGORIES } from "../../../../lib/voiceledger";

const SUPPORTED_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const MAX_BYTES = 25 * 1024 * 1024;

async function requestOpenAI(body: Record<string, unknown>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (response.ok) return response.json();
    const payload = await response.json().catch(() => ({}));
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const retryAfter = Math.min(5, Math.max(1, Number(response.headers.get("retry-after")) || 2 ** attempt));
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      continue;
    }
    throw new Error(payload?.error?.message || `OpenAI request failed (${response.status})`);
  }
  throw new Error("OpenAI request failed");
}

export async function POST(req: Request) {
  try {
    const userId = await getUserIdFromAuthHeader(req.headers.get("authorization"));
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "Receipt reading is not configured" }, { status: 503 });

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No receipt image provided" }, { status: 400 });
    if (!SUPPORTED_TYPES.includes(file.type)) return NextResponse.json({ error: "Use a PDF, JPG, PNG, or WebP receipt" }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "Receipt must be 25 MB or smaller" }, { status: 413 });

    const buffer = Buffer.from(await file.arrayBuffer());
    let upload: { id: string; key: string } | null = null;
    if (process.env.RETAIN_RECEIPTS === "true") {
      const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "jpg";
      const key = `receipts/${userId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
      const { error: storageError } = await supabaseAdmin.storage.from("uploads").upload(key, buffer, { contentType: file.type, upsert: false });
      if (storageError) throw storageError;
      const { data, error: uploadError } = await supabaseAdmin.from("uploads").insert({ user_id: userId, key, name: file.name || "receipt", size: buffer.length, content_type: file.type }).select("id,key").single();
      if (uploadError) { await supabaseAdmin.storage.from("uploads").remove([key]); throw uploadError; }
      upload = data;
    }

    const dataUrl = `data:${file.type};base64,${buffer.toString("base64")}`;
    const fileInput = file.type === "application/pdf"
      ? { type: "input_file", filename: file.name || "receipt.pdf", file_data: dataUrl, detail: "high" }
      : { type: "input_image", image_url: dataUrl, detail: "high" };
    const response = await requestOpenAI({
      model: process.env.OPENAI_VISION_MODEL || "gpt-4o",
      store: false,
      input: [{ role: "user", content: [fileInput, { type: "input_text", text: "Extract the final paid transaction from this receipt. Do not guess unreadable values." }] }],
      text: { format: { type: "json_schema", name: "receipt_transaction", strict: true, schema: {
        type: "object", additionalProperties: false,
        required: ["merchant","date","total","currency","description","category","tax_deductible","confidence","type","is_business"],
        properties: {
          merchant: { type: "string" }, date: { type: "string" }, total: { type: ["number","null"] }, currency: { type: "string" }, description: { type: "string" },
          category: { type: "string", enum: VOICELEDGER_CATEGORIES }, tax_deductible: { type: "boolean" }, confidence: { type: "number" }, type: { type: "string", enum: ["expense","income"] }, is_business: { type: "boolean" }
        }
      } } }
    });
    const raw = (response.output || []).flatMap((item: any) => item.content || []).find((item: any) => item.type === "output_text")?.text || "{}";
    const parsed = JSON.parse(raw);
    const receipt = {
      merchant: String(parsed.merchant || "").slice(0, 200),
      date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : "",
      total: Number.isFinite(Number(parsed.total)) ? Number(parsed.total) : null,
      currency: /^[A-Z]{3}$/.test(String(parsed.currency || "").toUpperCase()) ? String(parsed.currency).toUpperCase() : "GBP",
      description: String(parsed.description || parsed.merchant || "Receipt purchase").slice(0, 500),
      category: normalizeCategory(parsed.category),
      tax_deductible: Boolean(parsed.tax_deductible),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      type: parsed.type === "income" ? "income" : "expense",
      is_business: parsed.is_business !== false
    };
    await supabaseAdmin.from("ai_logs").insert({ user_id: userId, kind: "read_receipt", input: { upload_id: upload?.id ?? null, retained: Boolean(upload) }, output: receipt });
    return NextResponse.json({ receipt, upload });
  } catch (error) {
    console.error("Receipt reading error", error);
    return NextResponse.json({ error: "Could not read this receipt. Try a clearer photo." }, { status: 500 });
  }
}
