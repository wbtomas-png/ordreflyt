// file: web/src/app/api/auth/me/route.ts

import { NextResponse } from "next/server";
import {
  supabaseAnonServer,
  supabaseServiceServer,
} from "@/lib/supabase/server-clients";

type Role = "kunde" | "admin" | "innkjøper";

function normEmail(s: unknown) {
  return String(s ?? "").trim().toLowerCase();
}

function normRole(s: unknown): Role {
  const r = String(s ?? "").trim().toLowerCase();
  if (r === "kunde" || r === "admin" || r === "innkjøper") return r;
  return "kunde";
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";

  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Missing bearer token" },
      { status: 401 }
    );
  }

  const anon = supabaseAnonServer();
  const { data: userRes, error: userErr } = await anon.auth.getUser(token);

  if (userErr || !userRes.user?.email) {
    return NextResponse.json(
      { ok: false, error: "Invalid session" },
      { status: 401 }
    );
  }

  const email = normEmail(userRes.user.email);

  const svc = supabaseServiceServer();
  const { data, error } = await svc
    .from("allowed_emails")
    .select("email, role, display_name")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  if (!data?.email) {
    return NextResponse.json({ ok: false, denied: true }, { status: 403 });
  }

  const role = normRole(data.role);
  const display_name =
    String((data as any).display_name ?? "").trim() || null;

  return NextResponse.json({
    ok: true,
    email,
    role,
    display_name, // <- bruk dette i UI (fallback til email hvis null)
  });
}