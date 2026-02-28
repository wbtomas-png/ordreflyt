// file: web/src/app/checkout/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { CartItem, clearCart, getCart } from "@/lib/cart";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatNok(value: number) {
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(value);
}

function safeNumber(n: unknown) {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? x : 0;
}

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

  const [toast, setToast] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.replace("/login");
        return;
      }
      if (!alive) return;
      setItems(getCart());
    })();

    return () => {
      alive = false;
    };
  }, [router, supabase]);

  const summary = useMemo(() => {
    const lines = items.map((x) => ({
      ...x,
      lineSum: safeNumber(x.list_price) * safeNumber(x.qty),
    }));
    const total = lines.reduce((s, x) => s + x.lineSum, 0);
    const qty = lines.reduce((s, x) => s + safeNumber(x.qty), 0);
    return { lines, total, qty };
  }, [items]);

  function validate() {
    if (items.length === 0) return "Ingen varer i handlevognen.";
    if (!project_name.trim()) return "Prosjektnavn må fylles ut.";
    if (!contact_name.trim()) return "Kontaktperson må fylles ut.";
    if (!delivery_address.trim()) return "Leveringsadresse må fylles ut.";
    return null;
  }

  async function submitOrder() {
    const v = validate();
    if (v) {
      setErr(v);
      return;
    }

    setErr(null);
    setBusy(true);

    const { data: u } = await supabase.auth.getUser();
    const user = u.user;

    if (!user) {
      setBusy(false);
      router.replace("/login");
      return;
    }

    try {
      // ------------------------
      // Opprett ordre
      // ------------------------
      const { data: order, error: orderErr } = await supabase
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
        setErr(`Kunne ikke opprette ordre: ${orderErr?.message ?? "ukjent feil"}`);
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

      const { error: itemsErr } = await supabase.from("order_items").insert(rows as any);

      if (itemsErr) {
        console.error(itemsErr);
        setErr(`Kunne ikke legge inn ordrelinjer: ${itemsErr.message}`);
        return;
      }

      clearCart();
      setToast("Bestilling sendt");
      window.setTimeout(() => setToast(null), 1200);

      router.push("/orders");
    } finally {
      setBusy(false);
    }
  }

  const inputBase =
    "mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none";

  const inputTheme = cn(
    "border-gray-700 bg-gray-900 text-gray-100 placeholder:text-gray-500 focus:border-gray-500",
    "md:border-gray-300 md:bg-white md:text-gray-900 md:placeholder:text-gray-400 md:focus:border-gray-400"
  );

  const cardTheme = cn(
    "rounded-2xl border p-4",
    "border-gray-800 bg-gray-900/40",
    "md:border-gray-200 md:bg-white"
  );

  const subtleText = "text-gray-300 md:text-gray-600";
  const strongText = "text-gray-100 md:text-gray-900";

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 md:bg-white md:text-gray-900">
      {/* Topbar */}
      <div className="sticky top-0 z-10 border-b border-gray-800 bg-gray-950/95 backdrop-blur md:border-gray-200 md:bg-white/80">
        <div className="mx-auto max-w-5xl px-4 md:px-6 py-3">
          <div className="flex items-center justify-between gap-2">
            <button
              className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 hover:bg-gray-800 md:border-gray-300 md:bg-white md:text-gray-900 md:hover:bg-gray-50"
              onClick={() => router.back()}
            >
              ← Tilbake
            </button>
            <button
              className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 hover:bg-gray-800 md:border-gray-300 md:bg-white md:text-gray-900 md:hover:bg-gray-50"
              onClick={() => router.push("/cart")}
            >
              Handlevogn
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-5xl px-4 md:px-6 py-5 space-y-4">
        <div className="space-y-1">
          <h1 className={cn("text-xl font-semibold", strongText)}>Bestilling</h1>
          <p className={cn("text-sm", subtleText)}>
            Fyll inn prosjekt og levering. Oppsummering vises tydelig på mobil.
          </p>
        </div>

        {err ? (
          <div className="rounded-2xl border border-red-700/40 bg-red-950/30 px-4 py-3 text-sm text-red-200 md:border-red-200 md:bg-red-50 md:text-red-700">
            {err}
          </div>
        ) : null}

        {toast ? (
          <div className="rounded-2xl border border-emerald-700/40 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200 md:border-green-200 md:bg-green-50 md:text-green-700">
            {toast}
          </div>
        ) : null}

        {items.length === 0 ? (
          <div className={cn(cardTheme, "text-sm text-gray-300 md:text-gray-600")}>
            Ingen varer i handlevognen.
          </div>
        ) : (
          <>
            {/* Mobil: sticky oppsummering */}
            <div className={cn(cardTheme, "md:hidden")}>
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-200">
                  <span className="font-semibold text-gray-100">{summary.qty}</span> varer
                </div>
                <div className="text-sm">
                  Total: <span className="font-semibold text-gray-100">{formatNok(summary.total)}</span>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {summary.lines.slice(0, 4).map((x) => (
                  <div key={`${x.product_id}-${x.product_no}`} className="rounded-xl border border-gray-800 bg-gray-950/40 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-mono text-gray-400">{x.product_no}</div>
                        <div className="text-sm font-medium text-gray-100 truncate" title={x.name}>
                          {x.name}
                        </div>
                        <div className="mt-1 text-xs text-gray-300">
                          Antall: <span className="font-medium text-gray-100">{x.qty}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-gray-400">Linje</div>
                        <div className="text-sm font-semibold text-gray-100">{formatNok(x.lineSum)}</div>
                      </div>
                    </div>
                  </div>
                ))}
                {summary.lines.length > 4 ? (
                  <div className="text-xs text-gray-400">
                    + {summary.lines.length - 4} flere linjer (se i handlevogn)
                  </div>
                ) : null}
              </div>
            </div>

            {/* Prosjekt */}
            <div className={cardTheme}>
              <div className="flex items-center justify-between">
                <div className={cn("font-semibold", strongText)}>Prosjekt</div>
                <div className={cn("text-xs", subtleText)}>* påkrevd</div>
              </div>

              <div className="mt-3 grid gap-3">
                <label className="text-sm">
                  Prosjektnavn <span className="text-red-300 md:text-red-600">*</span>
                  <input
                    className={cn(inputBase, inputTheme)}
                    value={project_name}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="F.eks. Sandviken Brannstasjon"
                  />
                </label>

                <label className="text-sm">
                  Prosjektnummer
                  <input
                    className={cn(inputBase, inputTheme)}
                    value={project_no}
                    onChange={(e) => setProjectNo(e.target.value)}
                    placeholder="Valgfritt"
                  />
                </label>
              </div>
            </div>

            {/* Kontakt */}
            <div className={cardTheme}>
              <div className={cn("font-semibold", strongText)}>Kontakt</div>

              <div className="mt-3 grid gap-3">
                <label className="text-sm">
                  Kontaktperson <span className="text-red-300 md:text-red-600">*</span>
                  <input
                    className={cn(inputBase, inputTheme)}
                    value={contact_name}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Navn"
                  />
                </label>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm">
                    Telefon
                    <input
                      className={cn(inputBase, inputTheme)}
                      value={contact_phone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      placeholder="Valgfritt"
                    />
                  </label>

                  <label className="text-sm">
                    E-post
                    <input
                      className={cn(inputBase, inputTheme)}
                      value={contact_email}
                      onChange={(e) => setContactEmail(e.target.value)}
                      placeholder="Valgfritt"
                      inputMode="email"
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* Levering */}
            <div className={cardTheme}>
              <div className={cn("font-semibold", strongText)}>Levering</div>

              <div className="mt-3 grid gap-3">
                <label className="text-sm">
                  Adresse <span className="text-red-300 md:text-red-600">*</span>
                  <input
                    className={cn(inputBase, inputTheme)}
                    value={delivery_address}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    placeholder="Gateadresse, evt. mer info"
                  />
                </label>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm">
                    Postnr
                    <input
                      className={cn(inputBase, inputTheme)}
                      value={delivery_postcode}
                      onChange={(e) => setDeliveryPostcode(e.target.value)}
                      placeholder="Valgfritt"
                      inputMode="numeric"
                    />
                  </label>

                  <label className="text-sm">
                    Sted
                    <input
                      className={cn(inputBase, inputTheme)}
                      value={delivery_city}
                      onChange={(e) => setDeliveryCity(e.target.value)}
                      placeholder="Valgfritt"
                    />
                  </label>
                </div>

                <label className="text-sm">
                  Kommentar
                  <textarea
                    className={cn(inputBase, inputTheme)}
                    rows={4}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Valgfritt"
                  />
                </label>
              </div>
            </div>

            {/* Desktop: oppsummering i kort */}
            <div className={cn(cardTheme, "hidden md:block")}>
              <div className="flex items-center justify-between">
                <div className="font-semibold">Oppsummering</div>
                <div className="text-sm text-gray-600">{summary.lines.length} linje(r)</div>
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-gray-600">
                      <th className="border-b py-2 pr-3">Produkt</th>
                      <th className="border-b py-2 pr-3">Navn</th>
                      <th className="border-b py-2 pr-3 text-right">Antall</th>
                      <th className="border-b py-2 pr-3 text-right">Pris</th>
                      <th className="border-b py-2 text-right">Linjesum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.lines.map((x) => (
                      <tr key={`${x.product_id}-${x.product_no}`} className="align-top">
                        <td className="border-b py-2 pr-3 font-medium">{x.product_no}</td>
                        <td className="border-b py-2 pr-3">{x.name}</td>
                        <td className="border-b py-2 pr-3 text-right">{x.qty}</td>
                        <td className="border-b py-2 pr-3 text-right">{formatNok(safeNumber(x.list_price))}</td>
                        <td className="border-b py-2 text-right">{formatNok(x.lineSum)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4} className="pt-3 text-right font-semibold">
                        Total
                      </td>
                      <td className="pt-3 text-right font-semibold">{formatNok(summary.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <button
              disabled={busy}
              onClick={submitOrder}
              className={cn(
                "w-full rounded-xl px-4 py-3 text-sm font-semibold",
                "bg-white/10 text-gray-100 hover:bg-white/15 disabled:opacity-50",
                "md:bg-black md:text-white md:hover:opacity-90"
              )}
            >
              {busy ? "Sender…" : `Send bestilling (${formatNok(summary.total)})`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}