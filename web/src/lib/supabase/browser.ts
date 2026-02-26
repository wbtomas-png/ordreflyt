// file: web/src/lib/supabase/browser.ts
import { createClient } from "@supabase/supabase-js";

function getEnv(name: string): string {
  const v = process.env[name];
  return typeof v === "string" ? v : "";
}

const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

// IKKE throw på import-tid (det kan gi "client-side exception" og svart side).
// Throw først når funksjonen kalles i browser.
export function supabaseBrowser() {
  if (!url || !anon) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Set in Vercel (Production/Preview) and locally in web/.env.local, then redeploy."
    );
  }

  return createClient(url, anon, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}