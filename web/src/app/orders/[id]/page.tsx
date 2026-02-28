// file: web/src/app/orders/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Role = "kunde" | "admin" | "innkjøper";

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

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

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

function formatDateOnly(value: string | null | undefined) {
  if (!value) return "";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return String(value);

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  return `${day}.${month}.${year}`;
}

function daysUntil(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);

  return Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

// Mobile: dark-first. Desktop: light.
function statusTone(status: string) {
  const s = String(status ?? "").toUpperCase();

  if (s === "DELIVERED")
    return cn(
      "border-emerald-700/40 bg-emerald-950/40 text-emerald-200",
      "md:border-emerald-200 md:bg-emerald-50 md:text-emerald-800"
    );

  if (s === "CANCELLED")
    return cn(
      "border-red-700/40 bg-red-950/40 text-red-200",
      "md:border-red-200 md:bg-red-50 md:text-red-800"
    );

  if (["SUBMITTED", "IN_REVIEW", "ORDERED"].includes(s))
    return cn(
      "border-amber-700/40 bg-amber-950/40 text-amber-200",
      "md:border-amber-200 md:bg-amber-50 md:text-amber-800"
    );

  if (["CONFIRMED", "SHIPPING"].includes(s))
    return cn(
      "border-sky-700/40 bg-sky-950/40 text-sky-200",
      "md:border-blue-200 md:bg-blue-50 md:text-blue-800"
    );

  return cn(
    "border-gray-700 bg-gray-900 text-gray-200",
    "md:border-gray-200 md:bg-gray-50 md:text-gray-800"
  );
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

  const [myEmail, setMyEmail] = useState<string>("");
  const [myDisplayName, setMyDisplayName] = useState<string>("");
  const [myRole, setMyRole] = useState<Role>("kunde");

  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const isAdmin = myRole === "admin";
  const orderId = params?.id;

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setErrorMsg(null);

      if (!orderId) {
        setOrder(null);
        setItems([]);
        setErrorMsg("Mangler ordre-id i URL.");
        setLoading(false);
        return;
      }

      // 1) Må være logget inn
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.replace("/login");
        return;
      }

      // 2) Token (refresh hvis nødvendig)
      let token: string | null = null;
      const { data: sessRes } = await supabase.auth.getSession();
      token = sessRes.session?.access_token ?? null;

      if (!token) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        token = refreshed.session?.access_token ?? null;
      }

      if (!token) {
        router.replace("/login");
        return;
      }

      // 3) Rolle + display_name fra server
      try {
        const meRes = await fetch("/api/auth/me", {
          method: "GET",
          headers: { authorization: `Bearer ${token}` },
        });

        const me = await meRes.json().catch(() => null);

        if (!meRes.ok || !me?.ok) {
          await supabase.auth.signOut();
          router.replace("/login");
          return;
        }

        if (!alive) return;

        const email = String(me.email ?? "").toLowerCase();
        const display = String(me.display_name ?? "").trim();

        setMyEmail(email);
        setMyDisplayName(display || email);
        setMyRole((String(me.role ?? "kunde") as Role) ?? "kunde");
      } catch {
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }

      // 4) Last ordre
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
        .eq("id", orderId)
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

      // 5) Last ordrelinjer
      const { data: it, error: itErr } = await supabase
        .from("order_items")
        .select("id, product_id, product_no, name, unit_price, qty")
        .eq("order_id", orderId)
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
  }, [orderId, router, supabase]);

  const total = useMemo(() => {
    return items.reduce((sum, x) => sum + safeNumber(x.unit_price) * safeNumber(x.qty), 0);
  }, [items]);

  async function openConfirmation() {
    if (!order?.confirmation_file_path || !orderId) return;

    setDownloading(true);
    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      let token = sessionRes.session?.access_token ?? null;

      if (!token) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        token = refreshed.session?.access_token ?? null;
      }

      if (!token) {
        alert("Du er ikke innlogget.");
        router.replace("/login");
        return;
      }

      const res = await fetch(`/api/orders/${orderId}/confirmation-url`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
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

  async function deleteOrder() {
    if (!isAdmin || !order) return;

    const ok = confirm("Slette denne ordren permanent? Dette kan ikke angres.");
    if (!ok) return;

    setDeleting(true);
    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      let token = sessionRes.session?.access_token ?? null;

      if (!token) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        token = refreshed.session?.access_token ?? null;
      }

      if (!token) {
        router.replace("/login");
        return;
      }

      const res = await fetch(`/api/admin/orders/${order.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        alert(data?.error ?? `Delete failed (${res.status})`);
        return;
      }

      setToast("Ordre slettet");
      setTimeout(() => setToast(null), 1200);

      router.push("/orders");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 md:bg-white md:text-gray-900 p-6">
        <h1 className="text-xl font-semibold">Ordre</h1>
        <p className="mt-2 text-sm text-gray-400 md:text-gray-600">Laster…</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 md:bg-white md:text-gray-900 p-6 space-y-4">
        <button
          className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 hover:bg-gray-800 md:border-gray-300 md:bg-white md:text-gray-900 md:hover:bg-gray-50"
          onClick={() => router.push("/orders")}
        >
          ← Tilbake til ordreoversikt
        </button>

        <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5 text-sm text-gray-200 md:border-gray-200 md:bg-white md:text-gray-700">
          {errorMsg ?? "Ukjent feil."}
        </div>
      </div>
    );
  }

  const diff = order.expected_delivery_date ? daysUntil(order.expected_delivery_date) : null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 md:bg-white md:text-gray-900">
      {/* Topbar */}
      <div className="sticky top-0 z-10 border-b border-gray-800 bg-gray-950/95 backdrop-blur md:border-gray-200 md:bg-white/80">
        <div className="mx-auto max-w-5xl px-4 md:px-6 py-3">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <button
              className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 hover:bg-gray-800 md:border-gray-300 md:bg-white md:text-gray-900 md:hover:bg-gray-50"
              onClick={() => router.push("/orders")}
            >
              ← Mine bestillinger
            </button>

            <div className="flex items-center gap-2">
              <button
                className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 hover:bg-gray-800 md:border-gray-300 md:bg-white md:text-gray-900 md:hover:bg-gray-50"
                onClick={() => router.push("/products")}
              >
                Produkter
              </button>
              <button
                className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 hover:bg-gray-800 md:border-gray-300 md:bg-white md:text-gray-900 md:hover:bg-gray-50"
                onClick={() => router.push("/cart")}
              >
                Handlevogn
              </button>
            </div>
          </header>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-5xl px-4 md:px-6 py-5 space-y-4">
        {/* Summary card */}
        <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4 md:p-5 md:border-gray-200 md:bg-white">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <div className="text-xs text-gray-300 md:text-gray-600">
                Opprettet: {formatDateTime(order.created_at)}
              </div>

              <div className="text-lg font-semibold text-gray-100 md:text-gray-900">
                {order.project_name}
              </div>

              {order.project_no ? (
                <div className="text-sm text-gray-300 md:text-gray-600">Prosjekt nr: {order.project_no}</div>
              ) : null}

              <div
                className={cn(
                  "mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs md:text-sm",
                  statusTone(order.status)
                )}
              >
                <span className="font-medium">{statusLabel(order.status)}</span>
              </div>

              {order.expected_delivery_date ? (
                <div className="mt-2 text-sm space-y-1">
                  <div className="text-gray-200 md:text-gray-700">
                    Forventet levering:{" "}
                    <span className="font-medium text-gray-100 md:text-gray-900">
                      {formatDateOnly(order.expected_delivery_date)}
                    </span>
                  </div>

                  {typeof diff === "number" ? (
                    <div
                      className={cn(
                        "text-xs font-medium",
                        diff < 0
                          ? "text-red-300 md:text-red-700"
                          : diff <= 3
                            ? "text-amber-300 md:text-amber-700"
                            : "text-gray-400 md:text-gray-600"
                      )}
                    >
                      {diff < 0
                        ? `${Math.abs(diff)} dager forsinket`
                        : diff === 0
                          ? "Levering i dag"
                          : `${diff} dager til levering`}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {order.delivery_info ? (
                <div className="mt-3 rounded-xl border border-gray-800 bg-gray-950/40 p-3 text-sm text-gray-200 whitespace-pre-line md:border-gray-200 md:bg-gray-50 md:text-gray-700">
                  {order.delivery_info}
                </div>
              ) : null}

              {(myDisplayName || myEmail) && (
                <div className="mt-3 text-xs text-gray-300 md:text-gray-500">
                  {myDisplayName || myEmail} · {myRole}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 md:items-end">
              {order.confirmation_file_path ? (
                <button
                  disabled={downloading}
                  className="rounded-xl bg-white/10 px-4 py-2 text-sm text-gray-100 hover:bg-white/15 disabled:opacity-50 md:bg-black md:text-white md:hover:opacity-90"
                  onClick={openConfirmation}
                >
                  {downloading ? "Henter lenke…" : "Last ned ordrebekreftelse"}
                </button>
              ) : (
                <div className="rounded-xl border border-gray-800 bg-gray-950/40 px-4 py-2 text-sm text-gray-300 md:border-gray-200 md:bg-white md:text-gray-600">
                  Ingen ordrebekreftelse ennå
                </div>
              )}

              <div className="rounded-xl border border-gray-800 bg-gray-950/40 px-4 py-2 text-sm md:border-gray-200 md:bg-white">
                Sum: <span className="font-semibold text-gray-100 md:text-gray-900">{formatNok(total)}</span>
              </div>

              {isAdmin ? (
                <button
                  disabled={deleting}
                  className="rounded-xl border border-red-700/50 bg-red-950/30 px-4 py-2 text-sm text-red-200 hover:bg-red-950/45 disabled:opacity-50 md:border-red-200 md:bg-white md:text-red-700 md:hover:bg-red-50"
                  onClick={deleteOrder}
                  title="Slett ordre"
                >
                  {deleting ? "Sletter…" : "Slett ordre"}
                </button>
              ) : null}

              {toast ? <div className="text-xs text-emerald-300 md:text-green-700">{toast}</div> : null}
            </div>
          </div>
        </div>

        {/* Contact + delivery */}
        <div className="grid gap-3 md:gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4 md:p-5 md:border-gray-200 md:bg-white space-y-3">
            <h2 className="font-semibold text-gray-100 md:text-gray-900">Kontakt</h2>
            <div className="text-sm space-y-1">
              <div className="text-gray-200 md:text-gray-800">
                <span className="text-gray-400 md:text-gray-600">Navn:</span>{" "}
                <span className="font-medium">{order.contact_name}</span>
              </div>
              {order.contact_phone ? (
                <div className="text-gray-200 md:text-gray-800">
                  <span className="text-gray-400 md:text-gray-600">Telefon:</span> {order.contact_phone}
                </div>
              ) : null}
              {order.contact_email ? (
                <div className="text-gray-200 md:text-gray-800">
                  <span className="text-gray-400 md:text-gray-600">E-post:</span> {order.contact_email}
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4 md:p-5 md:border-gray-200 md:bg-white space-y-3">
            <h2 className="font-semibold text-gray-100 md:text-gray-900">Levering</h2>
            <div className="text-sm space-y-1">
              <div className="whitespace-pre-line text-gray-200 md:text-gray-800">{order.delivery_address}</div>
              <div className="text-gray-200 md:text-gray-800">
                {[order.delivery_postcode, order.delivery_city].filter(Boolean).join(" ")}
              </div>
            </div>
          </section>
        </div>

        {/* Comment */}
        {order.comment ? (
          <section className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4 md:p-5 md:border-gray-200 md:bg-white space-y-2">
            <h2 className="font-semibold text-gray-100 md:text-gray-900">Kommentar</h2>
            <p className="text-sm text-gray-200 md:text-gray-800 whitespace-pre-line">{order.comment}</p>
          </section>
        ) : null}

        {/* Order lines */}
        <section className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4 md:p-5 md:border-gray-200 md:bg-white space-y-3">
          <div className="flex items-end justify-between gap-3">
            <h2 className="font-semibold text-gray-100 md:text-gray-900">Ordrelinjer</h2>
            <div className="text-sm text-gray-300 md:text-gray-600">{items.length} linje(r)</div>
          </div>

          {items.length === 0 ? (
            <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-4 text-sm text-gray-200 md:border-gray-200 md:bg-gray-50 md:text-gray-600">
              Ingen ordrelinjer funnet.
            </div>
          ) : (
            <>
              {/* Mobil: kort-liste */}
              <div className="space-y-2 md:hidden">
                {items.map((x) => {
                  const line = safeNumber(x.unit_price) * safeNumber(x.qty);
                  return (
                    <div key={x.id} className="rounded-xl border border-gray-800 bg-gray-950/40 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-mono text-gray-400">{x.product_no}</div>
                          <div className="text-sm font-medium text-gray-100 truncate" title={x.name}>
                            {x.name}
                          </div>
                          <div className="mt-1 text-xs text-gray-300">
                            Antall: <span className="font-medium text-gray-100">{x.qty}</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs text-gray-400">Pris</div>
                          <div className="text-sm font-semibold text-gray-100">{formatNok(safeNumber(x.unit_price))}</div>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="text-xs text-gray-400">Linjesum</div>
                        <div className="text-sm font-semibold text-gray-100">{formatNok(line)}</div>
                      </div>
                    </div>
                  );
                })}

                <div className="pt-2 flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-200">Total</div>
                  <div className="text-sm font-semibold text-gray-100">{formatNok(total)}</div>
                </div>
              </div>

              {/* Desktop: tabell */}
              <div className="hidden md:block overflow-x-auto">
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
                          <td className="border-b py-2 pr-3 text-right">{formatNok(safeNumber(x.unit_price))}</td>
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
            </>
          )}
        </section>
      </div>
    </div>
  );
}