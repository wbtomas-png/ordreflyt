// file: web/src/app/orders/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

type OrderRow = {
  id: string;
  created_at: string;
  status: string;

  project_name: string;
  project_no: string | null;

  contact_name: string;
  contact_phone: string | null;
  contact_email: string | null;

  delivery_address: string;
  delivery_postcode: string | null;
  delivery_city: string | null;

  comment: string | null;

  expected_delivery_date: string | null;
  delivery_info: string | null;

  confirmation_file_path: string | null;
};

type OrderItemRow = {
  id: string;
  product_id: string;
  product_no: string;
  name: string;
  unit_price: number;
  qty: number;
};

function statusLabel(s: string) {
  return (s ?? "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

function formatDateTime(value: string) {
  try {
    return new Date(value).toLocaleString("nb-NO");
  } catch {
    return value;
  }
}

function formatNok(value: number) {
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(value);
}

function safeNumber(n: unknown) {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? x : 0;
}

// Type guard: sørger for at vi faktisk har en OrderRow før vi setter state
function isOrderRow(x: unknown): x is OrderRow {
  if (!x || typeof x !== "object") return false;
  const o = x as any;
  return (
    typeof o.id === "string" &&
    typeof o.created_at === "string" &&
    typeof o.status === "string" &&
    typeof o.project_name === "string" &&
    typeof o.contact_name === "string" &&
    typeof o.delivery_address === "string"
  );
}

export default function OrderDetailsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [downloading, setDownloading] = useState(false);

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

      const id = params.id;

      const { data: o, error: oErr } = await supabase
        .from("orders")
        .select(
          [
            "id",
            "created_at",
            "status",
            "project_name",
            "project_no",
            "contact_name",
            "contact_phone",
            "contact_email",
            "delivery_address",
            "delivery_postcode",
            "delivery_city",
            "comment",
            "expected_delivery_date",
            "delivery_info",
            "confirmation_file_path",
          ].join(", ")
        )
        .eq("id", id)
        .maybeSingle();

      if (!alive) return;

      if (oErr || !isOrderRow(o)) {
        console.error(oErr);
        setOrder(null);
        setItems([]);
        setErrorMsg("Fant ikke ordren (eller du har ikke tilgang).");
        setLoading(false);
        return;
      }

      setOrder(o);

      const { data: it, error: itErr } = await supabase
        .from("order_items")
        .select("id, product_id, product_no, name, unit_price, qty")
        .eq("order_id", id)
        .order("product_no", { ascending: true });

      if (!alive) return;

      if (itErr) {
        console.error(itErr);
        setItems([]);
      } else {
        setItems((it ?? []) as OrderItemRow[]);
      }

      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [params.id, router, supabase]);

  const total = useMemo(() => {
    return items.reduce(
      (sum, x) => sum + safeNumber(x.unit_price) * safeNumber(x.qty),
      0
    );
  }, [items]);

  async function openConfirmation() {
    if (!order?.confirmation_file_path) return;

    setDownloading(true);
    try {
      // Hent access_token (API-route kjører på server og må få token i header)
      const { data: sessionRes, error: sessErr } = await supabase.auth.getSession();
      const token = sessionRes.session?.access_token;

      if (sessErr || !token) {
        alert("Du er ikke innlogget.");
        router.replace("/login");
        return;
      }

      const res = await fetch(`/api/orders/${params.id}/confirmation-url`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        alert("Kunne ikke hente nedlastingslenke.");
        return;
      }

      const { url } = (await res.json()) as { url: string };
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Ordre</h1>
        <p className="mt-2 text-sm text-gray-600">Laster…</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-6 space-y-4">
        <button
          className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
          onClick={() => router.push("/orders")}
        >
          ← Tilbake til ordreoversikt
        </button>

        <div className="rounded-2xl border p-5 text-sm text-gray-700">
          {errorMsg ?? "Ukjent feil."}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Top navigation */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <button
          className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
          onClick={() => router.push("/orders")}
        >
          ← Mine bestillinger
        </button>

        <div className="flex items-center gap-2">
          <button
            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={() => router.push("/products")}
          >
            Produkter
          </button>
          <button
            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={() => router.push("/cart")}
          >
            Handlevogn
          </button>
        </div>
      </header>

      {/* Summary card */}
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="text-sm text-gray-600">
              Opprettet: {formatDateTime(order.created_at)}
            </div>

            <div className="text-lg font-semibold">{order.project_name}</div>

            {order.project_no && (
              <div className="text-sm text-gray-600">
                Prosjekt nr: {order.project_no}
              </div>
            )}

            <div className="mt-1 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm">
              <span className="text-gray-600">Status:</span>
              <span className="font-medium">{statusLabel(order.status)}</span>
            </div>

            {order.expected_delivery_date && (
              <div className="mt-2 text-sm text-gray-700">
                Forventet levering:{" "}
                <span className="font-medium">{order.expected_delivery_date}</span>
              </div>
            )}

            {order.delivery_info && (
              <div className="mt-3 rounded-xl border bg-gray-50 p-3 text-sm text-gray-700 whitespace-pre-line">
                {order.delivery_info}
              </div>
            )}
          </div>

          <div className="flex flex-col items-start gap-2">
            {order.confirmation_file_path ? (
              <button
                disabled={downloading}
                className="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                onClick={openConfirmation}
              >
                {downloading ? "Henter lenke…" : "Last ned ordrebekreftelse"}
              </button>
            ) : (
              <div className="rounded-lg border px-4 py-2 text-sm text-gray-600">
                Ingen ordrebekreftelse ennå
              </div>
            )}

            <div className="rounded-lg border px-4 py-2 text-sm">
              Sum: <span className="font-semibold">{formatNok(total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Contact + delivery */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border bg-white p-5 shadow-sm space-y-3">
          <h2 className="font-semibold">Kontakt</h2>
          <div className="text-sm text-gray-800 space-y-1">
            <div>
              <span className="text-gray-600">Navn:</span>{" "}
              <span className="font-medium">{order.contact_name}</span>
            </div>
            {order.contact_phone && (
              <div>
                <span className="text-gray-600">Telefon:</span>{" "}
                {order.contact_phone}
              </div>
            )}
            {order.contact_email && (
              <div>
                <span className="text-gray-600">E-post:</span> {order.contact_email}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm space-y-3">
          <h2 className="font-semibold">Levering</h2>
          <div className="text-sm text-gray-800 space-y-1">
            <div className="whitespace-pre-line">{order.delivery_address}</div>
            <div>
              {[order.delivery_postcode, order.delivery_city].filter(Boolean).join(" ")}
            </div>
          </div>
        </section>
      </div>

      {/* Comment */}
      {order.comment && (
        <section className="rounded-2xl border bg-white p-5 shadow-sm space-y-2">
          <h2 className="font-semibold">Kommentar</h2>
          <p className="text-sm text-gray-800 whitespace-pre-line">{order.comment}</p>
        </section>
      )}

      {/* Order lines */}
      <section className="rounded-2xl border bg-white p-5 shadow-sm space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="font-semibold">Ordrelinjer</h2>
          <div className="text-sm text-gray-600">{items.length} linje(r)</div>
        </div>

        {items.length === 0 ? (
          <div className="rounded-xl border bg-gray-50 p-4 text-sm text-gray-600">
            Ingen ordrelinjer funnet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="border-b py-2 pr-3">Produkt</th>
                  <th className="border-b py-2 pr-3">Navn</th>
                  <th className="border-b py-2 pr-3 text-right">Antall</th>
                  <th className="border-b py-2 pr-3 text-right">Pris</th>
                  <th className="border-b py-2 text-right">Linjesum</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => {
                  const line = safeNumber(x.unit_price) * safeNumber(x.qty);
                  return (
                    <tr key={x.id} className="align-top">
                      <td className="border-b py-2 pr-3 font-medium">{x.product_no}</td>
                      <td className="border-b py-2 pr-3">{x.name}</td>
                      <td className="border-b py-2 pr-3 text-right">{x.qty}</td>
                      <td className="border-b py-2 pr-3 text-right">
                        {formatNok(safeNumber(x.unit_price))}
                      </td>
                      <td className="border-b py-2 text-right">{formatNok(line)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="pt-3 text-right font-semibold">
                    Total
                  </td>
                  <td className="pt-3 text-right font-semibold">{formatNok(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}