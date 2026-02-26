// file: web/src/app/login/page.tsx
"use client";

export const dynamic = "force-dynamic"; // hindrer prerender under build

import { useState } from "react";

export default function LoginPage() {
  const [busy, setBusy] = useState(false);

  async function signInGoogle() {
    setBusy(true);
    try {
      // Lazy import -> hindrer at supabase/browser evalueres under build/prerender
      const { supabaseBrowser } = await import("@/lib/supabase/browser");
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
    } catch (e) {
      console.error(e);
      alert("Innlogging feilet (klient). Sjekk console/logs.");
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

        <div className="rounded-2xl border bg-white p-8 shadow-sm space-y-6">
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
        </div>

        <div className="text-center text-xs text-gray-400">
          © {new Date().getFullYear()} OrderFlow
        </div>
      </div>
    </div>
  );
}