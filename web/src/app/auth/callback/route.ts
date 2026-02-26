import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  // Hvis vi ikke har code, er dette ikke en gyldig OAuth callback
  if (!code) {
    return NextResponse.redirect(new URL("/login?e=missing_code", url.origin));
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          for (const c of cookiesToSet) {
            // c = { name, value, options }
            cookieStore.set(c.name, c.value, c.options);
          }
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Send feilen til login så vi ser hva som skjer
    const e = encodeURIComponent(error.message);
    return NextResponse.redirect(new URL(`/login?e=${e}`, url.origin));
  }

  // OK – nå er session-cookie satt på domenet
  return NextResponse.redirect(new URL("/products", url.origin));
}