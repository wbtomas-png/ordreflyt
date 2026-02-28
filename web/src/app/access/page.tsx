// file: web/src/app/access/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useRequireMe } from "@/lib/useRequireMe";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Role = "kunde" | "admin" | "innkjøper";
type Row = {
  email: string;
  display_name: string | null;
  role: Role;
  created_at: string;
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const ROLE_LABEL: Record<Role, string> = {
  kunde: "Kunde",
  admin: "Admin",
  innkjøper: "Innkjøper",
};

function safeText(s: unknown) {
  return String(s ?? "").trim();
}

export default function AccessPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  // Krev admin for å se/endre allowlist (hooken redirecter ved feil rolle)
  const { me, loading } = useRequireMe({ requireRole: "admin" });

  const [rows, setRows] = useState<Row[]>([]);

  // add new
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [newRole, setNewRole] = useState<Role>("kunde");

  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // inline edits
  const [roleDraftByEmail, setRoleDraftByEmail] = useState<Record<string, Role>>({});
  const [nameDraftByEmail, setNameDraftByEmail] = useState<Record<string, string>>({});
  const [savingEmail, setSavingEmail] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1200);
  }

  async function authHeader(): Promise<string | null> {
    const { data, error } = await supabase.auth.getSession();
    if (error) console.error(error);
    const token = data.session?.access_token ?? null;
    return token ? `Bearer ${token}` : null;
  }

  async function load() {
    setErr(null);

    const auth = await authHeader();
    if (!auth) {
      router.replace("/login");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/admin/allowlist", {
        method: "GET",
        headers: { authorization: auth },
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setErr(data?.error ?? `Load failed (${res.status})`);
        setRows([]);
        return;
      }

      const list = (data.rows ?? []) as Row[];
      setRows(list);

      // init drafts from server
      setRoleDraftByEmail(() => {
        const next: Record<string, Role> = {};
        for (const r of list) next[r.email] = (r.role ?? "kunde") as Role;
        return next;
      });

      setNameDraftByEmail(() => {
        const next: Record<string, string> = {};
        for (const r of list) next[r.email] = String(r.display_name ?? "");
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  async function addEmail() {
    setErr(null);

    const auth = await authHeader();
    if (!auth) {
      router.replace("/login");
      return;
    }

    const e = email.trim().toLowerCase();
    const n = displayName.trim();

    if (!e) return;

    setBusy(true);
    try {
      const res = await fetch("/api/admin/allowlist", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: auth,
        },
        body: JSON.stringify({ email: e, display_name: n, role: newRole }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setErr(data?.error ?? `Add failed (${res.status})`);
        return;
      }

      setEmail("");
      setDisplayName("");
      setNewRole("kunde");

      showToast("Lagt til");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function removeEmail(e: string) {
    setErr(null);

    const auth = await authHeader();
    if (!auth) {
      router.replace("/login");
      return;
    }

    const ok = confirm(`Fjerne ${e} fra allowlist?`);
    if (!ok) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/allowlist?email=${encodeURIComponent(e)}`, {
        method: "DELETE",
        headers: { authorization: auth },
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setErr(data?.error ?? `Delete failed (${res.status})`);
        return;
      }

      showToast("Fjernet");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveRow(email: string) {
    setErr(null);

    const auth = await authHeader();
    if (!auth) {
      router.replace("/login");
      return;
    }

    const role = roleDraftByEmail[email] ?? "kunde";
    const display_name = (nameDraftByEmail[email] ?? "").trim();

    setSavingEmail(email);
    try {
      const res = await fetch("/api/admin/allowlist", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: auth,
        },
        body: JSON.stringify({ email, role, display_name }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setErr(data?.error ?? `Update failed (${res.status})`);
        return;
      }

      showToast("Oppdatert");
      await load();
    } finally {
      setSavingEmail(null);
    }
  }

  // Auto-load når admin er verifisert
  useEffect(() => {
    if (loading) return;
    if (!me) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, me]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 md:bg-white md:text-gray-900 p-6 text-sm">
        Laster…
      </div>
    );
  }

  // Hooken redirecter ved feil rolle, så her er vi admin
  const canUse = Boolean(me);
  const meName = safeText(me?.display_name) || safeText(me?.email);

  const pageBg = "bg-gray-950 text-gray-100 md:bg-white md:text-gray-900";
  const card = "rounded-2xl border border-gray-800 bg-gray-900/40 md:border-gray-200 md:bg-white";
  const input =
    "w-full rounded-xl border px-3 py-2 text-sm outline-none " +
    "border-gray-800 bg-gray-900 text-gray-100 placeholder:text-gray-500 focus:border-gray-600 " +
    "md:border-gray-300 md:bg-white md:text-gray-900 md:placeholder:text-gray-400 md:focus:border-gray-400";
  const select =
    "w-full rounded-xl border px-3 py-2 text-sm outline-none " +
    "border-gray-800 bg-gray-900 text-gray-100 focus:border-gray-600 " +
    "md:border-gray-300 md:bg-white md:text-gray-900 md:focus:border-gray-400";
  const btn =
    "rounded-xl border px-4 py-2 text-sm disabled:opacity-50 " +
    "border-gray-800 bg-gray-900 text-gray-100 hover:bg-gray-800 " +
    "md:border-gray-300 md:bg-white md:text-gray-900 md:hover:bg-gray-50";

  return (
    <div className={cn("min-h-screen", pageBg)}>
      {/* Topbar */}
      <div className="sticky top-0 z-10 border-b border-gray-800 bg-gray-950/95 backdrop-blur md:border-gray-200 md:bg-white/80">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 md:px-6">
          <div className="text-sm font-medium text-gray-200 md:text-gray-700">Tilgangsstyring</div>

          <div className="flex items-center gap-2">
            {meName ? (
              <div className="hidden sm:block text-xs text-gray-400 md:text-gray-500">
                {meName} · {me?.role}
              </div>
            ) : null}

            <button className={btn} onClick={() => router.push("/products")}>
              Til produkter
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
        {/* Header card */}
        <div className={cn(card, "p-5 space-y-3")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold">Allowlist</div>
            <button onClick={load} disabled={!canUse || busy} className={btn} title="Oppdater liste">
              {busy ? "Oppdaterer…" : "Oppdater"}
            </button>
          </div>

          {err ? (
            <div className="rounded-xl border border-red-700/40 bg-red-950/30 px-4 py-3 text-sm text-red-200 md:border-red-200 md:bg-white md:text-red-700">
              {err}
            </div>
          ) : null}

          {toast ? (
            <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200 md:border-emerald-200 md:bg-white md:text-emerald-700">
              {toast}
            </div>
          ) : null}

          <div className="text-xs text-gray-400 md:text-gray-500">
            Kun admin-brukere har tilgang til denne siden. Ingen ekstra passord brukes.
          </div>
        </div>

        {/* Add user */}
        <div className={cn(card, "p-5 space-y-3")}>
          <div className="text-sm font-semibold">Legg til bruker</div>

          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_170px_110px]">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="navn@firma.no"
              className={input}
              inputMode="email"
              autoComplete="email"
            />

            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Visningsnavn"
              className={input}
              autoComplete="name"
            />

            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as Role)}
              className={select}
              title="Rolle"
            >
              <option value="kunde">Kunde</option>
              <option value="innkjøper">Innkjøper</option>
              <option value="admin">Admin</option>
            </select>

            <button onClick={addEmail} disabled={!canUse || busy} className={btn}>
              Legg til
            </button>
          </div>

          <div className="text-xs text-gray-400 md:text-gray-500">
            Visningsnavn brukes i UI og audit (“sist endret”). E-post brukes som fallback hvis navn er tomt.
          </div>
        </div>

        {/* List */}
        <div className={cn(card, "p-5")}>
          <div className="mb-3 text-sm font-semibold">Allowlist ({rows.length})</div>

          {rows.length === 0 ? (
            <div className="text-sm text-gray-300 md:text-gray-600">Ingen e-poster.</div>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => {
                const draftRole = roleDraftByEmail[r.email] ?? r.role ?? "kunde";
                const draftName = nameDraftByEmail[r.email] ?? String(r.display_name ?? "");
                const changed =
                  draftRole !== (r.role ?? "kunde") ||
                  draftName.trim() !== String(r.display_name ?? "").trim();
                const saving = savingEmail === r.email;

                return (
                  <li key={r.email} className="rounded-2xl border border-gray-800 bg-gray-950/30 px-4 py-4 md:border-gray-200 md:bg-white">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-100 md:text-gray-900">
                          {r.display_name?.trim() ? r.display_name : r.email}
                        </div>

                        <div className="mt-1 text-xs text-gray-400 md:text-gray-500">
                          <span className="font-mono">{r.email}</span>
                          <span className="mx-2">·</span>
                          {new Date(r.created_at).toLocaleString("nb-NO")}
                          <span className="mx-2">·</span>
                          Rolle:{" "}
                          <span className="font-medium text-gray-200 md:text-gray-700">
                            {ROLE_LABEL[r.role ?? "kunde"]}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          className={cn(
                            "rounded-xl px-3 py-2 text-xs",
                            changed
                              ? "border border-white/10 bg-white/10 text-white hover:bg-white/15 md:border-black md:bg-black md:text-white md:hover:opacity-90"
                              : "border border-gray-800 bg-gray-900 text-gray-100 hover:bg-gray-800 md:border-gray-300 md:bg-white md:text-gray-900 md:hover:bg-gray-50",
                            saving ? "opacity-60" : ""
                          )}
                          disabled={!changed || saving}
                          onClick={() => saveRow(r.email)}
                          title="Lagre endringer"
                        >
                          {saving ? "Lagrer…" : "Lagre"}
                        </button>

                        <button
                          className={cn(
                            "rounded-xl px-3 py-2 text-xs",
                            "border border-red-700/40 bg-red-950/30 text-red-200 hover:bg-red-950/50",
                            "md:border-red-200 md:bg-white md:text-red-700 md:hover:bg-red-50"
                          )}
                          onClick={() => removeEmail(r.email)}
                          disabled={saving}
                          title="Fjern"
                        >
                          Fjern
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_170px]">
                      <input
                        value={draftName}
                        onChange={(e) =>
                          setNameDraftByEmail((prev) => ({
                            ...prev,
                            [r.email]: e.target.value,
                          }))
                        }
                        placeholder="Visningsnavn"
                        className={input}
                      />

                      <select
                        value={draftRole}
                        onChange={(e) =>
                          setRoleDraftByEmail((prev) => ({
                            ...prev,
                            [r.email]: e.target.value as Role,
                          }))
                        }
                        className={select}
                        title="Endre rolle"
                      >
                        <option value="kunde">Kunde</option>
                        <option value="innkjøper">Innkjøper</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="text-[11px] text-gray-500 md:text-gray-400">
          Tips: På mobil er alt “stacked” for å være lett å treffe med tommel. På desktop får du grid/layout.
        </div>
      </div>
    </div>
  );
}