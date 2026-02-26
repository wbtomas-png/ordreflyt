// file: web/src/app/auth/callback/page.tsx

import { Suspense } from "react";
import AuthCallbackClient from "./AuthCallbackClient";

export const dynamic = "force-dynamic"; // viktig: ikke prøv å prerendere callback

function Loading() {
  return <p className="text-sm text-gray-600">Fullfører innlogging…</p>;
}

export default function AuthCallbackPage() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm space-y-3">
        <div className="text-lg font-semibold">OrderFlow</div>

        <Suspense fallback={<Loading />}>
          <AuthCallbackClient />
        </Suspense>
      </div>
    </div>
  );
}