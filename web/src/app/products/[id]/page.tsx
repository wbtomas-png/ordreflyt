// file: web/src/app/products/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { addToCart } from "@/lib/cart";

type ProductRow = {
  id: string;
  product_no: string;
  name: string;
  list_price: number | null;
  thumb_path: string | null; // Supabase Storage path (bucket: product-images)
  is_active: boolean | null;
};

type ProductFileRow = {
  id: string;
  file_type: string;
  title: string | null;
  relative_path: string; // Supabase Storage path (bucket: product-files)
};

type ProductImageRow = {
  id: string;
  storage_bucket: string; // "product-images"
  storage_path: string;
  caption: string | null;
  sort_order: number | null;
};

type LinkedRow = {
  link_id: string;
  link_type: "SPARE_PART" | "ACCESSORY";
  product: ProductRow;
};

type ProfileRoleRow = {
  role: string | null;
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatNok(value: number | null) {
  if (value == null) return "—";
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(value);
}

function niceType(t: string) {
  const x = (t ?? "").toLowerCase();
  if (x === "fdv") return "FDV";
  if (x === "datablad") return "Datablad";
  if (x === "tegning") return "Tegning";
  if (x === "modell") return "3D-modell";
  if (x === "bilde") return "Bilde";
  return t;
}

function linkTypeLabel(t: LinkedRow["link_type"]) {
  return t === "SPARE_PART" ? "Reservedel" : "Ekstrautstyr";
}

async function fetchSignedUrl(opts: {
  token: string;
  bucket: string;
  path: string;
  expires?: number;
  download?: boolean;
}) {
  const qs = new URLSearchParams({
    bucket: opts.bucket,
    path: opts.path,
    expires: String(opts.expires ?? 600),
    ...(opts.download ? { download: "1" } : {}),
  });

  const res = await fetch(`/api/files/signed-url?${qs.toString()}`, {
    method: "GET",
    headers: { authorization: `Bearer ${opts.token}` },
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error ?? `Signed URL failed (status ${res.status})`);
  }
  return data.url as string;
}

export default function ProductDetailsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sp = useSearchParams();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<ProductRow | null>(null);

  const [files, setFiles] = useState<ProductFileRow[]>([]);
  const [fileUrlByPath, setFileUrlByPath] = useState<Record<string, string>>({});

  const [images, setImages] = useState<ProductImageRow[]>([]);
  const [imgUrlByPath, setImgUrlByPath] = useState<Record<string, string>>({});

  const [linked, setLinked] = useState<LinkedRow[]>([]);
  const [linkSearch, setLinkSearch] = useState("");

  const [addQ, setAddQ] = useState("");
  const [addResults, setAddResults] = useState<ProductRow[]>([]);
  const [addType, setAddType] = useState<LinkedRow["link_type"]>("SPARE_PART");
  const [role, setRole] = useState<string | null>(null);

  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // Lightbox (bildefremvisning)
  const [activeImgUrl, setActiveImgUrl] = useState<string | null>(null);
  const [activeImgCaption, setActiveImgCaption] = useState<string | null>(null);

  async function refreshLinked(productId: string) {
    const { data: links, error: linksErr } = await supabase
      .from("product_relations")
      .select("id, relation_type, related_product_id")
      .eq("product_id", productId)
      .order("created_at", { ascending: false });

    if (linksErr) {
      console.error("product_relations select failed:", linksErr);
      setLinked([]);
      return;
    }

    const ids = (links ?? []).map((x: any) => x.related_product_id);
    if (ids.length === 0) {
      setLinked([]);
      return;
    }

    const { data: prods, error: prodsErr } = await supabase
      .from("products")
      .select("id, product_no, name, list_price, thumb_path, is_active")
      .in("id", ids);

    if (prodsErr) {
      console.error("linked products select failed:", prodsErr);
      setLinked([]);
      return;
    }

    const byId = new Map<string, ProductRow>();
    (prods ?? []).forEach((p: any) => byId.set(p.id, p as ProductRow));

    const rows: LinkedRow[] = (links ?? [])
      .map((l: any) => {
        const p = byId.get(l.related_product_id);
        if (!p) return null;
        return {
          link_id: l.id,
          link_type: l.relation_type as LinkedRow["link_type"],
          product: p,
        } as LinkedRow;
      })
      .filter(Boolean) as LinkedRow[];

    setLinked(rows);
  }

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);

      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) {
        router.replace("/login");
        return;
      }

      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? null;
      if (!token) {
        router.replace("/login");
        return;
      }
      if (alive) setAccessToken(token);

      const id = params.id;

      const { data: prof, error: pErr } = (await supabase
        .from("profiles" as any)
        .select("role")
        .eq("user_id", userRes.user.id)
        .maybeSingle()) as { data: ProfileRoleRow | null; error: any };

      if (pErr) console.warn("profiles role lookup failed:", pErr);
      if (alive) setRole(prof?.role ?? null);

      const { data: prod, error: prodErr } = await supabase
        .from("products")
        .select("id, product_no, name, list_price, thumb_path, is_active")
        .eq("id", id)
        .maybeSingle();

      if (!alive) return;

      if (prodErr || !prod) {
        if (prodErr) console.error("products select failed:", prodErr);
        setProduct(null);
        setFiles([]);
        setImages([]);
        setLinked([]);
        setThumbUrl(null);
        setFileUrlByPath({});
        setImgUrlByPath({});
        setLoading(false);
        return;
      }

      setProduct(prod as ProductRow);

      // Thumb signed URL
      try {
        const p = prod as any;
        if (p.thumb_path) {
          const u = await fetchSignedUrl({
            token,
            bucket: "product-images",
            path: String(p.thumb_path),
            expires: 600,
          });
          if (alive) setThumbUrl(u);
        } else {
          if (alive) setThumbUrl(null);
        }
      } catch (e) {
        console.warn("thumb signed-url failed:", (prod as any).thumb_path, e);
        if (alive) setThumbUrl(null);
      }

      // Dokumenter
      const { data: fileRows, error: fileErr } = await supabase
        .from("product_files")
        .select("id, file_type, title, relative_path")
        .eq("product_id", id)
        .order("created_at", { ascending: false });

      if (!alive) return;

      if (fileErr) {
        console.error("product_files select failed:", fileErr);
        setFiles([]);
        setFileUrlByPath({});
      } else {
        const list = (fileRows ?? []) as ProductFileRow[];
        setFiles(list);

        const uniquePaths = Array.from(
          new Set(list.map((x) => x.relative_path).filter(Boolean))
        ) as string[];

        const entries: Array<[string, string]> = [];
        for (const storagePath of uniquePaths) {
          try {
            const u = await fetchSignedUrl({
              token,
              bucket: "product-files",
              path: storagePath,
              expires: 600,
              download: true,
            });
            entries.push([storagePath, u]);
          } catch (e) {
            console.warn("doc signed-url failed:", storagePath, e);
          }
        }

        if (alive) {
          setFileUrlByPath(() => {
            const next: Record<string, string> = {};
            for (const [p, u] of entries) next[p] = u;
            return next;
          });
        }
      }

      // Galleri-bilder
      const { data: imgRows, error: imgErr } = await supabase
        .from("product_images")
        .select("id, storage_bucket, storage_path, caption, sort_order")
        .eq("product_id", id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (!alive) return;

      if (imgErr) {
        console.error("product_images select failed:", imgErr);
        setImages([]);
        setImgUrlByPath({});
      } else {
        const list = (imgRows ?? []) as ProductImageRow[];
        setImages(list);

        const uniqueImgPaths = Array.from(
          new Set(list.map((x) => x.storage_path).filter(Boolean))
        ) as string[];

        const imgEntries: Array<[string, string]> = [];
        for (const storagePath of uniqueImgPaths) {
          try {
            const u = await fetchSignedUrl({
              token,
              bucket: "product-images",
              path: storagePath,
              expires: 600,
            });
            imgEntries.push([storagePath, u]);
          } catch (e) {
            console.warn("image signed-url failed:", storagePath, e);
          }
        }

        if (alive) {
          setImgUrlByPath(() => {
            const next: Record<string, string> = {};
            for (const [p, u] of imgEntries) next[p] = u;
            return next;
          });
        }
      }

      await refreshLinked(id);

      if (!alive) return;
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, router, supabase, sp]);

  // ESC lukker bildefremvisning
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setActiveImgUrl(null);
        setActiveImgCaption(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function onAddProductToCart(p: ProductRow) {
    addToCart(
      {
        product_id: p.id,
        product_no: p.product_no,
        name: p.name,
        list_price: p.list_price ?? 0,
      } as any,
      1
    );
    router.push("/cart");
  }

  async function searchProducts(q: string) {
    if (!product) return;
    const s = q.trim();
    if (s.length < 2) {
      setAddResults([]);
      return;
    }

    const { data: rows, error } = await supabase
      .from("products")
      .select("id, product_no, name, list_price, thumb_path, is_active")
      .order("name", { ascending: true })
      .limit(200);

    if (error) {
      console.error("products search failed:", error);
      setAddResults([]);
      return;
    }

    const low = s.toLowerCase();
    const filtered = (rows ?? [])
      .map((x: any) => x as ProductRow)
      .filter((p) => p.id !== product.id)
      .filter(
        (p) =>
          p.product_no.toLowerCase().includes(low) ||
          p.name.toLowerCase().includes(low)
      )
      .slice(0, 20);

    setAddResults(filtered);
  }

  async function linkProduct(target: ProductRow) {
    if (!product) return;

    const payload = {
      product_id: product.id,
      related_product_id: target.id,
      relation_type: addType,
    };

    const { error } = await (supabase as any)
      .from("product_relations")
      .insert(payload as any);

    if (error) {
      console.error("product_relations insert failed:", error, payload);
      alert(error.message);
      return;
    }

    setAddQ("");
    setAddResults([]);
    await refreshLinked(product.id);
  }

  async function unlink(link_id: string) {
    if (!product) return;

    const { error } = await supabase.from("product_relations").delete().eq("id", link_id);

    if (error) {
      console.error("product_relations delete failed:", error);
      alert(error.message);
      return;
    }

    await refreshLinked(product.id);
  }

  const linkedFiltered = useMemo(() => {
    const s = linkSearch.trim().toLowerCase();
    if (!s) return linked;
    return linked.filter(
      (x) =>
        x.product.product_no.toLowerCase().includes(s) ||
        x.product.name.toLowerCase().includes(s)
    );
  }, [linkSearch, linked]);

  if (loading) return <div className="p-6 max-sm:bg-gray-950 max-sm:text-gray-100">Laster…</div>;
  if (!product) return <div className="p-6 max-sm:bg-gray-950 max-sm:text-gray-100">Fant ikke produkt.</div>;

  const roleUpper = (role ?? "").toUpperCase();
  const isAdminOrPurchaser = roleUpper === "ADMIN" || roleUpper === "PURCHASER";

  return (
    <div className="min-h-screen p-6 space-y-6 bg-white text-gray-900 max-sm:bg-gray-950 max-sm:text-gray-100">
      {/* Lightbox */}
      {activeImgUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => {
            setActiveImgUrl(null);
            setActiveImgCaption(null);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-5xl rounded-2xl border border-white/10 bg-black p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-2 pb-2">
              <div className="text-sm text-gray-200 truncate">
                {activeImgCaption ?? product.name}
              </div>
              <button
                className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-gray-100 hover:bg-white/10"
                onClick={() => {
                  setActiveImgUrl(null);
                  setActiveImgCaption(null);
                }}
              >
                Lukk
              </button>
            </div>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activeImgUrl}
              alt={activeImgCaption ?? product.name}
              className="max-h-[75vh] w-full rounded-xl object-contain bg-black"
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <button className="underline" onClick={() => router.back()}>
          ← Tilbake
        </button>

        <div className="flex gap-2">
          <button
            className="rounded-lg border px-3 py-2 hover:bg-gray-50 max-sm:hover:bg-white/10"
            onClick={() => router.push("/orders")}
          >
            Mine ordre
          </button>
          <button
            className="rounded-lg border px-3 py-2 hover:bg-gray-50 max-sm:hover:bg-white/10"
            onClick={() => router.push("/cart")}
          >
            Handlevogn
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px,1fr]">
        {/* Venstre */}
        <div className="space-y-4">
          <div className="rounded-xl border p-3 bg-white max-sm:bg-gray-900 max-sm:border-white/10">
            {thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbUrl}
                alt={product.name}
                className="w-full rounded-lg object-contain"
              />
            ) : (
              <div className="text-sm text-gray-600 max-sm:text-gray-300">Ingen bilde</div>
            )}
          </div>

          <div className="rounded-xl border p-4 space-y-1 bg-white max-sm:bg-gray-900 max-sm:border-white/10">
            <div className="text-sm text-gray-600 max-sm:text-gray-300">{product.product_no}</div>
            <div className="text-lg font-semibold">{product.name}</div>
            <div className="text-sm font-semibold">{formatNok(product.list_price)}</div>

            <button
              onClick={() => onAddProductToCart(product)}
              className="mt-3 w-full rounded-lg bg-black px-4 py-2 text-white hover:opacity-90"
            >
              Legg produkt i handlevogn
            </button>
          </div>
        </div>

        {/* Høyre */}
        <div className="space-y-6">
          {/* 3D */}
          <div className="rounded-xl border p-4 bg-white max-sm:bg-gray-900 max-sm:border-white/10">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">3D-visning</h2>
            </div>

            <div className="mt-3 rounded-lg border p-6 text-sm bg-gray-50 text-gray-700 max-sm:bg-black/30 max-sm:text-gray-100 max-sm:border-white/10">
              Her kommer 3d modell visning
            </div>
          </div>

          {/* Galleri */}
          <div className="rounded-xl border p-4 bg-white max-sm:bg-gray-900 max-sm:border-white/10">
            <h2 className="font-semibold">Bilder</h2>

            {images.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600 max-sm:text-gray-300">
                Ingen bilder i galleriet.
              </p>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {images.map((img) => {
                  const url = imgUrlByPath[img.storage_path] ?? null;

                  return (
                    <button
                      key={img.id}
                      type="button"
                      className={cn(
                        "rounded-lg border p-2 text-left transition",
                        "hover:bg-gray-50 max-sm:hover:bg-white/5",
                        "bg-white max-sm:bg-transparent max-sm:border-white/10"
                      )}
                      onClick={() => {
                        if (!url) return;
                        setActiveImgUrl(url);
                        setActiveImgCaption(img.caption ?? null);
                      }}
                      disabled={!url}
                      title={url ? "Trykk for å åpne" : "Mangler bilde-URL"}
                    >
                      <div className="aspect-square w-full overflow-hidden rounded-md bg-gray-50 max-sm:bg-black/30">
                        {url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={url}
                            alt={img.caption ?? product.name}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">
                            —
                          </div>
                        )}
                      </div>

                      <div className="mt-2 flex items-center justify-between gap-2">
                        {img.caption ? (
                          <div className="text-xs text-gray-600 max-sm:text-gray-300 line-clamp-2">
                            {img.caption}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-500 max-sm:text-gray-400">
                            Trykk for å åpne
                          </div>
                        )}

                        <div className="text-[11px] text-gray-400 max-sm:text-gray-400">
                          {url ? "Vis" : "Manglar"}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Dokumenter */}
          <div className="rounded-xl border p-4 bg-white max-sm:bg-gray-900 max-sm:border-white/10">
            <h2 className="font-semibold">Dokumenter</h2>

            {files.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600 max-sm:text-gray-300">
                Ingen dokumenter er knyttet til dette produktet ennå.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {files.map((f) => {
                  const href = fileUrlByPath[f.relative_path] ?? null;

                  return (
                    <a
                      key={f.id}
                      href={href ?? "#"}
                      onClick={(e) => {
                        if (!href) e.preventDefault();
                      }}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-lg border px-3 py-2 hover:bg-gray-50 max-sm:hover:bg-white/10 max-sm:border-white/10"
                      title={
                        href
                          ? "Åpne dokument"
                          : "Mangler signed URL (ikke funnet / ingen tilgang)"
                      }
                    >
                      <div className="text-xs text-gray-600 max-sm:text-gray-300">
                        {niceType(f.file_type)}
                      </div>
                      <div className="text-sm font-medium">
                        {f.title ?? f.relative_path}
                      </div>
                      <div className="text-xs text-gray-600 max-sm:text-gray-400">
                        {f.relative_path}
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          {/* Reservedeler/ekstrautstyr */}
          <div className="rounded-xl border p-4 space-y-4 bg-white max-sm:bg-gray-900 max-sm:border-white/10">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="font-semibold">Reservedeler / ekstrautstyr</h2>
                <p className="text-sm text-gray-600 max-sm:text-gray-300">
                  Søk i tilknyttede produkter og legg i handlevogn.
                </p>
              </div>

              <input
                value={linkSearch}
                onChange={(e) => setLinkSearch(e.target.value)}
                placeholder="Søk i listen…"
                className="w-full max-w-sm rounded-lg border px-3 py-2 bg-white max-sm:bg-black/20 max-sm:text-gray-100 max-sm:border-white/10"
              />
            </div>

            {linkedFiltered.length === 0 ? (
              <div className="rounded-lg border p-4 text-sm text-gray-600 max-sm:text-gray-300 max-sm:border-white/10">
                Ingen reservedeler/ekstrautstyr er knyttet til dette produktet ennå.
              </div>
            ) : (
              <div className="space-y-2">
                {linkedFiltered.map((x) => (
                  <div key={x.link_id} className="rounded-lg border p-3 max-sm:border-white/10">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs text-gray-600 max-sm:text-gray-300">
                          {linkTypeLabel(x.link_type)}
                        </div>
                        <div className="text-sm text-gray-600 max-sm:text-gray-300">
                          {x.product.product_no}
                        </div>
                        <div className="font-medium">{x.product.name}</div>
                        <div className="text-sm font-semibold">
                          {formatNok(x.product.list_price)}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <button
                          className="rounded-lg bg-black px-3 py-2 text-white hover:opacity-90"
                          onClick={() => onAddProductToCart(x.product)}
                        >
                          Legg i handlevogn
                        </button>

                        {isAdminOrPurchaser && (
                          <button
                            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 max-sm:hover:bg-white/10 max-sm:border-white/10"
                            onClick={() => unlink(x.link_id)}
                          >
                            Fjern kobling
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Admin/purchaser: koble nye */}
            {isAdminOrPurchaser && (
              <div className="rounded-lg border p-3 space-y-3 max-sm:border-white/10">
                <div className="font-semibold text-sm">Koble til ny</div>

                <div className="grid gap-2 md:grid-cols-3">
                  <select
                    className="rounded-lg border px-3 py-2 bg-white max-sm:bg-black/20 max-sm:text-gray-100 max-sm:border-white/10"
                    value={addType}
                    onChange={(e) => setAddType(e.target.value as any)}
                  >
                    <option value="SPARE_PART">Reservedel</option>
                    <option value="ACCESSORY">Ekstrautstyr</option>
                  </select>

                  <input
                    className="md:col-span-2 rounded-lg border px-3 py-2 bg-white max-sm:bg-black/20 max-sm:text-gray-100 max-sm:border-white/10"
                    value={addQ}
                    onChange={(e) => {
                      setAddQ(e.target.value);
                      searchProducts(e.target.value);
                    }}
                    placeholder="Søk etter produkt å koble til (min 2 tegn)…"
                  />
                </div>

                {addResults.length > 0 && (
                  <div className="space-y-2">
                    {addResults.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded-lg border p-2 max-sm:border-white/10"
                      >
                        <div>
                          <div className="text-sm text-gray-600 max-sm:text-gray-300">
                            {p.product_no}
                          </div>
                          <div className="font-medium">{p.name}</div>
                          <div className="text-sm font-semibold">
                            {formatNok(p.list_price)}
                          </div>
                        </div>
                        <button
                          className="rounded-lg bg-black px-3 py-2 text-white hover:opacity-90"
                          onClick={() => linkProduct(p)}
                        >
                          Koble til
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="text-xs text-gray-600 max-sm:text-gray-400">
                  (Denne koblingen er data i databasen – så alle brukere ser samme oppsett.)
                </div>

                {process.env.NODE_ENV !== "production" && (
                  <div className="text-[11px] text-gray-400">
                    auth: {accessToken ? "ok" : "missing"}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}