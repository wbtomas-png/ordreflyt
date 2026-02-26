// file: web/src/app/auth/callback/page.tsx
import { Suspense } from "react";
import AuthCallbackClient from "./AuthCallbackClient";

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <AuthCallbackClient />
    </Suspense>
  );
}

function Fallback() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 text-center">
        <div className="text-lg font-semibold">OrderFlow</div>
        <div className="mt-3 text-sm text-gray-600">Fullfører innlogging…</div>
      </div>
    </div>
  );
}