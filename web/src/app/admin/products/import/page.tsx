// file: web/src/app/admin/products/import/page.tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { useRequireMe } from "@/lib/useRequireMe";
import { supabaseBrowser } from "@/lib/supabase/browser";

type ImportRow = {
  product_no: string;
  name?: string | null;
  list_price?: number | null;
  is_active?: boolean | null;

  // bulk assets
  thumb_path?: string | null; // products.thumb_path
  documents?: string | null; // "path1, path2, ..."
  gallery_images?: string | null; // "path1, path2, ..."

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
      rows_in?: number;
      rows_deduped?: number;
    }
  | { ok: false; error: string; details?: any };

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

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
  return s ? s : null;
}

function normalizeListCell(v: any): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;

  const parts = s
    .split(/[;,\n\r]+/g)
    .map((x) => x.trim())
    .filter(Boolean);

  return parts.length ? parts.join(",") : null;
}

function normalizeMultiPathCell(v: any): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;

  const parts = s
    .split(/[;,\n\r]+/g)
    .map((x) => x.trim())
    .filter(Boolean);

  return parts.length ? parts.join(",") : null;
}

/** Dedupe: siste forekomst av product_no i Excel vinner */
function dedupeByProductNo(parsed: ImportRow[]) {
  const map = new Map<string, ImportRow>();
  const counts = new Map<string, number>();

  for (const r of parsed) {
    const pn = String(r.product_no ?? "").trim();
    if (!pn) continue; // viktig: ikke lag "" key

    const key = pn.toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    map.set(key, { ...r, product_no: pn });
  }

  const deduped = Array.from(map.values());
  const dupKeys = Array.from(counts.entries())
    .filter(([, c]) => c > 1)
    .map(([k]) => k);

  return { deduped, dupKeys };
}

function validate(parsed: ImportRow[]) {
  const errors: string[] = [];
  const warnings: string[] = [];

  parsed.forEach((r, i) => {
    const rowNo = i + 2; // header=1
    const pn = (r.product_no ?? "").trim();
    if (!pn) errors.push(`Rad ${rowNo}: product_no mangler.`);

    if (r.list_price !== null && r.list_price !== undefined) {
      const n = Number(r.list_price);
      if (!Number.isFinite(n)) errors.push(`Rad ${rowNo}: list_price er ugyldig.`);
    }

    const acc = (r.accessories ?? "").trim();
    if (acc && !acc.replace(/[;,]/g, "").trim()) {
      errors.push(`Rad ${rowNo}: accessories ser ut til å være tom liste (kun separatorer).`);
    }

    const sp = (r.spare_parts ?? "").trim();
    if (sp && !sp.replace(/[;,]/g, "").trim()) {
      errors.push(`Rad ${rowNo}: spare_parts ser ut til å være tom liste (kun separatorer).`);
    }

    const tp = (r.thumb_path ?? "").trim();
    if (tp && (tp.startsWith("http://") || tp.startsWith("https://"))) {
      errors.push(
        `Rad ${rowNo}: thumb_path ser ut til å være URL. Bruk storage path (f.eks. products/...).`
      );
    }

    const docs = (r.documents ?? "").trim();
    if (docs && !docs.replace(/[;,\n\r]/g, "").trim()) {
      errors.push(`Rad ${rowNo}: documents ser ut til å være tom liste (kun separatorer).`);
    }

    const gal = (r.gallery_images ?? "").trim();
    if (gal && !gal.replace(/[;,\n\r]/g, "").trim()) {
      errors.push(`Rad ${rowNo}: gallery_images ser ut til å være tom liste (kun separatorer).`);
    }
  });

  const anyThumb = parsed.some((r) => (r.thumb_path ?? "").trim().length > 0);
  const anyDocs = parsed.some((r) => (r.documents ?? "").trim().length > 0);
  const anyGallery = parsed.some((r) => (r.gallery_images ?? "").trim().length > 0);

  // ✅ advarsel, ikke feil
  if (!anyThumb && !anyDocs && !anyGallery && parsed.length > 0) {
    warnings.push(
      "Merk: Ingen rader inneholder thumb_path/documents/gallery_images. " +
        "Hvis dette er forventet, ignorer. Hvis ikke: sjekk kolonnenavnene."
    );
  }

  return { errors, warnings };
}

