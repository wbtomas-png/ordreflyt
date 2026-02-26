"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Step =
  | "boot"
  | "parsed_url"
  | "has_error"
  | "missing_code"
  | "exchanging"
  | "exchanged"
  | "checking_session"
  | "no_session"
  | "checking_user"
  | "no_user"
  | "redirecting"
  | "done"
  | "failed";

function safeStr(v: unknown) {
  return String(v ?? "");
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [step, setStep] = useState<Step>("boot");
  const [detail, setDetail] = useState<string>("Sender deg videre…");
  const [debug, setDebug] = useState<Record<string, any>>({});

  useEffect(() => {
    let alive = true;

    const run = async () => {
      try {
        setStep("boot");
        setDetail("Starter callback…");

        const href = window.location.href;
        const origin = window.location.origin;

        const url = new URL(href);
        setStep("parsed_url");

        const qpError = url.searchParams.get("error");
        const qpErrorDesc = url.searchParams.get("error_description");
        const code = url.searchParams.get("code");

        const hash = url.hash || "";
        const hasHashToken = hash.includes("access_token=");
        const hashType = hasHashToken ? "implicit_hash" : "none";

        setDebug({
          origin,
          path: url.pathname,
          search: url.search,
          hash: hash.slice(0, 60) + (hash.length > 60 ? "…" : ""),
          hasCode: !!code,
          hashType,
          qpError,
          qpErrorDesc,
        });

        if (qpError) {
          setStep("has_error");
          setDetail(`Feil fra provider: ${qpError}`);
          router.replace(`/login?cb=${encodeURIComponent(qpError)}&m=${encodeURIComponent(qpErrorDesc ?? "")}`);
          return;
        }

        // Vi forventer PKCE (?code=). Hvis den mangler, er redirect/callback-feil.
        if (!code) {
          setStep("missing_code");
          setDetail("Mangler ?code=. Dette betyr at Supabase ikke sender PKCE-kode til callback URL.");
          router.replace("/login?cb=missing_code");
          return;
        }

        // 1) Exchange code -> session
        setStep("exchanging");
        setDetail("Fullfører innlogging (exchangeCodeForSession)…");

        const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
        if (exErr) {
          setStep("failed");
          setDetail(`exchangeCodeForSession feilet: ${exErr.message}`);
          setDebug((d) => ({ ...d, exchangeError: exErr.message }));
          router.replace(`/login?cb=exchange_failed&m=${encodeURIComponent(exErr.message)}`);
          return;
        }

        setStep("exchanged");
        setDetail("Session etablert. Verifiserer…");

        // 2) Rydd URL (fjern code)
        url.searchParams.delete("code");
        window.history.replaceState({}, "", url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : ""));

        // 3) Sjekk session
        setStep("checking_session");
        const { data: sessRes, error: sessErr } = await supabase.auth.getSession();

        if (sessErr) {
          setStep("failed");
          setDetail(`getSession feilet: ${sessErr.message}`);
          setDebug((d) => ({ ...d, sessionError: sessErr.message }));
          router.replace(`/login?cb=session_failed&m=${encodeURIComponent(sessErr.message)}`);
          return;
        }

        if (!sessRes.session) {
          setStep("no_session");
          setDetail("Ingen session etter exchange. Typisk tegn på cookie/storage-problem eller at du blir overskrevet av en redirect-guard.");
          setDebug((d) => ({ ...d, session: null }));
          router.replace("/login?cb=no_session");
          return;
        }

        setDebug((d) => ({
          ...d,
          session: {
            user_id: sessRes.session?.user?.id,
            expires_at: sessRes.session?.expires_at,
          },
        }));

        // 4) Sjekk user
        setStep("checking_user");
        const { data: userRes, error: userErr } = await supabase.auth.getUser();

        if (userErr) {
          setStep("failed");
          setDetail(`getUser feilet: ${userErr.message}`);
          setDebug((d) => ({ ...d, userError: userErr.message }));
          router.replace(`/login?cb=user_failed&m=${encodeURIComponent(userErr.message)}`);
          return;
        }

        if (!userRes.user) {
          setStep("no_user");
          setDetail("Session finnes, men user mangler. Dette betyr at auth-state ikke blir holdt stabilt i klienten.");
          router.replace("/login?cb=no_user");
          return;
        }

        if (!alive) return;

        // 5) Redirect
        setStep("redirecting");
        setDetail("Innlogging ok. Sender deg til /products …");
        router.replace("/products");
        setStep("done");
      } catch (e: any) {
        const msg = safeStr(e?.message ?? e);
        setStep("failed");
        setDetail(`Callback krasjet: ${msg}`);
        setDebug((d) => ({ ...d, fatal: msg }));
        router.replace(`/login?cb=callback_crash&m=${encodeURIComponent(msg)}`);
      }
    };

    // Timeout “fastlåst” -> vis debug på skjerm
    const t = window.setTimeout(() => {
      setDetail((s) => s + " (tar uvanlig lang tid – se debug under)");
    }, 6000);

    run().finally(() => window.clearTimeout(t));

    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [router, supabase]);

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="w-full max-w-2xl space-y-3 rounded-2xl border bg-white p-6">
        <div className="text-lg font-semibold">Auth callback</div>
        <div className="text-sm text-gray-700">{detail}</div>

        <div className="rounded-xl border bg-gray-50 p-3">
          <div className="text-xs text-gray-500 mb-2">step</div>
          <div className="text-sm font-mono">{step}</div>
        </div>

        <details className="rounded-xl border bg-gray-50 p-3">
          <summary className="cursor-pointer text-sm font-medium">Debug</summary>
          <pre className="mt-2 overflow-x-auto text-[12px] leading-4">
{JSON.stringify(debug, null, 2)}
          </pre>
        </details>

        <div className="flex flex-wrap gap-2">
          <button className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50" onClick={() => location.reload()}>
            Last på nytt
          </button>
          <button className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50" onClick={() => router.replace("/login")}>
            Til /login
          </button>
          <button className="rounded-lg bg-black px-3 py-2 text-sm text-white hover:opacity-90" onClick={() => router.replace("/products")}>
            Gå til /products
          </button>
        </div>
      </div>
    </div>
  );
}