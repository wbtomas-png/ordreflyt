"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function LoginPage() {
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="w-full max-w-md space-y-8">
        {/* Logo / Brand */}
        <div className="text-center space-y-3">
          <div className="text-3xl font-semibold tracking-tight">
            OrderFlow
          </div>
          <p className="text-sm text-gray-600">
            Produktkatalog og bestillingssystem for intern bruk.
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border bg-white p-8 shadow-sm space-y-6">
          <div className="space-y-2 text-center">
            <h1 className="text-xl font-semibold">
              Logg inn
            </h1>

          </div>

          <button
            disabled={busy}
            onClick={signInGoogle}
            className="w-full rounded-xl border border-black bg-black px-4 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Sender deg videre…" : "Logg inn med Google"}
          </button>
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-gray-400">
          © {new Date().getFullYear()} OrderFlow
        </div>
      </div>
    </div>
  );
}