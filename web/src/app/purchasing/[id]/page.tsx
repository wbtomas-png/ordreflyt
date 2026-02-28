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

function formatDateOnly(value: string | null | undefined) {
  if (!value) return "";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return String(value);
  return d.toLocaleDateString("nb-NO");
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

  const [myEmail, setMyEmail] = useState("");
  const [myName, setMyName] = useState("");
  const [myRole, setMyRole] = useState<Role>("kunde");

  const roleOk = myRole === "admin" || myRole === "innkjøper";

  const [order, setOrder] = useState<OrderRow | null>(null);

  const [status, setStatus] = useState<(typeof STATUSES)[number]>("SUBMITTED");
  const [eta, setEta] = useState("");
  const [info, setInfo] = useState("");
  const [confirmPath, setConfirmPath] = useState("");
  const [note, setNote] = useState("");

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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

      // hent ordre (bruk maybeSingle + runtime guard)
      const sel = [
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

      const res = await supabase.from("orders").select(sel).eq("id", id).maybeSingle();

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

      const st = (String(o.status || "SUBMITTED") as any) as (typeof STATUSES)[number];
      setStatus((STATUSES as readonly string[]).includes(st) ? st : "SUBMITTED");

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
        status: status || "SUBMITTED",
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
          status: status || "SUBMITTED",
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

      setToast("Lagret");
      window.setTimeout(() => setToast(null), 1200);

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
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-600">Laster…</p>
      </div>
    );
  }

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

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
          onClick={() => router.push("/purchasing")}
        >
          ← Tilbake til innkjøperliste
        </button>

        <div className="text-xs text-gray-500">
          {myName} · {myRole} · {myEmail}
        </div>
      </div>

      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{order.project_name}</h1>
        <div className="text-sm text-gray-600">
          Opprettet: {formatDateOnly(order.created_at)}
          {order.project_no ? ` · Prosjekt nr: ${order.project_no}` : ""}
        </div>
      </div>

      {err ? (
        <div className="rounded-xl border bg-white px-4 py-3 text-sm text-red-700">{err}</div>
      ) : null}
      {toast ? (
        <div className="rounded-xl border bg-white px-4 py-3 text-sm text-green-700">{toast}</div>
      ) : null}

      <div className="grid gap-4 rounded-xl border p-4 bg-white">
        <label className="text-sm">
          Status
          <select
            className="mt-1 w-full rounded-lg border px-3 py-2 bg-white"
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
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
            className={cn("mt-1 w-full rounded-lg border px-3 py-2")}
            value={eta}
            onChange={(e) => setEta(e.target.value)}
            placeholder="2026-02-28"
            inputMode="numeric"
          />
        </label>

        <label className="text-sm">
          Leveringsinfo (til bestiller)
          <textarea
            className="mt-1 w-full rounded-lg border px-3 py-2"
            rows={3}
            value={info}
            onChange={(e) => setInfo(e.target.value)}
          />
        </label>

        <label className="text-sm">
          Ordrebekreftelse sti (relativ)
          <input
            className="mt-1 w-full rounded-lg border px-3 py-2"
            value={confirmPath}
            onChange={(e) => setConfirmPath(e.target.value)}
            placeholder="uploads/orders/ORDER-123.pdf"
          />
          <div className="mt-1 text-xs text-gray-600">
            (Dette er fortsatt “local-file”-opplegget ditt. Senere kan vi bytte til Supabase Storage.)
          </div>
        </label>

        <label className="text-sm">
          Innkjøpernotat (internt)
          <textarea
            className="mt-1 w-full rounded-lg border px-3 py-2"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <button
          disabled={busy}
          onClick={saveChanges}
          className="rounded-lg bg-black px-4 py-2 text-white disabled:opacity-50 hover:opacity-90"
        >
          {busy ? "Lagrer…" : "Lagre endringer"}
        </button>
      </div>
    </div>
  );
}