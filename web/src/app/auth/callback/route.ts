// file: web/src/app/auth/callback/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = url.searchParams.get("next") || "/products";

  // NB: cookies() kan være async i Next 15/16
  const cookieStore = await cookies();

  const supabase = createRouteHandlerClient(
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          cookieStore.set({ name, value: "", ...options, maxAge: 0 });
        },
      },
    },
    {
      // valgfritt: hvis du kjører med env via NEXT_PUBLIC_SUPABASE_URL/ANON_KEY,
      // så trenger du ikke sette noe her.
    }
  );

  // Denne gjør PKCE exchange og lagrer session i cookies
  const { error } = await supabase.auth.exchangeCodeForSession(url.toString());

  if (error) {
    // Send tilbake til login med en liten feilmelding i URL
    const loginUrl = new URL("/login", url.origin);
    loginUrl.searchParams.set("error", error.message);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}