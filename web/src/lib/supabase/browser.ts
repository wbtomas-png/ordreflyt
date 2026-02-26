// file: web/src/lib/supabase/browser.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// OBS: I Next.js må NEXT_PUBLIC_* leses med statisk property access,
// ellers blir de ikke inlinet i client-bundle.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Cache én client per browser-tab
let _client: SupabaseClient | null = null;

function envOk(v: string | undefined): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function supabaseBrowser(): SupabaseClient {
  if (_client) return _client;

  // Ikke throw i module-scope (det dreper hele appen før UI vises).
  // Throw her gjør feilen mer lokal og lettere å debugge.
  if (!envOk(URL)) {
    throw new Error(
      "Missing environment variable NEXT_PUBLIC_SUPABASE_URL. " +
        "Set it in Vercel (Preview/Production) and in web/.env.local"
    );
  }
  if (!envOk(ANON)) {
    throw new Error(
      "Missing environment variable NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Set it in Vercel (Preview/Production) and in web/.env.local"
    );
  }

  if (typeof window !== "undefined") {
    // eslint-disable-next-line no-console
    console.log("[supabase] URL set:", true);
    // eslint-disable-next-line no-console
    console.log("[supabase] ANON key set:", true);
  }

  _client = createClient(URL, ANON);
  return _client;
}