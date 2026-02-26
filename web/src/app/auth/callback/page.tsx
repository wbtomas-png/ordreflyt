"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function AuthCallbackPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [msg, setMsg] = useState("Sender deg videre…");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        // 1) Hvis PKCE: exchange code
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");

        if (code) {
          setMsg("Fullfører innlogging…");
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            router.replace(`/login?cb=exchange_failed&m=${encodeURIComponent(error.message)}`);
            return;
          }
          // Rydd vekk code fra URL
          url.searchParams.delete("code");
          window.history.replaceState({}, "", url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : ""));
        } else {
          // 2) Hvis hash-token flow: la detectSessionInUrl gjøre jobben
          // Gi browser en micro-tick til å la supabase-js lese hash
          await new Promise((r) => setTimeout(r, 50));
        }

        // 3) Verifiser session
        const { data: sess } = await supabase.auth.getSession();
        if (!sess.session) {
          router.replace("/login?cb=no_session_after_callback");
          return;
        }

        // 4) OK → videre
        if (!alive) return;
        router.replace("/products");
      } catch (e: any) {
        router.replace(`/login?cb=callback_crash&m=${encodeURIComponent(String(e?.message ?? e))}`);
      }
    })();

    return () => {
      alive = false;
    };
  }, [router, supabase]);

  return (
    <div className="p-6">
      <div className="text-sm text-gray-700">{msg}</div>
    </div>
  );
}