// file: web/src/app/orders/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useRequireMe } from "@/lib/useRequireMe";

type Role = "kunde" | "admin" | "innkjøper";

type OrderRow = {
  id: string;
  created_at: string;
  status: string;

  project_name: string;
  project_no: string | null;

  expected_delivery_date: string | null;
  delivery_info: string | null;
  confirmation_file_path: string | null;

  // kan mangle i DB
  updated_at?: string | null;
  updated_by_name?: string | null;

  // 👇 nye (kan mangle i DB – vi håndterer fallback)
  customer_id?: string | null;
  customer_name?: string | null;
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

function safeDate(s: string | null | undefined) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function parseDateInput(value: string) {
  // <input type="date"> => "YYYY-MM-DD"
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function isEtaOverdue(eta: string | null) {
  const d = safeDate(eta ?? null);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
}

function isEtaSoon(eta: string | null, days: number) {
  const d = safeDate(eta ?? null);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= days;
}

function etaCounterText(eta: string | null) {
  const d = safeDate(eta ?? null);
  if (!d) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);

  const diffDays = Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays > 0) return `${diffDays} dager igjen`;
  if (diffDays === 0) return "i dag";
  return `${Math.abs(diffDays)} dager over`;
}

function statusTone(status: string): "green" | "yellow" | "red" | "neutral" {
  const s = String(status ?? "").toUpperCase();
  if (s === "DELIVERED" || s === "CONFIRMED") return "green";
  if (s === "SUBMITTED" || s === "IN_REVIEW" || s === "ORDERED" || s === "SHIPPING") return "yellow";
  if (s === "CANCELLED") return "red";
  return "neutral";
}

// Mobil: mørk base. Desktop: lys base.
function badgeClass(tone: ReturnType<typeof statusTone>) {
  // base (mobile dark)
  const base = "border px-3 py-1 text-xs rounded-full";
  const md = "md:text-sm md:border";

  if (tone === "green")
    return cn(
      base,
      md,
      "border-emerald-700/40 bg-emerald-950/40 text-emerald-200",
      "md:border-emerald-200 md:bg-emerald-50 md:text-emerald-800"
    );
  if (tone === "yellow")
    return cn(
      base,
      md,
      "border-amber-700/40 bg-amber-950/40 text-amber-200",
      "md:border-amber-200 md:bg-amber-50 md:text-amber-800"
    );
  if (tone === "red")
    return cn(
      base,
      md,
      "border-red-700/40 bg-red-950/40 text-red-200",
      "md:border-red-200 md:bg-white md:text-red-700"
    );
  return cn(
    base,
    md,
    "border-gray-700 bg-gray-900 text-gray-200",
    "md:border-gray-200 md:bg-gray-50 md:text-gray-700"
  );
}

function looksLikeMissingColumn(err: any, col: string) {
  const msg = String(err?.message ?? "").toLowerCase();
  return msg.includes("does not exist") && msg.includes(col.toLowerCase());
}

function norm(s: string) {
  return s.trim().toLowerCase();
}

