import { NextResponse } from "next/server";
import { supabaseAnonServer, supabaseServiceServer } from "@/lib/supabase/server-clients";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (!token) return NextResponse.json({ ok: false, error: "Missing bearer token" }, { status: 401 });

  const anon = supabaseAnonServer();
  const { data: userRes, error: userErr } = await anon.auth.getUser(token);
  if (userErr || !userRes.user?.email) {
    return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 401 });
  }

  const email = userRes.user.email.toLowerCase();

  const svc = supabaseServiceServer();
  const { data, error } = await svc
    .from("allowed_emails")
    .select("email")
    .eq("email", email)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data?.email) return NextResponse.json({ ok: false, denied: true }, { status: 403 });

  return NextResponse.json({ ok: true });
}