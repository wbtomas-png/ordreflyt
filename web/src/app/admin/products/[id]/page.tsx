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

  // join kan komme som array
  related_product: ProductRow[] | null;
};

type ProfileRoleRow = { role: string | null };

const IMAGE_BUCKET = "product-images";
const FILE_BUCKET = "product-files";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

// Hjelper: hvis du har api/local-file (service proxy), kan du bruke den.
// Men vi bruker signed URL for bilder her for å være robust ved private buckets.
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

// normaliser related_product (array) -> ProductRow | null
function getRelatedProduct(r: ProductRelationRow): ProductRow | null {
  const x = r.related_product;
  if (!x || !Array.isArray(x) || x.length === 0) return null;
  return x[0] ?? null;
}

function imgPath(row: ProductImageRow) {
  return row.storage_path || row.path || "";
}

function supaErrToText(e: unknown) {
  // Supabase/PostgrestError er ofte et plain object.
  if (!e) return "Ukjent feil";
  if (e instanceof Error) return e.message;

  if (typeof e === "object") {
    const anyE = e as any;
    const msg =
      anyE.message ||
      anyE.error_description ||
      anyE.error ||
      anyE.hint ||
      anyE.details;
    const parts: string[] = [];
    if (anyE.code) parts.push(`code=${anyE.code}`);
    if (msg) parts.push(String(msg));
    if (anyE.details) parts.push(String(anyE.details));
    if (anyE.hint) parts.push(String(anyE.hint));
    return parts.filter(Boolean).join(" • ") || "Ukjent feil";
  }

  return String(e);
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

  // NOTE: cast én gang for å unngå "never"
  const sb = supabase as any;

  const [loading, setLoading] = useState(true);
  const [roleOk, setRoleOk] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [product, setProduct] = useState<ProductRow | null>(null);
  const [images, setImages] = useState<ProductImageRow[]>([]);
  const [files, setFiles] = useState<ProductFileRow[]>([]);

  // Relations
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

  // ===== signed url cache for previews =====
  const [previewUrlByKey, setPreviewUrlByKey] = useState<Record<string, string>>(
    {}
  );
  const previewInFlight = useRef<Record<string, boolean>>({});

  async function ensurePreviewUrl(bucket: string, path: string) {
    const key = `${bucket}::${path}`;
    if (!path) return;
    if (previewUrlByKey[key]) return;
    if (previewInFlight.current[key]) return;

    previewInFlight.current[key] = true;
    try {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, 60 * 15);

      if (error || !data?.signedUrl) return;

      setPreviewUrlByKey((prev) => ({ ...prev, [key]: data.signedUrl }));
    } finally {
      previewInFlight.current[key] = false;
    }
  }

  function getPreviewUrl(bucket: string, path: string | null | undefined) {
    if (!path) return null;
    const key = `${bucket}::${path}`;
    return previewUrlByKey[key] ?? null;
  }

  async function refreshRelations() {
    setRelationsLoading(true);
    setRelationsError(null);

    try {
      const { data, error } = await sb
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

      const list = ((data ?? []) as unknown) as ProductRelationRow[];
      setRelations(list);

      // preload thumbnails for related products
      for (const r of list) {
        const rp = getRelatedProduct(r);
        if (rp?.thumb_path) void ensurePreviewUrl(IMAGE_BUCKET, rp.thumb_path);
      }
    } catch (e: unknown) {
      console.error(e);
      setRelations([]);
      setRelationsError(supaErrToText(e) || "Kunne ikke hente relasjoner.");
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

      // rolle-sjekk
      const { data: prof, error: profErr } = (await sb
        .from("profiles")
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

      // produkt
      const { data: p, error: pErr } = await sb
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
        setErrorMsg("Fant ikke produktet.");
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

      // preload thumb preview
      if (pr.thumb_path) void ensurePreviewUrl(IMAGE_BUCKET, pr.thumb_path);

      // bilder
      const { data: img, error: imgErr } = await sb
        .from("product_images")
        .select(
          "id, product_id, storage_bucket, storage_path, caption, sort_order, created_at, path"
        )
        .eq("product_id", productId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (!alive) return;

      if (imgErr) {
        console.error(imgErr);
        setImages([]);
      } else {
        const list = ((img ?? []) as unknown) as ProductImageRow[];
        setImages(list);
        // preload gallery previews
        for (const row of list) {
          const bucket = row.storage_bucket || IMAGE_BUCKET;
          const path = imgPath(row);
          if (path) void ensurePreviewUrl(bucket, path);
        }
      }

      // dokumenter
      const { data: f, error: fErr } = await sb
        .from("product_files")
        .select("id, product_id, relative_path, file_type, title, created_at")
        .eq("product_id", productId)
        .order("created_at", { ascending: false });

      if (!alive) return;

      if (fErr) {
        console.error(fErr);
        setFiles([]);
      } else {
        setFiles(((f ?? []) as unknown) as ProductFileRow[]);
      }

      await refreshRelations();

      if (!alive) return;
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, router]);

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
        const { data, error } = await sb
          .from("products")
          .select("id, product_no, name, list_price, thumb_path, is_active")
          .or(`product_no.ilike.%${q}%,name.ilike.%${q}%`)
          .order("product_no", { ascending: true })
          .limit(25);

        if (error) throw error;

        const rows = ((data ?? []) as unknown) as ProductRow[];
        const filtered = rows.filter((x) => x.id !== productId);

        if (!alive) return;

        setRelCandidates(filtered);
        setRelSelectedId(filtered[0]?.id ?? "");

        // preload thumbs for candidates (nice UX)
        for (const c of filtered) {
          if (c.thumb_path) void ensurePreviewUrl(IMAGE_BUCKET, c.thumb_path);
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relSearch, productId]);

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

    const { error } = await sb
      .from("products")
      .update(patch)
      .eq("id", product.id);

    setSavingProduct(false);

    if (error) {
      console.error(error);
      alert(supaErrToText(error));
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

      const { error: dbErr } = await sb
        .from("products")
        .update({ thumb_path: path })
        .eq("id", product.id);

      if (dbErr) throw dbErr;

      setProduct((prev) => (prev ? { ...prev, thumb_path: path } : prev));
      setThumbFile(null);
      void ensurePreviewUrl(IMAGE_BUCKET, path);
      alert("Thumbnail lastet opp.");
    } catch (e: unknown) {
      console.error(e);
      alert(`Opplasting feilet: ${supaErrToText(e)}`);
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

        void ensurePreviewUrl(IMAGE_BUCKET, storage_path);
      }

      const { data: created, error: insErr } = await sb
        .from("product_images")
        .insert(inserts)
        .select(
          "id, product_id, storage_bucket, storage_path, caption, sort_order, created_at, path"
        );

      if (insErr) throw insErr;

      setImages((prev) =>
        [...prev, ...(((created ?? []) as unknown) as ProductImageRow[])].sort(
          (a, b) => {
            const sa = typeof a.sort_order === "number" ? a.sort_order : 0;
            const sb2 = typeof b.sort_order === "number" ? b.sort_order : 0;
            return sa - sb2;
          }
        )
      );

      setGalleryFiles([]);
      if (galleryInputRef.current) galleryInputRef.current.value = "";
      alert("Galleri-bilder lastet opp.");
    } catch (e: unknown) {
      console.error(e);
      alert(`Opplasting feilet: ${supaErrToText(e)}`);
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

      const { data: created, error: insErr } = await sb
        .from("product_files")
        .insert(inserts)
        .select("id, product_id, relative_path, file_type, title, created_at");

      if (insErr) throw insErr;

      setFiles((prev) => [
        ...(((created ?? []) as unknown) as ProductFileRow[]),
        ...prev,
      ]);
      setDocFiles([]);
      if (docsInputRef.current) docsInputRef.current.value = "";
      alert("Dokument(er) lastet opp.");
    } catch (e: unknown) {
      console.error(e);
      alert(`Opplasting feilet: ${supaErrToText(e)}`);
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

      const { error: dbErr } = await sb
        .from("product_images")
        .delete()
        .eq("id", row.id);
      if (dbErr) throw dbErr;

      setImages((prev) => prev.filter((x) => x.id !== row.id));
    } catch (e: unknown) {
      console.error(e);
      alert(`Kunne ikke slette: ${supaErrToText(e)}`);
    }
  }

  async function deleteDocument(row: ProductFileRow) {
    if (!confirm("Slette dette dokumentet?")) return;

    try {
      const { error: stErr } = await supabase.storage
        .from(FILE_BUCKET)
        .remove([row.relative_path]);
      if (stErr) throw stErr;

      const { error: dbErr } = await sb
        .from("product_files")
        .delete()
        .eq("id", row.id);
      if (dbErr) throw dbErr;

      setFiles((prev) => prev.filter((x) => x.id !== row.id));
    } catch (e: unknown) {
      console.error(e);
      alert(`Kunne ikke slette: ${supaErrToText(e)}`);
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

      const { error: dbErr } = await sb
        .from("products")
        .update({ thumb_path: null })
        .eq("id", product.id);
      if (dbErr) throw dbErr;

      setProduct((prev) => (prev ? { ...prev, thumb_path: null } : prev));
      alert("Thumbnail slettet.");
    } catch (e: unknown) {
      console.error(e);
      alert(`Kunne ikke slette: ${supaErrToText(e)}`);
    }
  }

  async function addRelation() {
    if (!product) return;

    const rid = relSelectedId;
    if (!rid) {
      alert("Velg et produkt å legge til.");
      return;
    }

    // vanlige årsak: duplikat
    const already = relations.some(
      (r) => r.relation_type === relType && r.related_product_id === rid
    );
    if (already) {
      alert("Denne koblingen finnes allerede.");
      return;
    }

    setRelSaving(true);
    setRelationsError(null);

    try {
      const maxSort = relations
        .filter((r) => r.relation_type === relType)
        .reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0);

      const { error } = await sb.from("product_relations").insert({
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
      const msg = supaErrToText(e);
      setRelationsError(msg);
      alert(`Kunne ikke legge til relasjon: ${msg}`);
    } finally {
      setRelSaving(false);
    }
  }

  async function removeRelation(row: ProductRelationRow) {
    if (!confirm("Fjerne koblingen?")) return;

    try {
      const { error } = await sb
        .from("product_relations")
        .delete()
        .eq("id", row.id);
      if (error) throw error;

      setRelations((prev) => prev.filter((x) => x.id !== row.id));
    } catch (e: unknown) {
      console.error(e);
      alert(`Kunne ikke fjerne relasjonen: ${supaErrToText(e)}`);
    }
  }

  // ===== Delete product (custom modal Ja/Nei) =====
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function deleteProductNow() {
    if (!product) return;

    setDeleting(true);
    setErrorMsg(null);

    try {
      // 1) hent alt vi må rydde opp
      const { data: imgRows, error: imgErr } = await sb
        .from("product_images")
        .select("id, storage_bucket, storage_path, path")
        .eq("product_id", product.id);

      if (imgErr) throw imgErr;

      const { data: fileRows, error: fileErr } = await sb
        .from("product_files")
        .select("id, relative_path")
        .eq("product_id", product.id);

      if (fileErr) throw fileErr;

      // 2) slett relasjoner (både som parent og som related)
      {
        const { error: relErr1 } = await sb
          .from("product_relations")
          .delete()
          .eq("product_id", product.id);
        if (relErr1) throw relErr1;

        const { error: relErr2 } = await sb
          .from("product_relations")
          .delete()
          .eq("related_product_id", product.id);
        if (relErr2) throw relErr2;
      }

      // 3) slett DB-rader + storage (best effort på storage)
      // images storage
      const imgList = (((imgRows ?? []) as unknown) as ProductImageRow[]).map(
        (r) => ({
          bucket: (r as any).storage_bucket || IMAGE_BUCKET,
          path: (r as any).storage_path || (r as any).path || "",
          id: (r as any).id,
        })
      );

      for (const x of imgList) {
        if (x.path) {
          await supabase.storage.from(x.bucket).remove([x.path]).catch(() => null);
        }
      }

      // delete product_images rows
      {
        const { error: delImgDbErr } = await sb
          .from("product_images")
          .delete()
          .eq("product_id", product.id);
        if (delImgDbErr) throw delImgDbErr;
      }

      // files storage
      const fileList = (((fileRows ?? []) as unknown) as ProductFileRow[]).map(
        (r) => ({
          path: (r as any).relative_path as string,
        })
      );

      for (const f of fileList) {
        if (f.path) {
          await supabase.storage.from(FILE_BUCKET).remove([f.path]).catch(() => null);
        }
      }

      // delete product_files rows
      {
        const { error: delFilesDbErr } = await sb
          .from("product_files")
          .delete()
          .eq("product_id", product.id);
        if (delFilesDbErr) throw delFilesDbErr;
      }

      // thumb storage
      if (product.thumb_path) {
        await supabase.storage.from(IMAGE_BUCKET).remove([product.thumb_path]).catch(() => null);
      }

      // 4) slett produktet
      const { error: delProdErr } = await sb
        .from("products")
        .delete()
        .eq("id", product.id);

      if (delProdErr) throw delProdErr;

      // done
      setConfirmDeleteOpen(false);
      router.push("/admin/products");
    } catch (e: unknown) {
      console.error(e);
      const msg = supaErrToText(e);
      setErrorMsg(`Kunne ikke slette produkt: ${msg}`);
      alert(`Kunne ikke slette produkt: ${msg}`);
    } finally {
      setDeleting(false);
    }
  }

  const accessories = relations.filter((r) => r.relation_type === "ACCESSORY");
  const spareParts = relations.filter((r) => r.relation_type === "SPARE_PART");

  // preload thumb previews when relations change
  useEffect(() => {
    for (const r of relations) {
      const rp = getRelatedProduct(r);
      if (rp?.thumb_path) void ensurePreviewUrl(IMAGE_BUCKET, rp.thumb_path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relations]);

  // preload gallery previews when images change
  useEffect(() => {
    for (const row of images) {
      const bucket = row.storage_bucket || IMAGE_BUCKET;
      const path = imgPath(row);
      if (path) void ensurePreviewUrl(bucket, path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white p-6">
        <div className="text-sm text-neutral-300">Laster…</div>
      </div>
    );
  }

  if (!roleOk) {
    return (
      <div className="min-h-screen bg-black text-white p-6 space-y-3">
        <button
          className="rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900"
          onClick={() => router.push("/products")}
        >
          ← Til produkter
        </button>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5 text-sm text-neutral-200">
          Du har ikke admin-tilgang. Rollen må være <b>ADMIN</b> i{" "}
          <code className="text-neutral-100">profiles</code>.
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-black text-white p-6 space-y-3">
        <button
          className="rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900"
          onClick={() => router.push("/admin/products")}
        >
          ← Til admin produkter
        </button>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5 text-sm text-neutral-200">
          {errorMsg ?? "Fant ikke produkt."}
        </div>
      </div>
    );
  }

  const thumbPreview = getPreviewUrl(IMAGE_BUCKET, product.thumb_path);

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Confirm delete modal */}
      {confirmDeleteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" />
          <div className="relative w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-950 p-5 shadow-xl">
            <div className="text-lg font-semibold">Slette produkt?</div>
            <div className="mt-2 text-sm text-neutral-300">
              Er du sikker på at du vil slette{" "}
              <span className="font-medium text-white">
                {product.product_no}
              </span>{" "}
              {product.name ? `(${product.name})` : ""}?
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className="rounded-xl border border-neutral-800 px-4 py-2 text-sm hover:bg-neutral-900"
                onClick={() => setConfirmDeleteOpen(false)}
                disabled={deleting}
              >
                Nei
              </button>
              <button
                className="rounded-xl bg-red-600 px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
                onClick={deleteProductNow}
                disabled={deleting}
              >
                {deleting ? "Sletter…" : "Ja, slett"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="p-6 space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900"
              onClick={() => router.push("/admin/products")}
            >
              ← Admin produkter
            </button>

            <button
              className="rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900"
              onClick={() => router.push("/products")}
            >
              Produkter (kundevisning)
            </button>

            <button
              className="rounded-lg border border-red-700/60 bg-red-600/10 px-3 py-2 hover:bg-red-600/20"
              onClick={() => setConfirmDeleteOpen(true)}
            >
              Slett produkt
            </button>
          </div>

          <div className="text-xs text-neutral-400">
            Produkt-ID: <code className="text-neutral-200">{product.id}</code>
          </div>
        </header>

        {errorMsg ? (
          <div className="rounded-2xl border border-red-700/50 bg-red-900/20 p-4 text-sm text-red-200">
            {errorMsg}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            {/* Produkt */}
            <section className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="text-xl font-semibold">Rediger produkt</h1>
                  <div className="text-sm text-neutral-400">
                    (product_no, name, list_price, is_active)
                  </div>
                </div>

                <button
                  disabled={savingProduct}
                  className="rounded-lg bg-white px-4 py-2 text-sm text-black hover:opacity-90 disabled:opacity-50"
                  onClick={saveProduct}
                >
                  {savingProduct ? "Lagrer…" : "Lagre"}
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm text-neutral-200">
                  Produktnr (må være satt)
                  <input
                    className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-white outline-none focus:border-neutral-500"
                    value={productNo}
                    onChange={(e) => setProductNo(e.target.value)}
                    placeholder="P-001"
                  />
                </label>

                <label className="text-sm text-neutral-200">
                  Pris (NOK)
                  <input
                    className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-white outline-none focus:border-neutral-500"
                    value={listPrice}
                    onChange={(e) => setListPrice(e.target.value)}
                    placeholder="1990"
                    inputMode="numeric"
                  />
                  <div className="mt-1 text-xs text-neutral-400">
                    {listPrice
                      ? `Visning: ${formatNok(Number(listPrice.replace(",", ".")))}`
                      : ""}
                  </div>
                </label>
              </div>

              <label className="text-sm text-neutral-200 block">
                Navn
                <input
                  className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-white outline-none focus:border-neutral-500"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Produktnavn"
                />
              </label>

              <label className="inline-flex items-center gap-2 text-sm text-neutral-200">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                Aktiv
              </label>
            </section>

            {/* Ekstrautstyr / Reservedeler */}
            <section className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Ekstrautstyr / reservedeler</h2>
                  <div className="text-sm text-neutral-400">
                    Ekstrautstyr: {accessories.length} • Reservedeler:{" "}
                    {spareParts.length}
                  </div>
                </div>

                <button
                  className="rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900"
                  onClick={refreshRelations}
                  disabled={relationsLoading}
                >
                  {relationsLoading ? "Oppdaterer…" : "Oppdater"}
                </button>
              </div>

              {relationsError ? (
                <div className="rounded-xl border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-200">
                  {relationsError}
                </div>
              ) : null}

              <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 space-y-3">
                <div className="text-sm font-medium">Legg til manuelt</div>

                <div className="grid gap-3 md:grid-cols-3">
                  <label className="text-sm text-neutral-200">
                    Type
                    <select
                      className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-white outline-none focus:border-neutral-500"
                      value={relType}
                      onChange={(e) => setRelType(e.target.value as RelationType)}
                    >
                      <option value="ACCESSORY">Ekstrautstyr</option>
                      <option value="SPARE_PART">Reservedel</option>
                    </select>
                  </label>

                  <label className="text-sm text-neutral-200 md:col-span-2">
                    Søk produkt (min 2 tegn)
                    <input
                      className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-white outline-none focus:border-neutral-500"
                      value={relSearch}
                      onChange={(e) => setRelSearch(e.target.value)}
                      placeholder="Søk på produktnr eller navn…"
                    />
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <select
                    className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white outline-none focus:border-neutral-500"
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
                    className="rounded-lg bg-white px-4 py-2 text-sm text-black hover:opacity-90 disabled:opacity-50"
                    onClick={addRelation}
                    disabled={!relSelectedId || relSaving}
                  >
                    {relSaving ? "Legger til…" : "Legg til"}
                  </button>
                </div>

                <div className="text-xs text-neutral-400">
                  Dette fyller tabellen <code className="text-neutral-200">product_relations</code>.
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {/* accessories */}
                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 space-y-2">
                  <div className="font-medium text-sm">Ekstrautstyr</div>

                  {accessories.length === 0 ? (
                    <div className="text-sm text-neutral-400">
                      Ingen koblinger enda.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {accessories.map((r) => {
                        const rp = getRelatedProduct(r);
                        const rpThumb = rp?.thumb_path
                          ? getPreviewUrl(IMAGE_BUCKET, rp.thumb_path)
                          : null;

                        return (
                          <div
                            key={r.id}
                            className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
                                {rpThumb ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={rpThumb}
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="h-full w-full grid place-items-center text-xs text-neutral-500">
                                    —
                                  </div>
                                )}
                              </div>

                              <div className="min-w-0">
                                <div className="text-xs text-neutral-500">
                                  {relationLabel(r.relation_type)}
                                </div>
                                <div className="text-sm font-medium truncate">
                                  {rp?.product_no ?? r.related_product_id} —{" "}
                                  {rp?.name ?? "(uten navn)"}
                                </div>
                                <div className="text-xs text-neutral-400">
                                  {rp?.list_price != null ? formatNok(rp.list_price) : ""}
                                </div>
                              </div>
                            </div>

                            <button
                              className="rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900"
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

                {/* spare parts */}
                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 space-y-2">
                  <div className="font-medium text-sm">Reservedeler</div>

                  {spareParts.length === 0 ? (
                    <div className="text-sm text-neutral-400">
                      Ingen koblinger enda.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {spareParts.map((r) => {
                        const rp = getRelatedProduct(r);
                        const rpThumb = rp?.thumb_path
                          ? getPreviewUrl(IMAGE_BUCKET, rp.thumb_path)
                          : null;

                        return (
                          <div
                            key={r.id}
                            className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
                                {rpThumb ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={rpThumb}
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="h-full w-full grid place-items-center text-xs text-neutral-500">
                                    —
                                  </div>
                                )}
                              </div>

                              <div className="min-w-0">
                                <div className="text-xs text-neutral-500">
                                  {relationLabel(r.relation_type)}
                                </div>
                                <div className="text-sm font-medium truncate">
                                  {rp?.product_no ?? r.related_product_id} —{" "}
                                  {rp?.name ?? "(uten navn)"}
                                </div>
                                <div className="text-xs text-neutral-400">
                                  {rp?.list_price != null ? formatNok(rp.list_price) : ""}
                                </div>
                              </div>
                            </div>

                            <button
                              className="rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900"
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
            <section className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Bilder (galleri)</h2>
                  <div className="text-sm text-neutral-400">
                    {images.length} bilde(r)
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="block w-full text-sm md:w-auto text-neutral-200"
                    onChange={(e) =>
                      setGalleryFiles(Array.from(e.target.files ?? []))
                    }
                  />

                  <button
                    disabled={uploadingGallery || galleryFiles.length === 0}
                    className="rounded-lg bg-white px-4 py-2 text-sm text-black hover:opacity-90 disabled:opacity-50"
                    onClick={uploadGallery}
                  >
                    {uploadingGallery ? "Laster opp…" : "Last opp bilder"}
                  </button>
                </div>
              </div>

              {images.length === 0 ? (
                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-400">
                  Ingen galleri-bilder ennå.
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {images.map((img) => {
                    const bucket = img.storage_bucket || IMAGE_BUCKET;
                    const path = imgPath(img);
                    const prevUrl = path ? getPreviewUrl(bucket, path) : null;

                    return (
                      <div
                        key={img.id}
                        className="rounded-xl border border-neutral-800 bg-neutral-950 p-3 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-xs text-neutral-500 break-all">
                            {img.storage_path || img.path}
                          </div>
                          <button
                            className="rounded-lg border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900"
                            onClick={() => deleteGalleryImage(img)}
                          >
                            Slett
                          </button>
                        </div>

                        <div className="aspect-[4/3] w-full overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
                          {prevUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={prevUrl}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="h-full w-full grid place-items-center text-xs text-neutral-500">
                              Laster…
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            className="rounded-lg bg-white px-3 py-2 text-xs text-black hover:opacity-90"
                            onClick={async () => {
                              try {
                                await openSignedUrl(supabase, bucket, path);
                              } catch (e: unknown) {
                                alert(supaErrToText(e));
                              }
                            }}
                            disabled={!path}
                          >
                            Åpne
                          </button>

                          <div className="text-xs text-neutral-400">
                            Sort: {img.sort_order ?? "-"}
                          </div>
                        </div>

                        <div className="text-xs text-neutral-500">
                          {img.created_at ? formatDateTime(img.created_at) : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="text-xs text-neutral-500">
                Bucket: <code className="text-neutral-200">{IMAGE_BUCKET}</code> • Sti:{" "}
                <code className="text-neutral-200">products/&lt;id&gt;/gallery/…</code>
              </div>
            </section>

            {/* Documents */}
            <section className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Dokumenter</h2>
                  <div className="text-sm text-neutral-400">
                    {files.length} fil(er)
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={docsInputRef}
                    type="file"
                    multiple
                    className="block w-full text-sm md:w-auto text-neutral-200"
                    onChange={(e) => setDocFiles(Array.from(e.target.files ?? []))}
                  />

                  <button
                    disabled={uploadingDocs || docFiles.length === 0}
                    className="rounded-lg bg-white px-4 py-2 text-sm text-black hover:opacity-90 disabled:opacity-50"
                    onClick={uploadDocuments}
                  >
                    {uploadingDocs ? "Laster opp…" : "Last opp dokumenter"}
                  </button>
                </div>
              </div>

              {files.length === 0 ? (
                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-400">
                  Ingen dokumenter ennå.
                </div>
              ) : (
                <div className="space-y-2">
                  {files.map((f) => (
                    <div
                      key={f.id}
                      className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {f.title ?? f.relative_path.split("/").pop() ?? "Fil"}
                        </div>
                        <div className="text-xs text-neutral-500 break-all">
                          {f.relative_path}
                        </div>
                        <div className="text-xs text-neutral-500">
                          {f.file_type}
                          {f.created_at ? ` • ${formatDateTime(f.created_at)}` : ""}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          className="rounded-lg bg-white px-3 py-2 text-sm text-black hover:opacity-90"
                          onClick={async () => {
                            try {
                              await openSignedUrl(supabase, FILE_BUCKET, f.relative_path);
                            } catch (e: unknown) {
                              alert(supaErrToText(e));
                            }
                          }}
                        >
                          Åpne
                        </button>

                        <button
                          className="rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900"
                          onClick={() => deleteDocument(f)}
                        >
                          Slett
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="text-xs text-neutral-500">
                Bucket: <code className="text-neutral-200">{FILE_BUCKET}</code> • Sti:{" "}
                <code className="text-neutral-200">products/&lt;id&gt;/docs/…</code>
              </div>
            </section>
          </div>

          {/* Right: thumbnail */}
          <aside className="space-y-4">
            <section className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Thumbnail</h2>
                  <div className="text-sm text-neutral-400">
                    Brukes i produktkort / lister.
                  </div>
                </div>

                {product.thumb_path ? (
                  <button
                    className="rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900"
                    onClick={deleteThumbnail}
                  >
                    Slett
                  </button>
                ) : null}
              </div>

              <div className="space-y-3">
                <div className="aspect-[4/3] w-full overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
                  {thumbPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbPreview}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full grid place-items-center text-sm text-neutral-500">
                      {product.thumb_path ? "Laster…" : "Ingen thumbnail"}
                    </div>
                  )}
                </div>

                {product.thumb_path ? (
                  <button
                    className="w-full rounded-lg bg-white px-4 py-2 text-sm text-black hover:opacity-90"
                    onClick={async () => {
                      try {
                        await openSignedUrl(supabase, IMAGE_BUCKET, product.thumb_path!);
                      } catch (e: unknown) {
                        alert(supaErrToText(e));
                      }
                    }}
                  >
                    Åpne thumbnail
                  </button>
                ) : null}

                {product.thumb_path ? (
                  <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                    <div className="text-xs text-neutral-500 break-all">
                      {product.thumb_path}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="space-y-2">
                <input
                  type="file"
                  accept="image/*"
                  className="block w-full text-sm text-neutral-200"
                  onChange={(e) => setThumbFile(e.target.files?.[0] ?? null)}
                />

                <button
                  disabled={uploadingThumb || !thumbFile}
                  className="w-full rounded-lg bg-white px-4 py-2 text-sm text-black hover:opacity-90 disabled:opacity-50"
                  onClick={uploadThumbnail}
                >
                  {uploadingThumb ? "Laster opp…" : "Last opp thumbnail"}
                </button>

                <div className="text-xs text-neutral-500">
                  Bucket: <code className="text-neutral-200">{IMAGE_BUCKET}</code> • Sti:{" "}
                  <code className="text-neutral-200">products/&lt;id&gt;/thumb.*</code>
                </div>
              </div>
            </section>

            {relationsError ? (
              <section className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
                <div className="text-sm text-red-200">{relationsError}</div>
                <div className="mt-2 text-xs text-neutral-500">
                  Tips: hvis dette er RLS, må du ha policy som tillater ADMIN å insert/delete i{" "}
                  <code className="text-neutral-200">product_relations</code>.
                </div>
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}