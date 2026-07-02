export async function getUserFromAuthHeader(authHeader?: string | null) {
  if (!authHeader) return null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: authHeader,
        apikey: supabaseAnonKey
      }
    });

    if (!response.ok) return null;
    const user = await response.json();
    return user?.id ? user : null;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to validate Supabase session", error);
    return null;
  }
}

export async function getUserIdFromAuthHeader(authHeader?: string | null) {
  const user = await getUserFromAuthHeader(authHeader);
  return user?.id ?? null;
}
