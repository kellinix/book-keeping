import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getUserIdFromAuthHeader } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
if (!OPENAI_KEY) {
  // eslint-disable-next-line no-console
  console.warn("OPENAI_API_KEY is not set. LLM assistant will not function without it.");
}

const client = OPENAI_KEY ? new OpenAI({ apiKey: OPENAI_KEY }) : null;

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function quarterRangeForOffset(offset = 0) {
  const now = new Date();
  const currentQuarter = Math.floor(now.getMonth() / 3) + 1;
  let target = currentQuarter + offset;
  let year = now.getFullYear();
  while (target <= 0) { target += 4; year -= 1; }
  while (target > 4) { target -= 4; year += 1; }
  const startMonth = (target - 1) * 3; // 0-based
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0);
  return { start, end };
}

async function fetchTransactions(params: { user_id: string; start?: string; end?: string; filterSql?: string; limit?: number }) {
  let q = supabaseAdmin.from('transactions').select('transaction_date,amount,currency,type,category,merchant,description,tax_deductible,payment_source,paid_by,director_reimbursable,reimbursement_status,reimbursed_amount').eq('user_id', params.user_id);
  if (params.start) q = q.gte('transaction_date', params.start);
  if (params.end) q = q.lte('transaction_date', params.end);
  if (params.filterSql) q = q.or(params.filterSql);
  const { data, error } = await q.order('transaction_date', { ascending: false }).limit(params.limit ?? 200);
  if (error) throw error;
  return data ?? [];
}

async function fetchDirectorExpenses(user_id: string, start?: string, end?: string) {
  let q = supabaseAdmin.from('transactions')
    .select('transaction_date,amount,currency,type,category,merchant,description,payment_source,reimbursement_status,reimbursed_amount,reimbursement_notes')
    .eq('user_id', user_id)
    .in('payment_source', ['personal_account', 'personal_credit_card'])
    .eq('type', 'expense');
  if (start) q = q.gte('transaction_date', start);
  if (end) q = q.lte('transaction_date', end);
  const { data, error } = await q.order('transaction_date', { ascending: false }).limit(200);
  if (error) throw error;
  return data ?? [];
}

function sanitizeRows(rows: any[]) {
  return (rows || []).slice(0, 200).map((r) => ({
    amount: Number(r.amount || 0),
    category: r.category || null,
    currency: r.currency || 'GBP',
    date: r.transaction_date?.toString?.() ?? r.transaction_date,
    description: (r.description || '').toString().slice(0, 200),
    director_reimbursable: !!r.director_reimbursable,
    merchant: r.merchant || null,
    paid_by: r.paid_by || null,
    payment_source: r.payment_source || null,
    reimbursed_amount: Number(r.reimbursed_amount || 0),
    reimbursement_status: r.reimbursement_status || null,
    tax_deductible: !!r.tax_deductible,
    type: r.type || 'expense'
  }));
}

// Minimal PII redaction: emails, long digit sequences (credit cards, account numbers), SSN-like patterns
function redactText(s: string) {
  if (!s || typeof s !== 'string') return s;
  let out = s;
  // Email addresses
  out = out.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]');
  // Long digit sequences (12+ digits) often indicate card/account numbers
  out = out.replace(/(?:\d[ -]*?){12,19}/g, '[REDACTED_NUMBER]');
  // Long uninterrupted digits (10+)
  out = out.replace(/\b\d{10,}\b/g, '[REDACTED_NUMBER]');
  // US SSN pattern
  out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]');
  return out;
}

function redactObject(obj: any): any {
  if (obj == null) return obj;
  if (typeof obj === 'string') return redactText(obj);
  if (Array.isArray(obj)) return obj.map(redactObject);
  if (typeof obj === 'object') {
    const out: any = {};
    for (const k of Object.keys(obj)) {
      const v = (obj as any)[k];
      out[k] = redactObject(v);
    }
    return out;
  }
  return obj;
}

