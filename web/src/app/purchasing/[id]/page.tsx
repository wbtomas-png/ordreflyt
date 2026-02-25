// file: web/src/app/purchasing/[id]/page.tsx
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
};

type OrderItemRow = {
  id: string;
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

function makeStoragePath(orderId: string, file: File) {
  const ext = (file.name.split(".").pop() || "pdf").toLowerCase();
  return `orders/${orderId}/confirmation.${ext}`;
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

export default function PurchasingOrderDetailsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const orderId = params?.id;

  const [loading, setLoading] = useState(true);
  const [roleOk, setRoleOk] = useState<boolean | null>(null);

  const [order, setOrder] = useState<OrderRow | null>(null);
  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [status, setStatus] = useState<string>("SUBMITTED");
  const [eta, setEta] = useState<string>("");
  const [info, setInfo] = useState<string>("");
  const [confirmPath, setConfirmPath] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const [saving, setSaving] = useState(false);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setErrorMsg(null);

      if (!orderId) {
        setRoleOk(false);
        setOrder(null);
        setItems([]);
        setErrorMsg("Mangler ordre-id i URL.");
        setLoading(false);
        return;
      }

      // 1) Må være innlogget
      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) {
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

      // 3) Rolle-sjekk via server (samme gate som resten av systemet)
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

        const role = (String(me.role ?? "kunde") as Role) ?? "kunde";
        const ok = role === "admin" || role === "innkjøper";

        if (!alive) return;

        setRoleOk(ok);

        if (!ok) {
          setOrder(null);
          setItems([]);
          setLoading(false);
          return;
        }
      } catch {
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }

      // 4) Last ordre (bruk maybeSingle + type guard)
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
            "purchaser_note",
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

      setStatus(o.status ?? "SUBMITTED");
      setEta(o.expected_delivery_date ?? "");
      setInfo(o.delivery_info ?? "");
      setConfirmPath(o.confirmation_file_path ?? "");
      setNote(o.purchaser_note ?? "");

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

  async function save() {
    if (!order) return;

    setSaving(true);
    setErrorMsg(null);

    const { error } = await supabase
      .from("orders")
      .update({
        status,
        expected_delivery_date: eta || null,
        delivery_info: info || null,
        confirmation_file_path: confirmPath || null,
        purchaser_note: note || null,
      })
      .eq("id", order.id);

    setSaving(false);

    if (error) {
      alert(error.message);
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
          }
        : prev
    );

    alert("Lagret.");
  }

  async function uploadConfirmationPdf() {
    if (!order) return;
    if (!uploadFile) return alert("Velg en PDF først.");

    setUploading(true);
    setErrorMsg(null);

    const path = makeStoragePath(order.id, uploadFile);

    const { error: upErr } = await supabase.storage
      .from("order-confirmations")
      .upload(path, uploadFile, {
        upsert: true,
        contentType: uploadFile.type || "application/pdf",
      });

    if (upErr) {
      console.error(upErr);
      alert(`Opplasting feilet: ${upErr.message}`);
      setUploading(false);
      return;
    }

    const nextStatus = status === "SUBMITTED" ? "CONFIRMED" : status;

    const { error: dbErr } = await supabase
      .from("orders")
      .update({
        confirmation_file_path: path,
        status: nextStatus,
      })
      .eq("id", order.id);

    setUploading(false);

    if (dbErr) {
      console.error(dbErr);
      alert(`Kunne ikke lagre filreferanse på ordren: ${dbErr.message}`);
      return;
    }

    setConfirmPath(path);
    setStatus(nextStatus);

    setOrder((prev) =>
      prev ? { ...prev, confirmation_file_path: path, status: nextStatus } : prev
    );

    setUploadFile(null);

    alert("Ordrebekreftelse lastet opp og lagret.");
  }

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Innkjøper</h1>
        <p className="mt-2 text-sm text-gray-600">Laster…</p>
      </div>
    );
  }

  if (!roleOk) {
    return (
      <div className="p-6 space-y-3">
        <button
          className="rounded-lg border px-3 py-2 hover:bg-gray-50"
          onClick={() => router.push("/orders")}
        >
          ← Mine ordre
        </button>
        <div className="rounded-xl border p-5 text-sm text-gray-700">
          Du har ikke innkjøper-tilgang. Rollen må være <b>innkjøper</b> eller{" "}
          <b>admin</b>.
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-6 space-y-3">
        <button
          className="rounded-lg border px-3 py-2 hover:bg-gray-50"
          onClick={() => router.push("/purchasing")}
        >
          ← Tilbake
        </button>
        <div className="rounded-xl border p-5 text-sm text-gray-700">
          {errorMsg ?? "Fant ikke ordren."}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <button
          className="rounded-lg border px-3 py-2 hover:bg-gray-50"
          onClick={() => router.push("/purchasing")}
        >
          ← Innkjøperoversikt
        </button>

        <div className="flex items-center gap-2">
          <button
            className="rounded-lg border px-3 py-2 hover:bg-gray-50"
            onClick={() => router.push(`/orders/${order.id}`)}
          >
            Se bestillers visning
          </button>
        </div>
      </header>

      {/* Header-card */}
      <div className="rounded-2xl border p-5">
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

            <div className="text-sm">
              Status: <span className="font-medium">{status}</span>
            </div>

            <div className="text-sm">
              Sum: <span className="font-semibold">{formatNok(total)}</span>
            </div>
          </div>

          <div className="flex flex-col items-start gap-2">
            {confirmPath ? (
              <div className="rounded-lg border px-4 py-2 text-sm text-gray-700">
                Ordrebekreftelse er lastet opp.
                <div className="mt-1 text-xs text-gray-500">
                  Storage-path: <code>{confirmPath}</code>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border px-4 py-2 text-sm text-gray-600">
                Ingen ordrebekreftelse
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Kontakt + levering */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border p-5 space-y-2">
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
                <span className="text-gray-600">E-post:</span>{" "}
                {order.contact_email}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border p-5 space-y-2">
          <h2 className="font-semibold">Levering</h2>
          <div className="text-sm text-gray-800 space-y-1">
            <div className="whitespace-pre-line">{order.delivery_address}</div>
            <div>
              {[order.delivery_postcode, order.delivery_city].filter(Boolean).join(" ")}
            </div>
          </div>

          {order.comment && (
            <div className="mt-2 text-sm text-gray-700 whitespace-pre-line">
              <span className="text-gray-600">Kommentar:</span>{" "}
              <span className="font-medium">{order.comment}</span>
            </div>
          )}
        </section>
      </div>

      {/* Linjer */}
      <section className="rounded-2xl border p-5 space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="font-semibold">Ordrelinjer</h2>
          <div className="text-sm text-gray-600">{items.length} linje(r)</div>
        </div>

        {items.length === 0 ? (
          <div className="rounded-lg border p-4 text-sm text-gray-600">
            Ingen ordrelinjer.
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

      {/* Behandling */}
      <section className="rounded-2xl border p-5 space-y-4">
        <h2 className="font-semibold">Behandling</h2>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            Status
            <select
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            Forventet leveringsdato (YYYY-MM-DD)
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={eta}
              onChange={(e) => setEta(e.target.value)}
              placeholder="2026-02-28"
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

        <div className="rounded-xl border p-4 space-y-2">
          <div className="text-sm font-medium">Ordrebekreftelse (PDF)</div>

          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm"
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              disabled={uploading || !uploadFile}
              className="rounded-lg bg-black px-4 py-2 text-white disabled:opacity-50"
              onClick={uploadConfirmationPdf}
            >
              {uploading ? "Laster opp…" : "Last opp PDF"}
            </button>

            {confirmPath && (
              <div className="text-xs text-gray-600">
                Lagringssti: <code>{confirmPath}</code>
              </div>
            )}
          </div>

          <div className="text-xs text-gray-600">
            PDF lagres i Supabase Storage (privat). Neste steg: bestiller laster ned via signed link.
          </div>
        </div>

        <label className="text-sm block">
          Innkjøper-notat (internt)
          <textarea
            className="mt-1 w-full rounded-lg border px-3 py-2"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <div className="flex flex-col gap-2">
          <button
            disabled={saving}
            className="w-full rounded-lg bg-black px-4 py-2 text-white disabled:opacity-50"
            onClick={save}
          >
            {saving ? "Lagrer…" : "Lagre endringer"}
          </button>

          <button
            className="w-full rounded-lg border px-4 py-2 hover:bg-gray-50"
            onClick={() => router.push("/purchasing")}
          >
            Tilbake til oversikt
          </button>
        </div>
      </section>
    </div>
  );
}