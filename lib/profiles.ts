import { supabaseAdmin } from "./supabaseAdmin";

type SupabaseAuthUser = {
  id: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    name?: string;
    avatar_url?: string;
  };
};

export async function ensureProfileForUser(user: SupabaseAuthUser) {
  if (!user?.id) return;

  await supabaseAdmin.from("profiles").upsert(
    {
      avatar_url: user.user_metadata?.avatar_url ?? null,
      email: user.email ?? null,
      full_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
      id: user.id
    },
    { onConflict: "id" }
  );
}
