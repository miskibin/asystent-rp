import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

export function createTygodnikClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.TYGODNIK_SUPABASE_URL;
  const key = process.env.TYGODNIK_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Tygodnik data source is not configured");

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
