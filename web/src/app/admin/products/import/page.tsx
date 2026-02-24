// file: web/src/app/admin/products/import/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { supabaseBrowser } from "@/lib/supabase/browser";

type ImportRow = {
  product_no: string;
  name?: string | null;
  list_price?: number | null;
  is_active?: boolean | null;

  // NEW (bulk assets)
  thumb_path?: string | null; // products.thumb_path (bucket: product-images)
  documents?: string | null; // "path1; path2; ..."
  gallery_images?: string | null; // "path1; path2; ..."

  accessories?: string | null; // CSV product_no
  spare_parts?: string | null; // CSV product_no
};

type ImportResponse =
  | {
      ok: true;
      products_upserted: number;
      thumbs_upserted?: number;
      files_upserted?: number;
      images_upserted?: number;
      relations_upserted: number;
    }
  | {
      ok: false;
      error: string;
      details?: any;
    };

function toBool(v: any): boolean | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "ja", "yes", "y"].includes(s)) return true;
  if (["0", "false", "nei", "no", "n"].includes(s)) return false;
  return null;
}

function toNumber(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(",", ".").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizePathCell(v: any): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s;
}

function normalizeListCell(v: any): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  // Tillat både komma og semikolon fra Excel + linjeskift
  const parts = s
    .split(/[;,\n\r]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.length ? parts.join(",") : null;
}

function normalizeMultiPathCell(v: any): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  // Tillat ; , og linjeskift – lagrer som komma-separert string
  const parts = s
    .split(/[;,\n\r]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.length ? parts.join(",") : null;
}

function headerList() {
  return [
    "product_no",
    "name",
    "list_price",
    "is_active",
    "thumb_path",
    "documents",
    "gallery_images",
    "accessories",
    "spare_parts",
  ];
}

