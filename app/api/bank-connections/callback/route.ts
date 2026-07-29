import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { encryptToken, exchangeCode, readState, trueLayerGet } from "../../../../lib/truelayer";

type Account = { account_id: string; display_name?: string; account_type?: string; currency?: string; provider?: { display_name?: string }; account_number?: { number?: string } };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const destination = new URL("/settings", url.origin);
  try {
    if (url.searchParams.get("error")) throw new Error(url.searchParams.get("error") || "Bank authorization declined");
    const code = url.searchParams.get("code"); const state = url.searchParams.get("state");
    if (!code || !state) throw new Error("Missing bank authorization response");
    const { userId } = readState(state);
    const tokens = await exchangeCode(code);
    const accounts = (await trueLayerGet<Account>("/accounts", tokens.access_token)).results;
    const cards = await trueLayerGet<Account>("/cards", tokens.access_token).then((r) => r.results).catch(() => []);
    const providerName = accounts[0]?.provider?.display_name || cards[0]?.provider?.display_name || "Connected bank";
    const { data: connection, error } = await supabaseAdmin.from("bank_connections").insert({
      user_id: userId, provider: "truelayer", provider_name: providerName, access_token_encrypted: encryptToken(tokens.access_token),
      refresh_token_encrypted: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      consent_expires_at: new Date(Date.now() + Math.max(1, Number(process.env.OPEN_BANKING_CONSENT_DAYS) || 90) * 24 * 60 * 60 * 1000).toISOString(), status: "active"
    }).select("id").single();
    if (error) throw error;
    for (const account of [...accounts, ...cards]) {
      const accountData = {
        connection_id: connection.id,
        user_id: userId,
        provider_account_id: account.account_id,
        display_name: account.display_name || "Bank account",
        account_type: account.account_type || "TRANSACTION",
        currency: account.currency || "GBP",
        account_number_masked: account.account_number?.number ? `••••${account.account_number.number.slice(-4)}` : null
      };
      // Reuse the account row when OAuth is renewed so linked transactions keep
      // the same internal id. New accounts default to Personal until explicitly classified.
      const { data: existing } = await supabaseAdmin.from("bank_accounts").select("id").eq("user_id", userId).eq("provider_account_id", account.account_id).order("created_at", { ascending: true }).limit(1).maybeSingle();
      const result = existing
        ? await supabaseAdmin.from("bank_accounts").update(accountData).eq("id", existing.id).eq("user_id", userId)
        : await supabaseAdmin.from("bank_accounts").insert({ ...accountData, is_business: false });
      if (result.error) throw result.error;
    }
    destination.searchParams.set("bank", "connected");
  } catch (error) {
    console.error("Bank callback error", error);
    destination.searchParams.set("bank", "error");
  }
  return NextResponse.redirect(destination);
}
