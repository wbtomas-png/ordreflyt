// file: web/src/app/login/LoginClient.tsx
"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function LoginClient() {
  const [busy, setBusy] = useState(false);
  const sp = useSearchParams();

  const cb = sp.get("cb");
  const detail = sp.get("detail");

  async function signInGoogle() {
    setBusy(true);
    const supabase = supabaseBrowser();

    const { error } = await supabase.auth.signInWithOAuth({
  provider: "google",
  options: {
    redirectTo: `${window.location.origin}/auth/callback`,
  },
});

    if (error) {
      console.error(error);
      alert(error.message);
      setBusy(false);
    }
  }

  async function signInMicrosoft() {
    setBusy(true);
    const supabase = supabaseBrowser();

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      console.error(error);
      alert(error.message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-3">
          <div className="text-3xl font-semibold tracking-tight">OrderFlow</div>
          <p className="text-sm text-gray-600">
            Produktkatalog og bestillingssystem for intern bruk.
          </p>
        </div>

        {/* DEBUG/FEILVISNING */}
        {cb && (
          <div className="rounded-xl border bg-red-50 p-4 text-sm text-red-800">
            <div className="font-semibold">Innlogging stoppet</div>
            <div className="mt-1">
              <span className="font-medium">Steg:</span> {cb}
            </div>
            {detail && (
              <div className="mt-1 break-words">
                <span className="font-medium">Detaljer:</span> {detail}
              </div>
            )}
          </div>
        )}

        <div className="rounded-2xl border bg-white p-8 shadow-sm space-y-4">
          <div className="space-y-2 text-center">
            <h1 className="text-xl font-semibold">Logg inn</h1>
          </div>

          <button
            disabled={busy}
            onClick={signInGoogle}
            className="w-full rounded-xl border border-black bg-black px-4 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Sender deg videre…" : "Logg inn med Google"}
          </button>

          <button
            disabled={busy}
            onClick={signInMicrosoft}
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-black transition hover:bg-gray-50 disabled:opacity-50"
          >
            {busy ? "Sender deg videre…" : "Logg inn med Microsoft"}
          </button>
        </div>

        <div className="text-center text-xs text-gray-400">
          © {new Date().getFullYear()} OrderFlow
        </div>
      </div>
    </div>
  );
}