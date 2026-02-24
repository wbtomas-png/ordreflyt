// file: web/src/app/api/files/signed-url/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function bearerToken(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

function jsonError(status: number, message: string, details?: unknown) {
  return NextResponse.json(
    { ok: false, error: message, ...(details !== undefined ? { details } : {}) },
    { status }
  );
}

// Stram inn hvilke buckets som er lov å signere
const ALLOWED_BUCKETS = new Set(["product-images", "product-files"]);

export async function GET(req: Request) {
  try {
    const url = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    const token = bearerToken(req);
    if (!token) return jsonError(401, "Mangler Authorization token.");

    const { searchParams } = new URL(req.url);

    const bucket = (searchParams.get("bucket") ?? "").trim();
    const storagePath = (searchParams.get("path") ?? "").trim();

    const expiresRaw = searchParams.get("expires");
    const expires = Math.max(
      60,
      Math.min(60 * 60, Number(expiresRaw ?? "600") || 600)
    );

    const download = searchParams.get("download") === "1";

    if (!bucket) return jsonError(400, "Mangler bucket.");
    if (!ALLOWED_BUCKETS.has(bucket))
      return jsonError(400, `Ugyldig bucket: ${bucket}`);
    if (!storagePath) return jsonError(400, "Mangler path.");

    // 1) Verifiser innlogget bruker (JWT)
    const supabaseAnon = createClient(url, anonKey, {
      auth: { persistSession: false },
    });

    const { data: userRes, error: userErr } = await supabaseAnon.auth.getUser(
      token
    );

    if (userErr || !userRes?.user) {
      return jsonError(401, "Ugyldig session. Logg inn på nytt.", userErr?.message);
    }

    // 2) (Anbefalt) Rolle-sjekk. Hvis du vil at ALLE innloggede skal kunne se filer,
    // kan du fjerne denne blokken.
    const supabaseService = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: prof, error: profErr } = await supabaseService
      .from("profiles")
      .select("role")
      .eq("user_id", userRes.user.id)
      .maybeSingle();

    if (profErr) {
      return jsonError(500, "Kunne ikke hente profil.", profErr.message);
    }

    const role = ((prof as any)?.role ?? "").toString().toUpperCase();
    const allowed = role === "ADMIN" || role === "PURCHASER" || role === "USER";
    if (!allowed) return jsonError(403, "Ikke tilgang.");

    // 3) Lag signed URL
    // createSignedUrl kan returnere "Object not found" hvis path/bucket ikke stemmer.
    const { data, error } = await supabaseService.storage
      .from(bucket)
      .createSignedUrl(storagePath, expires, { download });

    if (error || !data?.signedUrl) {
      console.error("[signed-url] failed:", {
        bucket,
        storagePath,
        expires,
        error,
      });
      return jsonError(
        500,
        "Kunne ikke lage signed URL.",
        (error as any)?.message ?? error
      );
    }

    return NextResponse.json({ ok: true, url: data.signedUrl });
  } catch (e: any) {
    console.error("[signed-url] error:", e);
    return jsonError(500, e?.message ?? "Ukjent feil");
  }
}