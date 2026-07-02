import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabaseClient";

export async function GET(req: Request) {
  const { data, error } = await supabase.auth.getUser();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data.user ?? null);
}
