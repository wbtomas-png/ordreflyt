import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function assertEnv(name: string, value: string) {
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing environment variable ${name}. Set it in Vercel (Production/Preview) and locally in web/.env.local`
    );
  }
}

assertEnv("NEXT_PUBLIC_SUPABASE_URL", url);
assertEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", anon);

// Ikke spam server logs
if (typeof window !== "undefined") {
  // eslint-disable-next-line no-console
  console.log("[env] NEXT_PUBLIC_SUPABASE_URL set:", true);
  // eslint-disable-next-line no-console
  console.log("[env] NEXT_PUBLIC_SUPABASE_ANON_KEY set:", true);
}

export function supabaseBrowser() {
  return createClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true, // VIKTIG for hash (#access_token=...) callback
      flowType: "pkce",         // Be om PKCE, men vi støtter også hash
    },
  });
}