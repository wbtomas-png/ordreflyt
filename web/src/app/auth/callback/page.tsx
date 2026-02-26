"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function AuthCallbackClient() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  useEffect(() => {
    (async () => {
      // Gi supabase ett tick til å prosessere URL
      await new Promise((r) => setTimeout(r, 50));

      const { data } = await supabase.auth.getSession();

      if (!data.session) {
        router.replace("/login?cb=session_missing");
        return;
      }

      router.replace("/products");
    })();
  }, [router, supabase]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      Fullfører innlogging…
    </div>
  );
}