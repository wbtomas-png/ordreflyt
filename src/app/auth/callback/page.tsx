// file: web/src/app/auth/callback/page.tsx
import { Suspense } from "react";
import AuthCallbackClient from "./AuthCallbackClient";

export const dynamic = "force-dynamic";

export default function AuthCallbackPage() {
  return (
    <div className="min-h-[60vh] p-6 flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Internordrer</h1>

        <div className="mt-4">
          <Suspense fallback={<p className="text-sm text-gray-600">Laster…</p>}>
            <AuthCallbackClient />
          </Suspense>
        </div>
      </div>
    </div>
  );
}