// file: web/src/lib/supabase/browser.ts
import { createClient } from "@supabase/supabase-js";

export function supabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createClient(url, anon, {
    auth: {
      // ✅ må være true i browser, ellers forsvinner PKCE state mellom redirects
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // ✅ tving PKCE (hindrer implicit/hash flow for OAuth)
      flowType: "pkce",
    },
  });
}