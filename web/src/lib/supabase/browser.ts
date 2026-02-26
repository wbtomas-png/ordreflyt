// file: web/src/lib/supabase/browser.ts
import { createClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `Missing environment variable ${name}. Set it in Vercel (Production/Preview) and locally in web/.env.local`
    );
  }
  return v;
}

const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const anon = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

// Kun i browser (unngå å spamme server logs)
if (typeof window !== "undefined") {
  // Ikke logg hele nøkkelen; bare om den finnes
  // eslint-disable-next-line no-console
  console.log("[env] NEXT_PUBLIC_SUPABASE_URL set:", !!url);
  // eslint-disable-next-line no-console
  console.log("[env] NEXT_PUBLIC_SUPABASE_ANON_KEY set:", !!anon);
}

export function supabaseBrowser() {
  return createClient(url, anon);
}