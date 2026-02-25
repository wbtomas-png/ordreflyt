import { NextResponse } from "next/server";
import { supabaseAnonServer, supabaseServiceServer } from "@/lib/supabase/server-clients";

function normEmail(s: string) {
  return String(s ?? "").trim().toLowerCase();
}

async function assertAdminByAllowlist(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (!token) return { ok: false as const, status: 401, error: "Missing bearer token" };

  const anon = supabaseAnonServer();
  const { data: userRes, error: userErr } = await anon.auth.getUser(token);
  if (userErr || !userRes.user?.email) {
    return { ok: false as const, status: 401, error: "Invalid session" };
  }

  const email = normEmail(userRes.user.email);

  const svc = supabaseServiceServer();
  const { data, error } = await svc
    .from("allowed_emails")
    .select("email, role")
    .eq("email", email)
    .maybeSingle();

  if (error) return { ok: false as const, status: 500, error: error.message };
  if (!data?.email) return { ok: false as const, status: 403, error: "Not allowed" };
  if (data.role !== "admin") return { ok: false as const, status: 403, error: "Admin only" };

  return { ok: true as const, email };
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await assertAdminByAllowlist(req);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
  }

  const svc = supabaseServiceServer();

  // Slett i riktig rekkefølge (barn -> forelder)
  const { error: itemsErr } = await svc.from("order_items").delete().eq("order_id", id);
  if (itemsErr) {
    return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 });
  }

  const { error: orderErr } = await svc.from("orders").delete().eq("id", id);
  if (orderErr) {
    return NextResponse.json({ ok: false, error: orderErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}