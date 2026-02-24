"use client";

import { useMemo, useState } from "react";

type ProductRow = {
  id: string;
  product_no: string;
  name: string;
  list_price: number;
  thumb_pat: string | null;
};

function formatNok(value: number) {
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function ProductsClient({ products }: { products: ProductRow[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return products;

    return products.filter((p) => {
      return (
        p.product_no.toLowerCase().includes(s) ||
        p.name.toLowerCase().includes(s)
      );
    });
  }, [q, products]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Produktsøk</h1>
          <p className="text-sm text-gray-600">
            Søk på produkt-ID eller navn.
          </p>
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Søk…"
          className="w-full max-w-md rounded-lg border px-3 py-2"
        />
      </div>

      <div className="grid gap-2">
        {filtered.map((p) => (
          <ProductRowCard key={p.id} p={p} />
        ))}
        {filtered.length === 0 && (
          <div className="rounded-lg border p-4 text-sm text-gray-600">
            Ingen treff.
          </div>
        )}
      </div>
    </div>
  );
}

function ProductRowCard({ p }: { p: ProductRow }) {
  return (
    <a
      href={`/products/${p.id}`}
      className="group relative block rounded-lg border p-3 hover:bg-gray-50"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-gray-600">{p.product_no}</div>
          <div className="font-medium">{p.name}</div>
        </div>
        <div className="text-sm font-semibold">{formatNok(p.list_price)}</div>
      </div>

      {p.thumb_pat && (
        <div className="pointer-events-none absolute right-3 top-3 hidden w-44 rounded-lg border bg-white p-2 shadow group-hover:block">
          <img
            src={`/api/local-file/${encodeURIComponent(p.thumb_pat)}`}
            alt={p.name}
            className="h-auto w-full rounded"
          />
        </div>
      )}
    </a>
  );
}