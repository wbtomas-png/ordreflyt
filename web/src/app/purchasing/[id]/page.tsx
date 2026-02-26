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
  if (!Number.isFinite(d.getTime())) return String(value);

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

function etaCounterText(eta: string | null) {
  const d = safeDate(eta);
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

function isEtaOverdue(eta: string | null) {
  const d = safeDate(eta);
  if (!d) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);

  return d.getTime() < today.getTime();
}

function isEtaSoon(eta: string | null, days: number) {
  const d = safeDate(eta);
  if (!d) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);

  const diffDays = Math.round(
    (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  return diffDays >= 0 && diffDays <= days;
}

function statusTone(status: string): "green" | "yellow" | "red" | "neutral" {
  const s = String(status ?? "").toUpperCase();
  if (s === "DELIVERED" || s === "CONFIRMED") return "green";
  if (
    s === "SUBMITTED" ||
    s === "IN_REVIEW" ||
    s === "ORDERED" ||
    s === "SHIPPING"
  )
    return "yellow";
  if (s === "CANCELLED") return "red";
  return "neutral";
}

function badgeClass(tone: ReturnType<typeof statusTone>) {
  if (tone === "green")
    return "border-green-200 bg-green-50 text-green-800";
  if (tone === "yellow")
    return "border-amber-200 bg-amber-50 text-amber-800";
  if (tone === "red")
    return "border-red-200 bg-red-50 text-red-800";
  return "border-gray-200 bg-gray-50 text-gray-700";
}

export default function PurchasingPage() {
  const router = useRouter();

  // 🔥 Viktig: cast til any for å drepe never-typing
  const supabase = useMemo(() => supabaseBrowser() as any, []);

  const [loading, setLoading] = useState(true);
  const [roleOk, setRoleOk] = useState<boolean | null>(null);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [myName, setMyName] = useState<string>("");
  const [myRole, setMyRole] = useState<Role>("kunde");

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

      const { data: sessRes } = await supabase.auth.getSession();
      const token = sessRes.session?.access_token ?? null;

      if (!token) {
        router.replace("/login");
        return;
      }

      // Rolle fra API
      const meRes = await fetch("/api/auth/me", {
        headers: { authorization: `Bearer ${token}` },
      });

      const me = await meRes.json().catch(() => null);

      if (!meRes.ok || !me?.ok) {
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }

      if (!alive) return;

      const role = (me.role ?? "kunde") as Role;
      setMyRole(role);
      setMyName(me.display_name || me.email || "");

      const ok = role === "admin" || role === "innkjøper";
      setRoleOk(ok);

      if (!ok) {
        setLoading(false);
        return;
      }

      // 🔥 Supabase query med any
      const { data, error } = await (supabase as any)
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });

      if (!alive) return;

      if (error) {
        console.error(error);
        setErr(error.message);
        setRows([]);
      } else {
        setRows((data ?? []) as OrderRow[]);
      }

      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [router, supabase]);

  const sorted = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const ta = new Date(a.updated_at ?? a.created_at).getTime();
      const tb = new Date(b.updated_at ?? b.created_at).getTime();
      return tb - ta;
    });
    return list;
  }, [rows]);

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
      <div className="p-6">
        <div className="rounded-xl border p-5 text-sm text-gray-700">
          Du har ikke innkjøper-tilgang.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <h1 className="text-xl font-semibold">Innkjøperoversikt</h1>

      {err && (
        <div className="rounded-xl border p-4 text-sm text-red-700">
          {err}
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="rounded-2xl border p-6 text-sm text-gray-600">
          Ingen ordre funnet.
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((o) => {
            const tone = statusTone(o.status);
            const etaOverdue = isEtaOverdue(o.expected_delivery_date);
            const etaSoon = isEtaSoon(o.expected_delivery_date, 7);

            return (
              <div key={o.id} className="rounded-2xl border p-5">
                <div className="flex justify-between">
                  <div>
                    <div className="font-semibold">{o.project_name}</div>
                    <div className="text-sm text-gray-600">
                      {formatDateTime(o.created_at)}
                    </div>
                  </div>

                  <div
                    className={cn(
                      "rounded-full border px-3 py-1 text-sm",
                      badgeClass(tone)
                    )}
                  >
                    {statusLabel(o.status)}
                  </div>
                </div>

                {o.expected_delivery_date && (
                  <div
                    className={cn(
                      "mt-2 text-sm",
                      etaOverdue
                        ? "text-red-700"
                        : etaSoon
                        ? "text-amber-700"
                        : "text-gray-700"
                    )}
                  >
                    ETA: {formatDateOnly(o.expected_delivery_date)} –{" "}
                    {etaCounterText(o.expected_delivery_date)}
                  </div>
                )}

                <div className="mt-3">
                  <button
                    className="rounded-lg border px-3 py-2 text-sm"
                    onClick={() => router.push(`/purchasing/${o.id}`)}
                  >
                    Åpne
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}