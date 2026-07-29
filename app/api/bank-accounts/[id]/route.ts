import { NextResponse } from "next/server";
import { getUserIdFromAuthHeader } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { trueLayerAccountRef } from "../../../../lib/truelayer";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const userId = await getUserIdFromAuthHeader(req.headers.get("authorization"));
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (typeof body?.isBusiness !== "boolean") return NextResponse.json({ error: "isBusiness must be true or false" }, { status: 400 });

  const { data: account } = await supabaseAdmin.from("bank_accounts").select("id,provider_account_id").eq("id", params.id).eq("user_id", userId).maybeSingle();
  if (!account) return NextResponse.json({ error: "Bank account not found" }, { status: 404 });

  const { error: accountError } = await supabaseAdmin.from("bank_accounts").update({ is_business: body.isBusiness }).eq("provider_account_id", account.provider_account_id).eq("user_id", userId);
  if (accountError) return NextResponse.json({ error: accountError.message }, { status: 500 });

  let updatedTransactions = 0;
  if (body.applyToExisting !== false) {
    const classification = body.isBusiness
      ? { is_business: true, payment_source: "business_account", paid_by: "company" }
      : { is_business: false, payment_source: "personal_account", paid_by: "owner" };
    const { count, error } = await supabaseAdmin
      .from("transactions")
      .update({
        ...classification,
        tax_deductible: false,
        director_reimbursable: false,
        reimbursement_status: "not_applicable",
        user_confirmed: false,
        updated_at: new Date().toISOString()
      }, { count: "exact" })
      .eq("user_id", userId)
      .eq("provider_account_ref", trueLayerAccountRef(account.provider_account_id))
      .eq("source", "bank_connection");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    updatedTransactions = count ?? 0;
  }

  return NextResponse.json({ isBusiness: body.isBusiness, updatedTransactions });
}