export default function AdminProductsImportPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  // ✅ invite-only + admin gate
  const { me, loading: meLoading } = useRequireMe({ requireRole: "admin" });

  const [rows, setRows] = useState<ImportRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");

  async function onFile(file: File) {
    setResult(null);
    setErrors([]);
    setWarnings([]);
    setRows([]);
    setFileName(file.name);

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });

    const parsedRaw: ImportRow[] = json.map((r) => ({
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

    const { deduped, dupKeys } = dedupeByProductNo(parsedRaw);
    const { errors: errs, warnings: warns } = validate(deduped);

    const nextWarnings = [...warns];
    if (dupKeys.length > 0) {
      nextWarnings.push(
        `Merk: Excel-filen inneholder duplikate product_no (${dupKeys.length} stk). ` +
          `Siste forekomst ble brukt (overskriver tidligere i filen).`
      );
    }

    setRows(deduped);
    setErrors(errs);
    setWarnings(nextWarnings);
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
      // ✅ Hent token ferskt (ikke stol på me.token)
      const { data: sessRes, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) console.error(sessErr);

      let token = sessRes.session?.access_token ?? null;

      // Prøv refresh én gang hvis token mangler
      if (!token) {
        const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
        if (refreshErr) console.error(refreshErr);
        token = refreshed.session?.access_token ?? null;
      }

      if (!token) throw new Error("Mangler token (logg inn på nytt).");

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

      if (!ct.includes("application/json")) {
        throw new Error(
          `Import-endepunktet svarte ikke JSON (status ${res.status}). (Fikk: ${ct || "ukjent"})`
        );
      }

      const data = JSON.parse(raw) as ImportResponse;

      if (!res.ok || !("ok" in data) || data.ok === false) {
        const base = (data as any)?.error ?? `Import feilet (status ${res.status}).`;
        const details = (data as any)?.details;
        const extra =
          details && typeof details === "object"
            ? `\n\nDetails:\n${JSON.stringify(details, null, 2)}`
            : "";
        throw new Error(base + extra);
      }

      setResult(
        `Import OK: ${data.products_upserted} produkter, ` +
          `${data.thumbs_upserted ?? 0} thumbs, ` +
          `${data.files_upserted ?? 0} docs, ` +
          `${data.images_upserted ?? 0} galleri-bilder, ` +
          `${data.relations_upserted} relasjoner.` +
          (data.rows_in !== undefined && data.rows_deduped !== undefined
            ? ` (rows: ${data.rows_in} → ${data.rows_deduped})`
            : "")
      );
    } catch (e: any) {
      console.error(e);
      setResult(`Import feilet: ${e?.message ?? "Ukjent feil"}`);
    } finally {
      setImporting(false);
    }
  }

  if (meLoading) {
    return (
      <div className="p-6">
        <div className="text-sm text-gray-600">Sjekker tilgang…</div>
      </div>
    );
  }

  if (!me?.ok || me.role !== "admin") {
    return (
      <div className="p-6 space-y-3">
        <button
          className="rounded-lg border px-3 py-2 hover:bg-gray-50"
          onClick={() => router.push("/products")}
        >
          ← Til produkter
        </button>
        <div className="rounded-2xl border p-5 text-sm text-gray-700">Du har ikke admin-tilgang.</div>
      </div>
    );
  }

  const disabled = importing || rows.length === 0 || errors.length > 0;

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Bulk import produkter</h1>
          <div className="mt-1 text-sm text-gray-600">
            Last opp Excel (.xlsx). Første ark brukes.
            <br />
            Kolonner: <code>product_no</code>, <code>name</code>, <code>list_price</code>,{" "}
            <code>is_active</code>, <code>thumb_path</code>, <code>documents</code>,{" "}
            <code>gallery_images</code>, <code>accessories</code>, <code>spare_parts</code>.
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
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="block w-full max-w-md text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
          {fileName ? <div className="text-sm text-gray-500">Valgt: {fileName}</div> : null}
        </div>

        {errors.length > 0 ? (
          <div className="rounded-xl border p-4 text-sm text-red-600 space-y-1">
            {errors.map((x, i) => (
              <div key={i}>{x}</div>
            ))}
          </div>
        ) : null}

        {warnings.length > 0 ? (
          <div className="rounded-xl border p-4 text-sm text-amber-700 space-y-1">
            {warnings.map((x, i) => (
              <div key={i}>{x}</div>
            ))}
          </div>
        ) : null}

        {result ? (
          <div
            className={cn(
              "rounded-xl border p-4 text-sm whitespace-pre-wrap",
              result.startsWith("Import OK") ? "text-green-700" : "text-gray-700"
            )}
          >
            {result}
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            disabled={disabled}
            className="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
            onClick={runImport}
            title={
              rows.length === 0
                ? "Velg en fil først"
                : errors.length > 0
                ? "Rett feilene før import"
                : ""
            }
          >
            {importing ? "Importerer…" : "Importer"}
          </button>

          <div className="text-sm text-gray-500">
            {rows.length > 0 ? `Rader klare: ${rows.length}` : ""}
          </div>
        </div>
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