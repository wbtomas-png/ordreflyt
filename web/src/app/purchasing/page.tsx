// file: src/app/purchasing/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Role = "kunde" | "admin" | "innkjøper";

const STATUSES = [
  "SUBMITTED",
  "IN_REVIEW",
  "ORDERED",
  "CONFIRMED",
  "SHIPPING",
  "DELIVERED",
  "CANCELLED",
] as const;

const STATUS_LABEL: Record<(typeof STATUSES)[number], string> = {
  SUBMITTED: "Submitted",
  IN_REVIEW: "In review",
  ORDERED: "Ordered",
  CONFIRMED: "Confirmed",
  SHIPPING: "Shipping",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

type OrderRow = {
  id: string;
  created_at: string;
  status: string;

  project_name: string;
  project_no: string | null;

  contact_name: string;
  contact_phone: string | null;
  contact_email: string | null;

  // noen systemer har "customer_name" / "ordered_by_name" etc.
  // vi viser det vi har: contact_name
  delivery_address: string;
  delivery_postcode: string | null;
  delivery_city: string | null;

  comment: string | null;

  expected_delivery_date: string | null;
  delivery_info: string | null;

  confirmation_file_path: string | null;
  purchaser_note: string | null;

  updated_at?: string | null;
  updated_by_name?: string | null;
};

type OrderItemRow = {
  order_id: string;
  qty: number;
  unit_price: number;
};

type OrderView = OrderRow & {
  total_nok: number;
};

type SortKey = "NEWEST" | "OLDEST" | "TOTAL_DESC" | "TOTAL_ASC";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function norm(s: unknown) {
  return String(s ?? "").trim().toLowerCase();
}

function safeDateOnly(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
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

function isOrderRow(x: unknown): x is OrderRow {
  if (!x || typeof x !== "object") return false;
  const o = x as any;
  return (
    typeof o.id === "string" &&
    typeof o.created_at === "string" &&
    typeof o.status === "string" &&
    typeof o.project_name === "string" &&
    typeof o.contact_name === "string"
  );
}

function coerceOrderRows(input: unknown): OrderRow[] {
  if (!Array.isArray(input)) return [];
  return input.filter(isOrderRow);
}

function looksLikeMissingColumn(err: any, col: string) {
  const msg = String(err?.message ?? "").toLowerCase();
  return msg.includes("does not exist") && msg.includes(col.toLowerCase());
}

function withinDateRange(createdAtIso: string, fromIso: string, toIso: string) {
  const d = safeDateOnly(createdAtIso);
  if (!d) return true;

  const from = safeDateOnly(fromIso);
  const to = safeDateOnly(toIso);

  if (from && d.getTime() < from.getTime()) return false;
  if (to && d.getTime() > to.getTime()) return false;
  return true;
}

export default function PurchasingIndexPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);
  const supabaseAny = supabase as any;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [myRole, setMyRole] = useState<Role>("kunde");
  const [myName, setMyName] = useState("");
  const [myEmail, setMyEmail] = useState("");

  const roleOk = myRole === "admin" || myRole === "innkjøper";

  const [rows, setRows] = useState<OrderView[]>([]);

  // filters
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<(typeof STATUSES)[number] | "ALL">("ALL");
  const [dateFrom, setDateFrom] = useState<string>(""); // YYYY-MM-DD
  const [dateTo, setDateTo] = useState<string>(""); // YYYY-MM-DD
  const [sort, setSort] = useState<SortKey>("NEWEST");

  // --- auth + load
  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setErr(null);

      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) {
        router.replace("/login");
        return;
      }

      let token: string | null = null;
      const { data: sess } = await supabase.auth.getSession();
      token = sess.session?.access_token ?? null;
      if (!token) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        token = refreshed.session?.access_token ?? null;
      }
      if (!token) {
        router.replace("/login");
        return;
      }

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

        setMyRole((String(me.role ?? "kunde") as Role) ?? "kunde");
        setMyName(String(me.display_name ?? "").trim());
        setMyEmail(String(me.email ?? "").trim().toLowerCase());
      } catch {
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }

      // load data
      await reloadAll();

      if (!alive) return;
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, supabase]);

  async function reloadAll() {
    setErr(null);

    // 1) hent orders
    // NB: ikke bruk .range() her – vi vil ha alt (Supabase default limit kan bite, men som regel ok).
    // Hvis dere får >1000 rader, må vi paginere.
    const selectWithUpdated = [
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
      "purchaser_note",
      "updated_at",
      "updated_by_name",
    ].join(", ");

    const selectBase = [
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
      "purchaser_note",
    ].join(", ");

    let ordersRes = await supabase.from("orders").select(selectWithUpdated);

    if (
      ordersRes.error &&
      (looksLikeMissingColumn(ordersRes.error, "updated_at") ||
        looksLikeMissingColumn(ordersRes.error, "updated_by_name"))
    ) {
      ordersRes = await supabase.from("orders").select(selectBase);
    }

    if (ordersRes.error) {
      console.error(ordersRes.error);
      setRows([]);
      setErr(ordersRes.error.message);
      return;
    }

    const orders = coerceOrderRows(ordersRes.data);
    if (orders.length === 0) {
      setRows([]);
      return;
    }

    // 2) totalpris: prøv nested select først (hvis relationship finnes)
    // Hvis det feiler, fall back til separat query på order_items.
    const orderIds = orders.map((o) => o.id);
    const totalsById: Record<string, number> = {};

    try {
      const nested = await supabaseAny
        .from("orders")
        .select("id, order_items(qty, unit_price)")
        .in("id", orderIds);

      if (nested?.error) {
        throw nested.error;
      }

      const nestedData: any[] = Array.isArray(nested?.data) ? nested.data : [];
      for (const r of nestedData) {
        const id = String(r?.id ?? "");
        const items: any[] = Array.isArray(r?.order_items) ? r.order_items : [];
        let sum = 0;
        for (const it of items) {
          const qty = Number(it?.qty ?? 0);
          const unit = Number(it?.unit_price ?? 0);
          if (Number.isFinite(qty) && Number.isFinite(unit)) sum += qty * unit;
        }
        totalsById[id] = sum;
      }
    } catch {
      // fallback: separate query (requires order_items table)
      try {
        const itemsRes = await supabase
          .from("order_items")
          .select("order_id, qty, unit_price")
          .in("order_id", orderIds);

        if (!itemsRes.error) {
          const items = (itemsRes.data ?? []) as unknown;
          if (Array.isArray(items)) {
            for (const it of items as any[]) {
              const oid = String(it?.order_id ?? "");
              const qty = Number(it?.qty ?? 0);
              const unit = Number(it?.unit_price ?? 0);
              if (!oid) continue;
              if (!Number.isFinite(qty) || !Number.isFinite(unit)) continue;
              totalsById[oid] = (totalsById[oid] ?? 0) + qty * unit;
            }
          }
        }
      } catch {
        // ingen totals – ok
      }
    }

    const view: OrderView[] = orders.map((o) => ({
      ...o,
      total_nok: Number.isFinite(totalsById[o.id]) ? totalsById[o.id] : 0,
    }));

    setRows(view);
  }

  async function setOrderStatus(orderId: string, newStatus: string) {
    setErr(null);

    const patch: Record<string, any> = {
      status: newStatus,
      updated_at: new Date().toISOString(),
      updated_by_name: myName || null,
    };

    let upd = await supabaseAny.from("orders").update(patch).eq("id", orderId);

    if (
      upd.error &&
      (looksLikeMissingColumn(upd.error, "updated_by_name") ||
        looksLikeMissingColumn(upd.error, "updated_at"))
    ) {
      const fallback = {
        status: newStatus,
        updated_at: new Date().toISOString(),
      };
      upd = await supabaseAny.from("orders").update(fallback).eq("id", orderId);
    }

    if (upd.error) {
      console.error(upd.error);
      setErr(upd.error.message);
      return;
    }

    setRows((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
    );
    setToast("Status lagret");
    window.setTimeout(() => setToast(null), 1000);
  }

  async function deleteOrder(orderId: string) {
    setErr(null);

    const ok = window.confirm(
      "Slette ordre permanent?\n\nTips: Hvis dere vil ha sporbarhet, bør vi heller bruke status = CANCELLED enn å slette."
    );
    if (!ok) return;

    // best-effort: slett items først (hvis ingen cascade)
    try {
      await supabaseAny.from("order_items").delete().eq("order_id", orderId);
    } catch {
      // ignore
    }

    const del = await supabaseAny.from("orders").delete().eq("id", orderId);
    if (del.error) {
      console.error(del.error);
      setErr(del.error.message);
      return;
    }

    setRows((prev) => prev.filter((o) => o.id !== orderId));
    setToast("Ordre slettet");
    window.setTimeout(() => setToast(null), 1200);
  }

  const filtered = useMemo(() => {
    const s = norm(q);

    let list = rows.filter((o) => {
      if (status !== "ALL" && String(o.status) !== status) return false;

      if (dateFrom || dateTo) {
        if (!withinDateRange(o.created_at, dateFrom, dateTo)) return false;
      }

      if (s) {
        const hay = [
          o.id,
          o.project_name,
          o.project_no ?? "",
          o.contact_name ?? "",
          o.contact_email ?? "",
          o.delivery_city ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(s)) return false;
      }

      return true;
    });

    const byCreated = (a: OrderView, b: OrderView) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime();

    if (sort === "NEWEST") list.sort((a, b) => -byCreated(a, b));
    if (sort === "OLDEST") list.sort(byCreated);
    if (sort === "TOTAL_DESC") list.sort((a, b) => (b.total_nok ?? 0) - (a.total_nok ?? 0));
    if (sort === "TOTAL_ASC") list.sort((a, b) => (a.total_nok ?? 0) - (b.total_nok ?? 0));

    return list;
  }, [rows, q, status, dateFrom, dateTo, sort]);

  if (loading) return <div className="p-6">Laster…</div>;

  if (!roleOk) {
    return (
      <div className="p-6 space-y-3">
        <button
          className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
          onClick={() => router.push("/products")}
        >
          ← Til produkter
        </button>
        <div className="rounded-lg border p-4 text-sm text-gray-700">
          Du har ikke tilgang til innkjøper-siden.
          <div className="mt-2 text-xs text-gray-500">
            Krever rolle <b>innkjøper</b> eller <b>admin</b>.
          </div>
        </div>
      </div>
    );
  }

  // Mobil mørk, desktop lys:
  // - base: mørk
  // - md+: lys
  return (
    <div className={cn("min-h-screen p-4 md:p-6", "bg-gray-950 text-gray-100 md:bg-gray-50 md:text-gray-900")}>
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Innkjøper – alle ordrer</h1>
            <div className="text-xs text-gray-300 md:text-gray-600">
              {myName || myEmail} · {myRole} · Totalt:{" "}
              <span className="font-medium">{rows.length}</span>
              {" · "}
              Viser: <span className="font-medium">{filtered.length}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              className={cn(
                "rounded-lg border px-3 py-2 text-sm",
                "border-gray-700 hover:bg-gray-900 md:border-gray-300 md:hover:bg-white"
              )}
              onClick={() => router.push("/orders")}
            >
              ← Mine ordre
            </button>

            <button
              className={cn(
                "rounded-lg px-3 py-2 text-sm",
                "bg-white/10 hover:bg-white/15 md:bg-white md:hover:bg-gray-50 md:border md:border-gray-300"
              )}
              onClick={reloadAll}
              title="Hent på nytt"
            >
              Oppdater
            </button>
          </div>
        </div>

        {err ? (
          <div className="rounded-xl border border-red-700/40 bg-red-950/40 px-4 py-3 text-sm text-red-200 md:border-red-200 md:bg-white md:text-red-700">
            {err}
          </div>
        ) : null}

        {toast ? (
          <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200 md:border-emerald-200 md:bg-white md:text-emerald-700">
            {toast}
          </div>
        ) : null}

        {/* Filters */}
        <div className={cn("rounded-2xl border p-4", "border-gray-800 bg-gray-900/40 md:border-gray-200 md:bg-white")}>
          <div className="grid gap-3 md:grid-cols-12">
            <div className="md:col-span-5">
              <label className="block text-xs font-medium text-gray-200 md:text-gray-600">Søk</label>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Prosjekt, prosjekt nr, kunde, e-post, ordre-id…"
                className={cn(
                  "mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none",
                  "border-gray-700 bg-gray-950 text-gray-100 placeholder:text-gray-500 focus:border-gray-500",
                  "md:border-gray-300 md:bg-white md:text-gray-900 md:placeholder:text-gray-400"
                )}
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-200 md:text-gray-600">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className={cn(
                  "mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none",
                  "border-gray-700 bg-gray-950 text-gray-100 focus:border-gray-500",
                  "md:border-gray-300 md:bg-white md:text-gray-900"
                )}
              >
                <option value="ALL">Alle</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-200 md:text-gray-600">Dato fra</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className={cn(
                  "mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none",
                  "border-gray-700 bg-gray-950 text-gray-100 focus:border-gray-500",
                  "md:border-gray-300 md:bg-white md:text-gray-900"
                )}
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-200 md:text-gray-600">Dato til</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className={cn(
                  "mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none",
                  "border-gray-700 bg-gray-950 text-gray-100 focus:border-gray-500",
                  "md:border-gray-300 md:bg-white md:text-gray-900"
                )}
              />
            </div>

            <div className="md:col-span-1">
              <label className="block text-xs font-medium text-gray-200 md:text-gray-600">Sort</label>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className={cn(
                  "mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none",
                  "border-gray-700 bg-gray-950 text-gray-100 focus:border-gray-500",
                  "md:border-gray-300 md:bg-white md:text-gray-900"
                )}
              >
                <option value="NEWEST">Nyeste</option>
                <option value="OLDEST">Eldste</option>
                <option value="TOTAL_DESC">Høyest pris</option>
                <option value="TOTAL_ASC">Lavest pris</option>
              </select>
            </div>
          </div>

          <div className="mt-2 text-xs text-gray-400 md:text-gray-500">
            Tips: Hvis totalpris er 0 på alt, mangler enten <code>order_items</code> eller relationship/query-tilgang.
          </div>
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div className={cn("rounded-xl border p-4 text-sm", "border-gray-800 bg-gray-900/40 text-gray-200 md:border-gray-200 md:bg-white md:text-gray-700")}>
            Ingen ordrer som matcher filteret.
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((o) => (
              <div
                key={o.id}
                className={cn(
                  "rounded-2xl border p-4",
                  "border-gray-800 bg-gray-900/40 md:border-gray-200 md:bg-white"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-xs text-gray-300 md:text-gray-500">
                      {formatDateTime(o.created_at)} · ID: <span className="font-mono">{o.id}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-base font-semibold">
                        {o.project_name}
                      </div>
                      {o.project_no ? (
                        <span className="text-xs rounded-full border px-2 py-0.5 border-gray-700 text-gray-200 md:border-gray-300 md:text-gray-700">
                          Prosjekt nr: {o.project_no}
                        </span>
                      ) : null}
                      <span className="text-xs rounded-full border px-2 py-0.5 border-gray-700 text-gray-200 md:border-gray-300 md:text-gray-700">
                        {STATUS_LABEL[(o.status as any) in STATUS_LABEL ? (o.status as any) : "SUBMITTED"]}
                      </span>
                      <span className="text-xs rounded-full border px-2 py-0.5 border-gray-700 text-gray-200 md:border-gray-300 md:text-gray-700">
                        {formatNok(o.total_nok ?? 0)}
                      </span>
                    </div>

                    <div className="text-sm text-gray-100 md:text-gray-700">
                      Bestiller/kunde: <span className="font-medium">{o.contact_name}</span>
                      {o.contact_email ? (
                        <span className="text-gray-300 md:text-gray-500"> · {o.contact_email}</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={(o.status as any) || "SUBMITTED"}
                      onChange={(e) => setOrderStatus(o.id, e.target.value)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-sm outline-none",
                        "border-gray-700 bg-gray-950 text-gray-100 hover:border-gray-500",
                        "md:border-gray-300 md:bg-white md:text-gray-900"
                      )}
                      title="Endre status"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>

                    <button
                      className={cn(
                        "rounded-lg px-3 py-2 text-sm",
                        "bg-white/10 hover:bg-white/15 md:border md:border-gray-300 md:bg-white md:hover:bg-gray-50"
                      )}
                      onClick={() => router.push(`/purchasing/${o.id}`)}
                    >
                      Åpne ordre
                    </button>

                    <button
                      className={cn(
                        "rounded-lg px-3 py-2 text-sm",
                        "bg-red-500/15 text-red-200 hover:bg-red-500/25",
                        "md:bg-white md:text-red-700 md:border md:border-red-200 md:hover:bg-red-50"
                      )}
                      onClick={() => deleteOrder(o.id)}
                    >
                      Slett
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footnote */}
        <div className="text-xs text-gray-400 md:text-gray-500">
          Hvis du fortsatt “ikke ser alle ordrer”: da er det 99% sannsynlig at Supabase RLS begrenser SELECT for admin/innkjøper.
          Da må vi oppdatere policies på <code>orders</code> (og <code>order_items</code>).
        </div>
      </div>
    </div>
  );
}