// file: web/src/app/access/page.tsx
"use client";

import { useMemo, useState } from "react";
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

export default function AccessPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  // Krev admin for å se/endre allowlist
  const { me, loading } = useRequireMe({ requireRole: "admin" });

  const [adminPass, setAdminPass] = useState<string>("");

  const [rows, setRows] = useState<Row[]>([]);

  // add new
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [newRole, setNewRole] = useState<Role>("kunde");

  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // inline edits
  const [roleDraftByEmail, setRoleDraftByEmail] = useState<Record<string, Role>>(
    {}
  );
  const [nameDraftByEmail, setNameDraftByEmail] = useState<Record<string, string>>(
    {}
  );
  const [savingEmail, setSavingEmail] = useState<string | null>(null);

  async function authHeader(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
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

    const res = await fetch("/api/admin/allowlist", {
      method: "GET",
      headers: {
        authorization: auth,
        "x-admin-password": adminPass, // (midlertidig, kan fjernes senere)
      },
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

    const res = await fetch("/api/admin/allowlist", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: auth,
        "x-admin-password": adminPass,
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

    setToast("Lagt til");
    setTimeout(() => setToast(null), 1200);

    await load();
  }

  async function removeEmail(e: string) {
    setErr(null);

    const auth = await authHeader();
    if (!auth) {
      router.replace("/login");
      return;
    }

    const res = await fetch(`/api/admin/allowlist?email=${encodeURIComponent(e)}`, {
      method: "DELETE",
      headers: {
        authorization: auth,
        "x-admin-password": adminPass,
      },
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      setErr(data?.error ?? `Delete failed (${res.status})`);
      return;
    }

    setToast("Fjernet");
    setTimeout(() => setToast(null), 1200);

    await load();
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

    const res = await fetch("/api/admin/allowlist", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: auth,
        "x-admin-password": adminPass,
      },
      body: JSON.stringify({ email, role, display_name }),
    });

    const data = await res.json().catch(() => null);
    setSavingEmail(null);

    if (!res.ok || !data?.ok) {
      setErr(data?.error ?? `Update failed (${res.status})`);
      return;
    }

    setToast("Oppdatert");
    setTimeout(() => setToast(null), 1200);

    await load();
  }

  if (loading) {
    return <div className="p-6 text-sm text-gray-600">Laster…</div>;
  }

  // Hooken redirecter allerede ved feil rolle, så her er vi admin
  const canUse = Boolean(me);

  return (
    <div className="min-h-screen bg-white">
      <div className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-3xl px-6 py-3 flex items-center justify-between">
          <div className="text-sm font-medium text-gray-700">Tilgangsstyring</div>

          <div className="flex items-center gap-2">
            {me?.display_name || me?.email ? (
              <div className="text-xs text-gray-500">
                {(me.display_name ?? me.email) || ""} · {me.role}
              </div>
            ) : null}

            <button
              className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
              onClick={() => router.push("/products")}
            >
              Til produkter
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl p-6 space-y-4">
        <div className="rounded-2xl border p-5 space-y-3">
          <div className="text-sm font-semibold">Admin-passord</div>
          <div className="flex gap-2">
            <input
              type="password"
              value={adminPass}
              onChange={(e) => setAdminPass(e.target.value)}
              placeholder="Skriv admin-passord…"
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-gray-400"
            />
            <button
              onClick={load}
              disabled={!canUse}
              className={cn(
                "rounded-xl border border-black bg-black px-4 py-2 text-sm font-semibold text-white",
                "hover:opacity-90 disabled:opacity-50"
              )}
            >
              Åpne
            </button>
          </div>

          {err ? <div className="text-sm text-red-600">{err}</div> : null}
          {toast ? <div className="text-sm text-green-700">{toast}</div> : null}
        </div>

        <div className="rounded-2xl border p-5 space-y-3">
          <div className="text-sm font-semibold">Legg til bruker</div>

          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_170px_110px]">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="navn@firma.no"
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-gray-400"
            />

            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Brukernavn (visningsnavn)"
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-gray-400"
            />

            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as Role)}
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-gray-400 bg-white"
              title="Rolle"
            >
              <option value="kunde">Kunde</option>
              <option value="innkjøper">Innkjøper</option>
              <option value="admin">Admin</option>
            </select>

            <button
              onClick={addEmail}
              className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
            >
              Legg til
            </button>
          </div>

          <div className="text-xs text-gray-500">
            Brukernavn vises i systemet (audit / “sist endret”). E-post brukes som fallback hvis navn er tomt.
          </div>
        </div>

        <div className="rounded-2xl border p-5">
          <div className="text-sm font-semibold mb-3">Allowlist ({rows.length})</div>

          {rows.length === 0 ? (
            <div className="text-sm text-gray-600">Ingen e-poster (eller ikke åpnet).</div>
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
                  <li key={r.email} className="flex flex-col gap-2 rounded-xl border px-3 py-3">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {r.display_name?.trim() ? r.display_name : r.email}
                        </div>
                        <div className="text-xs text-gray-500">
                          <span className="font-mono">{r.email}</span>
                          <span className="mx-2">·</span>
                          {new Date(r.created_at).toLocaleString("nb-NO")}
                          <span className="mx-2">·</span>
                          Rolle:{" "}
                          <span className="font-medium text-gray-700">
                            {ROLE_LABEL[r.role ?? "kunde"]}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          className={cn(
                            "rounded-lg border px-3 py-2 text-xs",
                            changed
                              ? "border-black bg-black text-white hover:opacity-90"
                              : "hover:bg-gray-50",
                            saving ? "opacity-60" : ""
                          )}
                          disabled={!changed || saving}
                          onClick={() => saveRow(r.email)}
                          title="Lagre endringer"
                        >
                          {saving ? "Lagrer…" : "Lagre"}
                        </button>

                        <button
                          className="rounded-lg border px-3 py-2 text-xs hover:bg-gray-50"
                          onClick={() => removeEmail(r.email)}
                          title="Fjern"
                        >
                          Fjern
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-[1fr_170px]">
                      <input
                        value={draftName}
                        onChange={(e) =>
                          setNameDraftByEmail((prev) => ({
                            ...prev,
                            [r.email]: e.target.value,
                          }))
                        }
                        placeholder="Brukernavn (visningsnavn)"
                        className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-gray-400"
                      />

                      <select
                        value={draftRole}
                        onChange={(e) =>
                          setRoleDraftByEmail((prev) => ({
                            ...prev,
                            [r.email]: e.target.value as Role,
                          }))
                        }
                        className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-gray-400 bg-white"
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
      </div>
    </div>
  );
}