// file: web/src/app/admin/products/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useRequireMe } from "@/lib/useRequireMe";

type ProductRow = {
  id: string;
  product_no: string;
  name: string | null;
  list_price: number | null;
  thumb_path: string | null;
  is_active: boolean | null;
  created_at?: string | null;
};

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

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function safeProductNoCandidate(input: string) {
  return input.trim();
}

function safeParseJson<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function normalizeStoragePath(p: string) {
  let s = p.trim();
  if (s.startsWith("/")) s = s.slice(1);
  if (s.startsWith("product-images/")) s = s.slice("product-images/".length);
  return s;
}

export default function AdminProductsPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser() as any, []);
  const { me, loading: meLoading } = useRequireMe({ requireRole: "admin" });

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [items, setItems] = useState<ProductRow[]>([]);
  const [q, setQ] = useState("");

  // Signed thumbs
  const [thumbUrlByPath, setThumbUrlByPath] = useState<Record<string, string>>({});

  // New product UI
  const [creating, setCreating] = useState(false);
  const [newProductNo, setNewProductNo] = useState("");
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState<string>("");
  const [newActive, setNewActive] = useState(true);

  // Small toast
  const [toast, setToast] = useState<string | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1200);
  }

  async function loadProducts(searchTerm?: string) {
    setErrorMsg(null);

    let query: any = (supabase as any)
      .from("products")
      .select("id, product_no, name, list_price, thumb_path, is_active, created_at")
      .order("created_at", { ascending: false });

    const term = (searchTerm ?? q).trim();
    if (term) query = query.or(`product_no.ilike.%${term}%,name.ilike.%${term}%`);

    const { data, error } = await query;
    if (error) {
      console.error(error);
      setItems([]);
      setErrorMsg(error.message ?? "Kunne ikke hente produkter.");
      return;
    }

    const list = ((data ?? []) as unknown) as ProductRow[];
    setItems(list);

    // Fetch thumbnails (signed urls) for top N unique thumb_path
    const paths = Array.from(new Set(list.map((p) => p.thumb_path).filter(Boolean) as string[]));
    const toFetch = paths.slice(0, 60);

    if (toFetch.length > 0) {
      const entries: Array<[string, string]> = [];
      for (const rawPath of toFetch) {
        try {
          const path = normalizeStoragePath(rawPath);
          const { data: signed, error: sErr } = await supabase.storage
            .from("product-images")
            .createSignedUrl(path, 600);
          if (sErr) throw sErr;
          if (signed?.signedUrl) entries.push([rawPath, signed.signedUrl]);
        } catch (e) {
          // fallback: ignore
          console.warn("thumb signed-url failed for path:", rawPath, e);
        }
      }

      if (entries.length > 0) {
        setThumbUrlByPath((prev) => {
          const next = { ...prev };
          for (const [p, u] of entries) next[p] = u;
          return next;
        });
      }
    }
  }

  useEffect(() => {
    let alive = true;

    (async () => {
      if (meLoading) return;

      if (!me?.ok || me.role !== "admin") {
        if (alive) setLoading(false);
        return;
      }

      if (!alive) return;
      setLoading(true);
      setErrorMsg(null);

      await loadProducts("");

      if (!alive) return;
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meLoading, me?.ok, me?.role]);

  useEffect(() => {
    if (meLoading) return;
    if (!me?.ok || me.role !== "admin") return;

    const t = window.setTimeout(() => {
      void loadProducts(q);
    }, 200);

    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, meLoading, me?.ok, me?.role]);

  async function createNewProduct() {
    setErrorMsg(null);

    const pn = safeProductNoCandidate(newProductNo);
    if (!pn) {
      setErrorMsg("Produktnr (product_no) må være satt.");
      return;
    }

    const price = newPrice.trim() === "" ? null : Number(newPrice.replace(",", "."));
    if (price !== null && !Number.isFinite(price)) {
      setErrorMsg("Ugyldig pris.");
      return;
    }

    setCreating(true);
    try {
      const { data, error } = await (supabase as any)
        .from("products")
        .insert({
          product_no: pn,
          name: newName.trim() === "" ? null : newName.trim(),
          list_price: price,
          is_active: newActive,
        } as any)
        .select("id")
        .single();

      if (error) {
        console.error("create product error:", error);
        setErrorMsg(error.message ?? "Kunne ikke opprette produkt.");
        return;
      }

      if (!data?.id) {
        setErrorMsg(
          "Produkt ble kanskje opprettet, men vi fikk ikke id tilbake. Sjekk at insert-kallet bruker .select('id').single()."
        );
        return;
      }

      setNewProductNo("");
      setNewName("");
      setNewPrice("");
      setNewActive(true);

      router.push(`/admin/products/${data.id}`);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message ?? "Kunne ikke opprette produkt.");
    } finally {
      setCreating(false);
    }
  }

  if (meLoading) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 md:bg-white md:text-gray-900">
        <div className="p-6 text-sm text-gray-400 md:text-gray-600">Laster…</div>
      </div>
    );
  }

  if (!me?.ok || me.role !== "admin") {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 md:bg-white md:text-gray-900">
        <div className="p-6 space-y-3">
          <button
            className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 hover:bg-gray-800 md:border-gray-300 md:bg-white md:text-gray-900 md:hover:bg-gray-50"
            onClick={() => router.push("/products")}
          >
            ← Til produkter
          </button>

          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-200 md:border-gray-200 md:bg-white md:text-gray-700">
            Du har ikke admin-tilgang.
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 md:bg-white md:text-gray-900">
        <div className="p-6 text-sm text-gray-400 md:text-gray-600">Laster…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 md:bg-white md:text-gray-900">
      {/* Topbar */}
      <div className="sticky top-0 z-10 border-b border-gray-800 bg-gray-950/95 backdrop-blur md:border-gray-200 md:bg-white/80">
        <div className="mx-auto max-w-5xl px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold md:text-xl">Admin produkter</h1>

              <button
                className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 hover:bg-gray-800 md:border-gray-300 md:bg-white md:text-gray-900 md:hover:bg-gray-50"
                onClick={() => router.push("/products")}
              >
                Kundevisning
              </button>

              <button
                className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 hover:bg-gray-800 md:border-gray-300 md:bg-white md:text-gray-900 md:hover:bg-gray-50"
                onClick={() => router.push("/admin/products/import")}
              >
                Bulk import
              </button>
            </div>

            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <input
                className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-gray-500 md:w-72 md:border-gray-300 md:bg-white md:text-gray-900 md:focus:border-gray-400"
                placeholder="Søk produktnr eller navn…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />

              <button
                className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:opacity-90 md:bg-black md:text-white"
                onClick={() => {
                  document
                    .getElementById("new-product-card")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                + Nytt produkt
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-5xl p-4 sm:p-6 space-y-6">
        {errorMsg ? (
          <div className="rounded-2xl border border-red-900/40 bg-red-950/40 p-4 text-sm text-red-200 md:border-red-200 md:bg-red-50 md:text-red-700">
            {errorMsg}
          </div>
        ) : null}

        {toast ? (
          <div className="rounded-2xl border border-emerald-900/40 bg-emerald-950/40 p-4 text-sm text-emerald-200 md:border-emerald-200 md:bg-emerald-50 md:text-emerald-700">
            {toast}
          </div>
        ) : null}

        {/* New product */}
        <section
          id="new-product-card"
          className="rounded-2xl border border-gray-800 bg-gray-900 p-5 space-y-4 md:border-gray-200 md:bg-white"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">Nytt produkt</h2>
              <div className="text-sm text-gray-400 md:text-gray-600">
                Krever <code className="font-mono">product_no</code> (NOT NULL).
              </div>
            </div>

            <button
              disabled={creating}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 disabled:opacity-50 hover:opacity-90 md:bg-black md:text-white"
              onClick={createNewProduct}
            >
              {creating ? "Oppretter…" : "Opprett"}
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              Produktnr (product_no) *
              <input
                className="mt-1 w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-gray-500 md:border-gray-300 md:bg-white md:text-gray-900 md:focus:border-gray-400"
                value={newProductNo}
                onChange={(e) => setNewProductNo(e.target.value)}
                placeholder="P-001"
              />
            </label>

            <label className="text-sm">
              Pris (NOK)
              <input
                className="mt-1 w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-gray-500 md:border-gray-300 md:bg-white md:text-gray-900 md:focus:border-gray-400"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                placeholder="1990"
                inputMode="numeric"
              />
              <div className="mt-1 text-xs text-gray-400 md:text-gray-600">
                {newPrice ? `Visning: ${formatNok(Number(newPrice.replace(",", ".")))}` : ""}
              </div>
            </label>
          </div>

          <label className="text-sm block">
            Navn
            <input
              className="mt-1 w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-gray-500 md:border-gray-300 md:bg-white md:text-gray-900 md:focus:border-gray-400"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Produktnavn"
            />
          </label>

          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={newActive} onChange={(e) => setNewActive(e.target.checked)} />
            Aktiv
          </label>
        </section>

        {/* List */}
        <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5 space-y-4 md:border-gray-200 md:bg-white">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Produkter</h2>
              <div className="text-sm text-gray-400 md:text-gray-600">{items.length} stk</div>
            </div>

            <button
              className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 hover:bg-gray-900 md:border-gray-300 md:bg-white md:text-gray-900 md:hover:bg-gray-50"
              onClick={() => {
                void loadProducts(q);
                showToast("Oppdatert");
              }}
            >
              Oppdater
            </button>
          </div>

          {items.length === 0 ? (
            <div className="rounded-xl border border-gray-800 bg-gray-950 p-4 text-sm text-gray-400 md:border-gray-200 md:bg-gray-50 md:text-gray-600">
              Ingen produkter funnet.
            </div>
          ) : (
            <div className="grid gap-3">
              {items.map((p) => {
                const hasThumb = !!p.thumb_path;
                const imgUrl = hasThumb ? thumbUrlByPath[p.thumb_path!] ?? null : null;

                return (
                  <div
                    key={p.id}
                    className={cn(
                      "rounded-xl border p-4",
                      "border-gray-800 bg-gray-950",
                      "md:border-gray-200 md:bg-white",
                      "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={cn(
                          "h-12 w-12 rounded-lg border overflow-hidden shrink-0",
                          "border-gray-800 bg-gray-900",
                          "md:border-gray-200 md:bg-gray-50",
                          !hasThumb && "flex items-center justify-center text-xs text-gray-500"
                        )}
                        title={p.thumb_path ?? ""}
                      >
                        {imgUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={imgUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          "—"
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-semibold">{p.product_no}</div>
                          <div className="text-gray-300 md:text-gray-600 truncate">
                            {p.name ?? "(uten navn)"}
                          </div>

                          <span
                            className={cn(
                              "text-xs rounded-full px-2 py-1 border",
                              (p.is_active ?? true)
                                ? "border-emerald-900/40 bg-emerald-950/40 text-emerald-200 md:border-green-200 md:bg-green-50 md:text-green-800"
                                : "border-gray-700 bg-gray-900 text-gray-200 md:border-gray-200 md:bg-gray-50 md:text-gray-700"
                            )}
                          >
                            {(p.is_active ?? true) ? "Aktiv" : "Inaktiv"}
                          </span>
                        </div>

                        <div className="text-sm text-gray-300 md:text-gray-600">{formatNok(p.list_price)}</div>
                        <div className="text-xs text-gray-500 break-all">ID: {p.id}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        className="w-full sm:w-auto rounded-xl bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:opacity-90 md:bg-black md:text-white"
                        onClick={() => router.push(`/admin/products/${p.id}`)}
                      >
                        Åpne / rediger
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="text-xs text-gray-500">
            Thumbs: bruker Supabase Storage bucket <span className="font-mono">product-images</span> (signed urls).
          </div>
        </section>
      </div>
    </div>
  );
}