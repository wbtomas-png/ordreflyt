import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;

  if (!token) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!url || !anon) {
    return new NextResponse("Missing Supabase env", { status: 500 });
  }

  // Viktig: global Authorization gjør at RLS + Storage kjører som brukeren
  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // Verifiser tokenet og hent user
  const { data: userRes, error: userErr } = await supabase.auth.getUser(token);
  const user = userRes?.user;

  if (userErr || !user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Hent ordre og path til PDF
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, user_id, confirmation_file_path")
    .eq("id", id)
    .single();

  if (error || !order?.confirmation_file_path) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Bestiller kan kun hente egen ordre (stramt)
  if (order.user_id !== user.id) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Signed URL (10 minutter)
  const { data: signed, error: signErr } = await supabase.storage
    .from("order-confirmations")
    .createSignedUrl(order.confirmation_file_path, 60 * 10);

  if (signErr || !signed?.signedUrl) {
    return new NextResponse("Could not sign", { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl });
}