import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (typeof window !== "undefined") {
  console.log("[env] NEXT_PUBLIC_SUPABASE_URL:", url);
  console.log("[env] NEXT_PUBLIC_SUPABASE_ANON_KEY set:", !!anon);
}

if (!url) throw new Error("Missing environment variable NEXT_PUBLIC_SUPABASE_URL. Set it in Vercel and .env.local");
if (!anon) throw new Error("Missing environment variable NEXT_PUBLIC_SUPABASE_ANON_KEY. Set it in Vercel and .env.local");

export function supabaseBrowser() {
  return createClient(url, anon);
}