const SYSTEM_PROMPT = `You are VoiceLedger Assistant, a bookkeeping assistant that answers questions using ONLY the provided transaction data.
Rules:
- Use only the transaction data included in the user's message. Do not call external services or invent facts.
- If the data is insufficient to answer the question, say so clearly and do not guess.
- When reporting amounts, compute totals exactly from the provided rows and state the currency. Do not convert currencies.
- Use safe wording: say "based on your records", "this appears to be", "for planning purposes only" as appropriate. Do not provide legal, tax, or accounting advice.
- Keep answers concise and actionable. When asked for lists, show at most 10 transactions with date, amount, category, and merchant.
- Avoid exposing personal identifiers; only include transaction-level fields.
- If asked for tax estimates, compute a simple estimate using the provided net profit and a tax rate provided in the context.
- For reimbursement questions: use the reimbursement_status field. "owed_to_director" means not yet reimbursed. "partially_reimbursed" means part has been paid back. "reimbursed" means fully paid back. outstanding = amount - reimbursed_amount.
- Always add: "Please confirm with your accountant before acting on this information."
Respond in plain English only. Do not include JSON, code fences, markdown tables, or machine-readable summaries.`;

function stripMachineReadableBlocks(text: string) {
  return String(text || "")
    .replace(/```(?:json)?[\s\S]*?```/gi, "")
    .replace(/\n\s*\{[\s\S]*?\}\s*$/g, "")
    .trim();
}

function buildLoanAnswer(rows: ReturnType<typeof sanitizeRows>, start?: string, end?: string) {
  const loanRows = rows.filter((row) => row.type === "income" && String(row.category ?? "").toLowerCase() === "director loan");
  const total = loanRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const currency = loanRows[0]?.currency ?? "GBP";

  if (!loanRows.length) {
    return {
      answer: "I could not find any Director Loan income transactions in your records for that period.",
      facts: { totalIncome: 0, totalExpenses: 0, net: 0, deductible: 0, transactionsCount: 0, period: { start, end } },
      transactions: []
    };
  }

  const lines = loanRows
    .slice(0, 10)
    .map((row) => `- ${row.date}: ${currency} ${Number(row.amount).toFixed(2)} from ${row.merchant || "Unknown merchant"}`)
    .join("\n");

  return {
    answer: `Based on your records, transactions categorised as Director Loan show ${currency} ${total.toFixed(2)} in loans for this period.\n\n${lines}\n\nThis is for planning purposes only; review the categorisation before relying on it. Please confirm with your accountant.`,
    facts: { totalIncome: total, totalExpenses: 0, net: total, deductible: 0, transactionsCount: loanRows.length, period: { start, end } },
    transactions: loanRows
  };
}

function buildDirectorExpensesAnswer(rows: any[], start?: string, end?: string) {
  const personalExpenses = rows.filter(r => r.payment_source === "personal_account" || r.payment_source === "personal_credit_card");
  const totalPaid = personalExpenses.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalReimbursed = personalExpenses.reduce((s, r) => s + Number(r.reimbursed_amount || 0), 0);
  const outstanding = Math.max(0, totalPaid - totalReimbursed);
  const currency = personalExpenses[0]?.currency ?? "GBP";

  const unreimbursed = personalExpenses.filter(r => r.reimbursement_status === "owed_to_director" || r.reimbursement_status === "partially_reimbursed");

  if (!personalExpenses.length) {
    return {
      answer: "Based on your records, I could not find any expenses paid from personal accounts for that period.",
      facts: { totalPaidPersonally: 0, totalReimbursed: 0, outstanding: 0, unreimbursedCount: 0, period: { start, end } },
      transactions: []
    };
  }

  const lines = unreimbursed.slice(0, 10).map(r =>
    `- ${r.date}: ${currency} ${Number(r.amount).toFixed(2)} — ${r.merchant || r.description || "Unknown"} (${r.reimbursement_status === "partially_reimbursed" ? `partially reimbursed, ${currency} ${(Number(r.amount) - Number(r.reimbursed_amount || 0)).toFixed(2)} outstanding` : "not yet reimbursed"})`
  ).join("\n");

  const answer = `Based on your records, here is a summary of business expenses paid personally:\n\nTotal paid personally: ${currency} ${totalPaid.toFixed(2)}\nReimbursed: ${currency} ${totalReimbursed.toFixed(2)}\nOutstanding (business owes you): ${currency} ${outstanding.toFixed(2)}\n\n${unreimbursed.length ? `Unreimbursed transactions (${unreimbursed.length}):\n${lines}` : "All personally paid expenses appear to have been reimbursed."}\n\nThis is based on your records and is for planning purposes only. Please confirm with your accountant.`;

  return {
    answer,
    facts: { totalPaidPersonally: totalPaid, totalReimbursed, outstanding, unreimbursedCount: unreimbursed.length, period: { start, end } },
    transactions: personalExpenses.slice(0, 50)
  };
}

