// file: web/src/app/login/LoginClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

function safeJson(x: unknown) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

function lsKeys(prefix?: string) {
  try {
    const keys = Object.keys(window.localStorage || {});
    return prefix ? keys.filter((k) => k.toLowerCase().includes(prefix.toLowerCase())) : keys;
  } catch {
    return [];
  }
}

function ssKeys(prefix?: string) {
  try {
    const keys = Object.keys(window.sessionStorage || {});
    return prefix ? keys.filter((k) => k.toLowerCase().includes(prefix.toLowerCase())) : keys;
  } catch {
    return [];
  }
}

function logAuthState(where: string) {
  // eslint-disable-next-line no-console
  console.groupCollapsed(`[auth][${where}] state`);
  try {
    // eslint-disable-next-line no-console
    console.log("origin:", window.location.origin);
    // eslint-disable-next-line no-console
    console.log("href:", window.location.href);
    // eslint-disable-next-line no-console
    console.log("pathname:", window.location.pathname);
    // eslint-disable-next-line no-console
    console.log("search:", window.location.search);
    // eslint-disable-next-line no-console
    console.log("hash:", window.location.hash);
    // eslint-disable-next-line no-console
    console.log("referrer:", document.referrer);
    // eslint-disable-next-line no-console
    console.log("userAgent:", navigator.userAgent);
    // eslint-disable-next-line no-console
    console.log("localStorage keys:", lsKeys());
    // eslint-disable-next-line no-console
    console.log("sessionStorage keys:", ssKeys());
    // eslint-disable-next-line no-console
    console.log("localStorage keys (supabase):", lsKeys("supabase"));
    // eslint-disable-next-line no-console
    console.log("sessionStorage keys (supabase):", ssKeys("supabase"));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log("logAuthState error:", e);
  }
  // eslint-disable-next-line no-console
  console.groupEnd();
}

type Provider = "google" | "azure";

export default function LoginClient() {
  const [busy, setBusy] = useState(false);
  const [busyProvider, setBusyProvider] = useState<Provider | null>(null);

  const sp = useSearchParams();
  const cb = sp.get("cb");
  const detail = sp.get("detail");

  // OBS:
  // Ikke bruk redirectTo her for OAuth-providerne når du får redirect_uri-mismatch.
  // La Supabase bruke sin egen callback: https://<project>.supabase.co/auth/v1/callback
  // og returnere deg til riktig site basert på Site URL / Redirect URLs i Supabase Auth settings.
  const origin = useMemo(() => (typeof window === "undefined" ? "" : window.location.origin), []);

  useEffect(() => {
    logAuthState("login:mount");

    try {
      const host = window.location.hostname;
      const isVercelPreview = host.includes("-") && host.endsWith(".vercel.app");
      const isProdVercel = host === "ordreflyt.vercel.app";
      // eslint-disable-next-line no-console
      console.log("[login] host:", host, { isVercelPreview, isProdVercel });
    } catch {}

    // eslint-disable-next-line no-console
    console.log("[login] cb/detail:", { cb, detail });

    // eslint-disable-next-line no-console
    if (typeof window !== "undefined" && window.location.hash) {
      console.log(
        "[login] hash present (possible implicit flow):",
        window.location.hash.slice(0, 200) + "…"
      );
    }
  }, [cb, detail]);

  async function signIn(provider: Provider) {
    setBusy(true);
    setBusyProvider(provider);

    const supabase = supabaseBrowser();

    try {
      logAuthState(`login:before:${provider}`);

      // snapshot storage keys before
      const lsBefore = lsKeys("supabase");
      const ssBefore = ssKeys("supabase");

      // ✅ Viktig endring:
      // Ikke sett options.redirectTo. Det er dette som ofte gjør at redirect_uri blir feil hos Microsoft.
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          // For jobbkontoer kan disse hjelpe litt på consent/debug, men er ikke påkrevd:
          // queryParams: { prompt: "select_account" },
        },
      });

      // eslint-disable-next-line no-console
      console.log("[login] signInWithOAuth data:", data);
      // eslint-disable-next-line no-console
      console.log("[login] signInWithOAuth error:", error);

      // snapshot storage keys after
      const lsAfter = lsKeys("supabase");
      const ssAfter = ssKeys("supabase");

      // eslint-disable-next-line no-console
      console.groupCollapsed("[login] storage diff (supabase)");
      // eslint-disable-next-line no-console
      console.log("localStorage before:", lsBefore);
      // eslint-disable-next-line no-console
      console.log("localStorage after :", lsAfter);
      // eslint-disable-next-line no-console
      console.log("sessionStorage before:", ssBefore);
      // eslint-disable-next-line no-console
      console.log("sessionStorage after :", ssAfter);
      // eslint-disable-next-line no-console
      console.groupEnd();

      const sess = await supabase.auth.getSession();
      // eslint-disable-next-line no-console
      console.log(
        "[login] getSession after signInWithOAuth:",
        safeJson(sess.data?.session ? { hasSession: true } : { hasSession: false })
      );

      if (error) {
        alert(error.message);
        setBusy(false);
        setBusyProvider(null);
        return;
      }

      // På suksess vil nettleseren redirecte bort. Hvis ikke, blir vi stående her.
      // eslint-disable-next-line no-console
      console.log("[login] OAuth initiated. Browser should redirect now.");
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error("[login] signIn exception:", e);
      alert(e?.message ? String(e.message) : "Ukjent feil ved innlogging.");
      setBusy(false);
      setBusyProvider(null);
    }
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-3">
          <div className="text-3xl font-semibold tracking-tight">OrderFlow</div>
          <p className="text-sm text-gray-600">Produktkatalog og bestillingssystem for intern bruk.</p>
        </div>

        {(cb || detail) && (
          <div className="rounded-xl border bg-red-50 p-4 text-sm text-red-800">
            <div className="font-semibold">Innlogging stoppet</div>
            {cb ? (
              <div className="mt-1">
                <span className="font-medium">Steg:</span> {cb}
              </div>
            ) : null}
            {detail ? (
              <div className="mt-1 break-words">
                <span className="font-medium">Detaljer:</span> {detail}
              </div>
            ) : null}

            <div className="mt-3 text-xs text-red-700 space-y-1">
              <div>
                <span className="font-medium">Origin:</span> {origin}
              </div>
              <div className="text-[11px] leading-4 text-red-700">
                Sjekk Console for full logg (origin, search/hash, storage keys og Supabase-respons).
              </div>
            </div>
          </div>
        )}

        <div className="rounded-2xl border bg-white p-8 shadow-sm space-y-4">
          <div className="space-y-2 text-center">
            <h1 className="text-xl font-semibold">Logg inn</h1>
          </div>

          <button
            disabled={busy}
            onClick={() => signIn("google")}
            className="w-full rounded-xl border border-black bg-black px-4 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy && busyProvider === "google" ? "Sender deg videre…" : "Logg inn med Google"}
          </button>

          <button
            disabled={busy}
            onClick={() => signIn("azure")}
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-black transition hover:bg-gray-50 disabled:opacity-50"
          >
            {busy && busyProvider === "azure" ? "Sender deg videre…" : "Logg inn med Microsoft"}
          </button>

          <div className="pt-2 text-xs text-gray-500">
            Debug: åpne DevTools Console. Vi logger origin, search/hash, storage keys og Supabase-respons.
          </div>
        </div>

        <div className="text-center text-xs text-gray-400">© {new Date().getFullYear()} OrderFlow</div>
      </div>
    </div>
  );
}