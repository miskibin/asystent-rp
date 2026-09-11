"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | undefined;

/** Creates the browser client used by the existing OAuth UI. */
export function createClientComponentClient(): SupabaseClient {
  if (browserClient) return browserClient;

  // Keep static generation safe; deployed environments must provide the real values.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key";

  browserClient = createBrowserClient(url, key);
  return browserClient;
}
