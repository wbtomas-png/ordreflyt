import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  const supabase = await supabaseServer();

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const to = new URL("/login", url.origin);
    to.searchParams.set("err", "oauth_failed");
    return NextResponse.redirect(to);
  }

  return NextResponse.redirect(new URL("/products", url.origin));
}