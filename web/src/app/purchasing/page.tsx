innkjøper id

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

function formatDateOnly(value: string | null | undefined) {
  if (!value) return "";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return String(value);
  return d.toLocaleDateString("nb-NO");
}

export default function PurchasingOrderPage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params?.id ?? "");

  // 🔥 viktig
  const supabase = useMemo(() => supabaseBrowser() as any, []);

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<OrderRow | null>(null);

  const [status, setStatus] = useState("");
  const [eta, setEta] = useState("");
  const [info, setInfo] = useState("");
  const [confirmPath, setConfirmPath] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);

      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) {
        router.replace("/login");
        return;
      }

      const { data, error } = await (supabase as any)
        .from("orders")
        .select("*")
        .eq("id", id)
        .single();

      if (!alive) return;

      if (error || !data) {
        console.error(error);
        setLoading(false);
        return;
      }

      const o = data as OrderRow;

      setOrder(o);
      setStatus(o.status ?? "SUBMITTED");
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

    const payload = {
      status,
      expected_delivery_date: eta || null,
      delivery_info: info || null,
      confirmation_file_path: confirmPath || null,
      purchaser_note: note || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await (supabase as any)
      .from("orders")
      .update(payload)
      .eq("id", order.id);

    if (error) {
      console.error(error);
      alert("Kunne ikke lagre endringer.");
      return;
    }

    alert("Lagret.");
    router.refresh();
  }

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-600">Laster…</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-600">Ordre ikke funnet.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <button
        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
        onClick={() => router.push("/purchasing")}
      >
        ← Tilbake
      </button>

      <h1 className="text-xl font-semibold">
        {order.project_name}
      </h1>

      <div className="text-sm text-gray-600">
        Opprettet: {formatDateOnly(order.created_at)}
      </div>

      <div className="grid gap-4 rounded-xl border p-4">
        <label className="text-sm">
          Status
          <select
            className="mt-1 w-full rounded-lg border px-3 py-2"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="SUBMITTED">Submitted</option>
            <option value="ORDERED">Ordered</option>
            <option value="SHIPPING">Shipping</option>
            <option value="DELIVERED">Delivered</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </label>

        <label className="text-sm">
          ETA
          <input
            type="date"
            className="mt-1 w-full rounded-lg border px-3 py-2"
            value={eta ?? ""}
            onChange={(e) => setEta(e.target.value)}
          />
        </label>

        <label className="text-sm">
          Leveringsinfo
          <textarea
            className="mt-1 w-full rounded-lg border px-3 py-2"
            rows={3}
            value={info}
            onChange={(e) => setInfo(e.target.value)}
          />
        </label>

        <label className="text-sm">
          Ordrebekreftelse sti
          <input
            className="mt-1 w-full rounded-lg border px-3 py-2"
            value={confirmPath}
            onChange={(e) => setConfirmPath(e.target.value)}
          />
        </label>

        <label className="text-sm">
          Innkjøpernotat
          <textarea
            className="mt-1 w-full rounded-lg border px-3 py-2"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>

      <button
        onClick={saveChanges}
        className="rounded-lg bg-black px-4 py-2 text-white"
      >
        Lagre endringer
      </button>
    </div>
  );
}