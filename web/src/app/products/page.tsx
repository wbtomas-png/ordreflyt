// file: web/src/app/products/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useRequireMe } from "@/lib/useRequireMe";
import { addToCart } from "@/lib/cart";

type Role = "kunde" | "admin" | "innkjøper";

type ProductRow = {
  id: string;
  product_no: string;
  name: string;
  list_price: number;
  thumb_path: string | null;
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

function safeParseJson<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function CartIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M6 6h15l-2 9H7L6 6Z" />
      <path d="M6 6 5 3H2" />
      <path d="M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
      <path d="M18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
    </svg>
  );
}

function tryCountFromUnknownShape(parsed: any): { qtySum: number; lines: number } | null {
  if (!parsed) return null;

  // A) Array of items
  if (Array.isArray(parsed)) {
    const qtySum = parsed.reduce(
      (sum: number, it: any) => sum + (Number(it?.qty) || Number(it?.quantity) || 0),
      0
    );
    return { qtySum, lines: parsed.length };
  }

  // B) { items: [...] }
  if (Array.isArray(parsed.items)) {
    const qtySum = parsed.items.reduce(
      (sum: number, it: any) => sum + (Number(it?.qty) || Number(it?.quantity) || 0),
      0
    );
    return { qtySum, lines: parsed.items.length };
  }

  // C) { lines: [...] }
  if (Array.isArray(parsed.lines)) {
    const qtySum = parsed.lines.reduce(
      (sum: number, it: any) => sum + (Number(it?.qty) || Number(it?.quantity) || 0),
      0
    );
    return { qtySum, lines: parsed.lines.length };
  }

  // D) nested { cart: ... }
  if (parsed.cart) {
    return tryCountFromUnknownShape(parsed.cart);
  }

  // E) nested { data: ... }
  if (parsed.data) {
    return tryCountFromUnknownShape(parsed.data);
  }

  return null;
}

function detectCartCountFromStorage(): { count: number; key: string | null } {
  if (typeof window === "undefined") return { count: 0, key: null };

  let best: { count: number; key: string } | null = null;

  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key) continue;

    // “cart-ish” keys: inneholder cart/handlekurv/kurv (case-insensitive)
    const k = key.toLowerCase();
    if (!(k.includes("cart") || k.includes("kurv") || k.includes("handle"))) continue;

    const raw = window.localStorage.getItem(key);
    const parsed = safeParseJson<any>(raw);
    if (!parsed) continue;

    const info = tryCountFromUnknownShape(parsed);
    if (!info) continue;

    const count = Number(info.qtySum) || 0;

    // Plukk beste kandidat (høyest count, tie-breaker: flest linjer)
    if (!best) {
      best = { count, key };
    } else {
      if (count > best.count) best = { count, key };
      else if (count === best.count) {
        const bestInfo = tryCountFromUnknownShape(
          safeParseJson<any>(window.localStorage.getItem(best.key))
        );
        const bestLines = bestInfo?.lines ?? 0;
        const thisLines = info.lines ?? 0;
        if (thisLines > bestLines) best = { count, key };
      }
    }
  }

  return best ? { count: best.count, key: best.key } : { count: 0, key: null };
}

function normalizeStoragePath(p: string) {
  let s = p.trim();
  if (s.startsWith("/")) s = s.slice(1);
  if (s.startsWith("product-images/")) s = s.slice("product-images/".length);
  return s;
}

