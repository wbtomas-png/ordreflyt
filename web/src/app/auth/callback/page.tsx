// file: web/src/app/auth/callback/page.tsx

import { Suspense } from "react";
import AuthCallbackClient from "./AuthCallbackClient";

// Viktig: dette hindrer at Next prøver å prerendere siden under build
export const dynamic = "force-dynamic";

export default function AuthCallbackPage() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm space-y-3">
        <div className="text-lg font-semibold">OrderFlow</div>

        <Suspense fallback={<p className="text-sm text-gray-600">Fullfører innlogging…</p>}>
          <AuthCallbackClient />
        </Suspense>
      </div>
    </div>
  );
}