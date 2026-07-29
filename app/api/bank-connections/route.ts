import { NextResponse } from "next/server";
import { getUserIdFromAuthHeader } from "../../../lib/auth";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { isTrueLayerConfigured, isTrueLayerSandbox } from "../../../lib/truelayer";

export async function GET(req: Request) {
  const userId = await getUserIdFromAuthHeader(req.headers.get("authorization"));
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isTrueLayerConfigured()) return NextResponse.json({ configured: false, connections: [], sandbox: false });
  const { data, error } = await supabaseAdmin.from("bank_connections").select("id,provider_name,status,expires_at,consent_expires_at,last_synced_at,created_at,bank_accounts(id,display_name,account_type,currency,account_number_masked,is_business)").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ configured: true, connections: data || [], sandbox: isTrueLayerSandbox() });
}
