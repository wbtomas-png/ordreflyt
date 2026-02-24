"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

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

const STATUSES = [
  "SUBMITTED",
  "IN_REVIEW",
  "ORDERED",
  "CONFIRMED",
  "SHIPPING",
  "DELIVERED",
  "CANCELLED",
] as const;

export default function PurchasingPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [roleOk, setRoleOk] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.replace("/login");
        return;
      }

      // sjekk rolle
      const { data: prof } = await supabase
        .from("profiles")
        .select("role")
        .maybeSingle();

      const role = (prof as any)?.role as string | undefined;
      const ok = role === "ADMIN" || role === "PURCHASER";
      setRoleOk(ok);

      if (!ok) {
        setLoading(false);
        return;
      }

      const { data: r, error } = await supabase
        .from("orders")
        .select(
          "id, created_at, status, project_name, project_no, contact_name, contact_phone, contact_email, delivery_address, delivery_postcode, delivery_city, comment, expected_delivery_date, delivery_info, confirmation_file_path, purchaser_note"
        )
        .order("created_at", { ascending: false });

      if (error) console.error(error);
      setRows((r ?? []) as OrderRow[]);
      setLoading(false);
    })();
  }, [router, supabase]);

  async function updateOrder(id: string, patch: Partial<OrderRow>) {
    const { error } = await supabase
      .from("orders")
      .update({
        status: patch.status,
        expected_delivery_date: patch.expected_delivery_date,
        delivery_info: patch.delivery_info,
        confirmation_file_path: patch.confirmation_file_path,
        purchaser_note: patch.purchaser_note,
      })
      .eq("id", id);

    if (error) {
      alert(error.message);
      return;
    }

    setRows((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  if (loading) return <div className="p-6">Laster…</div>;

  if (!roleOk) {
    return (
      <div className="p-6 space-y-3">
        <button className="underline" onClick={() => router.push("/orders")}>
          ← Mine ordre
        </button>
        <div className="rounded-lg border p-4 text-sm text-gray-700">
          Du har ikke innkjøper-tilgang. Sett rollen din til <b>PURCHASER</b> eller <b>ADMIN</b> i
          <code> profiles</code>-tabellen i Supabase for testing.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <button className="underline" onClick={() => router.push("/orders")}>
          ← Mine ordre
        </button>
      </div>

      <h1 className="text-xl font-semibold">Innkjøper – Innkommende ordre</h1>

      {rows.length === 0 ? (
        <div className="rounded-lg border p-4 text-sm text-gray-600">
          Ingen ordrer.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((o) => (
            <OrderCard key={o.id} o={o} onSave={updateOrder} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrderCard({
  o,
  onSave,
}: {
  o: OrderRow;
  onSave: (id: string, patch: Partial<OrderRow>) => Promise<void>;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(o.status);
  const [eta, setEta] = useState(o.expected_delivery_date ?? "");
  const [info, setInfo] = useState(o.delivery_info ?? "");
  const [confirmPath, setConfirmPath] = useState(o.confirmation_file_path ?? "");
  const [note, setNote] = useState(o.purchaser_note ?? "");
  const [busy, setBusy] = useState(false);

  return (
    <div className="rounded-xl border p-4 space-y-3">
      <div className="text-sm text-gray-600">
        {new Date(o.created_at).toLocaleString("nb-NO")}
      </div>

      <div className="flex items-center justify-between gap-3">
  <div className="font-semibold">{o.project_name}</div>

  <button
    className="rounded-lg bg-black px-3 py-2 text-white text-sm"
    onClick={() => router.push(`/purchasing/${o.id}`)}
  >
    Åpne ordre
  </button>
</div><div className="text-sm text-gray-700">
        Levering: {o.delivery_address}
        {o.delivery_postcode ? `, ${o.delivery_postcode}` : ""}
        {o.delivery_city ? ` ${o.delivery_city}` : ""}
      </div>

      {o.comment && (
        <div className="text-sm text-gray-700">
          Kommentar: <span className="font-medium">{o.comment}</span>
        </div>
      )}

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

      <button
        disabled={busy}
        className="rounded-lg bg-black px-4 py-2 text-white disabled:opacity-50"
        onClick={async () => {
          setBusy(true);
          await onSave(o.id, {
            status,
            expected_delivery_date: eta || null,
            delivery_info: info || null,
            confirmation_file_path: confirmPath || null,
            purchaser_note: note || null,
          });
          setBusy(false);
        }}
      >
        Lagre
      </button>
    </div>
  );
}