// file: web/src/app/purchasing/page.tsx
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

async function loadOrders(supabase: ReturnType<typeof supabaseBrowser>) {
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

  let res = await supabase
    .from("orders")
    .select(withUpdated)
    .order("created_at", { ascending: false });

  if (
    res.error &&
    (looksLikeMissingColumn(res.error, "updated_at") ||
      looksLikeMissingColumn(res.error, "updated_by_name"))
  ) {
    res = await supabase
      .from("orders")
      .select(base)
      .order("created_at", { ascending: false });
  }

  return res;
}

export default function PurchasingPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [myEmail, setMyEmail] = useState("");
  const [myName, setMyName] = useState("");
  const [myRole, setMyRole] = useState<Role>("kunde");

  const roleOk = myRole === "admin" || myRole === "innkjøper";

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    (typeof STATUSES)[number] | "ALL"
  >("ALL");
  const [queueMode, setQueueMode] = useState<"OPEN" | "ALL">("OPEN");

  const [auditByOrderId, setAuditByOrderId] = useState<
    Record<string, OrderAuditRow[]>
  >({});
  const [auditBusyId, setAuditBusyId] = useState<string | null>(null);

  const [err, setErr] = useState<string | null>(null);
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

      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
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

      const { data, error } = await loadOrders(supabase);

      if (!alive) return;

      if (error) {
        console.error(error);
        setErr(error.message);
        setRows([]);
        setLoading(false);
        return;
      }

            const rawUnknown = (data ?? []) as unknown[];

      const cleaned: OrderRow[] = Array.isArray(rawUnknown)
        ? rawUnknown
            .filter((x) => {
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
            })
            .map((x) => x as OrderRow)
        : [];

      setRows(cleaned);
      setRows(cleaned);
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [router, supabase]);

  const filtered = useMemo(() => {
    let list = [...rows];

    if (queueMode === "OPEN") {
      const closed = new Set(["DELIVERED", "CANCELLED"]);
      list = list.filter((o) => !closed.has(String(o.status ?? "")));
    }

    if (statusFilter !== "ALL") {
      list = list.filter((o) => String(o.status) === statusFilter);
    }

    const s = q.trim().toLowerCase();
    if (s) {
      list = list.filter((o) => {
        const hay = [
          o.project_name,
          o.project_no ?? "",
          o.contact_name ?? "",
          o.contact_email ?? "",
          o.id,
          o.delivery_city ?? "",
        ]
          .join(" ")
          .toLowerCase();

        return hay.includes(s);
      });
    }

    const prio = (st: string) => {
      if (st === "SUBMITTED") return 0;
      if (st === "IN_REVIEW") return 1;
      if (st === "ORDERED") return 2;
      if (st === "CONFIRMED") return 3;
      if (st === "SHIPPING") return 4;
      if (st === "DELIVERED") return 5;
      if (st === "CANCELLED") return 6;
      return 99;
    };

    list.sort((a, b) => {
      const pa = prio(String(a.status));
      const pb = prio(String(b.status));
      if (pa !== pb) return pa - pb;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

    return list;
  }, [rows, q, statusFilter, queueMode]);

  async function updateOrder(
    id: string,
    patch: Partial<OrderRow>,
    before?: OrderRow
  ) {
    setErr(null);

    const nowIso = new Date().toISOString();

    const payloadWithUpdated: any = {
      status: patch.status,
      expected_delivery_date: patch.expected_delivery_date,
      delivery_info: patch.delivery_info,
      confirmation_file_path: patch.confirmation_file_path,
      purchaser_note: patch.purchaser_note,
      updated_at: nowIso,
      updated_by_name: myName || null,
    };

    let upd = await supabase.from("orders").update(payloadWithUpdated).eq("id", id);

    if (
      upd.error &&
      (looksLikeMissingColumn(upd.error, "updated_at") ||
        looksLikeMissingColumn(upd.error, "updated_by_name"))
    ) {
      const payloadBase: any = {
        status: patch.status,
        expected_delivery_date: patch.expected_delivery_date,
        delivery_info: patch.delivery_info,
        confirmation_file_path: patch.confirmation_file_path,
        purchaser_note: patch.purchaser_note,
      };
      upd = await supabase.from("orders").update(payloadBase).eq("id", id);
    }

    if (upd.error) {
      alert(upd.error.message);
      return;
    }

    // audit (best effort)
    try {
      const diff: Record<string, { from: any; to: any }> = {};
      const keys: Array<keyof OrderRow> = [
        "status",
        "expected_delivery_date",
        "delivery_info",
        "confirmation_file_path",
        "purchaser_note",
      ];

      for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) {
          const from = (before as any)?.[k];
          const to = (patch as any)?.[k];
          if (from !== to) diff[String(k)] = { from, to };
        }
      }

      if (Object.keys(diff).length > 0) {
        let ins = await supabase.from("order_audit").insert({
          order_id: id,
          actor_name: myName || null,
          actor_email: myEmail || null,
          action: "UPDATE",
          diff,
        } as any);

        if (ins.error && looksLikeMissingColumn(ins.error, "actor_name")) {
          await supabase.from("order_audit").insert({
            order_id: id,
            actor_email: myEmail || "unknown",
            action: "UPDATE",
            diff,
          } as any);
        }
      }
    } catch (e) {
      console.warn("audit insert failed:", e);
    }

    setRows((prev) =>
      prev.map((x) =>
        x.id === id
          ? { ...x, ...patch, updated_at: nowIso, updated_by_name: myName }
          : x
      )
    );

    setToast("Lagret");
    setTimeout(() => setToast(null), 1000);
  }

    async function loadAudit(orderId: string) {
    setErr(null);
    setAuditBusyId(orderId);

    try {
      // Forsøk 1: med actor_name
      const resWithName = await supabase
        .from("order_audit")
        .select("id, order_id, created_at, actor_name, actor_email, action, diff")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false })
        .limit(5);

      // Hvis OK -> bruk den
      if (!resWithName.error) {
        setAuditByOrderId((prev) => ({
          ...prev,
          [orderId]: (resWithName.data ?? []) as any,
        }));
        return;
      }

      // Hvis feilen skyldes manglende kolonne -> fallback uten actor_name
      if (looksLikeMissingColumn(resWithName.error, "actor_name")) {
        const resNoName = await supabase
          .from("order_audit")
          .select("id, order_id, created_at, actor_email, action, diff")
          .eq("order_id", orderId)
          .order("created_at", { ascending: false })
          .limit(5);

        if (resNoName.error) {
          const msg = String(resNoName.error.message ?? "");
          if (msg.toLowerCase().includes("does not exist")) {
            setErr("Audit-tabellen finnes ikke enda. Kjør SQL-en for order_audit.");
          } else {
            setErr(resNoName.error.message);
          }
          return;
        }

        setAuditByOrderId((prev) => ({
          ...prev,
          [orderId]: (resNoName.data ?? []) as any,
        }));
        return;
      }

      // Annen feil enn manglende kolonne
      const msg = String(resWithName.error.message ?? "");
      if (msg.toLowerCase().includes("does not exist")) {
        setErr("Audit-tabellen finnes ikke enda. Kjør SQL-en for order_audit.");
      } else {
        setErr(resWithName.error.message);
      }
    } finally {
      setAuditBusyId(null);
    }
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

  const openCount = rows.filter(
    (o) => !["DELIVERED", "CANCELLED"].includes(String(o.status))
  ).length;
  const overdueCount = rows.filter((o) =>
    isEtaOverdue(o.expected_delivery_date)
  ).length;
  const soonCount = rows.filter((o) => isEtaSoon(o.expected_delivery_date, 7)).length;

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
          onClick={() => router.push("/orders")}
        >
          ← Mine ordre
        </button>

        <div className="text-xs text-gray-500">
          {myName} · {myRole}
        </div>
      </div>

      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Innkjøper – Innkommende ordre</h1>
        <div className="text-sm text-gray-600">
          Åpne: <span className="font-medium text-gray-800">{openCount}</span>
          <span className="mx-2">·</span>
          ETA passert:{" "}
          <span
            className={cn(
              "font-medium",
              overdueCount ? "text-red-700" : "text-gray-800"
            )}
          >
            {overdueCount}
          </span>
          <span className="mx-2">·</span>
          ETA innen 7 dager:{" "}
          <span
            className={cn(
              "font-medium",
              soonCount ? "text-amber-700" : "text-gray-800"
            )}
          >
            {soonCount}
          </span>
        </div>
      </div>

      {err ? (
        <div className="rounded-xl border bg-white px-4 py-3 text-sm text-red-700">
          {err}
        </div>
      ) : null}
      {toast ? (
        <div className="rounded-xl border bg-white px-4 py-3 text-sm text-green-700">
          {toast}
        </div>
      ) : null}

      <div className="rounded-2xl border p-4 bg-white space-y-3">
        <div className="grid gap-3 md:grid-cols-[1fr_220px_220px]">
          <div>
            <label className="block text-xs font-medium text-gray-600">Søk</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Prosjekt, prosjekt nr, e-post, navn, ordre-id…"
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-gray-400"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600">Status</label>
            <select
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white outline-none focus:border-gray-400"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
            >
              <option value="ALL">Alle</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600">Arbeidskø</label>
            <select
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white outline-none focus:border-gray-400"
              value={queueMode}
              onChange={(e) => setQueueMode(e.target.value as any)}
            >
              <option value="OPEN">Åpne (ikke levert/avbrutt)</option>
              <option value="ALL">Alle</option>
            </select>
          </div>
        </div>

        <div className="text-xs text-gray-500">
          Sortering: viktigst først (Submitted/In review) og deretter eldste.
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border p-4 text-sm text-gray-600">Ingen ordrer.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((o) => (
            <OrderCard
              key={o.id}
              o={o}
              onSave={updateOrder}
              onLoadAudit={loadAudit}
              audit={auditByOrderId[o.id] ?? null}
              auditBusy={auditBusyId === o.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OrderCard({
  o,
  onSave,
  onLoadAudit,
  audit,
  auditBusy,
}: {
  o: OrderRow;
  onSave: (id: string, patch: Partial<OrderRow>, before?: OrderRow) => Promise<void>;
  onLoadAudit: (orderId: string) => Promise<void>;
  audit: OrderAuditRow[] | null;
  auditBusy: boolean;
}) {
  const router = useRouter();

  const [status, setStatus] = useState<string>(o.status);
  const [eta, setEta] = useState<string>(o.expected_delivery_date ?? "");
  const [info, setInfo] = useState<string>(o.delivery_info ?? "");
  const [confirmPath, setConfirmPath] = useState<string>(o.confirmation_file_path ?? "");
  const [note, setNote] = useState<string>(o.purchaser_note ?? "");
  const [busy, setBusy] = useState(false);

  const ageDays = daysSince(o.created_at);
  const overdue = isEtaOverdue(o.expected_delivery_date);
  const soon = isEtaSoon(o.expected_delivery_date, 7);

  useEffect(() => {
    setStatus(o.status);
    setEta(o.expected_delivery_date ?? "");
    setInfo(o.delivery_info ?? "");
    setConfirmPath(o.confirmation_file_path ?? "");
    setNote(o.purchaser_note ?? "");
  }, [
    o.id,
    o.status,
    o.expected_delivery_date,
    o.delivery_info,
    o.confirmation_file_path,
    o.purchaser_note,
  ]);

  return (
    <div className="rounded-xl border p-4 space-y-3 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm text-gray-600">{formatDateTime(o.created_at)}</div>

          <div className="flex items-center gap-2">
            <div className="font-semibold">{o.project_name}</div>

            {typeof ageDays === "number" ? (
              <span
                className={cn(
                  "text-xs rounded-full border px-2 py-0.5",
                  ageDays >= 7 ? "border-amber-300 text-amber-800" : "text-gray-600"
                )}
                title="Alder i dager siden opprettelse"
              >
                {ageDays}d
              </span>
            ) : null}

            {overdue ? (
              <span className="text-xs rounded-full border border-red-300 px-2 py-0.5 text-red-800">
                ETA passert
              </span>
            ) : soon ? (
              <span className="text-xs rounded-full border border-amber-300 px-2 py-0.5 text-amber-800">
                ETA snart
              </span>
            ) : null}
          </div>

          {o.project_no ? (
            <div className="text-xs text-gray-500">Prosjekt nr: {o.project_no}</div>
          ) : null}

          <div className="text-sm text-gray-700">
            Levering: {o.delivery_address}
            {o.delivery_postcode ? `, ${o.delivery_postcode}` : ""}
            {o.delivery_city ? ` ${o.delivery_city}` : ""}
          </div>

          {o.comment ? (
            <div className="text-sm text-gray-700">
              Kommentar: <span className="font-medium">{o.comment}</span>
            </div>
          ) : null}

          {o.updated_at ? (
            <div className="text-xs text-gray-500">
              Sist endret: {formatDateTime(o.updated_at)}
              {o.updated_by_name ? ` · ${o.updated_by_name}` : ""}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={() => router.push(`/purchasing/${o.id}`)}
          >
            Åpne ordre
          </button>

          <button
            className="rounded-lg bg-black px-3 py-2 text-white text-sm hover:opacity-90 disabled:opacity-50"
            onClick={() => onLoadAudit(o.id)}
            disabled={auditBusy}
            title="Vis siste endringer"
          >
            {auditBusy ? "Henter…" : "Historikk"}
          </button>
        </div>
      </div>

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
          Legg selve PDF-en på disk under <code>C:\Internordrer\</code> i samme relative sti.
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

      {audit ? (
        <div className="rounded-xl border bg-gray-50 p-3 space-y-2">
          <div className="text-sm font-semibold">Siste endringer</div>

          {audit.length === 0 ? (
            <div className="text-sm text-gray-600">Ingen historikk.</div>
          ) : (
            <ul className="space-y-2">
              {audit.map((a) => (
                <li key={a.id} className="text-xs text-gray-700">
                  <div className="text-gray-500">
                    {formatDateTime(a.created_at)} ·{" "}
                    {a.actor_name?.trim()
                      ? a.actor_name
                      : a.actor_email?.trim()
                      ? a.actor_email
                      : "ukjent"}
                  </div>

                  <pre className="mt-1 overflow-x-auto rounded-lg border bg-white p-2 text-[11px] leading-4 whitespace-pre">
                    {JSON.stringify(a.diff, null, 2)}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <button
        disabled={busy}
        className="rounded-lg bg-black px-4 py-2 text-white disabled:opacity-50 hover:opacity-90"
        onClick={async () => {
          setBusy(true);
          try {
            const before: OrderRow = { ...o };
            await onSave(
              o.id,
              {
                status,
                expected_delivery_date: eta || null,
                delivery_info: info || null,
                confirmation_file_path: confirmPath || null,
                purchaser_note: note || null,
              },
              before
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Lagrer…" : "Lagre"}
      </button>
    </div>
  );
}