export default function ProductsPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  // ✅ invite-only gate
  const { me, loading: meLoading } = useRequireMe();

  const [q, setQ] = useState("");
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [thumbUrlByPath, setThumbUrlByPath] = useState<Record<string, string>>({});

  // ✅ Cart counter + key vi detekterte
  const [cartCount, setCartCount] = useState<number>(0);
  const [cartKey, setCartKey] = useState<string | null>(null);

  const myEmail = me?.email ? String(me.email).toLowerCase() : "";
  const myRole: Role = (me?.role as Role) ?? "kunde";

  const canSeeAdmin = myRole === "admin";
  const canSeePurchasing = myRole === "admin" || myRole === "innkjøper";

  function refreshCartCount() {
    const found = detectCartCountFromStorage();
    setCartCount(found.count);
    setCartKey(found.key);

    // nyttig debug akkurat nå
    if (found.key) {
      // eslint-disable-next-line no-console
      console.log("[cart] detected key:", found.key, "count:", found.count);
    } else {
      // eslint-disable-next-line no-console
      console.log("[cart] no cart key detected in localStorage");
    }
  }

  useEffect(() => {
    refreshCartCount();

    function onStorage(e: StorageEvent) {
      // Hvis vi vet key, oppdater kun når den endres. Ellers oppdater alltid.
      if (!e.key) return;
      if (!cartKey || e.key === cartKey) refreshCartCount();
    }

    function onCartUpdated() {
      refreshCartCount();
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener("cart:updated", onCartUpdated as any);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("cart:updated", onCartUpdated as any);
    };
    // cartKey med i deps så vi kan “narrow” storage filtering
  }, [cartKey]);

  useEffect(() => {
    let alive = true;

    (async () => {
      if (meLoading) return;

      if (!me?.ok) {
        setLoading(false);
        return;
      }

      setLoading(true);

      const { data: rows, error } = await supabase
        .from("products")
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

      const paths = Array.from(new Set(list.map((p) => p.thumb_path).filter(Boolean) as string[]));
      const toFetch = paths.slice(0, 30);

      if (toFetch.length > 0) {
        const entries: Array<[string, string]> = [];

        for (const rawPath of toFetch) {
          try {
            const path = normalizeStoragePath(rawPath);

            const { data, error } = await supabase.storage
              .from("product-images")
              .createSignedUrl(path, 600);

            if (error) throw error;
            if (data?.signedUrl) entries.push([rawPath, data.signedUrl]);
          } catch (e) {
            console.warn("thumb signed-url failed for path:", rawPath, e);
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
  }, [meLoading, me?.ok, router, supabase]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return products;
    return products.filter((p) => p.product_no.toLowerCase().includes(s) || p.name.toLowerCase().includes(s));
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

    // ✅ Oppdater badge umiddelbart
    refreshCartCount();

    // (valgfritt) event for andre komponenter
    try {
      window.dispatchEvent(new Event("cart:updated"));
    } catch {
      // ignore
    }
  }

  if (meLoading || loading) {
    return (
      <div className="p-6">
        <div className="text-xl font-semibold">Produktsøk</div>
        <p className="mt-2 text-sm text-gray-600">Laster…</p>
      </div>
    );
  }

  if (!me?.ok) {
    return (
      <div className="p-6 space-y-3">
        <div className="rounded-2xl border p-5 text-sm text-gray-700">Du har ikke tilgang. Logg inn på nytt.</div>
        <button className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50" onClick={() => router.push("/login")}>
          Til innlogging
        </button>
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
              <button className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50" onClick={() => router.push("/orders")}>
                Mine ordrer
              </button>

              {/* ✅ Handlevogn ikon + counter */}
              <button
                className="relative rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                onClick={() => router.push("/cart")}
                title="Handlevogn"
                aria-label={`Handlevogn. ${cartCount} varer.`}
              >
                <span className="flex items-center gap-2">
                  <CartIcon className="h-5 w-5" />
                  <span className="hidden sm:inline">Handlevogn</span>
                </span>

                <span
                  className={cn(
                    "absolute -right-2 -top-2",
                    "min-w-[18px] h-[18px] px-1",
                    "rounded-full",
                    cartCount > 0 ? "bg-black text-white" : "bg-gray-200 text-gray-700",
                    "text-[11px] leading-[18px] text-center",
                    "shadow-sm"
                  )}
                >
                  {cartCount > 99 ? "99+" : cartCount}
                </span>
              </button>

              {canSeePurchasing ? (
                <button
                  className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                  onClick={() => router.push("/purchasing")}
                  title="Innkjøper"
                >
                  Innkjøper
                </button>
              ) : null}

              {canSeeAdmin ? (
                <button
                  className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                  onClick={() => router.push("/admin/products")}
                  title="Admin"
                >
                  Admin
                </button>
              ) : null}

              {canSeeAdmin ? (
                <button
                  className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                  onClick={() => router.push("/access")}
                  title="Tilgangsstyring"
                >
                  Tilgang
                </button>
              ) : null}
            </div>

            <div className="text-sm font-medium text-gray-700">
              Produkter ({filtered.length})
              {myEmail ? <span className="ml-2 text-xs text-gray-400">{myEmail} · {myRole}</span> : null}
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
            <p className="mt-1 text-sm text-gray-600">Søk på produkt-ID eller navn.</p>
          </div>

          <div className="w-full sm:max-w-md">
            <label className="block text-xs font-medium text-gray-600">Søk</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Søk…"
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-gray-400"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border p-5 text-sm text-gray-600">Ingen treff.</div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((p) => {
              const imgUrl = p.thumb_path && thumbUrlByPath[p.thumb_path] ? thumbUrlByPath[p.thumb_path] : null;

              return (
                <li key={p.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/products/${p.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(`/products/${p.id}`);
                      }
                    }}
                    className={cn(
                      "group w-full text-left cursor-pointer",
                      "rounded-2xl border bg-white",
                      "px-4 py-3",
                      "transition",
                      "hover:shadow-sm hover:border-gray-300 hover:bg-gray-50/60",
                      "focus:outline-none focus:ring-2 focus:ring-gray-300"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="shrink-0">
                        <div
                          className={cn(
                            "overflow-hidden rounded-md border bg-gray-50",
                            "transition-all duration-200",
                            "h-10 w-10",
                            "group-hover:h-14 group-hover:w-14 group-hover:rounded-lg group-hover:shadow-sm"
                          )}
                        >
                          {imgUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={imgUrl}
                              alt={p.name}
                              loading="lazy"
                              className={cn("block h-full w-full object-cover", "transition-all duration-200")}
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-400">—</div>
                          )}
                        </div>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs text-gray-500 font-mono">{p.product_no}</div>
                            <div
                              className={cn(
                                "truncate font-medium text-gray-900",
                                "transition-transform duration-200",
                                "group-hover:translate-x-[1px]"
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
                              title="Legg i handlekurv"
                            >
                              Legg i handlekurv
                            </button>
                          </div>
                        </div>

                        <div className="mt-1 text-xs text-gray-500">Klikk for detaljer</div>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Debug (kan fjernes senere) */}
        <div className="text-[11px] text-gray-400">
          Cart key: {cartKey ?? "—"} · Count: {cartCount}
        </div>
      </div>
    </div>
  );
}