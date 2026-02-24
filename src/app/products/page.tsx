// file: web/src/app/products/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { addToCart } from "@/lib/cart";

type ProductRow = {
  id: string;
  product_no: string;
  name: string;
  list_price: number;
  thumb_path: string | null; // storage path i Supabase Storage
};

function formatNok(value: number) {
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(value);
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
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
    headers: {
      authorization: `Bearer ${opts.token}`,
    },
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error ?? `Signed URL failed (status ${res.status})`);
  }
  return data.url as string;
}

export default function ProductsPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [q, setQ] = useState("");
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  
  // cache: storage_path -> signedUrl
  const [thumbUrlByPath, setThumbUrlByPath] = useState<Record<string, string>>(
    {}
  );

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
      const token = sess.session?.access_token;
      if (!token) {
        router.replace("/login");
        return;
      }

      const { data: rows, error } = await supabase
        .from("products")
        // ⚠️ Viktig: ingen trailing space etter thumb_path
        .select("id, product_no, name, list_price, thumb_path")
        .order("name", { ascending: true });

      if (!alive) return;

      if (error) {
        console.error("products load error:", error);
        setProducts([]);
        setLoading(false);
        return;
      }

      const list = (rows ?? []) as ProductRow[];
      setProducts(list);

      // Hent signed URLs for thumbs (maks 30 første for å være snill)
      const paths = Array.from(
        new Set(list.map((p) => p.thumb_path).filter(Boolean) as string[])
      );

      const toFetch = paths.slice(0, 30);
      if (toFetch.length > 0) {
        const entries: Array<[string, string]> = [];

        // sekvensielt for å unngå rate/overhead (kan parallelliseres senere)
        for (const storagePath of toFetch) {
          try {
            const url = await fetchSignedUrl({
              token,
              bucket: "product-images",
              path: storagePath,
              expires: 600,
            });
            entries.push([storagePath, url]);
          } catch (e) {
            console.warn("thumb signed-url failed for path:", storagePath, e);
          }
        }

        if (alive && entries.length > 0) {
          setThumbUrlByPath((prev) => {
            const next = { ...prev };
            for (const [p, u] of entries) next[p] = u;
            return next;
          });
        }
      }

      setLoading(false);
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, supabase]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return products;
    return products.filter(
      (p) =>
        p.product_no.toLowerCase().includes(s) ||
        p.name.toLowerCase().includes(s)
    );
  }, [q, products]);

  function addLineToCart(p: ProductRow) {
  addToCart(
    {
      product_id: p.id,
      product_no: p.product_no,
      name: p.name,
      list_price: p.list_price ?? 0,
    } as any,
    1
  );

  setToast(`${p.product_no} lagt i handlevogn`);
  setTimeout(() => setToast(null), 1800);
}

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-xl font-semibold">Produktsøk</div>
        <p className="mt-2 text-sm text-gray-600">Laster…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Topbar */}
      <div className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-6 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                onClick={() => router.push("/orders")}
              >
                Mine ordrer
              </button>
              <button
                className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                onClick={() => router.push("/cart")}
              >
                Handlevogn
              </button>
              <button
                className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                onClick={() => router.push("/admin/products")}
                title="Admin"
              >
                Admin
              </button>
            </div>

            <div className="text-sm font-medium text-gray-700">
              Produkter ({filtered.length})
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-5xl p-6 space-y-4">
        {/* Header + search */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Produktsøk</h1>
            <p className="mt-1 text-sm text-gray-600">
              Søk på produkt-ID eller navn.
            </p>
          </div>

          <div className="w-full sm:max-w-md">
            <label className="block text-xs font-medium text-gray-600">
              Søk
            </label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Søk…"
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-gray-400"
            />
          </div>
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div className="rounded-2xl border p-5 text-sm text-gray-600">
            Ingen treff.
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((p) => {
              const imgUrl =
                p.thumb_path && thumbUrlByPath[p.thumb_path]
                  ? thumbUrlByPath[p.thumb_path]
                  : null;

              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`/products/${p.id}`)}
                    className={cn(
                      "group w-full text-left",
                      "rounded-2xl border bg-white",
                      "px-4 py-3",
                      "transition",
                      "hover:shadow-sm hover:border-gray-300",
                      "focus:outline-none focus:ring-2 focus:ring-gray-300"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="shrink-0">
                        <div className="h-10 w-10 overflow-hidden rounded-md border bg-gray-50">
                          {imgUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={imgUrl}
                              alt={p.name}
                              loading="lazy"
                              className="block h-10 w-10 object-cover"
                              style={{ width: 40, height: 40 }}
                            />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center text-[10px] text-gray-400">
                              —
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs text-gray-500 font-mono">
                              {p.product_no}
                            </div>
                            <div
                              className={cn(
                                "truncate font-medium text-gray-900",
                                "transition-transform duration-200",
                                "group-hover:scale-[1.01]"
                              )}
                              title={p.name}
                            >
                              {p.name}
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div
                              className={cn(
                                "shrink-0 text-sm font-semibold text-gray-900",
                                "transition-transform duration-200",
                                "group-hover:scale-[1.01]"
                              )}
                            >
                              {formatNok(p.list_price)}
                            </div>

                            <button
                              type="button"
                              className={cn(
                                "shrink-0",
                                "rounded-lg border border-black bg-black px-3 py-2",
                                "text-xs font-semibold text-white",
                                "hover:opacity-90",
                                "focus:outline-none focus:ring-2 focus:ring-gray-300"
                              )}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                addLineToCart(p);
                              }}
                              title="Legg i handlevogn"
                            >
                              Legg i handlevogn
                            </button>
                          </div>
                        </div>

                        <div className="mt-1 text-xs text-gray-500">
                          Klikk for detaljer
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}