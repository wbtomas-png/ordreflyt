// file: src/app/purchasing/[id]/page.tsx
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
  purchaser_note: string | null;

  updated_at?: string | null;
  updated_by_name?: string | null;
};

const STATUSES = [
  "SUBMITTED",
  "IN_REVIEW",
  "ORDERED",
  "CONFIRMED",
  "SHIPPING",
  "DELIVERED",
  "CANCELLED",
] as const;

type Status = (typeof STATUSES)[number];

const STATUS_LABEL: Record<Status, string> = {
  SUBMITTED: "Submitted",
  IN_REVIEW: "In review",
  ORDERED: "Ordered",
  CONFIRMED: "Confirmed",
  SHIPPING: "Shipping",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function isStatus(x: unknown): x is Status {
  return typeof x === "string" && (STATUSES as readonly string[]).includes(x);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString("nb-NO");
  } catch {
    return String(value);
  }
}

function normEmail(s: unknown) {
  return String(s ?? "").trim().toLowerCase();
}

function normName(s: unknown) {
  return String(s ?? "").trim();
}

function looksLikeMissingColumn(err: any, col: string) {
  const msg = String(err?.message ?? "").toLowerCase();
  return msg.includes("does not exist") && msg.includes(col.toLowerCase());
}

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

export default function PurchasingOrderPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");

  const supabase = useMemo(() => supabaseBrowser(), []);
  const supabaseAny = supabase as any;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [myEmail, setMyEmail] = useState("");
  const [myName, setMyName] = useState("");
  const [myRole, setMyRole] = useState<Role>("kunde");
  const roleOk = myRole === "admin" || myRole === "innkjøper";

  const [order, setOrder] = useState<OrderRow | null>(null);

  const [status, setStatus] = useState<Status>("SUBMITTED");
  const [eta, setEta] = useState("");
  const [info, setInfo] = useState("");
  const [confirmPath, setConfirmPath] = useState("");
  const [note, setNote] = useState("");

  const [busy, setBusy] = useState(false);

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

      // access token til /api/auth/me
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

      // rolle + display_name via /api/auth/me
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

        const email = normEmail(me.email);
        const displayName = normName(me.display_name);

        setMyEmail(email);
        setMyName(displayName || email);
        setMyRole((String(me.role ?? "kunde") as Role) ?? "kunde");
      } catch {
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }

      // hent ordre (runtime guard, ingen "as OrderRow" som TS krangler med)
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

      let res = await supabase
        .from("orders")
        .select(selectWithUpdated)
        .eq("id", id)
        .maybeSingle();

      if (
        res.error &&
        (looksLikeMissingColumn(res.error, "updated_at") ||
          looksLikeMissingColumn(res.error, "updated_by_name"))
      ) {
        res = await supabase.from("orders").select(selectBase).eq("id", id).maybeSingle();
      }

      if (!alive) return;

      if (res.error) {
        console.error(res.error);
        setErr(res.error.message);
        setOrder(null);
        setLoading(false);
        return;
      }

      const dataUnknown: unknown = (res as any).data ?? null;

      if (!isOrderRow(dataUnknown)) {
        setErr("Ordre ikke funnet, eller mangler påkrevde felt.");
        setOrder(null);
        setLoading(false);
        return;
      }

      const o = dataUnknown;

      setOrder(o);

      const st = isStatus(o.status) ? (o.status as Status) : "SUBMITTED";
      setStatus(st);

      setEta(o.expected_delivery_date ?? "");
      setInfo(o.delivery_info ?? "");
      setConfirmPath(o.confirmation_file_path ?? "");
      setNote(o.purchaser_note ?? "");

      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [id, router, supabase]);

  async function saveChanges() {
    if (!order) return;
    setErr(null);
    setBusy(true);

    try {
      const nowIso = new Date().toISOString();

      const basePayload: Record<string, any> = {
        status, // alltid string, aldri null
        expected_delivery_date: eta || null,
        delivery_info: info || null,
        confirmation_file_path: confirmPath || null,
        purchaser_note: note || null,
        updated_at: nowIso,
        updated_by_name: myName || null,
      };

      let upd = await supabaseAny.from("orders").update(basePayload).eq("id", order.id);

      if (
        upd.error &&
        (looksLikeMissingColumn(upd.error, "updated_by_name") ||
          looksLikeMissingColumn(upd.error, "updated_at"))
      ) {
        const fallbackPayload = {
          status,
          expected_delivery_date: eta || null,
          delivery_info: info || null,
          confirmation_file_path: confirmPath || null,
          purchaser_note: note || null,
          updated_at: nowIso,
        };
        upd = await supabaseAny.from("orders").update(fallbackPayload).eq("id", order.id);
      }

      if (upd.error) {
        console.error(upd.error);
        setErr(upd.error.message);
        return;
      }

      setOrder((prev) =>
        prev
          ? {
              ...prev,
              status,
              expected_delivery_date: eta || null,
              delivery_info: info || null,
              confirmation_file_path: confirmPath || null,
              purchaser_note: note || null,
              updated_at: nowIso,
              updated_by_name: myName || null,
            }
          : prev
      );

      setToast("Lagret");
      window.setTimeout(() => setToast(null), 1200);
    } finally {
      setBusy(false);
    }
  }

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

  if (!order) {
    return (
      <div className="p-6 space-y-3">
        <button
          className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
          onClick={() => router.push("/purchasing")}
        >
          ← Tilbake
        </button>
        <div className="rounded-lg border p-4 text-sm text-red-700">
          {err ?? "Ordre ikke funnet."}
        </div>
      </div>
    );
  }

  // Mobil mørk, desktop lys (samme prinsipp som index-siden)
  return (
    <div
      className={cn(
        "min-h-screen p-4 md:p-6",
        "bg-gray-950 text-gray-100 md:bg-gray-50 md:text-gray-900"
      )}
    >
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            className={cn(
              "rounded-lg border px-3 py-2 text-sm",
              "border-gray-700 hover:bg-gray-900 md:border-gray-300 md:hover:bg-white"
            )}
            onClick={() => router.push("/purchasing")}
          >
            ← Tilbake til innkjøperliste
          </button>

          <div className="text-xs text-gray-300 md:text-gray-600">
            {myName || myEmail} · {myRole}
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

        <div
          className={cn(
            "rounded-2xl border p-4 space-y-3",
            "border-gray-800 bg-gray-900/40 md:border-gray-200 md:bg-white"
          )}
        >
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">{order.project_name}</h1>
            <div className="text-sm text-gray-300 md:text-gray-600">
              Opprettet: {formatDateTime(order.created_at)}
              {order.project_no ? ` · Prosjekt nr: ${order.project_no}` : ""}
            </div>
            <div className="text-sm text-gray-200 md:text-gray-700">
              Bestiller/kunde: <span className="font-medium">{order.contact_name}</span>
              {order.contact_email ? (
                <span className="text-gray-400 md:text-gray-500"> · {order.contact_email}</span>
              ) : null}
            </div>

            <div className="text-xs text-gray-400 md:text-gray-500">
              Levering: {order.delivery_address}
              {order.delivery_postcode ? `, ${order.delivery_postcode}` : ""}
              {order.delivery_city ? ` ${order.delivery_city}` : ""}
            </div>

            {order.updated_at ? (
              <div className="text-xs text-gray-400 md:text-gray-500">
                Sist endret: {formatDateTime(order.updated_at)}
                {order.updated_by_name ? ` · ${order.updated_by_name}` : ""}
              </div>
            ) : null}
          </div>

          <div className="grid gap-3">
            <label className="text-sm">
              Status
              <select
                className={cn(
                  "mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none",
                  "border-gray-700 bg-gray-950 text-gray-100 focus:border-gray-500",
                  "md:border-gray-300 md:bg-white md:text-gray-900"
                )}
                value={status}
                onChange={(e) => setStatus(e.target.value as Status)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              ETA (YYYY-MM-DD)
              <input
                className={cn(
                  "mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none",
                  "border-gray-700 bg-gray-950 text-gray-100 placeholder:text-gray-500 focus:border-gray-500",
                  "md:border-gray-300 md:bg-white md:text-gray-900 md:placeholder:text-gray-400"
                )}
                value={eta}
                onChange={(e) => setEta(e.target.value)}
                placeholder="2026-02-28"
                inputMode="numeric"
              />
            </label>

            <label className="text-sm">
              Leveringsinfo (til bestiller)
              <textarea
                className={cn(
                  "mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none",
                  "border-gray-700 bg-gray-950 text-gray-100 placeholder:text-gray-500 focus:border-gray-500",
                  "md:border-gray-300 md:bg-white md:text-gray-900"
                )}
                rows={3}
                value={info}
                onChange={(e) => setInfo(e.target.value)}
              />
            </label>

            <label className="text-sm">
              Ordrebekreftelse sti (relativ)
              <input
                className={cn(
                  "mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none",
                  "border-gray-700 bg-gray-950 text-gray-100 placeholder:text-gray-500 focus:border-gray-500",
                  "md:border-gray-300 md:bg-white md:text-gray-900 md:placeholder:text-gray-400"
                )}
                value={confirmPath}
                onChange={(e) => setConfirmPath(e.target.value)}
                placeholder="uploads/orders/ORDER-123.pdf"
              />
              <div className="mt-1 text-xs text-gray-400 md:text-gray-500">
                (Senere kan vi flytte dette til Supabase Storage.)
              </div>
            </label>

            <label className="text-sm">
              Innkjøpernotat (internt)
              <textarea
                className={cn(
                  "mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none",
                  "border-gray-700 bg-gray-950 text-gray-100 placeholder:text-gray-500 focus:border-gray-500",
                  "md:border-gray-300 md:bg-white md:text-gray-900"
                )}
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>

            <button
              disabled={busy}
              onClick={saveChanges}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50",
                "bg-white/10 hover:bg-white/15 md:bg-black md:text-white md:hover:opacity-90"
              )}
            >
              {busy ? "Lagrer…" : "Lagre endringer"}
            </button>
          </div>
        </div>

        <div className="text-xs text-gray-400 md:text-gray-500">
          Status-visning: <span className="font-medium">{STATUS_LABEL[status]}</span>
        </div>
      </div>
    </div>
  );
}