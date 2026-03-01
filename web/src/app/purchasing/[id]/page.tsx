// file: web/src/app/purchasing/[id]/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

  expected_delivery_date: string | null; // stored as ISO-ish string/date in DB
  delivery_info: string | null;

  confirmation_file_path: string | null; // storage path
  purchaser_note: string | null;

  updated_at?: string | null;
  updated_by_name?: string | null;
};

type OrderMessageRow = {
  id: string;
  order_id: string;
  created_at: string;
  sender_email: string | null;
  sender_name: string | null;
  sender_role: Role | null;
  body: string;
};

// ✅ ADDED: Order item rows (same shape as customer side)
type OrderItemRow = {
  id: string;
  order_id: string;
  product_id: string;
  product_no: string;
  name: string;
  unit_price: number;
  qty: number;
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

function looksLikeMissingTable(err: any, table: string) {
  const msg = String(err?.message ?? "").toLowerCase();
  const t = table.toLowerCase();
  return (
    (msg.includes("does not exist") ||
      msg.includes("could not find the table") ||
      msg.includes("schema cache")) &&
    msg.includes(t)
  );
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

/** Accepts ISO date (YYYY-MM-DD) or ISO datetime and formats to DD.MM.YYYY */
function isoToNorDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = String(iso).trim();
  // already dd.mm.yyyy?
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return s;

  // try YYYY-MM-DD first
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;

  // fallback: Date parse
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return "";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = String(d.getFullYear());
    return `${dd}.${mm}.${yyyy}`;
  } catch {
    return "";
  }
}

/**
 * ✅ ADDED: Formats ETA input so mobile "numeric" keyboards work.
 * - User can type 05032026 and it becomes 05.03.2026 automatically.
 * - We still allow dots if user has them.
 */
function formatEtaInput(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}

/** Parses DD.MM.YYYY -> YYYY-MM-DD. Returns null if empty. Throws on invalid */
function norDateToIso(input: string): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  // ✅ ADDED: accept 8 digits (DDMMYYYY) as well
  const onlyDigits = raw.replace(/\D/g, "");
  if (/^\d{8}$/.test(onlyDigits)) {
    const dd = Number(onlyDigits.slice(0, 2));
    const mm = Number(onlyDigits.slice(2, 4));
    const yyyy = Number(onlyDigits.slice(4, 8));

    if (yyyy < 1900 || yyyy > 2100) throw new Error("Ugyldig årstall.");
    if (mm < 1 || mm > 12) throw new Error("Ugyldig måned.");
    if (dd < 1 || dd > 31) throw new Error("Ugyldig dag.");

    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    const ok =
      d.getUTCFullYear() === yyyy && d.getUTCMonth() === mm - 1 && d.getUTCDate() === dd;
    if (!ok) throw new Error("Datoen finnes ikke.");

    return `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(
      2,
      "0"
    )}`;
  }

  const m = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) throw new Error("Ugyldig dato. Bruk format DD.MM.YYYY (f.eks. 05.03.2026).");

  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);

  if (yyyy < 1900 || yyyy > 2100) throw new Error("Ugyldig årstall.");
  if (mm < 1 || mm > 12) throw new Error("Ugyldig måned.");
  if (dd < 1 || dd > 31) throw new Error("Ugyldig dag.");

  // real calendar validation
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  const ok =
    d.getUTCFullYear() === yyyy && d.getUTCMonth() === mm - 1 && d.getUTCDate() === dd;
  if (!ok) throw new Error("Datoen finnes ikke.");

  return `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(
    2,
    "0"
  )}`;
}

function humanRole(r: Role) {
  if (r === "innkjøper") return "Innkjøper";
  if (r === "admin") return "Admin";
  return "Kunde";
}

/**
 * Storage bucket for order confirmations.
 * Ensure this bucket exists in Supabase Storage (private or public).
 * Recommended: private bucket + signed URL.
 */
const CONFIRM_BUCKET = "order-confirmations";

// ✅ ADDED: price formatting helpers
function safeNumber(n: unknown) {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? x : 0;
}

