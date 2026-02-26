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

// Viktig for catch-all route: encode hver del, ikke hele stien
function localFileUrl(relativePath: string) {
  return `/api/local-file/${relativePath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function safeProductNoCandidate(input: string) {
  return input.trim();
}

export default function AdminProductsPage() {
  const router = useRouter();
  // Cast til any for å unngå "never" fra manglende/feil Supabase Database-typing
  const supabase = useMemo(() => supabaseBrowser() as any, []);
  // Gate: må være invitert + admin
  const { me, loading: meLoading } = useRequireMe({ requireRole: "admin" });

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [items, setItems] = useState<ProductRow[]>([]);
  const [q, setQ] = useState("");

  // New product UI
  const [creating, setCreating] = useState(false);
  const [newProductNo, setNewProductNo] = useState("");
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState<string>("");
  const [newActive, setNewActive] = useState(true);

  async function loadProducts(searchTerm?: string) {
    setErrorMsg(null);

    // Bygg query (hold alt på any for å unngå TS "never")
    let query: any = (supabase as any)
      .from("products")
      .select("id, product_no, name, list_price, thumb_path, is_active, created_at")
      .order("created_at", { ascending: false });

    const term = (searchTerm ?? q).trim();
    if (term) {
      query = query.or(`product_no.ilike.%${term}%,name.ilike.%${term}%`);
    }

    const { data, error } = await query;
    if (error) {
      console.error(error);
      setItems([]);
      setErrorMsg(error.message ?? "Kunne ikke hente produkter.");
      return;
    }

    setItems(((data ?? []) as unknown) as ProductRow[]);
  }

  // Last data når tilgang er avklart
  useEffect(() => {
    let alive = true;

    (async () => {
      if (meLoading) return;

      // Hooken skal normalt redirecte hvis ikke admin, men vi har safe fallback
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

  // Søk: reload når q endrer seg (kun hvis admin er bekreftet)
  useEffect(() => {
    if (meLoading) return;
    if (!me?.ok || me.role !== "admin") return;

    const t = setTimeout(() => {
      loadProducts(q);
    }, 150); // liten debounce
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, meLoading, me?.ok, me?.role]);

  async function createNewProduct() {
    setErrorMsg(null);

    const pn = safeProductNoCandidate(newProductNo);
    if (!pn) {
      setErrorMsg("Produktnr (product_no) må være satt.");
      return;
    }

    const price =
      newPrice.trim() === "" ? null : Number(newPrice.replace(",", "."));
    if (price !== null && !Number.isFinite(price)) {
      setErrorMsg("Ugyldig pris.");
      return;
    }

    setCreating(true);
    try {
      // NB: bruk newActive (ikke booleanValue)
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

  // Mens vi avklarer tilgang (invite-only + role), vis loader
  if (meLoading) {
    return (
      <div className="p-6">
        <div className="text-sm text-gray-600">Laster…</div>
      </div>
    );
  }

  // Hooken vil vanligvis redirecte om ikke admin, men behold safe fallback UI
  if (!me?.ok || me.role !== "admin") {
    return (
      <div className="p-6 space-y-3">
        <button
          className="rounded-lg border px-3 py-2 hover:bg-gray-50"
          onClick={() => router.push("/products")}
        >
          ← Til produkter
        </button>

        <div className="rounded-2xl border p-5 text-sm text-gray-700">
          Du har ikke admin-tilgang.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-sm text-gray-600">Laster…</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Admin produkter</h1>

          <button
            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={() => router.push("/products")}
          >
            Kundevisning
          </button>

          <button
            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={() => router.push("/admin/products/import")}
          >
            Bulk import
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            className="w-72 max-w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="Søk produktnr eller navn…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <button
            className="rounded-lg bg-black px-4 py-2 text-sm text-white"
            onClick={() => {
              document
                .getElementById("new-product-card")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            + Nytt produkt
          </button>
        </div>
      </header>

      {errorMsg ? (
        <div className="rounded-2xl border p-4 text-sm text-red-700">
          {errorMsg}
        </div>
      ) : null}

      <section id="new-product-card" className="rounded-2xl border p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">Nytt produkt</h2>
            <div className="text-sm text-gray-600">
              Krever <code>product_no</code> (NOT NULL).
            </div>
          </div>

          <button
            disabled={creating}
            className="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
            onClick={createNewProduct}
          >
            {creating ? "Oppretter…" : "Opprett"}
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            Produktnr (product_no) *
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={newProductNo}
              onChange={(e) => setNewProductNo(e.target.value)}
              placeholder="P-001"
            />
          </label>

          <label className="text-sm">
            Pris (NOK)
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              placeholder="1990"
              inputMode="numeric"
            />
            <div className="mt-1 text-xs text-gray-600">
              {newPrice
                ? `Visning: ${formatNok(Number(newPrice.replace(",", ".")))}`
                : ""}
            </div>
          </label>
        </div>

        <label className="text-sm block">
          Navn
          <input
            className="mt-1 w-full rounded-lg border px-3 py-2"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Produktnavn"
          />
        </label>

        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={newActive}
            onChange={(e) => setNewActive(e.target.checked)}
          />
          Aktiv
        </label>
      </section>

      <section className="rounded-2xl border p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Produkter</h2>
            <div className="text-sm text-gray-600">{items.length} stk</div>
          </div>

          <button
            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={() => loadProducts(q)}
          >
            Oppdater
          </button>
        </div>

        {items.length === 0 ? (
          <div className="rounded-xl border p-4 text-sm text-gray-600">
            Ingen produkter funnet.
          </div>
        ) : (
          <div className="grid gap-3">
            {items.map((p) => {
              const hasThumb = !!p.thumb_path;
              const thumbUrl = hasThumb ? localFileUrl(p.thumb_path!) : null;

              return (
                <div
                  key={p.id}
                  className="rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={cn(
                        "h-12 w-12 rounded-lg border bg-gray-50 flex items-center justify-center overflow-hidden",
                        !hasThumb && "text-xs text-gray-400"
                      )}
                    >
                      {thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumbUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        "—"
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-semibold">{p.product_no}</div>
                        <div className="text-gray-600 truncate">
                          {p.name ?? "(uten navn)"}
                        </div>
                        <span
                          className={cn(
                            "text-xs rounded-full px-2 py-1 border",
                            (p.is_active ?? true)
                              ? "bg-green-50 border-green-200 text-green-800"
                              : "bg-gray-50 border-gray-200 text-gray-700"
                          )}
                        >
                          {(p.is_active ?? true) ? "Aktiv" : "Inaktiv"}
                        </span>
                      </div>

                      <div className="text-sm text-gray-600">
                        {formatNok(p.list_price)}
                      </div>
                      <div className="text-xs text-gray-500 break-all">
                        ID: {p.id}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      className="rounded-lg bg-black px-3 py-2 text-sm text-white"
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
      </section>
    </div>
  );
}