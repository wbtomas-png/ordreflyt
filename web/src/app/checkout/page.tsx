// file: web/src/app/checkout/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { CartItem, clearCart, getCart } from "@/lib/cart";

export default function CheckoutPage() {
  const router = useRouter();

  // Viktig: cast til any for å unngå Supabase never-typing
  const supabase = useMemo(() => supabaseBrowser() as any, []);

  const [items, setItems] = useState<CartItem[]>([]);
  const [busy, setBusy] = useState(false);

  const [project_name, setProjectName] = useState("");
  const [project_no, setProjectNo] = useState("");

  const [contact_name, setContactName] = useState("");
  const [contact_phone, setContactPhone] = useState("");
  const [contact_email, setContactEmail] = useState("");

  const [delivery_address, setDeliveryAddress] = useState("");
  const [delivery_postcode, setDeliveryPostcode] = useState("");
  const [delivery_city, setDeliveryCity] = useState("");

  const [comment, setComment] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.replace("/login");
        return;
      }
      setItems(getCart());
    })();
  }, [router, supabase]);

  async function submitOrder() {
    if (items.length === 0) return;

    if (!project_name.trim()) {
      alert("Prosjektnavn må fylles ut.");
      return;
    }

    if (!contact_name.trim()) {
      alert("Kontaktperson må fylles ut.");
      return;
    }

    if (!delivery_address.trim()) {
      alert("Leveringsadresse må fylles ut.");
      return;
    }

    setBusy(true);

    const { data: u } = await supabase.auth.getUser();
    const user = u.user;

    if (!user) {
      setBusy(false);
      router.replace("/login");
      return;
    }

    // ------------------------
    // Opprett ordre
    // ------------------------
    const { data: order, error: orderErr } = await (supabase as any)
      .from("orders")
      .insert({
        created_by: user.id,
        project_name: project_name.trim(),
        project_no: project_no.trim() || null,
        contact_name: contact_name.trim(),
        contact_phone: contact_phone.trim() || null,
        contact_email: contact_email.trim() || null,
        delivery_address: delivery_address.trim(),
        delivery_postcode: delivery_postcode.trim() || null,
        delivery_city: delivery_city.trim() || null,
        comment: comment.trim() || null,
      } as any)
      .select("id")
      .single();

    if (orderErr || !order) {
      console.error(orderErr);
      alert(
        `Kunne ikke opprette ordre: ${
          orderErr?.message ?? "ukjent feil"
        }`
      );
      setBusy(false);
      return;
    }

    // ------------------------
    // Opprett ordrelinjer
    // ------------------------
    const rows = items.map((x) => ({
      order_id: order.id,
      product_id: x.product_id,
      product_no: x.product_no,
      name: x.name,
      unit_price: x.list_price,
      qty: x.qty,
    }));

    const { error: itemsErr } = await (supabase as any)
      .from("order_items")
      .insert(rows as any);

    if (itemsErr) {
      console.error(itemsErr);
      alert(`Kunne ikke legge inn ordrelinjer: ${itemsErr.message}`);
      setBusy(false);
      return;
    }

    clearCart();
    setBusy(false);
    router.push("/orders");
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <button className="underline" onClick={() => router.back()}>
          ← Tilbake
        </button>
        <button className="underline" onClick={() => router.push("/cart")}>
          Handlevogn
        </button>
      </div>

      <h1 className="text-xl font-semibold">Bestilling</h1>

      {items.length === 0 ? (
        <div className="rounded-lg border p-4 text-sm text-gray-600">
          Ingen varer i handlevognen.
        </div>
      ) : (
        <>
          {/* Prosjekt */}
          <div className="grid gap-3 rounded-xl border p-4">
            <label className="text-sm">
              Prosjektnavn *
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={project_name}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </label>

            <label className="text-sm">
              Prosjektnummer
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={project_no}
                onChange={(e) => setProjectNo(e.target.value)}
              />
            </label>
          </div>

          {/* Kontakt */}
          <div className="grid gap-3 rounded-xl border p-4">
            <div className="font-semibold">Kontakt</div>

            <label className="text-sm">
              Kontaktperson *
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={contact_name}
                onChange={(e) => setContactName(e.target.value)}
              />
            </label>

            <label className="text-sm">
              Telefon
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={contact_phone}
                onChange={(e) => setContactPhone(e.target.value)}
              />
            </label>

            <label className="text-sm">
              E-post
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={contact_email}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </label>
          </div>

          {/* Levering */}
          <div className="grid gap-3 rounded-xl border p-4">
            <div className="font-semibold">Levering</div>

            <label className="text-sm">
              Adresse *
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={delivery_address}
                onChange={(e) => setDeliveryAddress(e.target.value)}
              />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                Postnr
                <input
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                  value={delivery_postcode}
                  onChange={(e) => setDeliveryPostcode(e.target.value)}
                />
              </label>

              <label className="text-sm">
                Sted
                <input
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                  value={delivery_city}
                  onChange={(e) => setDeliveryCity(e.target.value)}
                />
              </label>
            </div>

            <label className="text-sm">
              Kommentar
              <textarea
                className="mt-1 w-full rounded-lg border px-3 py-2"
                rows={4}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </label>
          </div>

          <button
            disabled={busy}
            onClick={submitOrder}
            className="w-full rounded-lg bg-black px-4 py-2 text-white disabled:opacity-50"
          >
            {busy ? "Sender…" : "Send bestilling"}
          </button>
        </>
      )}
    </div>
  );
}