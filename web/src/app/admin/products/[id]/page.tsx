// file: web/src/app/admin/products/[id]/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

type ProductRow = {
  id: string;
  product_no: string;
  name: string | null;
  list_price: number | null;
  thumb_path: string | null;
  is_active: boolean | null;
};

type ProductImageRow = {
  id: string;
  product_id: string;
  storage_bucket: string;
  storage_path: string;
  caption?: string | null;
  sort_order?: number | null;
  created_at?: string | null;
  // bakoverkompat
  path?: string | null;
};

type ProductFileRow = {
  id: string;
  product_id: string;
  relative_path: string;
  file_type: string;
  title?: string | null;
  created_at?: string | null;
};

type RelationType = "ACCESSORY" | "SPARE_PART";

type ProductRelationRow = {
  id: string;
  product_id: string;
  related_product_id: string;
  relation_type: RelationType;
  sort_order: number | null;
  created_at: string | null;

  // NB: Supabase join kan komme som array, selv om det egentlig er 1-til-1.
  related_product: ProductRow[] | null;
};

const IMAGE_BUCKET = "product-images";
const FILE_BUCKET = "product-files";

function imgPath(row: ProductImageRow) {
  return row.storage_path || row.path || "";
}

function formatDateTime(value?: string | null) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString("nb-NO");
  } catch {
    return value;
  }
}

function formatNok(value?: number | null) {
  if (value === null || value === undefined) return "";
  const v = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(v)) return "";
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(v);
}

function safeExt(name: string, fallback: string) {
  const ext = (name.split(".").pop() || fallback).toLowerCase();
  return ext.replace(/[^a-z0-9]/g, "") || fallback;
}

function safeSlug(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^\w.\-]+/g, "-")
    .replace(/\-+/g, "-")
    .replace(/^\-|\-$/g, "");
}

function relationLabel(t: RelationType) {
  return t === "SPARE_PART" ? "Reservedel" : "Ekstrautstyr";
}

// Hjelper: normaliser related_product (array) -> ProductRow | null
function getRelatedProduct(r: ProductRelationRow): ProductRow | null {
  const x = r.related_product;
  if (!x || !Array.isArray(x) || x.length === 0) return null;
  return x[0] ?? null;
}

async function openSignedUrl(
  supabase: ReturnType<typeof supabaseBrowser>,
  bucket: string,
  path: string
) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 10);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || "Kunne ikke lage signed URL.");
  }
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

