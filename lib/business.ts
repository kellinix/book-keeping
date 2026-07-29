import { supabase } from "./supabaseClient";

export type Business = {
  id: string;
  owner_id: string;
  name: string | null;
  business_type: string | null;
  base_currency: string | null;
  tax_year_start: string | null;
  tax_year_end: string | null;
  corporation_tax_rate: number | string | null;
  export_preferences: { format?: string } | null;
  mtd_enrolled: boolean | null;
  created_at: string;
};

/**
 * Returns the caller's business, creating a default one if none exists yet.
 * Uses order+limit instead of .maybeSingle() directly: if a stale duplicate
 * row ever exists, maybeSingle() throws and callers used to treat that as
 * "no business found", inserting another duplicate on every load.
 */
export async function getOrCreateBusiness(userId: string, userEmail?: string | null): Promise<Business> {
  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  if (data && data.length > 0) return data[0] as Business;

  const { data: inserted, error: insertError } = await supabase
    .from("businesses")
    .insert({ owner_id: userId, name: `${userEmail ?? "My"} Business`, base_currency: "GBP", corporation_tax_rate: 25 })
    .select()
    .single();
  if (insertError) throw insertError;
  return inserted as Business;
}
