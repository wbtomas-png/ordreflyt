// file: web/src/lib/useRequireMe.ts
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Role = "kunde" | "admin" | "innkjøper";

type MeOk = {
  ok: true;
  email: string;
  role: Role;
  display_name: string | null;
};

type MeFail = {
  ok: false;
  denied?: boolean;
  error?: string;
};

type UseRequireMeOpts = {
  requireRole?: Role | Role[]; // f.eks "admin" eller ["admin","innkjøper"]
  redirectTo?: string;         // default "/login"
  deniedTo?: string;           // default "/login?denied=1"
};

function normRole(r: any): Role {
  const s = String(r ?? "").trim().toLowerCase();
  if (s === "admin") return "admin";
  if (s === "innkjøper" || s === "innkjoper") return "innkjøper";
  return "kunde";
}

export function useRequireMe(opts: UseRequireMeOpts = {}) {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const redirectTo = opts.redirectTo ?? "/login";
  const deniedTo = opts.deniedTo ?? "/login?denied=1";

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeOk | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requiredRoles = useMemo(() => {
    if (!opts.requireRole) return null;
    const arr = Array.isArray(opts.requireRole) ? opts.requireRole : [opts.requireRole];
    return arr.map(normRole);
  }, [opts.requireRole]);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setError(null);
      setMe(null);

      // 1) Må ha session
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;

      if (!token) {
        if (!alive) return;
        setLoading(false);
        router.replace(redirectTo);
        return;
      }

      // 2) Sjekk allowlist + role via server
      const res = await fetch("/api/auth/me", {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
      });

      const data = (await res.json().catch(() => null)) as (MeOk | MeFail | null);

      if (!alive) return;

      if (!res.ok || !data || (data as any).ok !== true) {
        // denied eller error -> logg ut for å “renske”
        await supabase.auth.signOut();
        setLoading(false);
        router.replace(deniedTo);
        return;
      }

      const ok = data as MeOk;
      const role = normRole(ok.role);

      // 3) Rollekrav
      if (requiredRoles && !requiredRoles.includes(role)) {
        setLoading(false);
        router.replace("/products"); // eller en /no-access side
        return;
      }

      setMe({ ...ok, role });
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [router, supabase, redirectTo, deniedTo, requiredRoles]);

  return { loading, me, error };
}