export async function POST(req: Request) {
  const body = await req.json();
  const { question } = body || {};
  if (!question) return NextResponse.json({ error: 'Missing question' }, { status: 400 });

  const authHeader = req.headers.get('authorization');
  const user_id = await getUserIdFromAuthHeader(authHeader);
  if (!user_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!client) return NextResponse.json({ error: 'Server: OPENAI_API_KEY not configured' }, { status: 500 });

  const q = String(question || '');
  const normalizedQuestion = q.toLowerCase();
  try {
    // Determine time range heuristically
    const now = new Date();
    let start: Date | null = null;
    let end: Date | null = null;
    if (normalizedQuestion.includes('this month')) { start = startOfMonth(now); end = endOfMonth(now); }
    else if (normalizedQuestion.includes('last month')) { const d = new Date(); d.setMonth(d.getMonth() - 1); start = startOfMonth(d); end = endOfMonth(d); }
    else if (normalizedQuestion.includes('this quarter')) { const r = quarterRangeForOffset(0); start = r.start; end = r.end; }
    else if (normalizedQuestion.includes('last quarter')) { const r = quarterRangeForOffset(-1); start = r.start; end = r.end; }
    else if (normalizedQuestion.includes('this year') || normalizedQuestion.includes('year to date') || normalizedQuestion.includes('ytd')) { start = new Date(now.getFullYear(), 0, 1); end = now; }
    else if (normalizedQuestion.includes('last year')) { start = new Date(now.getFullYear() - 1, 0, 1); end = new Date(now.getFullYear() - 1, 11, 31); }
    else { start = new Date(now.getFullYear(), now.getMonth() - 11, 1); end = now; }

    // Detect reimbursement / director expense intent
    const isReimbursementQuery = normalizedQuestion.includes('owe me') || normalizedQuestion.includes('owes me') ||
      normalizedQuestion.includes('personal account') || normalizedQuestion.includes('personal card') ||
      normalizedQuestion.includes('paid personally') || normalizedQuestion.includes('reimburse') ||
      normalizedQuestion.includes('reimbursement') || normalizedQuestion.includes('director') ||
      normalizedQuestion.includes('business owes');

    if (isReimbursementQuery) {
      const directorRows = await fetchDirectorExpenses(user_id, start?.toISOString().slice(0, 10), end?.toISOString().slice(0, 10));
      return NextResponse.json(buildDirectorExpensesAnswer(directorRows, start?.toISOString().slice(0, 10), end?.toISOString().slice(0, 10)));
    }

    // Category and intent filters
    let filterSql: string | undefined;
    if (normalizedQuestion.includes('uncategor')) filterSql = `category.is.null,category.eq.''`;
    if (normalizedQuestion.includes('loan')) filterSql = `category.eq.Director Loan,description.ilike.%loan%,merchant.ilike.%loan%`;
    if (normalizedQuestion.includes('contractor') || normalizedQuestion.includes('freelancer')) filterSql = `category.ilike.%contractor%,category.ilike.%freelancer%,description.ilike.%contractor%,merchant.ilike.%contractor%`;
    if (normalizedQuestion.includes('software')) filterSql = `category.ilike.%software%,description.ilike.%software%,merchant.ilike.%software%`;
    // Biggest expenses -> extend range to year-to-date
    if (normalizedQuestion.includes('biggest') || normalizedQuestion.includes('largest') || normalizedQuestion.includes('biggest expenses')) { start = new Date(now.getFullYear(), 0, 1); end = now; }

    const rows = await fetchTransactions({ user_id, start: start?.toISOString().slice(0,10), end: end?.toISOString().slice(0,10), filterSql, limit: 1000 });
    const sanitized = sanitizeRows(rows as any[]);
    const period = { start: start?.toISOString().slice(0,10), end: end?.toISOString().slice(0,10) };

    if (!sanitized.length) {
      return NextResponse.json({ answer: `I couldn't find any matching transactions in your records for that query. Please check the time period or provide more details.`, data: { count: 0 } });
    }

    if (normalizedQuestion.includes("loan")) {
      return NextResponse.json(buildLoanAnswer(sanitized, period.start, period.end));
    }

    // Compute facts
    const totalIncome = sanitized.reduce((s, t) => s + (t.type === 'income' ? Number(t.amount || 0) : 0), 0);
    const totalExpenses = sanitized.reduce((s, t) => s + (t.type === 'expense' ? Number(t.amount || 0) : 0), 0);
    const net = totalIncome - totalExpenses;
    const deductible = sanitized.filter(t => t.tax_deductible).reduce((s, t) => s + Number(t.amount || 0), 0);
    const totalPersonallyPaid = sanitized.filter(t => t.payment_source === 'personal_account' || t.payment_source === 'personal_credit_card').reduce((s, t) => s + Number(t.amount || 0), 0);
    const totalOutstanding = sanitized.reduce((s, t) => {
      if (t.reimbursement_status === 'owed_to_director') return s + Number(t.amount || 0);
      if (t.reimbursement_status === 'partially_reimbursed') return s + Math.max(0, Number(t.amount || 0) - Number(t.reimbursed_amount || 0));
      return s;
    }, 0);

    // Build LLM prompt
    const sample = sanitized.slice(0, 200);
    const FACTS = `period_start: ${start?.toISOString().slice(0,10)}\nperiod_end: ${end?.toISOString().slice(0,10)}\ntransactions_count: ${sanitized.length}\ntotal_income: ${totalIncome}\ntotal_expenses: ${totalExpenses}\nnet: ${net}\ntax_deductible_total: ${deductible}\ntotal_personally_paid: ${totalPersonallyPaid}\ntotal_outstanding_reimbursement: ${totalOutstanding}`;
    const userPrompt = `User question: ${q}\n\nFACTS:\n${FACTS}\n\nTRANSACTIONS (showing up to ${sample.length} rows):\n${JSON.stringify(sample, null, 2)}\n\nUsing ONLY the FACTS and TRANSACTIONS above, answer the user's question in plain English. Include numeric totals where relevant and use the safe phrasing described in the system instructions. If there is insufficient data, say so. Keep it short (1-3 short paragraphs). End with: "Please confirm with your accountant before acting on this information."`;

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.0,
      max_tokens: 700
    });

    const llmText = stripMachineReadableBlocks(completion.choices?.[0]?.message?.content ?? '');
    const result = { answer: llmText, facts: { totalIncome, totalExpenses, net, deductible, transactionsCount: sanitized.length, period }, transactions: sample };

    // Log the assistant query and response to ai_logs with PII redaction (best-effort heuristics)
    try {
      const redactedQuestion = redactText(q);
      const redactedSample = redactObject(sample);
      const logPayload = {
        user_id,
        business_id: null,
        kind: 'assistant_query',
        input: { question: redactedQuestion, facts: { totalIncome, totalExpenses, net, deductible, transactionsCount: sanitized.length, period: { start: start?.toISOString().slice(0,10), end: end?.toISOString().slice(0,10) } }, transactions: redactedSample },
        output: { answer: llmText }
      };
      const { error: logError } = await supabaseAdmin.from('ai_logs').insert([logPayload]);
      if (logError) {
        // eslint-disable-next-line no-console
        console.warn('Failed to insert assistant log:', logError.message ?? logError);
      }
    } catch (logErr: any) {
      // eslint-disable-next-line no-console
      console.warn('Assistant logging error', logErr);
    }

    return NextResponse.json(result);
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error(err);
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 });
  }
}
