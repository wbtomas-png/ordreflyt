// file: web/src/app/page.tsx

import { redirect } from "next/navigation";

export default function Home() {
  // Root skal alltid lande på /login
  redirect("/login");
}