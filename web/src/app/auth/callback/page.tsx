// file: web/src/app/auth/callback/page.tsx
import AuthCallbackClient from "./AuthCallbackClient";

export default function AuthCallbackPage() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm space-y-3">
        <div className="text-lg font-semibold">OrderFlow</div>
        <AuthCallbackClient />
      </div>
    </div>
  );
}