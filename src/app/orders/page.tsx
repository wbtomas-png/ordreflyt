// file: web/src/app/orders/page.tsx
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
  expected_delivery_date: string | null;
  delivery_info: string | null;
  confirmation_file_path: string | null;
};

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

export default function OrdersPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.replace("/login");
        return;
      }

      const { data: r, error } = await supabase
        .from("orders")
        .select(
          "id, created_at, status, project_name, project_no, expected_delivery_date, delivery_info, confirmation_file_path"
        )
        .order("created_at", { ascending: false });

      if (!alive) return;

      if (error) console.error(error);
      setRows((r ?? []) as OrderRow[]);
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [router, supabase]);

  async function openConfirmation(orderId: string) {
    setDownloadingId(orderId);

    try {
      // Hent access_token fra klient-session (localStorage-basert auth)
      const { data: sessionRes, error: sessErr } = await supabase.auth.getSession();
      const token = sessionRes.session?.access_token;

      if (sessErr || !token) {
        alert("Du er ikke innlogget.");
        router.replace("/login");
        return;
      }

      const res = await fetch(`/api/orders/${orderId}/confirmation-url`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
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

        <button
          className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
          onClick={() => router.push("/purchasing")}
        >
          Innkjøper
        </button>
      </header>

      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Mine bestillinger</h1>
        <p className="text-sm text-gray-600">
          Her ser du status og kan laste ned ordrebekreftelse når den er klar.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border p-6 text-sm text-gray-600">
          Du har ingen bestillinger ennå.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((o) => {
            const hasConfirmation = Boolean(o.confirmation_file_path);
            const busy = downloadingId === o.id;

            return (
              <div
                key={o.id}
                className="rounded-2xl border bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-sm text-gray-600">
                      Opprettet: {formatDateTime(o.created_at)}
                    </div>

                    <div className="font-semibold">{o.project_name}</div>

                    {o.project_no && (
                      <div className="text-sm text-gray-600">
                        Prosjekt nr: {o.project_no}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <div className="rounded-full border px-3 py-1 text-sm">
                      Status:{" "}
                      <span className="font-medium">{statusLabel(o.status)}</span>
                    </div>

                    {o.expected_delivery_date && (
                      <div className="text-sm text-gray-700">
                        Forventet levering:{" "}
                        <span className="font-medium">{o.expected_delivery_date}</span>
                      </div>
                    )}
                  </div>
                </div>

                {o.delivery_info && (
                  <div className="mt-3 rounded-xl border bg-gray-50 p-3 text-sm text-gray-700 whitespace-pre-line">
                    {o.delivery_info}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                    onClick={() => router.push(`/orders/${o.id}`)}
                  >
                    Åpne ordre
                  </button>

                  {hasConfirmation ? (
                    <button
                      disabled={busy}
                      className="rounded-lg bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
                      onClick={() => openConfirmation(o.id)}
                    >
                      {busy ? "Henter lenke…" : "Last ned ordrebekreftelse"}
                    </button>
                  ) : (
                    <div className="text-sm text-gray-500">
                      Ordrebekreftelse ikke tilgjengelig enda
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}