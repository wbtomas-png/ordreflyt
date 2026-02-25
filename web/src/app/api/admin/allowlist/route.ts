// file: web/src/app/api/admin/allowlist/route.ts

import { NextResponse } from "next/server";
import {
  adminEmailSet,
  supabaseAnonServer,
  supabaseServiceServer,
} from "@/lib/supabase/server-clients";

type Role = "kunde" | "admin" | "innkjøper";

function normEmail(s: unknown) {
  return String(s ?? "").trim().toLowerCase();
}

function normName(s: unknown) {
  // tillat tom streng (så kan vi bruke fallback), men trim whitespace
  return String(s ?? "").trim();
}

function normRole(s: unknown): Role | null {
  const r = String(s ?? "").trim().toLowerCase();
  if (r === "kunde" || r === "admin" || r === "innkjøper") return r;
  return null;
}

function isValidEmail(email: string) {
  // enkel sjekk (ikke RFC), bra nok for allowlist
  return Boolean(email) && email.includes("@") && !email.includes(" ");
}

async function assertAdmin(req: Request) {
  const pass = req.headers.get("x-admin-password") ?? "";
  if (!pass || pass !== process.env.ACCESS_ADMIN_PASSWORD) {
    return { ok: false as const, status: 401, error: "Bad admin password" };
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (!token) {
    return { ok: false as const, status: 401, error: "Missing bearer token" };
  }

  const anon = supabaseAnonServer();
  const { data: userRes, error: userErr } = await anon.auth.getUser(token);

  if (userErr || !userRes.user?.email) {
    return { ok: false as const, status: 401, error: "Invalid session" };
  }

  const email = normEmail(userRes.user.email);
  const admins = adminEmailSet();
  if (!admins.has(email)) {
    return { ok: false as const, status: 403, error: "Not an admin" };
  }

  return { ok: true as const, email };
}

export async function GET(req: Request) {
  const gate = await assertAdmin(req);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error },
      { status: gate.status }
    );
  }

  const svc = supabaseServiceServer();
  const { data, error } = await svc
    .from("allowed_emails")
    .select("email, display_name, role, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rows: data ?? [] });
}

export async function POST(req: Request) {
  const gate = await assertAdmin(req);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error },
      { status: gate.status }
    );
  }

  const body = await req.json().catch(() => null);

  const email = normEmail(body?.email);
  const display_name = normName(body?.display_name);
  const role = normRole(body?.role) ?? "kunde";

  if (!isValidEmail(email)) {
    return NextResponse.json({ ok: false, error: "Invalid email" }, { status: 400 });
  }

  // display_name kan være tom. Da kan UI bruke fallback til email senere.
  const svc = supabaseServiceServer();
  const { error } = await svc
    .from("allowed_emails")
    .upsert(
      { email, display_name: display_name || null, role },
      { onConflict: "email" }
    );

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const gate = await assertAdmin(req);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error },
      { status: gate.status }
    );
  }

  const body = await req.json().catch(() => null);

  const email = normEmail(body?.email);
  const role = body?.role !== undefined ? normRole(body?.role) : null;
  const display_name =
    body?.display_name !== undefined ? normName(body?.display_name) : null;

  if (!isValidEmail(email)) {
    return NextResponse.json({ ok: false, error: "Invalid email" }, { status: 400 });
  }

  const patch: Record<string, any> = {};

  if (role) patch.role = role;
  if (body?.role !== undefined && !role) {
    return NextResponse.json({ ok: false, error: "Invalid role" }, { status: 400 });
  }

  if (display_name !== null) patch.display_name = display_name || null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { ok: false, error: "Nothing to update" },
      { status: 400 }
    );
  }

  const svc = supabaseServiceServer();
  const { error } = await svc.from("allowed_emails").update(patch).eq("email", email);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const gate = await assertAdmin(req);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error },
      { status: gate.status }
    );
  }

  const { searchParams } = new URL(req.url);
  const email = normEmail(searchParams.get("email"));

  if (!isValidEmail(email)) {
    return NextResponse.json({ ok: false, error: "Missing email" }, { status: 400 });
  }

  const svc = supabaseServiceServer();
  const { error } = await svc.from("allowed_emails").delete().eq("email", email);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}