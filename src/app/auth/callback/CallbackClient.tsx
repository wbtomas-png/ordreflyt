// file: web/src/app/auth/callback/AuthCallbackClient.tsx
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

    const code = sp.get("code");

    if (!code) {
      setMsg("Mangler auth-kode. Sender deg til login…");
      setTimeout(() => router.replace("/login"), 800);
      return;
    }

    (async () => {
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (!alive) return;

      if (error) {
        console.error(error);
        setMsg(`Innlogging feilet: ${error.message}`);
        setTimeout(() => router.replace("/login"), 1200);
        return;
      }

      router.replace("/products");
    })();

    return () => {
      alive = false;
    };
  }, [router, sp, supabase]);

  return <p className="text-sm text-gray-600">{msg}</p>;
}