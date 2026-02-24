// file: web/src/app/api/products/import/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type ImportRow = {
  product_no: string;
  name?: string | null;
  list_price?: number | null;
  is_active?: boolean | null;

  // Media
  thumb_path?: string | null; // products.thumb_path (bucket: product-images)
  documents?: string | null; // "path1; path2; ..."
  gallery_images?: string | null; // "path1; path2; ..."

  // Relations
  accessories?: string | null; // CSV med product_no
  spare_parts?: string | null; // CSV med product_no
};

type RelationType = "ACCESSORY" | "SPARE_PART";

const REL: Record<RelationType, RelationType> = {
  ACCESSORY: "ACCESSORY",
  SPARE_PART: "SPARE_PART",
};

function normalizeNo(s: any) {
  return String(s ?? "").trim();
}

function parseCsvNos(s?: string | null) {
  if (!s) return [];
  return String(s)
    .split(/[;,]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

// For paths i documents/gallery: tillat ; , og linjeskift
function parsePathList(s?: string | null) {
  if (!s) return [];
  return String(s)
    .split(/[;,\n\r]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function basename(p: string) {
  const x = String(p || "").trim();
  if (!x) return "";
  const parts = x.split("/");
  return parts[parts.length - 1] || x;
}

function bearerToken(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

function jsonError(status: number, message: string, details?: any) {
  return NextResponse.json(
    { ok: false, error: message, ...(details !== undefined ? { details } : {}) },
    { status }
  );
}

function logEnvSnapshot() {
  console.log("[import] cwd:", process.cwd());
  console.log(
    "[import] has SUPABASE_SERVICE_ROLE_KEY:",
    !!process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  console.log("[import] env keys loaded sample:", {
    hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasAnon: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

export async function POST(req: Request) {
  try {
    logEnvSnapshot();

    // ---- ENV ----
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !anonKey) {
      return jsonError(500, "Supabase public env mangler.", {
        hasUrl: !!url,
        hasAnon: !!anonKey,
      });
    }
    if (!serviceKey) {
      return jsonError(500, "Missing env: SUPABASE_SERVICE_ROLE_KEY");
    }

    // ---- AUTH ----
    const token = bearerToken(req);
    if (!token) return jsonError(401, "Mangler Authorization token.");

    const supabaseAnon = createClient(url, anonKey, {
      auth: { persistSession: false },
    });

    const { data: userRes, error: userErr } = await supabaseAnon.auth.getUser(token);
    if (userErr || !userRes?.user) {
      return jsonError(401, "Ugyldig session. Logg inn på nytt.", userErr?.message);
    }

    // ---- SERVICE CLIENT ----
    const supabaseService = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });

    // Admin check
    const { data: prof, error: profErr } = await supabaseService
      .from("profiles")
      .select("role")
      .eq("user_id", userRes.user.id)
      .maybeSingle();

    if (profErr) return jsonError(500, "Kunne ikke hente profil.", profErr.message);

    const role = ((prof as any)?.role ?? "").toString().toUpperCase();
    if (role !== "ADMIN") return jsonError(403, "Ikke admin-tilgang.");

    // ---- BODY ----
    let body: any = null;
    try {
      body = await req.json();
    } catch {
      return jsonError(400, "Ugyldig JSON body.");
    }

    const rows: ImportRow[] = Array.isArray(body?.rows) ? body.rows : [];
    if (rows.length === 0) return jsonError(400, "Ingen rader å importere.");

    // ---- 1) DEDUPE per product_no (viktig for å unngå ON CONFLICT ... row a second time) ----
    // Vi beholder "siste" rad pr product_no (typisk det du forventer ved bulk).
    const byNo = new Map<string, ImportRow>();
    for (const r of rows) {
      const pn = normalizeNo(r.product_no);
      if (!pn) continue;
      byNo.set(pn.toUpperCase(), { ...r, product_no: pn });
    }
    const uniqRows = Array.from(byNo.values());

    // ---- 2) Upsert produkter (inkluder thumb_path i samme upsert) ----
    // Viktig: vi inkluderer thumb_path kun hvis den er satt, ellers lar vi feltet være uendret.
    const productsForUpsert: any[] = uniqRows.map((r, idx) => {
      const rowNo = idx + 2;
      const product_no = normalizeNo(r.product_no);
      if (!product_no) throw new Error(`Rad ${rowNo}: product_no mangler.`);

      const name =
        r.name === null || r.name === undefined ? null : String(r.name).trim() || null;

      const list_price =
        r.list_price === null || r.list_price === undefined ? null : Number(r.list_price);

      if (list_price !== null && !Number.isFinite(list_price)) {
        throw new Error(`Rad ${rowNo}: list_price er ugyldig.`);
      }

      const is_active =
        r.is_active === null || r.is_active === undefined ? true : Boolean(r.is_active);

      const obj: any = { product_no, name, list_price, is_active };

      const tp = String(r.thumb_path ?? "").trim();
      if (tp) obj.thumb_path = tp; // bare oppdater når excel faktisk har verdi

      return obj;
    });

    const { data: upserted, error: upErr } = await supabaseService
      .from("products")
      .upsert(productsForUpsert, { onConflict: "product_no" })
      .select("id, product_no");

    if (upErr) return jsonError(500, "Upsert til products feilet.", upErr.message);

    // Map product_no -> id
    const idByNo = new Map<string, string>();
    for (const p of upserted ?? []) {
      const no = String((p as any).product_no ?? "").trim().toUpperCase();
      const id = String((p as any).id ?? "").trim();
      if (no && id) idByNo.set(no, id);
    }

    // ---- 3) Utvid id-map med referanser i accessories/spare_parts (slik at de kan peke på produkter utenfor importen) ----
    const referencedNos = new Set<string>();
    for (const r of uniqRows) {
      for (const no of parseCsvNos(r.accessories)) referencedNos.add(no.toUpperCase());
      for (const no of parseCsvNos(r.spare_parts)) referencedNos.add(no.toUpperCase());
    }

    const missing = Array.from(referencedNos).filter((no) => !idByNo.has(no));
    if (missing.length > 0) {
      const { data: refRows, error: refErr } = await supabaseService
        .from("products")
        .select("id, product_no")
        .in("product_no", missing);

      if (refErr) return jsonError(500, "Kunne ikke hente refererte produkter.", refErr.message);

      for (const p of refRows ?? []) {
        const no = String((p as any).product_no ?? "").trim().toUpperCase();
        const id = String((p as any).id ?? "").trim();
        if (no && id) idByNo.set(no, id);
      }
    }

    // ---- 4) Dokumenter -> product_files (idempotent via unique index + upsert) ----
    const fileInserts: Array<{
      product_id: string;
      relative_path: string;
      file_type: string;
      title: string | null;
    }> = [];

    for (const r of uniqRows) {
      const product_id = idByNo.get(normalizeNo(r.product_no).toUpperCase());
      if (!product_id) continue;

      const paths = parsePathList(r.documents);
      for (const p of paths) {
        fileInserts.push({
          product_id,
          relative_path: p,
          file_type: "dok",
          title: basename(p) || null,
        });
      }
    }

    if (fileInserts.length > 0) {
      const { error: fErr } = await supabaseService
        .from("product_files")
        .upsert(fileInserts, { onConflict: "product_id,relative_path" });

      if (fErr) return jsonError(500, "Upsert til product_files feilet.", fErr.message);
    }

    // ---- 5) Galleri -> product_images (idempotent via unique index + upsert) ----
    const imageInserts: Array<{
      product_id: string;
      storage_bucket: string;
      storage_path: string;
      caption: string | null;
      sort_order: number;
    }> = [];

    for (const r of uniqRows) {
      const product_id = idByNo.get(normalizeNo(r.product_no).toUpperCase());
      if (!product_id) continue;

      const paths = parsePathList(r.gallery_images);
      let sort = 0;
      for (const p of paths) {
        sort += 1;
        imageInserts.push({
          product_id,
          storage_bucket: "product-images",
          storage_path: p,
          caption: null,
          sort_order: sort,
        });
      }
    }

    if (imageInserts.length > 0) {
      const { error: iErr } = await supabaseService
        .from("product_images")
        .upsert(imageInserts, { onConflict: "product_id,storage_path" });

      if (iErr) return jsonError(500, "Upsert til product_images feilet.", iErr.message);
    }

    // ---- 6) Relasjoner -> product_relations (idempotent via unique index + upsert) ----
    const relationInserts: Array<{
      product_id: string;
      related_product_id: string;
      relation_type: RelationType;
      sort_order: number;
    }> = [];

    for (const r of uniqRows) {
      const baseNo = normalizeNo(r.product_no);
      const product_id = idByNo.get(baseNo.toUpperCase());
      if (!product_id) continue;

      const acc = parseCsvNos(r.accessories);
      const sp = parseCsvNos(r.spare_parts);

      let i = 0;
      for (const no of acc) {
        const rid = idByNo.get(no.toUpperCase());
        if (!rid || rid === product_id) continue;
        i += 1;
        relationInserts.push({
          product_id,
          related_product_id: rid,
          relation_type: REL.ACCESSORY,
          sort_order: i,
        });
      }

      i = 0;
      for (const no of sp) {
        const rid = idByNo.get(no.toUpperCase());
        if (!rid || rid === product_id) continue;
        i += 1;
        relationInserts.push({
          product_id,
          related_product_id: rid,
          relation_type: REL.SPARE_PART,
          sort_order: i,
        });
      }
    }

    if (relationInserts.length > 0) {
      const { error: relErr } = await supabaseService
        .from("product_relations")
        .upsert(relationInserts, {
          onConflict: "product_id,related_product_id,relation_type",
        });

      if (relErr) return jsonError(500, "Upsert til product_relations feilet.", relErr.message);
    }

    return NextResponse.json({
      ok: true,
      rows_in: rows.length,
      rows_deduped: uniqRows.length,
      products_upserted: upserted?.length ?? 0,
      files_upserted: fileInserts.length,
      images_upserted: imageInserts.length,
      relations_upserted: relationInserts.length,
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Ukjent feil" },
      { status: 500 }
    );
  }
}