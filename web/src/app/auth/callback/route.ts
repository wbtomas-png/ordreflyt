// file: web/src/app/auth/callback/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseServiceServer } from "@/lib/supabase/server-clients";

export async function GET(req: Request) {
  const url = new URL(req.url);

  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/products";

  // Hvis Supabase sender error i query
  const error = url.searchParams.get("error");
  const errorDesc = url.searchParams.get("error_description");
  if (error) {
    const loginUrl = new URL("/login", url.origin);
    loginUrl.searchParams.set("error", error);
    if (errorDesc) loginUrl.searchParams.set("error_description", errorDesc);
    return NextResponse.redirect(loginUrl);
  }

  if (!code) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  // 1) Bytt code -> session (setter cookies via supabaseServer())
  const supabase = await supabaseServer();

  const exchanged = await supabase.auth.exchangeCodeForSession(code);
  if (exchanged.error) {
    const loginUrl = new URL("/login", url.origin);
    loginUrl.searchParams.set("error", exchanged.error.message);
    return NextResponse.redirect(loginUrl);
  }

  // 2) Hent session og sjekk allowlist (server-side)
  const { data: sessionRes } = await supabase.auth.getSession();
  const session = sessionRes.session;

  if (!session?.user?.email) {
    const loginUrl = new URL("/login", url.origin);
    loginUrl.searchParams.set("error", "No session after exchange");
    return NextResponse.redirect(loginUrl);
  }

  const email = session.user.email.toLowerCase();

  const svc = supabaseServiceServer();
  const { data: allowed, error: allowErr } = await svc
    .from("allowed_emails")
    .select("email")
    .eq("email", email)
    .maybeSingle();

  if (allowErr) {
    const loginUrl = new URL("/login", url.origin);
    loginUrl.searchParams.set("error", allowErr.message);
    return NextResponse.redirect(loginUrl);
  }

  if (!allowed?.email) {
    // Valgfritt: logg ut ved å fjerne cookies (ikke alltid nødvendig)
    const deniedUrl = new URL("/login", url.origin);
    deniedUrl.searchParams.set("denied", "1");
    return NextResponse.redirect(deniedUrl);
  }

  // 3) Ferdig: redirect inn i appen
  return NextResponse.redirect(new URL(next, url.origin));
}