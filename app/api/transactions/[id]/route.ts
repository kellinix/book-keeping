import { NextResponse } from "next/server";
import { getUserIdFromAuthHeader } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { reconciliationKey } from "../../../../lib/reconciliation";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  const authHeader = req.headers.get('authorization');
  const user_id = await getUserIdFromAuthHeader(authHeader);
  if (!user_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify ownership or business membership before making changes (supabaseAdmin bypasses RLS)
  const { data: original, error: origErr } = await supabaseAdmin.from('transactions').select('*').eq('id', id).single();
  if (origErr || !original) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let allowed = false;
  if (original.user_id === user_id) allowed = true;
  if (!allowed && original.business_id) {
    const { data: bm } = await supabaseAdmin.from('business_members').select('id').eq('business_id', original.business_id).eq('user_id', user_id).limit(1);
    if (bm && bm.length) allowed = true;
  }
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();

  // General fields any authorised user (owner or business member) may edit
  const memberFields = [
    "transaction_date", "description", "merchant", "amount", "currency",
    "type", "category", "payment_method", "notes", "tags", "is_business",
    "tax_deductible", "confidence_score", "payment_source", "paid_by"
  ];

  // Financial-status fields only the transaction owner may write
  const ownerOnlyFields = [
    "director_reimbursable", "reimbursement_status",
    "reimbursed_amount", "reimbursed_date", "reimbursement_notes", "bank_account_id", "user_confirmed"
  ];

  const isOwner = original.user_id === user_id;
  const allowedFields = isOwner ? [...memberFields, ...ownerOnlyFields] : memberFields;
  const update: Record<string, unknown> = Object.fromEntries(Object.entries(body).filter(([key]) => allowedFields.includes(key)));
  if (update.amount !== undefined) {
    const amount = Math.abs(Number(update.amount));
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Amount must be positive" }, { status: 400 });
    update.amount = amount;
    update.amount_pence = Math.round(amount * 100);
  }
  if (update.bank_account_id) {
    const { data: account } = await supabaseAdmin.from("bank_accounts").select("id").eq("id", String(update.bank_account_id)).eq("user_id", user_id).maybeSingle();
    if (!account) return NextResponse.json({ error: "Invalid account source" }, { status: 403 });
  }
  const next = { ...original, ...update };
  if (next.is_business === false) {
    update.tax_deductible = false;
    next.tax_deductible = false;
  }
  update.reconciliation_key = reconciliationKey(next);
  const { error, data } = await supabaseAdmin.from('transactions').update({ ...update, updated_at: new Date().toISOString() }).eq('id', id).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  const authHeader = req.headers.get('authorization');
  const user_id = await getUserIdFromAuthHeader(authHeader);
  if (!user_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: original, error: origErr } = await supabaseAdmin.from('transactions').select('id,user_id,business_id').eq('id', id).single();
  if (origErr || !original) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let allowed = false;
  if (original.user_id === user_id) allowed = true;
  if (!allowed && original.business_id) {
    const { data: bm } = await supabaseAdmin.from('business_members').select('id').eq('business_id', original.business_id).eq('user_id', user_id).limit(1);
    if (bm && bm.length) allowed = true;
  }
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { error } = await supabaseAdmin.from('transactions').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
