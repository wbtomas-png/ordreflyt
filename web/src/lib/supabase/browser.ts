// file: web/src/lib/supabase/browser.ts
import { createClient } from "@supabase/supabase-js";

let _client: ReturnType<typeof createClient> | null = null;

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    // Dette gjør at feilen blir synlig i både build og runtime.
    throw new Error(
      `Missing environment variable ${name}. ` +
        `Set it in Vercel (Production/Preview) and locally in web/.env.local.`
    );
  }
  return v;
}

export function supabaseBrowser() {
  if (_client) return _client;

  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"); // publishable key (sb_publishable_...) er riktig her

  _client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return _client;
}