function formatNok(value: number) {
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(value);
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
  const [etaNor, setEtaNor] = useState(""); // DD.MM.YYYY in UI
  const [info, setInfo] = useState("");
  const [confirmPath, setConfirmPath] = useState("");
  const [note, setNote] = useState("");

  const [busy, setBusy] = useState(false);

  // Upload
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [confirmSignedUrl, setConfirmSignedUrl] = useState<string | null>(null);

  // Chat
  const [chatEnabled, setChatEnabled] = useState(true);
  const [messages, setMessages] = useState<OrderMessageRow[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgErr, setMsgErr] = useState<string | null>(null);
  const [msgText, setMsgText] = useState("");
  const msgEndRef = useRef<HTMLDivElement | null>(null);

  // ✅ ADDED: Order items state
  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsErr, setItemsErr] = useState<string | null>(null);

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

      // hent ordre
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

      setEtaNor(isoToNorDate(o.expected_delivery_date));
      setInfo(o.delivery_info ?? "");
      setConfirmPath(o.confirmation_file_path ?? "");
      setNote(o.purchaser_note ?? "");

      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [id, router, supabase]);

  // ✅ ADDED: Load order items (best-effort)
  useEffect(() => {
    let alive = true;

    async function loadItems() {
      setItemsErr(null);
      setItemsLoading(true);

      try {
        const res = await supabase
          .from("order_items")
          .select("id, order_id, product_id, product_no, name, unit_price, qty")
          .eq("order_id", id)
          .order("product_no", { ascending: true });

        if (!alive) return;

        if (res.error) {
          if (looksLikeMissingTable(res.error, "order_items")) {
            setItems([]);
            setItemsErr(
              'Ordrelinjer er ikke aktivert ennå (mangler tabell "order_items"). Si fra, så legger vi SQL-migrering.'
            );
            return;
          }
          setItems([]);
          setItemsErr(res.error.message);
          return;
        }

        setItems((res.data ?? []) as OrderItemRow[]);
      } finally {
        if (alive) setItemsLoading(false);
      }
    }

    if (!id) return;

    loadItems();

    return () => {
      alive = false;
    };
  }, [id, supabase]);

  const itemsTotal = useMemo(() => {
    return (items ?? []).reduce((sum, it) => {
      return sum + safeNumber(it.qty) * safeNumber(it.unit_price);
    }, 0);
  }, [items]);

  // Signed URL for confirmation download (if private bucket)
  useEffect(() => {
    let alive = true;

    (async () => {
      setConfirmSignedUrl(null);
      if (!confirmPath) return;

      // If your system uses /api/local-file for downloads, you can swap to that here.
      // For Storage bucket, we generate signed URL:
      try {
        const { data, error } = await supabase.storage
          .from(CONFIRM_BUCKET)
          .createSignedUrl(confirmPath, 600);

        if (!alive) return;

        if (error) {
          // Don't hard-fail the page; just don't show URL
          console.warn("signedUrl failed:", error);
          setConfirmSignedUrl(null);
          return;
        }

        setConfirmSignedUrl(data?.signedUrl ?? null);
      } catch (e) {
        console.warn("signedUrl exception:", e);
        setConfirmSignedUrl(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, [confirmPath, supabase]);

  async function saveChanges() {
    if (!order) return;
    setErr(null);
    setBusy(true);

    try {
      const nowIso = new Date().toISOString();

      let etaIso: string | null = null;
      try {
        etaIso = norDateToIso(formatEtaInput(etaNor));
      } catch (e: any) {
        setErr(String(e?.message ?? "Ugyldig ETA-dato."));
        return;
      }

      const basePayload: Record<string, any> = {
        status,
        expected_delivery_date: etaIso,
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
          expected_delivery_date: etaIso,
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
              expected_delivery_date: etaIso,
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

  async function uploadConfirmationFile(file: File) {
    if (!order) return;
    setErr(null);
    setUploadBusy(true);

    try {
      const safeName = file.name.replace(/[^\w.\-()+ ]/g, "_");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const path = `orders/${order.id}/${stamp}_${safeName}`;

      const { error } = await supabase.storage.from(CONFIRM_BUCKET).upload(path, file, {
        upsert: true,
        contentType: file.type || "application/octet-stream",
      });

      if (error) {
        // Common: bucket missing
        if (String(error.message).toLowerCase().includes("bucket")) {
          setErr(
            `Upload feilet: Storage-bucket "${CONFIRM_BUCKET}" finnes ikke (eller du mangler tilgang). Lag bucketen i Supabase Storage, eller juster bucket-navnet i koden.`
          );
        } else {
          setErr(`Upload feilet: ${error.message}`);
        }
        return;
      }

      // Store path on order
      setConfirmPath(path);

      // Save immediately so customer sees it
      const nowIso = new Date().toISOString();
      const payload: Record<string, any> = {
        confirmation_file_path: path,
        updated_at: nowIso,
        updated_by_name: myName || null,
      };

      let upd = await supabaseAny.from("orders").update(payload).eq("id", order.id);

      if (
        upd.error &&
        (looksLikeMissingColumn(upd.error, "updated_by_name") ||
          looksLikeMissingColumn(upd.error, "updated_at"))
      ) {
        upd = await supabaseAny
          .from("orders")
          .update({ confirmation_file_path: path, updated_at: nowIso })
          .eq("id", order.id);
      }

      if (upd.error) {
        setErr(upd.error.message);
        return;
      }

      setOrder((prev) =>
        prev
          ? {
              ...prev,
              confirmation_file_path: path,
              updated_at: nowIso,
              updated_by_name: myName || null,
            }
          : prev
      );

      setToast("Ordrebekreftelse lastet opp");
      window.setTimeout(() => setToast(null), 1400);

      // reset input
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setUploadBusy(false);
    }
  }

  // Chat: load + realtime subscription
  useEffect(() => {
    let alive = true;

    async function loadMessages() {
      setMsgErr(null);
      setMsgLoading(true);

      try {
        const res = await supabase
          .from("order_messages")
          .select("id, order_id, created_at, sender_email, sender_name, sender_role, body")
          .eq("order_id", id)
          .order("created_at", { ascending: true });

        if (!alive) return;

        if (res.error) {
          if (looksLikeMissingTable(res.error, "order_messages")) {
            setChatEnabled(false);
            setMessages([]);
            setMsgErr(
              'Chat er ikke aktivert ennå (mangler tabell "order_messages"). Si fra, så legger vi SQL-migrering for dette.'
            );
            return;
          }
          setMsgErr(res.error.message);
          setMessages([]);
          return;
        }

        setMessages((res.data ?? []) as OrderMessageRow[]);
      } finally {
        if (alive) setMsgLoading(false);
      }
    }

    loadMessages();

    // Realtime (best-effort). Requires Realtime enabled for table.
    const channel = supabase
      .channel(`order_messages:${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "order_messages", filter: `order_id=eq.${id}` },
        (payload) => {
          const row = payload.new as any;
          if (!row?.id) return;

          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            return [...prev, row as OrderMessageRow];
          });
        }
      )
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [id, supabase]);

  useEffect(() => {
    // auto-scroll chat to bottom
    if (!msgEndRef.current) return;
    msgEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  async function sendMessage() {
    if (!chatEnabled) return;
    const body = msgText.trim();
    if (!body) return;

    setMsgErr(null);

    try {
      const ins = await supabase.from("order_messages").insert({
        order_id: id,
        body,
        sender_email: myEmail || null,
        sender_name: myName || null,
        sender_role: myRole || null,
      });

      if (ins.error) {
        if (looksLikeMissingTable(ins.error, "order_messages")) {
          setChatEnabled(false);
          setMsgErr(
            'Chat er ikke aktivert ennå (mangler tabell "order_messages"). Si fra, så legger vi SQL-migrering for dette.'
          );
          return;
        }
        setMsgErr(ins.error.message);
        return;
      }

      setMsgText("");
      // optimistic update is not necessary if realtime is enabled, but keep a safety fetch-less UX:
      // if realtime isn't working, we can append a local echo by refetching minimal:
      // We'll just append locally if no realtime arrives soon.
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          order_id: id,
          created_at: new Date().toISOString(),
          sender_email: myEmail || null,
          sender_name: myName || null,
          sender_role: myRole || null,
          body,
        },
      ]);
    } catch (e: any) {
      setMsgErr(String(e?.message ?? "Ukjent feil ved sending."));
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
            {myName || myEmail} · {humanRole(myRole)}
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

        {/* Order card */}
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

          {/* ✅ ADDED: Customer comment visible on purchasing page (same as orders/[id]) */}
          {order.comment ? (
            <section
              className={cn(
                "rounded-2xl border p-4 md:p-5 space-y-2",
                "border-gray-800 bg-gray-950/40 md:border-gray-200 md:bg-gray-50"
              )}
            >
              <h2 className="font-semibold text-gray-100 md:text-gray-900">Kommentar fra kunde</h2>
              <p className="text-sm text-gray-200 md:text-gray-800 whitespace-pre-line">
                {order.comment}
              </p>
            </section>
          ) : null}

          {/* ✅ ADDED: Order items + total + per-product button */}
          <div
            className={cn(
              "rounded-2xl border p-4 space-y-3",
              "border-gray-800 bg-gray-950/40 md:border-gray-200 md:bg-gray-50"
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-gray-100 md:text-gray-900">
                Ordrelinjer
              </div>
              <div className="text-xs text-gray-300 md:text-gray-600">
                Totalt:{" "}
                <span className="font-semibold text-gray-100 md:text-gray-900">
                  {formatNok(itemsTotal)}
                </span>
              </div>
            </div>

            {itemsErr ? (
              <div className="rounded-xl border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-200 md:border-amber-200 md:bg-white md:text-amber-800">
                {itemsErr}
              </div>
            ) : null}

            {itemsLoading ? (
              <div className="text-sm text-gray-400 md:text-gray-600">Laster ordrelinjer…</div>
            ) : items.length === 0 ? (
              <div className="text-sm text-gray-400 md:text-gray-600">
                Ingen ordrelinjer funnet.
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((it) => {
                  const lineTotal = safeNumber(it.qty) * safeNumber(it.unit_price);
                  return (
                    <div
                      key={it.id}
                      className={cn(
                        "rounded-xl border px-3 py-2",
                        "border-gray-800 bg-gray-900/30 md:border-gray-200 md:bg-white"
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs text-gray-400 md:text-gray-500 font-mono">
                            {it.product_no}
                          </div>
                          <div className="text-sm text-gray-100 md:text-gray-900 truncate">
                            {it.name}
                          </div>
                          <div className="mt-1 text-xs text-gray-300 md:text-gray-600">
                            Antall: <span className="font-medium">{it.qty}</span> · Enhetspris:{" "}
                            <span className="font-medium">{formatNok(safeNumber(it.unit_price))}</span>
                          </div>
                        </div>

                        <div className="shrink-0 text-right space-y-2">
                          <div className="text-sm font-semibold text-gray-100 md:text-gray-900">
                            {formatNok(lineTotal)}
                          </div>

                          <button
                            className={cn(
                              "rounded-lg border px-3 py-2 text-sm",
                              "border-gray-700 hover:bg-gray-900 md:border-gray-300 md:hover:bg-gray-50"
                            )}
                            onClick={() => {
                              // NOTE: adjust route if customer side uses a different product route
                              router.push(`/products/${it.product_id}`);
                            }}
                            title="Åpne produkt"
                          >
                            Åpne produkt
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
              ETA (DD.MM.YYYY)
              <input
                className={cn(
                  "mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none",
                  "border-gray-700 bg-gray-950 text-gray-100 placeholder:text-gray-500 focus:border-gray-500",
                  "md:border-gray-300 md:bg-white md:text-gray-900 md:placeholder:text-gray-400"
                )}
                value={etaNor}
                onChange={(e) => setEtaNor(formatEtaInput(e.target.value))}
                onBlur={() => setEtaNor(formatEtaInput(etaNor))}
                placeholder="05.03.2026"
                inputMode="numeric"
                autoComplete="off"
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

            {/* ✅ Restore: upload order confirmation */}
            <div className="space-y-2">
              <div className="text-sm font-medium">Ordrebekreftelse</div>

              {confirmPath ? (
                <div className="text-xs text-gray-400 md:text-gray-600 break-words">
                  Lagringssti: <span className="font-mono">{confirmPath}</span>
                </div>
              ) : (
                <div className="text-xs text-gray-400 md:text-gray-600">
                  Ingen ordrebekreftelse lastet opp.
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,image/*"
                  className={cn(
                    "block w-full text-sm",
                    "file:mr-3 file:rounded-lg file:border-0 file:px-3 file:py-2 file:text-sm file:font-medium",
                    "file:bg-white/10 file:text-gray-100 hover:file:bg-white/15",
                    "md:file:bg-black md:file:text-white md:hover:file:opacity-90"
                  )}
                  disabled={uploadBusy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadConfirmationFile(f);
                  }}
                />

                {confirmSignedUrl ? (
                  <a
                    href={confirmSignedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      "rounded-lg px-3 py-2 text-sm font-medium",
                      "bg-white/10 hover:bg-white/15 md:bg-black md:text-white md:hover:opacity-90"
                    )}
                  >
                    Last ned
                  </a>
                ) : null}
              </div>

              <div className="text-[11px] text-gray-500 md:text-gray-500">
                Lagrer i Supabase Storage-bucket:{" "}
                <span className="font-mono">{CONFIRM_BUCKET}</span>
              </div>
            </div>

            {/* ✅ REMOVED: Innkjøpernotat (internt) — replaced by chat */}
            {/* NOTE: We keep state/DB field intact (purchaser_note), but hide the UI input as requested. */}

            <button
              disabled={busy}
              onClick={saveChanges}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50",
                "transition-colors",
                "bg-white/10 hover:bg-white/15 text-gray-100",
                "md:bg-black md:text-white md:hover:bg-black/90"
              )}
            >
              {busy ? "Lagrer…" : "Lagre endringer"}
            </button>
          </div>
        </div>

        {/* Chat */}
        <div
          className={cn(
            "rounded-2xl border p-4 space-y-3",
            "border-gray-800 bg-gray-900/40 md:border-gray-200 md:bg-white"
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="text-lg font-semibold">Internchat</div>
            <div className="text-xs text-gray-400 md:text-gray-500">Chat gjelder kun denne ordren</div>
          </div>

          {!chatEnabled ? (
            <div className="rounded-xl border border-amber-700/40 bg-amber-950/40 px-4 py-3 text-sm text-amber-200 md:border-amber-200 md:bg-white md:text-amber-800">
              {msgErr ??
                'Chat er ikke aktivert ennå. Opprett tabell "order_messages" i databasen, så fungerer dette.'}
            </div>
          ) : null}

          {msgErr && chatEnabled ? (
            <div className="rounded-xl border border-red-700/40 bg-red-950/40 px-4 py-3 text-sm text-red-200 md:border-red-200 md:bg-white md:text-red-700">
              {msgErr}
            </div>
          ) : null}

          <div
            className={cn(
              "rounded-xl border p-3",
              "border-gray-800 bg-gray-950 md:border-gray-200 md:bg-gray-50"
            )}
            style={{ maxHeight: 340, overflow: "auto" }}
          >
            {msgLoading ? (
              <div className="text-sm text-gray-400 md:text-gray-600">Laster meldinger…</div>
            ) : messages.length === 0 ? (
              <div className="text-sm text-gray-400 md:text-gray-600">
                Ingen meldinger enda. Start en samtale.
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((m) => {
                  const isMe = normEmail(m.sender_email) === normEmail(myEmail);
                  const who = m.sender_name || m.sender_email || "Ukjent";
                  const role = (m.sender_role as Role | null) ?? null;
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "rounded-xl border px-3 py-2",
                        isMe
                          ? "border-emerald-700/40 bg-emerald-950/30 md:border-emerald-200 md:bg-white"
                          : "border-gray-800 bg-gray-900 md:border-gray-200 md:bg-white"
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs text-gray-300 md:text-gray-600">
                          <span className="font-medium text-gray-100 md:text-gray-900">{who}</span>
                          {role ? (
                            <span className="ml-2 text-[11px] text-gray-400 md:text-gray-500">
                              · {humanRole(role)}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[11px] text-gray-400 md:text-gray-500">
                          {formatDateTime(m.created_at)}
                        </div>
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-sm text-gray-100 md:text-gray-900">
                        {m.body}
                      </div>
                    </div>
                  );
                })}
                <div ref={msgEndRef} />
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <textarea
              rows={2}
              value={msgText}
              onChange={(e) => setMsgText(e.target.value)}
              placeholder="Skriv en melding…"
              className={cn(
                "flex-1 rounded-xl border px-3 py-2 text-sm outline-none",
                "border-gray-700 bg-gray-950 text-gray-100 placeholder:text-gray-500 focus:border-gray-500",
                "md:border-gray-300 md:bg-white md:text-gray-900 md:placeholder:text-gray-400"
              )}
              disabled={!chatEnabled}
            />
            <button
              onClick={sendMessage}
              disabled={!chatEnabled || !msgText.trim()}
              className={cn(
                "shrink-0 rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50",
                "bg-white/10 hover:bg-white/15 md:bg-black md:text-white md:hover:opacity-90"
              )}
              title="Send"
            >
              Send
            </button>
          </div>

          <div className="text-[11px] text-gray-500 md:text-gray-500">
            NB: For at chat skal fungere må databasen ha tabell{" "}
            <span className="font-mono">order_messages</span>.
          </div>
        </div>

        <div className="text-xs text-gray-400 md:text-gray-500">
          Status-visning: <span className="font-medium">{STATUS_LABEL[status]}</span>
        </div>
      </div>
    </div>
  );
}   