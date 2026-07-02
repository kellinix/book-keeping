import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getUserIdFromAuthHeader } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { normalizeCategory, VOICELEDGER_CATEGORIES } from "../../../../lib/voiceledger";

const openaiKey = process.env.OPENAI_API_KEY || "";
if (!openaiKey) {
  // eslint-disable-next-line no-console
  console.warn("OPENAI_API_KEY is not set");
}

const client = new OpenAI({ apiKey: openaiKey });

export async function POST(req: Request) {
  const userId = await getUserIdFromAuthHeader(req.headers.get("authorization"));
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { description, amount, merchant } = body;
  if (!description && !merchant) return NextResponse.json({ error: "Missing data" }, { status: 400 });
  if (!openaiKey) return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 500 });

  const prompt = `You suggest bookkeeping categories for VoiceLedger.
Use only these categories: ${VOICELEDGER_CATEGORIES.join(", ")}.
Return valid JSON only with {"category":string,"tax_deductible":boolean,"confidence":number,"explanation":string}.
Use safe wording in explanation such as "suggested" and "review before saving"; do not make final tax or legal claims.

Description: ${String(description ?? "").slice(0, 500)}
Merchant: ${String(merchant ?? "").slice(0, 200)}
Amount: ${amount}`;

  try {
    const completion = await client.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      max_tokens: 200,
      temperature: 0
    });
    const text = completion.choices?.[0]?.message?.content ?? "";
    // Try to parse JSON from the response
    const jsonStart = text.indexOf("{");
    const jsonText = jsonStart >= 0 ? text.slice(jsonStart) : text;
    let parsed: any = { category: "Other", tax_deductible: false, confidence: 0.5, explanation: text };
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      // fallback: try to extract category heuristically
      for (const c of VOICELEDGER_CATEGORIES) {
        if (text.toLowerCase().includes(c.toLowerCase())) {
          parsed.category = c;
          break;
        }
      }
      parsed.explanation = text;
    }

    // Ensure safe fields
    parsed.category = normalizeCategory(parsed.category);
    parsed.tax_deductible = !!parsed.tax_deductible;
    parsed.confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5));

    await supabaseAdmin.from("ai_logs").insert({
      user_id: userId,
      kind: "categorise_transaction",
      input: { description: String(description ?? "").slice(0, 500), merchant: String(merchant ?? "").slice(0, 200), amount },
      output: parsed
    });

    return NextResponse.json({ suggestion: parsed });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error(err);
    return NextResponse.json({ error: "AI error" }, { status: 500 });
  }
}
