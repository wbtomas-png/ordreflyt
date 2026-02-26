"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function AuthCallbackClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [msg, setMsg] = useState("Fullfører innlogging…");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const code = sp.get("code");
        const errorDesc = sp.get("error_description");
        const error = sp.get("error");

        if (error || errorDesc) {
          const reason = encodeURIComponent(errorDesc || error || "oauth_error");
          router.replace(`/login?cb=${reason}`);
          return;
        }

        if (!code) {
          router.replace(`/login?cb=missing_code`);
          return;
        }

        setMsg("Bytter kode mot sesjon…");

        const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);

        if (exErr) {
          const reason = encodeURIComponent(exErr.message || "exchange_failed");
          router.replace(`/login?cb=${reason}`);
          return;
        }

        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          router.replace(`/login?cb=session_missing`);
          return;
        }

        if (!alive) return;

        setMsg("Innlogget. Sender deg videre…");
        router.replace("/products");
      } catch (e: any) {
        const reason = encodeURIComponent(e?.message || "callback_error");
        router.replace(`/login?cb=${reason}`);
      }
    })();

    return () => {
      alive = false;
    };
  }, [router, sp, supabase]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 text-center">
        <div className="text-lg font-semibold">OrderFlow</div>
        <div className="mt-3 text-sm text-gray-600">{msg}</div>
      </div>
    </div>
  );
}