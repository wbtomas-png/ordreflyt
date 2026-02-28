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
  updated_by_name?: string | null; // display_name
};

type OrderAuditRow = {
  id: string;
  order_id: string;
  created_at: string;
  actor_name?: string | null;
  actor_email?: string | null;
  action: string;
  diff: any;
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

const STATUS_LABEL: Record<(typeof STATUSES)[number], string> = {
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

function safeDate(s: string | null | undefined) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function formatDateTime(value: string) {
  try {
    return new Date(value).toLocaleString("nb-NO");
  } catch {
    return value;
  }
}

function daysSince(iso: string) {
  const d = safeDate(iso);
  if (!d) return null;
  const ms = Date.now() - d.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
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
  const diffDays = Math.round(
    (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  return diffDays >= 0 && diffDays <= days;
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

async function loadOrder(
  supabase: ReturnType<typeof supabaseBrowser>,
  orderId: string
) {
  const withUpdated = [
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

  const base = [
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

  let res = await supabase.from("orders").select(withUpdated).eq("id", orderId).maybeSingle();

  if (
    res.error &&
    (looksLikeMissingColumn(res.error, "updated_at") ||
      looksLikeMissingColumn(res.error, "updated_by_name"))
  ) {
    res = await supabase.from("orders").select(base).eq("id", orderId).maybeSingle();
  }

  return res;
}

export default function PurchasingOrderPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const orderId = String(params?.id ?? "");

  // NB: Supabase without generated DB types -> mutations become `never`.
  // We keep the client normal, but cast the mutation builders to `any` locally.
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

  // editable fields
  const [status, setStatus] = useState<string>("SUBMITTED");
  const [eta, setEta] = useState<string>("");
  const [info, setInfo] = useState<string>("");
  const [confirmPath, setConfirmPath] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const ageDays = order?.created_at ? daysSince(order.created_at) : null;
  const overdue = isEtaOverdue(order?.expected_delivery_date ?? null);
  const soon = isEtaSoon(order?.expected_delivery_date ?? null, 7);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setErr(null);

      if (!orderId) {
        setErr("Mangler ordre-id i URL.");
        setLoading(false);
        return;
      }

      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) {
        router.replace("/login");
        return;
      }

      let token: string | null = null;
      const { data: sess } = await supabase.auth.getSession();
      token = sess.session?.access_token ?? null;

      // fallback refresh
      if (!token) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        token = refreshed.session?.access_token ?? null;
      }

      if (!token) {
        router.replace("/login");
        return;
      }

      // role + display_name via /api/auth/me
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

      const { data, error } = await loadOrder(supabase, orderId);

      if (!alive) return;

      if (error) {
        console.error(error);
        setErr(error.message);
        setOrder(null);
        setLoading(false);
        return;
      }

      if (!data || !isOrderRow(data)) {
        setErr("Ordre ikke funnet.");
        setOrder(null);
        setLoading(false);
        return;
      }

      const o = data as OrderRow;

      setOrder(o);
      setStatus(String(o.status ?? "SUBMITTED"));
      setEta(o.expected_delivery_date ?? "");
      setInfo(o.delivery_info ?? "");
      setConfirmPath(o.confirmation_file_path ?? "");
      setNote(o.purchaser_note ?? "");

      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [orderId, router, supabase]);

  async function saveChanges() {
    if (!order) return;
    setErr(null);

    const nowIso = new Date().toISOString();

    // build payload (do not include undefined keys)
    const basePayload: Record<string, any> = {
      status: status || null,
      expected_delivery_date: eta || null,
      delivery_info: info || null,
      confirmation_file_path: confirmPath || null,
      purchaser_note: note || null,
    };

    const payloadWithUpdated: Record<string, any> = {
      ...basePayload,
      updated_at: nowIso,
      updated_by_name: myName || null,
    };

    let upd = await supabaseAny.from("orders").update(payloadWithUpdated).eq("id", order.id);

    if (
      upd.error &&
      (looksLikeMissingColumn(upd.error, "updated_at") ||
        looksLikeMissingColumn(upd.error, "updated_by_name"))
    ) {
      upd = await supabaseAny.from("orders").update(basePayload).eq("id", order.id);
    }

    if (upd.error) {
      console.error("orders update failed:", upd.error);
      setErr(upd.error.message);
      return;
    }

    // audit (best effort)
    try {
      const before = order;
      const diff: Record<string, { from: any; to: any }> = {};

      const patch: Partial<OrderRow> = {
        status: status || null,
        expected_delivery_date: eta || null,
        delivery_info: info || null,
        confirmation_file_path: confirmPath || null,
        purchaser_note: note || null,
      };

      const keys: Array<keyof OrderRow> = [
        "status",
        "expected_delivery_date",
        "delivery_info",
        "confirmation_file_path",
        "purchaser_note",
      ];

      for (const k of keys) {
        const from = (before as any)[k];
        const to = (patch as any)[k];
        if (from !== to) diff[String(k)] = { from, to };
      }

      if (Object.keys(diff).length > 0) {
        let ins = await supabaseAny.from("order_audit").insert({
          order_id: order.id,
          actor_name: myName || null,
          actor_email: myEmail || null,
          action: "UPDATE",
          diff,
        });

        // fallback if actor_name column doesn't exist
        if (ins.error && looksLikeMissingColumn(ins.error, "actor_name")) {
          await supabaseAny.from("order_audit").insert({
            order_id: order.id,
            actor_email: myEmail || "unknown",
            action: "UPDATE",
            diff,
          });
        }
      }
    } catch (e) {
      console.warn("audit insert failed:", e);
    }

    // refresh local order view
    const nextOrder: OrderRow = {
      ...order,
      status: status || order.status,
      expected_delivery_date: eta || null,
      delivery_info: info || null,
      confirmation_file_path: confirmPath || null,
      purchaser_note: note || null,
      updated_at: nowIso,
      updated_by_name: myName || order.updated_by_name || null,
    };

    setOrder(nextOrder);

    setToast("Lagret");
    window.setTimeout(() => setToast(null), 1000);
  }

  if (loading) return <div className="p-6">Laster…</div>;

  if (!roleOk) {
    return (
      <div className="p-6 space-y-3">
        <button className="underline" onClick={() => router.push("/products")}>
          ← Til produkter
        </button>
        <div className="rounded-lg border p-4 text-sm text-gray-700">
          Du har ikke tilgang til innkjøper-siden.
          <div className="mt-2 text-xs text-gray-500">
            Krever rolle <b>innkjøper</b> eller <b>admin</b> i allowlist.
          </div>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-6 space-y-3">
        <button className="underline" onClick={() => router.push("/purchasing")}>
          ← Til innkjøper
        </button>
        <div className="rounded-lg border p-4 text-sm text-red-700">
          {err ?? "Ordre ikke funnet."}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
          onClick={() => router.push("/purchasing")}
        >
          ← Til innkjøper
        </button>

        <div className="text-xs text-gray-500">
          {myName} · {myRole}
        </div>
      </div>

      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{order.project_name}</h1>

        <div className="text-sm text-gray-600">
          Opprettet: {formatDateTime(order.created_at)}
          {typeof ageDays === "number" ? (
            <>
              <span className="mx-2">·</span>
              Alder:{" "}
              <span
                className={cn(
                  "font-medium",
                  ageDays >= 7 ? "text-amber-700" : "text-gray-800"
                )}
                title="Alder i dager siden opprettelse"
              >
                {ageDays}d
              </span>
            </>
          ) : null}
          {overdue ? (
            <>
              <span className="mx-2">·</span>
              <span className="font-medium text-red-700">ETA passert</span>
            </>
          ) : soon ? (
            <>
              <span className="mx-2">·</span>
              <span className="font-medium text-amber-700">ETA innen 7 dager</span>
            </>
          ) : null}
        </div>

        {order.project_no ? (
          <div className="text-xs text-gray-500">Prosjekt nr: {order.project_no}</div>
        ) : null}

        <div className="text-sm text-gray-700">
          Levering: {order.delivery_address}
          {order.delivery_postcode ? `, ${order.delivery_postcode}` : ""}
          {order.delivery_city ? ` ${order.delivery_city}` : ""}
        </div>

        {order.comment ? (
          <div className="text-sm text-gray-700">
            Kommentar: <span className="font-medium">{order.comment}</span>
          </div>
        ) : null}

        {order.updated_at ? (
          <div className="text-xs text-gray-500">
            Sist endret: {formatDateTime(order.updated_at)}
            {order.updated_by_name ? ` · ${order.updated_by_name}` : ""}
          </div>
        ) : null}
      </div>

      {err ? (
        <div className="rounded-xl border bg-white px-4 py-3 text-sm text-red-700">{err}</div>
      ) : null}
      {toast ? (
        <div className="rounded-xl border bg-white px-4 py-3 text-sm text-green-700">
          {toast}
        </div>
      ) : null}

      <div className="rounded-2xl border p-4 bg-white space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            Status
            <select
              className="mt-1 w-full rounded-lg border px-3 py-2 bg-white"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            Forventet leveringsdato (YYYY-MM-DD)
            <input
              className={cn(
                "mt-1 w-full rounded-lg border px-3 py-2",
                isEtaOverdue(eta || null) ? "border-red-300" : ""
              )}
              value={eta}
              onChange={(e) => setEta(e.target.value)}
              placeholder="2026-02-28"
              inputMode="numeric"
            />
          </label>
        </div>

        <label className="text-sm block">
          Leveringsinfo (til bestiller)
          <textarea
            className="mt-1 w-full rounded-lg border px-3 py-2"
            rows={3}
            value={info}
            onChange={(e) => setInfo(e.target.value)}
          />
        </label>

        <label className="text-sm block">
          Ordrebekreftelse PDF (relativ sti)
          <input
            className="mt-1 w-full rounded-lg border px-3 py-2"
            value={confirmPath}
            onChange={(e) => setConfirmPath(e.target.value)}
            placeholder="uploads/orders/ORDER-123.pdf"
          />
          <div className="mt-1 text-xs text-gray-600">
            Legg selve PDF-en på disk under <code>C:\Internordrer\</code> i samme relative
            sti.
          </div>
        </label>

        <label className="text-sm block">
          Innkjøper-notat (internt)
          <textarea
            className="mt-1 w-full rounded-lg border px-3 py-2"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <button
          className="rounded-lg bg-black px-4 py-2 text-white hover:opacity-90"
          onClick={saveChanges}
        >
          Lagre
        </button>
      </div>

      <div className="rounded-2xl border p-4 bg-white">
        <div className="text-sm font-semibold">Tips</div>
        <div className="mt-1 text-sm text-gray-600">
          Historikk (order_audit) vises på <code>/purchasing</code> (liste-siden). Denne
          siden er ment som “ordre-detalj og redigering”.
        </div>
      </div>
    </div>
  );
}