export default function AdminProductDetailsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [loading, setLoading] = useState(true);
  const [roleOk, setRoleOk] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [product, setProduct] = useState<ProductRow | null>(null);
  const [images, setImages] = useState<ProductImageRow[]>([]);
  const [files, setFiles] = useState<ProductFileRow[]>([]);

  // Relations (ekstrautstyr / reservedeler)
  const [relationsLoading, setRelationsLoading] = useState(false);
  const [relationsError, setRelationsError] = useState<string | null>(null);
  const [relations, setRelations] = useState<ProductRelationRow[]>([]);

  // Product search for adding relation
  const [relType, setRelType] = useState<RelationType>("ACCESSORY");
  const [relSearch, setRelSearch] = useState("");
  const [relSearching, setRelSearching] = useState(false);
  const [relCandidates, setRelCandidates] = useState<ProductRow[]>([]);
  const [relSelectedId, setRelSelectedId] = useState<string>("");
  const [relSaving, setRelSaving] = useState(false);

  // edit fields
  const [productNo, setProductNo] = useState("");
  const [name, setName] = useState("");
  const [listPrice, setListPrice] = useState<string>("");
  const [isActive, setIsActive] = useState(true);

  // upload state
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const [docFiles, setDocFiles] = useState<File[]>([]);

  const [savingProduct, setSavingProduct] = useState(false);
  const [uploadingThumb, setUploadingThumb] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [uploadingDocs, setUploadingDocs] = useState(false);

  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const docsInputRef = useRef<HTMLInputElement | null>(null);

  const productId = params.id;

  async function refreshRelations() {
    setRelationsLoading(true);
    setRelationsError(null);

    try {
      // join mot products for å vise navn/pris osv på relaterte produkter
      const { data, error } = await supabase
        .from("product_relations")
        .select(
          `
          id,
          product_id,
          related_product_id,
          relation_type,
          sort_order,
          created_at,
          related_product:products!product_relations_related_product_id_fkey (
            id, product_no, name, list_price, thumb_path, is_active
          )
        `
        )
        .eq("product_id", productId)
        .order("relation_type", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) throw error;

      // Supabase kan gi "any" – tving via unknown for TS-bygg
      setRelations(((data ?? []) as unknown) as ProductRelationRow[]);
    } catch (e: unknown) {
      console.error(e);
      setRelations([]);
      setRelationsError(
        e instanceof Error ? e.message : "Kunne ikke hente relasjoner."
      );
    } finally {
      setRelationsLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setErrorMsg(null);

      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.replace("/login");
        return;
      }

      type ProfileRoleRow = { role: string | null };

const { data: prof, error: profErr } = (await supabase
  .from("profiles" as any)
  .select("role")
  .eq("user_id", auth.user.id)
  .maybeSingle()) as { data: ProfileRoleRow | null; error: any };

if (profErr) console.error(profErr);

const role = String(prof?.role ?? "").toUpperCase();
const ok = role === "ADMIN";
      if (!alive) return;

      setRoleOk(ok);
      if (!ok) {
        setLoading(false);
        return;
      }

      const { data: p, error: pErr } = await supabase
        .from("products")
        .select("id, product_no, name, list_price, thumb_path, is_active")
        .eq("id", productId)
        .maybeSingle();

      if (!alive) return;

      if (pErr || !p) {
        console.error(pErr);
        setProduct(null);
        setImages([]);
        setFiles([]);
        setErrorMsg(
          "Fant ikke produktet. Sjekk at products-tabellen har kolonnene: id, product_no, name, list_price, thumb_path, is_active."
        );
        setLoading(false);
        return;
      }

      const pr = p as ProductRow;
      setProduct(pr);
      setProductNo(pr.product_no ?? "");
      setName(pr.name ?? "");
      setListPrice(
        typeof pr.list_price === "number" && Number.isFinite(pr.list_price)
          ? String(pr.list_price)
          : ""
      );
      setIsActive((pr.is_active ?? true) === true);

      const { data: img, error: imgErr } = await supabase
        .from("product_images")
        .select(
          "id, product_id, storage_bucket, storage_path, caption, sort_order, created_at"
        )
        .eq("product_id", productId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (!alive) return;

      if (imgErr) {
        console.error(imgErr);
        setImages([]);
      } else {
        setImages((img ?? []) as ProductImageRow[]);
      }

      const { data: f, error: fErr } = await supabase
        .from("product_files")
        .select("id, product_id, relative_path, file_type, title, created_at")
        .eq("product_id", productId)
        .order("created_at", { ascending: false });

      if (!alive) return;

      if (fErr) {
        console.error(fErr);
        setFiles([]);
      } else {
        setFiles((f ?? []) as ProductFileRow[]);
      }

      // relasjoner
      await refreshRelations();

      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [productId, router, supabase]);

  // søk etter kandidater å legge til
  useEffect(() => {
    let alive = true;

    (async () => {
      const q = relSearch.trim();
      if (q.length < 2) {
        setRelCandidates([]);
        setRelSelectedId("");
        return;
      }

      setRelSearching(true);
      try {
        // enkel OR-søk: product_no eller name
        const { data, error } = await supabase
          .from("products")
          .select("id, product_no, name, list_price, thumb_path, is_active")
          .or(`product_no.ilike.%${q}%,name.ilike.%${q}%`)
          .order("product_no", { ascending: true })
          .limit(25);

        if (error) throw error;

        const rows = ((data ?? []) as unknown) as ProductRow[];
        const filtered = rows.filter((x) => x.id !== productId);
        if (!alive) return;

        setRelCandidates(filtered as ProductRow[]);
        setRelSelectedId(filtered[0]?.id ?? "");
      } catch (e) {
        console.error(e);
        if (!alive) return;
        setRelCandidates([]);
        setRelSelectedId("");
      } finally {
        if (alive) setRelSearching(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [relSearch, productId, supabase]);

  async function saveProduct() {
    if (!product) return;

    const pn = productNo.trim();
    if (!pn) {
      alert("Produktnr (product_no) må være satt.");
      return;
    }

    setSavingProduct(true);
    setErrorMsg(null);

    const price =
      listPrice.trim() === "" ? null : Number(listPrice.replace(",", "."));
    if (price !== null && !Number.isFinite(price)) {
      setSavingProduct(false);
      alert("Ugyldig pris.");
      return;
    }

    const patch: Partial<ProductRow> = {
      product_no: pn,
      name: name.trim() === "" ? null : name.trim(),
      list_price: price,
      is_active: isActive,
    };

        const { error } = await (supabase as any)
  .from("products")
  .update(patch)
  .eq("id", product.id);

    setSavingProduct(false);

    if (error) {
      console.error(error);
      alert(error.message);
      return;
    }

    setProduct((prev) => (prev ? ({ ...prev, ...patch } as ProductRow) : prev));
    alert("Produkt lagret.");
  }

  async function uploadThumbnail() {
    if (!product) return;
    if (!thumbFile) return alert("Velg et bilde først.");

    setUploadingThumb(true);
    setErrorMsg(null);

    try {
      const ext = safeExt(thumbFile.name, "jpg");
      const path = `products/${product.id}/thumb.${ext}`;

      const { error: upErr } = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(path, thumbFile, {
          upsert: true,
          contentType: thumbFile.type || "image/jpeg",
        });

      if (upErr) throw upErr;

      const { error: dbErr } = await supabase
        .from("products")
        .update({ thumb_path: path })
        .eq("id", product.id);

      if (dbErr) throw dbErr;

      setProduct((prev) => (prev ? { ...prev, thumb_path: path } : prev));
      setThumbFile(null);
      alert("Thumbnail lastet opp.");
    } catch (e: unknown) {
      console.error(e);
      alert(
        `Opplasting feilet: ${
          e instanceof Error ? e.message : "Ukjent feil"
        }`
      );
    } finally {
      setUploadingThumb(false);
    }
  }

  async function uploadGallery() {
    if (!product) return;
    if (galleryFiles.length === 0)
      return alert("Velg ett eller flere bilder først.");

    setUploadingGallery(true);
    setErrorMsg(null);

    try {
      const maxSort = images.reduce((m, x) => {
        const v = typeof x.sort_order === "number" ? x.sort_order : 0;
        return Math.max(m, v);
      }, 0);

      const inserts: Array<{
        product_id: string;
        storage_bucket: string;
        storage_path: string;
        caption: null;
        sort_order: number;
      }> = [];

      let sort = maxSort;

      for (const file of galleryFiles) {
        sort += 1;
        const ext = safeExt(file.name, "jpg");
        const stamp = Date.now();
        const base = safeSlug(file.name.replace(/\.[^/.]+$/, "")) || "image";
        const storage_path = `products/${product.id}/gallery/${stamp}-${base}.${ext}`;

        const { error: upErr } = await supabase.storage
          .from(IMAGE_BUCKET)
          .upload(storage_path, file, {
            upsert: false,
            contentType: file.type || "image/jpeg",
          });

        if (upErr) throw upErr;

        inserts.push({
          product_id: product.id,
          storage_bucket: IMAGE_BUCKET,
          storage_path,
          caption: null,
          sort_order: sort,
        });
      }

      const { data: created, error: insErr } = await supabase
        .from("product_images")
        .insert(inserts)
        .select(
          "id, product_id, storage_bucket, storage_path, caption, sort_order, created_at"
        );

      if (insErr) throw insErr;

      setImages((prev) =>
        [...prev, ...((created ?? []) as ProductImageRow[])].sort((a, b) => {
          const sa = typeof a.sort_order === "number" ? a.sort_order : 0;
          const sb = typeof b.sort_order === "number" ? b.sort_order : 0;
          return sa - sb;
        })
      );

      setGalleryFiles([]);
      if (galleryInputRef.current) galleryInputRef.current.value = "";
      alert("Galleri-bilder lastet opp.");
    } catch (e: unknown) {
      console.error(e);
      alert(
        `Opplasting feilet: ${
          e instanceof Error ? e.message : "Ukjent feil"
        }`
      );
    } finally {
      setUploadingGallery(false);
    }
  }

  async function uploadDocuments() {
    if (!product) return;
    if (docFiles.length === 0)
      return alert("Velg ett eller flere dokumenter først.");

    setUploadingDocs(true);
    setErrorMsg(null);

    try {
      const inserts: Array<{
        product_id: string;
        relative_path: string;
        file_type: string;
        title: string;
      }> = [];

      for (const file of docFiles) {
        const ext = safeExt(file.name, "pdf");
        const stamp = Date.now();
        const base = safeSlug(file.name.replace(/\.[^/.]+$/, "")) || "doc";
        const path = `products/${product.id}/docs/${stamp}-${base}.${ext}`;

        const { error: upErr } = await supabase.storage
          .from(FILE_BUCKET)
          .upload(path, file, {
            upsert: false,
            contentType: file.type || "application/octet-stream",
          });

        if (upErr) throw upErr;

        inserts.push({
          product_id: product.id,
          relative_path: path,
          file_type: "dok",
          title: file.name,
        });
      }

      const { data: created, error: insErr } = await supabase
        .from("product_files")
        .insert(inserts)
        .select("id, product_id, relative_path, file_type, title, created_at");

      if (insErr) throw insErr;

      setFiles((prev) => [...((created ?? []) as ProductFileRow[]), ...prev]);
      setDocFiles([]);
      if (docsInputRef.current) docsInputRef.current.value = "";
      alert("Dokument(er) lastet opp.");
    } catch (e: unknown) {
      console.error(e);
      alert(
        `Opplasting feilet: ${
          e instanceof Error ? e.message : "Ukjent feil"
        }`
      );
    } finally {
      setUploadingDocs(false);
    }
  }

  async function deleteGalleryImage(row: ProductImageRow) {
    if (!confirm("Slette dette bildet?")) return;

    try {
      const bucket = row.storage_bucket || IMAGE_BUCKET;
      const path = imgPath(row);
      if (!path) throw new Error("Mangler storage_path på bildet.");

      const { error: stErr } = await supabase.storage.from(bucket).remove([path]);
      if (stErr) throw stErr;

      const { error: dbErr } = await supabase
        .from("product_images")
        .delete()
        .eq("id", row.id);
      if (dbErr) throw dbErr;

      setImages((prev) => prev.filter((x) => x.id !== row.id));
    } catch (e: unknown) {
      console.error(e);
      alert(`Kunne ikke slette: ${e instanceof Error ? e.message : "Ukjent feil"}`);
    }
  }

  async function deleteDocument(row: ProductFileRow) {
    if (!confirm("Slette dette dokumentet?")) return;

    try {
      const { error: stErr } = await supabase.storage
        .from(FILE_BUCKET)
        .remove([row.relative_path]);
      if (stErr) throw stErr;

      const { error: dbErr } = await supabase
        .from("product_files")
        .delete()
        .eq("id", row.id);
      if (dbErr) throw dbErr;

      setFiles((prev) => prev.filter((x) => x.id !== row.id));
    } catch (e: unknown) {
      console.error(e);
      alert(`Kunne ikke slette: ${e instanceof Error ? e.message : "Ukjent feil"}`);
    }
  }

  async function deleteThumbnail() {
    if (!product?.thumb_path) return;
    if (!confirm("Slette thumbnail?")) return;

    try {
      const path = product.thumb_path;

      const { error: stErr } = await supabase.storage
        .from(IMAGE_BUCKET)
        .remove([path]);
      if (stErr) throw stErr;

      const { error: dbErr } = await supabase
        .from("products")
        .update({ thumb_path: null })
        .eq("id", product.id);
      if (dbErr) throw dbErr;

      setProduct((prev) => (prev ? { ...prev, thumb_path: null } : prev));
      alert("Thumbnail slettet.");
    } catch (e: unknown) {
      console.error(e);
      alert(`Kunne ikke slette: ${e instanceof Error ? e.message : "Ukjent feil"}`);
    }
  }

  async function addRelation() {
    if (!product) return;

    const rid = relSelectedId;
    if (!rid) {
      alert("Velg et produkt å legge til.");
      return;
    }

    setRelSaving(true);
    setRelationsError(null);

    try {
      // finn max sort for denne typen
      const maxSort = relations
        .filter((r) => r.relation_type === relType)
        .reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0);

      const { error } = await supabase.from("product_relations").insert({
        product_id: product.id,
        related_product_id: rid,
        relation_type: relType,
        sort_order: maxSort + 1,
      });

      if (error) throw error;

      setRelSearch("");
      setRelCandidates([]);
      setRelSelectedId("");
      await refreshRelations();
      alert("Lagt til.");
    } catch (e: unknown) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Kunne ikke legge til relasjon.");
    } finally {
      setRelSaving(false);
    }
  }

  async function removeRelation(row: ProductRelationRow) {
    if (!confirm("Fjerne koblingen?")) return;

    try {
      const { error } = await supabase
        .from("product_relations")
        .delete()
        .eq("id", row.id);

      if (error) throw error;

      setRelations((prev) => prev.filter((x) => x.id !== row.id));
    } catch (e: unknown) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Kunne ikke fjerne relasjonen.");
    }
  }

  const accessories = relations.filter((r) => r.relation_type === "ACCESSORY");
  const spareParts = relations.filter((r) => r.relation_type === "SPARE_PART");

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-sm text-gray-600">Laster…</div>
      </div>
    );
  }

  if (!roleOk) {
    return (
      <div className="p-6 space-y-3">
        <button
          className="rounded-lg border px-3 py-2 hover:bg-gray-50"
          onClick={() => router.push("/products")}
        >
          ← Til produkter
        </button>

        <div className="rounded-2xl border p-5 text-sm text-gray-700">
          Du har ikke admin-tilgang. Rollen må være <b>ADMIN</b> i{" "}
          <code>profiles</code>.
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="p-6 space-y-3">
        <button
          className="rounded-lg border px-3 py-2 hover:bg-gray-50"
          onClick={() => router.push("/admin/products")}
        >
          ← Til admin produkter
        </button>

        <div className="rounded-2xl border p-5 text-sm text-gray-700">
          {errorMsg ?? "Fant ikke produkt."}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            className="rounded-lg border px-3 py-2 hover:bg-gray-50"
            onClick={() => router.push("/admin/products")}
          >
            ← Admin produkter
          </button>

          <button
            className="rounded-lg border px-3 py-2 hover:bg-gray-50"
            onClick={() => router.push("/products")}
          >
            Produkter (kundevisning)
          </button>
        </div>

        <div className="text-sm text-gray-600">
          Produkt-ID: <code>{product.id}</code>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          {/* Produkt */}
          <section className="rounded-2xl border p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold">Rediger produkt</h1>
                <div className="text-sm text-gray-600">
                  (Skjema: product_no, name, list_price, is_active)
                </div>
              </div>

              <button
                disabled={savingProduct}
                className="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                onClick={saveProduct}
              >
                {savingProduct ? "Lagrer…" : "Lagre"}
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                Produktnr (må være satt)
                <input
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                  value={productNo}
                  onChange={(e) => setProductNo(e.target.value)}
                  placeholder="P-001"
                />
              </label>

              <label className="text-sm">
                Pris (NOK)
                <input
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                  value={listPrice}
                  onChange={(e) => setListPrice(e.target.value)}
                  placeholder="1990"
                  inputMode="numeric"
                />
                <div className="mt-1 text-xs text-gray-600">
                  {listPrice
                    ? `Visning: ${formatNok(Number(listPrice.replace(",", ".")))}`
                    : ""}
                </div>
              </label>
            </div>

            <label className="text-sm block">
              Navn
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Produktnavn"
              />
            </label>

            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Aktiv
            </label>
          </section>

          {/* Ekstrautstyr / Reservedeler */}
          <section className="rounded-2xl border p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">Ekstrautstyr / reservedeler</h2>
                <div className="text-sm text-gray-600">
                  Ekstrautstyr: {accessories.length} • Reservedeler:{" "}
                  {spareParts.length}
                </div>
              </div>

              <button
                className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                onClick={refreshRelations}
                disabled={relationsLoading}
              >
                {relationsLoading ? "Oppdaterer…" : "Oppdater"}
              </button>
            </div>

            {relationsError ? (
              <div className="rounded-xl border p-3 text-sm text-red-600">
                {relationsError}
              </div>
            ) : null}

            <div className="rounded-xl border p-4 space-y-3">
              <div className="text-sm font-medium">Legg til manuelt</div>

              <div className="grid gap-3 md:grid-cols-3">
                <label className="text-sm">
                  Type
                  <select
                    className="mt-1 w-full rounded-lg border px-3 py-2"
                    value={relType}
                    onChange={(e) => setRelType(e.target.value as RelationType)}
                  >
                    <option value="ACCESSORY">Ekstrautstyr</option>
                    <option value="SPARE_PART">Reservedel</option>
                  </select>
                </label>

                <label className="text-sm md:col-span-2">
                  Søk produkt (min 2 tegn)
                  <input
                    className="mt-1 w-full rounded-lg border px-3 py-2"
                    value={relSearch}
                    onChange={(e) => setRelSearch(e.target.value)}
                    placeholder="Søk på produktnr eller navn…"
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <select
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={relSelectedId}
                  onChange={(e) => setRelSelectedId(e.target.value)}
                  disabled={relSearching || relCandidates.length === 0}
                >
                  {relCandidates.length === 0 ? (
                    <option value="">
                      {relSearch.trim().length < 2
                        ? "Skriv minst 2 tegn for å søke…"
                        : relSearching
                        ? "Søker…"
                        : "Ingen treff"}
                    </option>
                  ) : (
                    relCandidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.product_no} — {c.name ?? "(uten navn)"}{" "}
                        {c.list_price != null ? `— ${formatNok(c.list_price)}` : ""}
                      </option>
                    ))
                  )}
                </select>

                <button
                  className="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                  onClick={addRelation}
                  disabled={!relSelectedId || relSaving}
                >
                  {relSaving ? "Legger til…" : "Legg til"}
                </button>
              </div>

              <div className="text-xs text-gray-600">
                Dette fyller tabellen <code>product_relations</code>.
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border p-4 space-y-2">
                <div className="font-medium text-sm">Ekstrautstyr</div>
                {accessories.length === 0 ? (
                  <div className="text-sm text-gray-600">
                    Ingen koblinger enda.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {accessories.map((r) => {
                      const rp = getRelatedProduct(r);
                      return (
                        <div
                          key={r.id}
                          className="flex items-center justify-between gap-3 rounded-lg border p-3"
                        >
                          <div className="min-w-0">
                            <div className="text-xs text-gray-600">
                              {relationLabel(r.relation_type)}
                            </div>
                            <div className="text-sm font-medium truncate">
                              {rp?.product_no ?? r.related_product_id} —{" "}
                              {rp?.name ?? "(uten navn)"}
                            </div>
                            <div className="text-xs text-gray-600">
                              {rp?.list_price != null ? formatNok(rp.list_price) : ""}
                            </div>
                          </div>
                          <button
                            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                            onClick={() => removeRelation(r)}
                          >
                            Fjern
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-xl border p-4 space-y-2">
                <div className="font-medium text-sm">Reservedeler</div>
                {spareParts.length === 0 ? (
                  <div className="text-sm text-gray-600">
                    Ingen koblinger enda.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {spareParts.map((r) => {
                      const rp = getRelatedProduct(r);
                      return (
                        <div
                          key={r.id}
                          className="flex items-center justify-between gap-3 rounded-lg border p-3"
                        >
                          <div className="min-w-0">
                            <div className="text-xs text-gray-600">
                              {relationLabel(r.relation_type)}
                            </div>
                            <div className="text-sm font-medium truncate">
                              {rp?.product_no ?? r.related_product_id} —{" "}
                              {rp?.name ?? "(uten navn)"}
                            </div>
                            <div className="text-xs text-gray-600">
                              {rp?.list_price != null ? formatNok(rp.list_price) : ""}
                            </div>
                          </div>
                          <button
                            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                            onClick={() => removeRelation(r)}
                          >
                            Fjern
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Gallery */}
          <section className="rounded-2xl border p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Bilder (galleri)</h2>
                <div className="text-sm text-gray-600">{images.length} bilde(r)</div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="block w-full text-sm md:w-auto"
                  onChange={(e) =>
                    setGalleryFiles(Array.from(e.target.files ?? []))
                  }
                />

                <button
                  disabled={uploadingGallery || galleryFiles.length === 0}
                  className="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                  onClick={uploadGallery}
                >
                  {uploadingGallery ? "Laster opp…" : "Last opp bilder"}
                </button>
              </div>
            </div>

            {images.length === 0 ? (
              <div className="rounded-xl border p-4 text-sm text-gray-600">
                Ingen galleri-bilder ennå.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {images.map((img) => (
                  <div key={img.id} className="rounded-xl border p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-xs text-gray-600 break-all">
                        {img.storage_path}
                      </div>
                      <button
                        className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
                        onClick={() => deleteGalleryImage(img)}
                      >
                        Slett
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        className="rounded-lg bg-black px-3 py-2 text-xs text-white"
                        onClick={async () => {
                          try {
                            await openSignedUrl(
                              supabase,
                              img.storage_bucket || IMAGE_BUCKET,
                              imgPath(img)
                            );
                          } catch (e: unknown) {
                            alert(e instanceof Error ? e.message : "Kunne ikke åpne.");
                          }
                        }}
                      >
                        Åpne
                      </button>

                      <div className="text-xs text-gray-600">
                        Sort: {img.sort_order ?? "-"}
                      </div>
                    </div>

                    <div className="text-xs text-gray-600">
                      {img.created_at ? formatDateTime(img.created_at) : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="text-xs text-gray-600">
              Bucket: <code>{IMAGE_BUCKET}</code> • Sti:{" "}
              <code>products/&lt;id&gt;/gallery/…</code>
            </div>
          </section>

          {/* Documents */}
          <section className="rounded-2xl border p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Dokumenter</h2>
                <div className="text-sm text-gray-600">{files.length} fil(er)</div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={docsInputRef}
                  type="file"
                  multiple
                  className="block w-full text-sm md:w-auto"
                  onChange={(e) => setDocFiles(Array.from(e.target.files ?? []))}
                />

                <button
                  disabled={uploadingDocs || docFiles.length === 0}
                  className="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                  onClick={uploadDocuments}
                >
                  {uploadingDocs ? "Laster opp…" : "Last opp dokumenter"}
                </button>
              </div>
            </div>

            {files.length === 0 ? (
              <div className="rounded-xl border p-4 text-sm text-gray-600">
                Ingen dokumenter ennå.
              </div>
            ) : (
              <div className="space-y-2">
                {files.map((f) => (
                  <div
                    key={f.id}
                    className="rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {f.title ?? f.relative_path.split("/").pop() ?? "Fil"}
                      </div>
                      <div className="text-xs text-gray-600 break-all">
                        {f.relative_path}
                      </div>
                      <div className="text-xs text-gray-600">
                        {f.file_type}
                        {f.created_at ? ` • ${formatDateTime(f.created_at)}` : ""}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        className="rounded-lg bg-black px-3 py-2 text-sm text-white"
                        onClick={async () => {
                          try {
                            await openSignedUrl(supabase, FILE_BUCKET, f.relative_path);
                          } catch (e: unknown) {
                            alert(e instanceof Error ? e.message : "Kunne ikke åpne.");
                          }
                        }}
                      >
                        Åpne
                      </button>

                      <button
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                        onClick={() => deleteDocument(f)}
                      >
                        Slett
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="text-xs text-gray-600">
              Bucket: <code>{FILE_BUCKET}</code> • Sti:{" "}
              <code>products/&lt;id&gt;/docs/…</code>
            </div>
          </section>
        </div>

        {/* Right: thumbnail */}
        <aside className="space-y-4">
          <section className="rounded-2xl border p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">Thumbnail</h2>
                <div className="text-sm text-gray-600">
                  Brukes i produktkort / lister.
                </div>
              </div>

              {product.thumb_path ? (
                <button
                  className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                  onClick={deleteThumbnail}
                >
                  Slett
                </button>
              ) : null}
            </div>

            {product.thumb_path ? (
              <div className="space-y-2">
                <div className="rounded-xl border p-3">
                  <div className="text-xs text-gray-600 break-all">
                    {product.thumb_path}
                  </div>
                </div>

                <button
                  className="w-full rounded-lg bg-black px-4 py-2 text-sm text-white"
                  onClick={async () => {
                    try {
                      await openSignedUrl(supabase, IMAGE_BUCKET, product.thumb_path!);
                    } catch (e: unknown) {
                      alert(e instanceof Error ? e.message : "Kunne ikke åpne.");
                    }
                  }}
                >
                  Åpne thumbnail
                </button>
              </div>
            ) : (
              <div className="rounded-xl border p-4 text-sm text-gray-600">
                Ingen thumbnail satt.
              </div>
            )}

            <div className="space-y-2">
              <input
                type="file"
                accept="image/*"
                className="block w-full text-sm"
                onChange={(e) => setThumbFile(e.target.files?.[0] ?? null)}
              />

              <button
                disabled={uploadingThumb || !thumbFile}
                className="w-full rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                onClick={uploadThumbnail}
              >
                {uploadingThumb ? "Laster opp…" : "Last opp thumbnail"}
              </button>

              <div className="text-xs text-gray-600">
                Bucket: <code>{IMAGE_BUCKET}</code> • Sti:{" "}
                <code>products/&lt;id&gt;/thumb.*</code>
              </div>
            </div>
          </section>

          {errorMsg ? (
            <section className="rounded-2xl border p-5">
              <div className="text-sm text-gray-700">{errorMsg}</div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}