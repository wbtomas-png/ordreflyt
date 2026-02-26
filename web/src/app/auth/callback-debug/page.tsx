// file: web/src/app/auth/callback-debug/page.tsx
"use client";

import AuthCallbackClient from "../auth/callback/AuthCallbackClient";

export default function CallbackDebugPage() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="w-full max-w-2xl rounded-2xl border bg-white p-8 shadow-sm space-y-3">
        <div className="text-lg font-semibold">OrderFlow</div>
        <AuthCallbackClient />
      </div>
    </div>
  );
}