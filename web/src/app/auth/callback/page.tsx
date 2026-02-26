// file: web/src/app/auth/callback/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

function msgFromError(err: unknown) {
  const m = String((err as any)?.message ?? err ?? "");
  return m || "ukjent_feil";
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [info, setInfo] = useState("Sender deg videre…");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const url = new URL(window.location.href);

        // Supabase kan returnere feil i query
        const err = url.searchParams.get("error");
        const errDesc = url.searchParams.get("error_description");
        if (err) {
          router.replace(`/login?cb=${encodeURIComponent(err)}&m=${encodeURIComponent(errDesc ?? "")}`);
          return;
        }

        // PKCE: code i query
        const code = url.searchParams.get("code");

        // Legacy implicit: access_token i hash (skal egentlig ikke skje når du tvinger pkce)
        const hasHashToken = url.hash.includes("access_token=");

        if (!code && !hasHashToken) {
          router.replace("/login?cb=missing_code");
          return;
        }

        // Tving exchange når code finnes
        if (code) {
          setInfo("Fullfører innlogging…");
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            router.replace(`/login?cb=exchange_failed&m=${encodeURIComponent(error.message)}`);
            return;
          }

          // Rydd URL (fjern ?code=)
          url.searchParams.delete("code");
          window.history.replaceState({}, "", url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : ""));
        }

        // Verifiser at vi faktisk har session
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          router.replace("/login?cb=no_session");
          return;
        }

        // Ferdig
        if (!alive) return;
        router.replace("/products");
      } catch (e) {
        router.replace(`/login?cb=callback_error&m=${encodeURIComponent(msgFromError(e))}`);
      }
    })();

    return () => {
      alive = false;
    };
  }, [router, supabase]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="rounded-2xl border bg-white p-6 text-sm text-gray-700">
        {info}
      </div>
    </div>
  );
}