export default function AdminProductsImportPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [roleOk, setRoleOk] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);

  const [rows, setRows] = useState<ImportRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // Auth + admin check
  useEffect(() => {
    let alive = true;

    (async () => {
      setChecking(true);

      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) console.error(authErr);

      if (!auth.user) {
        router.replace("/login");
        return;
      }

      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", auth.user.id)
        .maybeSingle();

      if (profErr) console.error(profErr);

      const role = ((prof as any)?.role ?? "").toString().toUpperCase();

      if (!alive) return;
      setRoleOk(role === "ADMIN");
      setChecking(false);
    })();

    return () => {
      alive = false;
    };
  }, [router, supabase]);

  function validate(parsed: ImportRow[]) {
    const errs: string[] = [];
    const seen = new Set<string>();

    const required = ["product_no"];
    const headers = headerList();

    // Basic sanity: ensure the parsed objects at least have product_no key (done below per row).
    // We can't reliably read original sheet headers after sheet_to_json without extra work,
    // so we validate by content and presence of key fields.

    parsed.forEach((r, i) => {
      const rowNo = i + 2; // header=1
      const pn = (r.product_no ?? "").trim();
      if (!pn) errs.push(`Rad ${rowNo}: product_no mangler.`);

      if (pn) {
        const key = pn.toUpperCase();
        if (seen.has(key)) errs.push(`Rad ${rowNo}: product_no er duplikat (${pn}).`);
        seen.add(key);
      }

      if (r.list_price !== null && r.list_price !== undefined) {
        const n = Number(r.list_price);
        if (!Number.isFinite(n)) errs.push(`Rad ${rowNo}: list_price er ugyldig.`);
      }

      const acc = (r.accessories ?? "").trim();
      if (acc && !acc.replace(/[;,]/g, "").trim()) {
        errs.push(`Rad ${rowNo}: accessories ser ut til å være tom liste (kun separatorer).`);
      }
      const sp = (r.spare_parts ?? "").trim();
      if (sp && !sp.replace(/[;,]/g, "").trim()) {
        errs.push(`Rad ${rowNo}: spare_parts ser ut til å være tom liste (kun separatorer).`);
      }

      // thumb_path should look like a path, not a URL (we still allow anything non-empty)
      const tp = (r.thumb_path ?? "").trim();
      if (tp && (tp.startsWith("http://") || tp.startsWith("https://"))) {
        errs.push(`Rad ${rowNo}: thumb_path ser ut til å være en URL. Bruk storage path (products/...).`);
      }

      // documents/gallery_images: allow comma/semicolon lists, but warn if only separators
      const docs = (r.documents ?? "").trim();
      if (docs && !docs.replace(/[;,\n\r]/g, "").trim()) {
        errs.push(`Rad ${rowNo}: documents ser ut til å være tom liste (kun separatorer).`);
      }
      const gal = (r.gallery_images ?? "").trim();
      if (gal && !gal.replace(/[;,\n\r]/g, "").trim()) {
        errs.push(`Rad ${rowNo}: gallery_images ser ut til å være tom liste (kun separatorer).`);
      }
    });

    // Small hint if file looks like old template (missing new columns everywhere)
    const anyThumb = parsed.some((r) => (r.thumb_path ?? "").trim().length > 0);
    const anyDocs = parsed.some((r) => (r.documents ?? "").trim().length > 0);
    const anyGallery = parsed.some((r) => (r.gallery_images ?? "").trim().length > 0);

    if (!anyThumb && !anyDocs && !anyGallery) {
      errs.push(
        `Merk: Ingen rader inneholder thumb_path/documents/gallery_images. Hvis dette er forventet, ignorer. Hvis ikke: sjekk kolonnenavnene (${headers.join(
          ", "
        )}).`
      );
    }

    // Required fields note
    if (required.length > 0) {
      // just to avoid lint complaining about unused "required"
      void required;
    }

    return errs;
  }

  async function onFile(file: File) {
    setResult(null);
    setErrors([]);
    setRows([]);

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });

    // forventer headers:
    // product_no, name, list_price, is_active, thumb_path, documents, gallery_images, accessories, spare_parts
    const parsed: ImportRow[] = json.map((r) => ({
      product_no: String(r.product_no ?? "").trim(),
      name: String(r.name ?? "").trim() || null,
      list_price: toNumber(r.list_price),
      is_active: toBool(r.is_active) ?? true,

      thumb_path: normalizePathCell(r.thumb_path),
      documents: normalizeMultiPathCell(r.documents),
      gallery_images: normalizeMultiPathCell(r.gallery_images),

      accessories: normalizeListCell(r.accessories),
      spare_parts: normalizeListCell(r.spare_parts),
    }));

    const errs = validate(parsed);
    setRows(parsed);
    setErrors(errs);
  }

  async function runImport() {
    if (rows.length === 0) return;
    if (errors.length > 0) {
      alert("Rett feilene før import.");
      return;
    }

    setImporting(true);
    setResult(null);

    try {
      const { data: sess, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) console.error(sessErr);

      const token = sess.session?.access_token;
      if (!token) throw new Error("Ingen session token. Logg inn på nytt.");

      // Admin import route:
      // web/src/app/api/admin/products/import/route.ts => /api/admin/products/import
      const res = await fetch("/api/products/import", {
        method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ rows }),
});
      const ct = res.headers.get("content-type") || "";
      const raw = await res.text();

      console.log("IMPORT status:", res.status);
      console.log("IMPORT content-type:", ct);
      console.log("IMPORT body (first 800):", raw.slice(0, 800));

      if (!ct.includes("application/json")) {
        throw new Error(
          `Import-endepunktet svarte ikke JSON (status ${res.status}). Se console for body.`
        );
      }

      const data = JSON.parse(raw) as ImportResponse;

      if (!res.ok) {
        const msg = (data as any)?.error ?? `Import feilet (status ${res.status}).`;
        throw new Error(msg);
      }

      if (!("ok" in data) || data.ok === false) {
        const msg = (data as any)?.error ?? "Import feilet (ukjent feil).";
        throw new Error(msg);
      }

      const thumbs = data.thumbs_upserted ?? 0;
      const files = data.files_upserted ?? 0;
      const images = data.images_upserted ?? 0;

      setResult(
  `Import OK: ${data.products_upserted} produkter, ` +
    `${data.thumbs_upserted ?? 0} thumbs, ` +
    `${data.files_upserted ?? 0} docs, ` +
    `${data.images_upserted ?? 0} galleri-bilder, ` +
    `${data.relations_upserted} relasjoner.`
);
    } catch (e: any) {
      console.error(e);
      setResult(`Import feilet: ${e?.message ?? "Ukjent feil"}`);
    } finally {
      setImporting(false);
    }
  }

  if (checking) {
    return (
      <div className="p-6">
        <div className="text-sm text-gray-600">Sjekker tilgang…</div>
      </div>
    );
  }

  if (!roleOk) {
    return (
      <div className="p-6 space-y-3">
        <button
          className="rounded-lg border px-3 py-2 hover:bg-gray-50"
          onClick={() => router.push("/admin/products")}
        >
          ← Admin produkter
        </button>
        <div className="rounded-2xl border p-5 text-sm text-gray-700">
          Du har ikke admin-tilgang.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Bulk import produkter</h1>
          <div className="text-sm text-gray-600">
            Last opp Excel (.xlsx). Første ark brukes.
            <br />
            Kolonner:{" "}
            <code>product_no</code>, <code>name</code>, <code>list_price</code>,{" "}
            <code>is_active</code>, <code>thumb_path</code>, <code>documents</code>,{" "}
            <code>gallery_images</code>, <code>accessories</code>, <code>spare_parts</code>.
            <br />
            <code>documents</code>/<code>gallery_images</code>: flere paths i samme celle med{" "}
            <code>;</code>, <code>,</code> eller linjeskift.
            <br />
            <code>accessories</code>/<code>spare_parts</code>: liste med <code>product_no</code>{" "}
            (du kan bruke <code>;</code> i Excel).
          </div>
        </div>

        <button
          className="rounded-lg border px-3 py-2 hover:bg-gray-50"
          onClick={() => router.push("/admin/products")}
        >
          ← Tilbake
        </button>
      </header>

      <section className="rounded-2xl border p-5 space-y-4">
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          className="block w-full text-sm"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />

        {errors.length > 0 ? (
          <div className="rounded-xl border p-4 text-sm text-red-600 space-y-1">
            {errors.map((x, i) => (
              <div key={i}>{x}</div>
            ))}
          </div>
        ) : null}

        {result ? (
          <div className="rounded-xl border p-4 text-sm text-gray-700">{result}</div>
        ) : null}

        <button
          disabled={importing || rows.length === 0 || errors.length > 0}
          className="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
          onClick={runImport}
        >
          {importing ? "Importerer…" : "Importer"}
        </button>
      </section>

      <section className="rounded-2xl border p-5 space-y-3">
        <div className="font-semibold">Preview</div>
        <div className="text-sm text-gray-600">Viser maks 20 rader. Totalt: {rows.length}</div>

        {rows.length === 0 ? (
          <div className="text-sm text-gray-600">Ingen fil valgt.</div>
        ) : (
          <div className="overflow-auto rounded-xl border">
            <table className="min-w-[1200px] w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-left">product_no</th>
                  <th className="p-2 text-left">name</th>
                  <th className="p-2 text-left">list_price</th>
                  <th className="p-2 text-left">is_active</th>
                  <th className="p-2 text-left">thumb_path</th>
                  <th className="p-2 text-left">documents</th>
                  <th className="p-2 text-left">gallery_images</th>
                  <th className="p-2 text-left">accessories</th>
                  <th className="p-2 text-left">spare_parts</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 20).map((r, i) => (
                  <tr key={i} className="border-t align-top">
                    <td className="p-2">{r.product_no}</td>
                    <td className="p-2">{r.name ?? ""}</td>
                    <td className="p-2">{r.list_price ?? ""}</td>
                    <td className="p-2">{String(r.is_active ?? true)}</td>
                    <td className="p-2 font-mono text-[12px]">{r.thumb_path ?? ""}</td>
                    <td className="p-2 font-mono text-[12px] whitespace-pre-wrap">
                      {r.documents ?? ""}
                    </td>
                    <td className="p-2 font-mono text-[12px] whitespace-pre-wrap">
                      {r.gallery_images ?? ""}
                    </td>
                    <td className="p-2">{r.accessories ?? ""}</td>
                    <td className="p-2">{r.spare_parts ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}