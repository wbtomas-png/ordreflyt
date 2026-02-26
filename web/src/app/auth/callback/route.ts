// file: web/src/app/auth/callback/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseServiceServer } from "@/lib/supabase/server-clients";

function toLogin(origin: string, step: string, detail?: string) {
  const u = new URL("/login", origin);
  u.searchParams.set("cb", step);
  if (detail) u.searchParams.set("detail", detail);
  return NextResponse.redirect(u);
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/products";

  const oauthErr = url.searchParams.get("error");
  const oauthDesc = url.searchParams.get("error_description");

  if (oauthErr) {
    return toLogin(url.origin, "oauth_error", `${oauthErr}${oauthDesc ? `: ${oauthDesc}` : ""}`);
  }

  if (!code) {
    return toLogin(url.origin, "missing_code");
  }

  const supabase = await supabaseServer();

  const ex = await supabase.auth.exchangeCodeForSession(code);
  if (ex.error) {
    return toLogin(url.origin, "exchange_failed", ex.error.message);
  }

  const ses = await supabase.auth.getSession();
  const session = ses.data.session;

  if (!session?.user?.email) {
    return toLogin(url.origin, "no_session_after_exchange");
  }

  const email = session.user.email.toLowerCase();

  const svc = supabaseServiceServer();
  const allowed = await svc
    .from("allowed_emails")
    .select("email")
    .eq("email", email)
    .maybeSingle();

  if (allowed.error) {
    return toLogin(url.origin, "allowlist_db_error", allowed.error.message);
  }

  if (!allowed.data?.email) {
    return toLogin(url.origin, "denied", email);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}