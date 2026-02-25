// file: web/src/app/orders/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

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

  // nye (anbefalt i DB)
  updated_at?: string | null;
  updated_by_name?: string | null;
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
  if (!Number.isFinite(d.getTime())) return value;

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

function statusTone(status: string): "green" | "yellow" | "red" | "neutral" {
  const s = String(status ?? "").toUpperCase();

  // grønn: ferdige/trygge
  if (s === "DELIVERED" || s === "CONFIRMED") return "green";

  // gul: i arbeid / underveis
  if (s === "SUBMITTED" || s === "IN_REVIEW" || s === "ORDERED" || s === "SHIPPING")
    return "yellow";

  // rød: avbrutt/problemer
  if (s === "CANCELLED") return "red";

  return "neutral";
}

function badgeClass(tone: ReturnType<typeof statusTone>) {
  if (tone === "green") return "border-green-200 bg-green-50 text-green-800";
  if (tone === "yellow") return "border-amber-200 bg-amber-50 text-amber-800";
  if (tone === "red") return "border-red-200 bg-red-50 text-red-800";
  return "border-gray-200 bg-gray-50 text-gray-700";
}

function looksLikeMissingColumn(err: any, col: string) {
  const msg = String(err?.message ?? "").toLowerCase();
  return msg.includes("does not exist") && msg.includes(col.toLowerCase());
}

function etaCounterText(eta: string | null) {
  const d = safeDate(eta ?? null);
  if (!d) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);

  const diffDays = Math.round(
    (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays > 0) return `${diffDays} dager igjen`;
  if (diffDays === 0) return "i dag";
  return `${Math.abs(diffDays)} dager over`;
}