export default function OrdersPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  // ✅ invite-only + rolle fra server
  const { me, loading: meLoading } = useRequireMe();

  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 🔎 Filtre
  const [q, setQ] = useState<string>("");
  const [customerFilter, setCustomerFilter] = useState<string>("__ALL__");
  const [fromDate, setFromDate] = useState<string>(""); // YYYY-MM-DD
  const [toDate, setToDate] = useState<string>(""); // YYYY-MM-DD

  const myRole: Role = (me?.role as Role) ?? "kunde";
  const myDisplayName = (me?.display_name ? String(me.display_name).trim() : "") || "—";

  const isAdmin = myRole === "admin";
  const canFilterCustomers = myRole === "admin" || myRole === "innkjøper";

  async function getFreshToken() {
    const { data: sessRes, error: sessErr } = await supabase.auth.getSession();
    if (sessErr) console.error(sessErr);

    let token = sessRes.session?.access_token ?? null;

    if (!token) {
      const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr) console.error(refreshErr);
      token = refreshed.session?.access_token ?? null;
    }

    return token;
  }

  useEffect(() => {
    let alive = true;

    (async () => {
      if (meLoading) return;

      if (!me?.ok) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setErr(null);

      // Vi prøver å hente kunde-felter også. Hvis de ikke finnes i DB, faller vi tilbake.
      const selectFull =
        "id, created_at, status, project_name, project_no, expected_delivery_date, delivery_info, confirmation_file_path, updated_at, updated_by_name, customer_id, customer_name";

      const selectNoCustomer =
        "id, created_at, status, project_name, project_no, expected_delivery_date, delivery_info, confirmation_file_path, updated_at, updated_by_name";

      const selectBase =
        "id, created_at, status, project_name, project_no, expected_delivery_date, delivery_info, confirmation_file_path";

      const r1 = await supabase.from("orders").select(selectFull).order("created_at", { ascending: false });

      let data: unknown[] | null = (r1.data as unknown[]) ?? null;
      let error: any = r1.error;

      if (
        error &&
        (looksLikeMissingColumn(error, "updated_at") ||
          looksLikeMissingColumn(error, "updated_by_name") ||
          looksLikeMissingColumn(error, "customer_id") ||
          looksLikeMissingColumn(error, "customer_name"))
      ) {
        // Prøv uten customer_* først
        const r2 = await supabase.from("orders").select(selectNoCustomer).order("created_at", { ascending: false });
        data = (r2.data as unknown[]) ?? null;
        error = r2.error;

        // Hvis det fortsatt feiler pga updated_*, prøv helt base.
        if (error && (looksLikeMissingColumn(error, "updated_at") || looksLikeMissingColumn(error, "updated_by_name"))) {
          const r3 = await supabase.from("orders").select(selectBase).order("created_at", { ascending: false });
          data = (r3.data as unknown[]) ?? null;
          error = r3.error;
        }
      }

      if (!alive) return;

      if (error) {
        console.error(error);
        setErr(String(error.message ?? "Ukjent feil"));
        setRows([]);
      } else {
        setRows((data ?? []) as OrderRow[]);
      }

      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [meLoading, me?.ok, supabase]);

  const sorted = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const ta = new Date(a.updated_at ?? a.created_at).getTime();
      const tb = new Date(b.updated_at ?? b.created_at).getTime();
      return tb - ta;
    });
    return list;
  }, [rows]);

  const customerOptions = useMemo(() => {
    // Dropdown basert på data vi faktisk har.
    // Hvis customer_name mangler helt, vil listen bli tom (bortsett fra "Alle").
    const uniq = new Map<string, string>(); // key -> label
    for (const r of rows) {
      const name = (r.customer_name ? String(r.customer_name).trim() : "") || "";
      const id = (r.customer_id ? String(r.customer_id).trim() : "") || "";
      if (!name && !id) continue;

      const key = id || name; // stabil nøkkel hvis vi har id
      const label = name || id;
      if (!uniq.has(key)) uniq.set(key, label);
    }
    return Array.from(uniq.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "nb"));
  }, [rows]);

  const filtered = useMemo(() => {
    const query = norm(q);
    const fromD = parseDateInput(fromDate);
    const toD = parseDateInput(toDate);

    const fromTs = fromD ? startOfDay(fromD).getTime() : null;
    const toTs = toD ? endOfDay(toD).getTime() : null;

    return sorted.filter((o) => {
      // Kunde-filter (kun relevant hvis vi faktisk har kunde-data)
      if (canFilterCustomers && customerFilter !== "__ALL__") {
        const key = (o.customer_id ? String(o.customer_id).trim() : "") || (o.customer_name ? String(o.customer_name).trim() : "");
        if (key !== customerFilter) return false;
      }

      // Dato-filter på created_at
      const createdTs = new Date(o.created_at).getTime();
      if (Number.isFinite(createdTs)) {
        if (fromTs !== null && createdTs < fromTs) return false;
        if (toTs !== null && createdTs > toTs) return false;
      }

      // Søk: kunde, prosjektnavn, prosjekt nr
      if (query) {
        const hay = [
          o.customer_name ?? "",
          o.project_name ?? "",
          o.project_no ?? "",
        ]
          .join(" · ")
          .toLowerCase();

        if (!hay.includes(query)) return false;
      }

      return true;
    });
  }, [sorted, q, fromDate, toDate, canFilterCustomers, customerFilter]);

  async function openConfirmation(orderId: string) {
    setDownloadingId(orderId);
    setErr(null);

    try {
      const token = await getFreshToken();
      if (!token) {
        router.replace("/login");
        return;
      }

      const res = await fetch(`/api/orders/${orderId}/confirmation-url`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.url) {
        alert(payload?.error ?? "Kunne ikke hente nedlastingslenke.");
        return;
      }

      window.open(payload.url, "_blank", "noopener,noreferrer");
    } finally {
      setDownloadingId(null);
    }
  }

  async function deleteOrder(orderId: string) {
    if (!isAdmin) return;

    const ok = confirm("Slette denne ordren permanent? Dette kan ikke angres.");
    if (!ok) return;

    setDeletingId(orderId);
    setErr(null);

    try {
      const token = await getFreshToken();
      if (!token) {
        router.replace("/login");
        return;
      }

      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setErr(data?.error ?? `Delete failed (${res.status})`);
        return;
      }

      setRows((prev) => prev.filter((x) => x.id !== orderId));
      setToast("Ordre slettet");
      window.setTimeout(() => setToast(null), 1200);
    } finally {
      setDeletingId(null);
    }
  }

  if (meLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 md:bg-white md:text-gray-900 p-6">
        <h1 className="text-xl font-semibold">Mine bestillinger</h1>
        <p className="mt-2 text-sm text-gray-400 md:text-gray-600">Laster…</p>
      </div>
    );
  }

  if (!me?.ok) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 md:bg-white md:text-gray-900 p-6 space-y-3">
        <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5 text-sm text-gray-200 md:border-gray-200 md:bg-white md:text-gray-700">
          Du har ikke tilgang.
        </div>
        <button
          className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 hover:bg-gray-800 md:border-gray-300 md:bg-white md:text-gray-900 md:hover:bg-gray-50"
          onClick={() => router.push("/login")}
        >
          Til innlogging
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 md:bg-white md:text-gray-900">
      {/* Topbar */}
      <div className="sticky top-0 z-10 border-b border-gray-800 bg-gray-950/95 backdrop-blur md:border-gray-200 md:bg-white/80">
        <div className="mx-auto max-w-5xl px-4 md:px-6 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 hover:bg-gray-800 md:border-gray-300 md:bg-white md:text-gray-900 md:hover:bg-gray-50"
              onClick={() => router.push("/products")}
            >
              ← Produkter
            </button>

            <div className="text-xs text-gray-300 md:text-gray-600">
              {myDisplayName} · {myRole}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-5xl px-4 md:px-6 py-5 space-y-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Mine bestillinger</h1>
          <p className="text-sm text-gray-400 md:text-gray-600">
            Status, ETA og ordrebekreftelse – sortert etter sist oppdatert.
          </p>
        </div>

        {/* 🔎 Filterbar */}
        <div
          className={cn(
            "rounded-2xl border p-4 md:p-5",
            "border-gray-800 bg-gray-900/40 md:border-gray-200 md:bg-white"
          )}
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-end">
              {/* Kunde dropdown (kun for admin/innkjøper) */}
              {canFilterCustomers ? (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 md:text-gray-600">Kunde</label>
                  <select
                    className="h-10 rounded-xl border border-gray-700 bg-gray-950/40 px-3 text-sm text-gray-100 outline-none focus:ring-2 focus:ring-white/10 md:border-gray-300 md:bg-white md:text-gray-900"
                    value={customerFilter}
                    onChange={(e) => setCustomerFilter(e.target.value)}
                  >
                    <option value="__ALL__">Alle</option>
                    {customerOptions.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  {customerOptions.length === 0 ? (
                    <div className="text-[11px] text-gray-500 md:text-gray-500">
                      (Ingen kunde-felt i data ennå)
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Dato fra/til */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 md:text-gray-600">Fra dato</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-10 rounded-xl border border-gray-700 bg-gray-950/40 px-3 text-sm text-gray-100 outline-none focus:ring-2 focus:ring-white/10 md:border-gray-300 md:bg-white md:text-gray-900"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 md:text-gray-600">Til dato</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="h-10 rounded-xl border border-gray-700 bg-gray-950/40 px-3 text-sm text-gray-100 outline-none focus:ring-2 focus:ring-white/10 md:border-gray-300 md:bg-white md:text-gray-900"
                />
              </div>

              {/* Søk */}
              <div className="flex flex-col gap-1 md:min-w-[320px]">
                <label className="text-xs text-gray-400 md:text-gray-600">Søk</label>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Kunde, prosjektnavn, prosjekt nr…"
                  className="h-10 rounded-xl border border-gray-700 bg-gray-950/40 px-3 text-sm text-gray-100 outline-none placeholder:text-gray-500 focus:ring-2 focus:ring-white/10 md:border-gray-300 md:bg-white md:text-gray-900 md:placeholder:text-gray-400"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 md:justify-end">
              <div className="text-xs text-gray-400 md:text-gray-600">
                Viser <span className="font-semibold text-gray-100 md:text-gray-900">{filtered.length}</span> av{" "}
                <span className="font-semibold text-gray-100 md:text-gray-900">{sorted.length}</span>
              </div>

              <button
                className="h-10 rounded-xl border border-gray-700 bg-gray-900 px-3 text-sm text-gray-100 hover:bg-gray-800 md:border-gray-300 md:bg-white md:text-gray-900 md:hover:bg-gray-50"
                onClick={() => {
                  setQ("");
                  setFromDate("");
                  setToDate("");
                  setCustomerFilter("__ALL__");
                }}
              >
                Nullstill
              </button>
            </div>
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

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-6 text-sm text-gray-200 md:border-gray-200 md:bg-white md:text-gray-700">
            Ingen treff på filtrene dine.
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((o) => {
              const hasConfirmation = Boolean(o.confirmation_file_path);
              const busyDownload = downloadingId === o.id;
              const busyDelete = deletingId === o.id;

              const lastTs = o.updated_at ?? o.created_at;
              const etaOverdue = isEtaOverdue(o.expected_delivery_date);
              const etaSoon = isEtaSoon(o.expected_delivery_date, 7);

              const tone = statusTone(o.status);

              const customerLine =
                canFilterCustomers && (o.customer_name || o.customer_id)
                  ? (o.customer_name ? String(o.customer_name).trim() : "") || o.customer_id
                  : null;

              return (
                <div
                  key={o.id}
                  className={cn(
                    "rounded-2xl border p-4 md:p-5",
                    "border-gray-800 bg-gray-900/40 md:border-gray-200 md:bg-white"
                  )}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
                    <div className="space-y-1">
                      <div className="text-xs text-gray-300 md:text-gray-500">
                        Opprettet: {formatDateTime(o.created_at)}
                      </div>

                      <div className="text-xs text-gray-300 md:text-gray-500">
                        Sist endret:{" "}
                        <span className="font-medium text-gray-100 md:text-gray-900">{formatDateTime(lastTs)}</span>
                        {o.updated_by_name ? (
                          <span className="text-gray-400 md:text-gray-500"> · {o.updated_by_name}</span>
                        ) : null}
                      </div>

                      {customerLine ? (
                        <div className="text-sm text-gray-300 md:text-gray-600">Kunde: {customerLine}</div>
                      ) : null}

                      <div className="text-base font-semibold text-gray-100 md:text-gray-900">{o.project_name}</div>

                      {o.project_no ? (
                        <div className="text-sm text-gray-300 md:text-gray-600">Prosjekt nr: {o.project_no}</div>
                      ) : null}
                    </div>

                    <div className="flex items-start justify-between gap-3 md:flex-col md:items-end md:gap-2">
                      <div className={badgeClass(tone)}>
                        <span className="font-medium">{statusLabel(o.status)}</span>
                      </div>

                      <div className="text-right text-sm">
                        <div className="text-gray-200 md:text-gray-700">
                          ETA:{" "}
                          {o.expected_delivery_date ? (
                            <span
                              className={cn(
                                "font-medium",
                                etaOverdue
                                  ? "text-red-300 md:text-red-700"
                                  : etaSoon
                                    ? "text-amber-300 md:text-amber-700"
                                    : "text-gray-100 md:text-gray-900"
                              )}
                            >
                              {formatDateOnly(o.expected_delivery_date)}
                            </span>
                          ) : (
                            <span className="text-gray-400 md:text-gray-500">Ikke satt</span>
                          )}
                        </div>

                        {o.expected_delivery_date ? (
                          <div
                            className={cn(
                              "text-xs mt-0.5",
                              etaOverdue
                                ? "text-red-300/90 md:text-red-600"
                                : etaSoon
                                  ? "text-amber-300/90 md:text-amber-600"
                                  : "text-gray-400 md:text-gray-500"
                            )}
                          >
                            {etaCounterText(o.expected_delivery_date)}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {o.delivery_info ? (
                    <div className="mt-3 rounded-xl border border-gray-800 bg-gray-950/40 p-3 text-sm text-gray-200 whitespace-pre-line md:border-gray-200 md:bg-gray-50 md:text-gray-700">
                      {o.delivery_info}
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 hover:bg-gray-800 md:border-gray-300 md:bg-white md:text-gray-900 md:hover:bg-gray-50"
                      onClick={() => router.push(`/orders/${o.id}`)}
                    >
                      Åpne ordre
                    </button>

                    {hasConfirmation ? (
                      <button
                        disabled={busyDownload}
                        className="rounded-xl bg-white/10 px-3 py-2 text-sm text-gray-100 hover:bg-white/15 disabled:opacity-50 md:bg-black md:text-white md:hover:opacity-90"
                        onClick={() => openConfirmation(o.id)}
                      >
                        {busyDownload ? "Henter lenke…" : "Last ned ordrebekreftelse"}
                      </button>
                    ) : (
                      <div className="text-sm text-gray-400 md:text-gray-500">Ordrebekreftelse ikke tilgjengelig enda</div>
                    )}

                    {isAdmin ? (
                      <button
                        disabled={busyDelete}
                        className="rounded-xl border border-red-700/50 bg-red-950/30 px-3 py-2 text-sm text-red-200 hover:bg-red-950/45 disabled:opacity-50 md:border-red-200 md:bg-white md:text-red-700 md:hover:bg-red-50"
                        onClick={() => deleteOrder(o.id)}
                        title="Slett ordre"
                      >
                        {busyDelete ? "Sletter…" : "Slett"}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}