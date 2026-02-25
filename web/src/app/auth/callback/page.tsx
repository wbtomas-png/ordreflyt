"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [title, setTitle] = useState("Fullfører innlogging…");
  const [log, setLog] = useState<string>("Starter…");

  function add(line: string) {
    setLog((prev) => prev + "\n" + line);
  }

  useEffect(() => {
    let alive = true;

    (async () => {
      const supabase = supabaseBrowser();

      add("1) Leser URL…");
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      add(`- code i URL: ${code ? "JA" : "NEI"}`);

      // Prøv å hente session først (noen ganger plukkes den opp automatisk)
      add("2) getSession() før exchange…");
      const before = await supabase.auth.getSession();
      add(`- session før: ${before.data.session?.user?.email ?? "INGEN"}`);

      // Hvis vi har code, gjør exchange (PKCE)
      if (code) {
        add("3) exchangeCodeForSession(code) …");
        const ex = await supabase.auth.exchangeCodeForSession(code);
        add(`- exchange error: ${ex.error?.message ?? "ingen"}`);
      } else {
        add("3) Hopper over exchange (ingen code i URL)");
      }

      // Hent session etter exchange
      add("4) getSession() etter exchange…");
      const after = await supabase.auth.getSession();
      const session = after.data.session;
      add(`- session etter: ${session?.user?.email ?? "INGEN"}`);

      if (!session?.access_token) {
        setTitle("Ingen session etter callback");
        add("=> Dette er OAuth/redirect-konfig. Ikke allowlist.");
        return;
      }

      // Kjør allowlist-sjekk og VIS RESULTATET (ikke auto signout)
      add("5) Kaller /api/auth/ensure-allowed …");
      const res = await fetch("/api/auth/ensure-allowed", {
        method: "POST",
        headers: { authorization: `Bearer ${session.access_token}` },
      });

      const body = await res.json().catch(() => null);
      add(`- ensure-allowed HTTP: ${res.status}`);
      add(`- ensure-allowed body: ${JSON.stringify(body)}`);

      if (!alive) return;

      if (res.ok && body?.ok) {
        setTitle("Innlogging OK ✅");
        add("=> Redirect til /products om 1 sekund…");
        setTimeout(() => router.replace("/products"), 1000);
        return;
      }

      setTitle("Ingen tilgang (eller server-feil)");
      add("=> Du blir IKKE logget ut automatisk nå, så du rekker å lese feilen.");
    })();

    return () => {
      alive = false;
    };
  }, [router]);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="w-full max-w-2xl rounded-2xl border bg-white p-8 shadow-sm space-y-3">
        <div className="text-lg font-semibold">OrderFlow</div>
        <div className="text-sm text-gray-700">{title}</div>

        <pre className="text-xs whitespace-pre-wrap rounded-xl border bg-gray-50 p-3 overflow-auto max-h-[60vh]">
          {log}
        </pre>

        <div className="flex gap-2">
          <button
            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={() => router.replace("/login")}
          >
            Til login
          </button>
          <button
            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={async () => {
              const supabase = supabaseBrowser();
              await supabase.auth.signOut();
              router.replace("/login");
            }}
          >
            Logg ut
          </button>
        </div>
      </div>
    </div>
  );
}