export default function OrdersPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [myEmail, setMyEmail] = useState<string>("");
  const [myName, setMyName] = useState<string>("");
  const [myRole, setMyRole] = useState<Role>("kunde");

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const isAdmin = myRole === "admin";

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setErr(null);

      // 1) Må være innlogget
      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) {
        router.replace("/login");
        return;
      }

      // 2) Token
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        router.replace("/login");
        return;
      }

      // 3) Hent rolle + display_name fra server
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
        const displayName = String(me.display_name ?? "").trim();

        setMyEmail(email);
        setMyName(displayName || email);
        setMyRole((String(me.role ?? "kunde") as Role) ?? "kunde");
      } catch {
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }

      // 4) Last ordre (prøv med updated_*)
      const selectWithUpdated =
        "id, created_at, status, project_name, project_no, expected_delivery_date, delivery_info, confirmation_file_path, updated_at, updated_by_name";

      const selectBase =
        "id, created_at, status, project_name, project_no, expected_delivery_date, delivery_info, confirmation_file_path";

      let res = await supabase
        .from("orders")
        .select(selectWithUpdated)
        .order("created_at", { ascending: false });

      if (
        res.error &&
        (looksLikeMissingColumn(res.error, "updated_at") ||
          looksLikeMissingColumn(res.error, "updated_by_name"))
      ) {
        res = await supabase
          .from("orders")
          .select(selectBase)
          .order("created_at", { ascending: false });
      }

      if (!alive) return;

      if (res.error) {
        console.error(res.error);
        setErr(res.error.message);
        setRows([]);
      } else {
        setRows((res.data ?? []) as OrderRow[]);
      }

      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [router, supabase]);

  const sorted = useMemo(() => {
    // “Sist oppdatert øverst”: bruk updated_at hvis finnes, ellers created_at
    const list = [...rows];
    list.sort((a, b) => {
      const ta = new Date(a.updated_at ?? a.created_at).getTime();
      const tb = new Date(b.updated_at ?? b.created_at).getTime();
      return tb - ta;
    });
    return list;
  }, [rows]);

  async function openConfirmation(orderId: string) {
    setDownloadingId(orderId);
    setErr(null);

    try {
      const { data: sessionRes, error: sessErr } = await supabase.auth.getSession();
      const token = sessionRes.session?.access_token;

      if (sessErr || !token) {
        alert("Du er ikke innlogget.");
        router.replace("/login");
        return;
      }

      const res = await fetch(`/api/orders/${orderId}/confirmation-url`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        alert("Kunne ikke hente nedlastingslenke.");
        return;
      }

      const { url } = (await res.json()) as { url: string };
      window.open(url, "_blank", "noopener,noreferrer");
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
      const { data: sessionRes } = await supabase.auth.getSession();
      const token = sessionRes.session?.access_token;
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
      setTimeout(() => setToast(null), 1200);
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Mine bestillinger</h1>
        <p className="mt-2 text-sm text-gray-600">Laster…</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <button
          className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
          onClick={() => router.push("/products")}
        >
          ← Produkter
        </button>

        {myName ? (
          <div className="text-xs text-gray-500">
            {myName} · {myRole}
          </div>
        ) : null}
      </header>

      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Mine bestillinger</h1>
        <p className="text-sm text-gray-600">
          Status, ETA og ordrebekreftelse – sortert etter sist oppdatert.
        </p>
      </div>

      {err ? (
        <div className="rounded-xl border bg-white px-4 py-3 text-sm text-red-700">{err}</div>
      ) : null}

      {toast ? (
        <div className="rounded-xl border bg-white px-4 py-3 text-sm text-green-700">{toast}</div>
      ) : null}

      {sorted.length === 0 ? (
        <div className="rounded-2xl border p-6 text-sm text-gray-600">
          Du har ingen bestillinger ennå.
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((o) => {
            const hasConfirmation = Boolean(o.confirmation_file_path);
            const busyDownload = downloadingId === o.id;
            const busyDelete = deletingId === o.id;

            const lastTs = o.updated_at ?? o.created_at;
            const etaOverdue = isEtaOverdue(o.expected_delivery_date);
            const etaSoon = isEtaSoon(o.expected_delivery_date, 7);

            const tone = statusTone(o.status);

            return (
              <div key={o.id} className="rounded-2xl border bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-sm text-gray-600">
                      Opprettet: {formatDateTime(o.created_at)}
                    </div>

                    <div className="text-sm text-gray-600">
                      Sist endret:{" "}
                      <span className="font-medium text-gray-900">{formatDateTime(lastTs)}</span>
                      {o.updated_by_name ? (
                        <span className="text-gray-500"> · {o.updated_by_name}</span>
                      ) : null}
                    </div>

                    <div className="font-semibold">{o.project_name}</div>

                    {o.project_no ? (
                      <div className="text-sm text-gray-600">Prosjekt nr: {o.project_no}</div>
                    ) : null}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <div
                      className={cn(
                        "rounded-full border px-3 py-1 text-sm",
                        badgeClass(tone)
                      )}
                    >
                      <span className="font-medium">{statusLabel(o.status)}</span>
                    </div>

                    <div className="text-sm text-gray-700">
  ETA:{" "}
  {o.expected_delivery_date ? (
    <span
      className={cn(
        "font-medium",
        etaOverdue ? "text-red-700" : etaSoon ? "text-amber-700" : "text-gray-900"
      )}
    >
      {formatDateOnly(o.expected_delivery_date)}</span>
  ) : (
    <span className="text-gray-500">Ikke satt</span>
  )}

  {o.expected_delivery_date ? (
    <div
      className={cn(
        "text-xs mt-0.5",
        etaOverdue
          ? "text-red-600"
          : etaSoon
          ? "text-amber-600"
          : "text-gray-500"
      )}
    >
      {etaCounterText(o.expected_delivery_date)}
    </div>
  ) : null}
</div>
                  </div>
                </div>

                {o.delivery_info ? (
                  <div className="mt-3 rounded-xl border bg-gray-50 p-3 text-sm text-gray-700 whitespace-pre-line">
                    {o.delivery_info}
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                    onClick={() => router.push(`/orders/${o.id}`)}
                  >
                    Åpne ordre
                  </button>

                  {hasConfirmation ? (
                    <button
                      disabled={busyDownload}
                      className="rounded-lg bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
                      onClick={() => openConfirmation(o.id)}
                    >
                      {busyDownload ? "Henter lenke…" : "Last ned ordrebekreftelse"}
                    </button>
                  ) : (
                    <div className="text-sm text-gray-500">
                      Ordrebekreftelse ikke tilgjengelig enda
                    </div>
                  )}

                  {isAdmin ? (
                    <button
                      disabled={busyDelete}
                      className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
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
  );
}