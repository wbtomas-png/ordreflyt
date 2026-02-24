// file: web/src/app/cart/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { CartItem, clearCart, getCart, removeFromCart } from "@/lib/cart";

function formatNok(value: number) {
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function CartPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [items, setItems] = useState<CartItem[]>([]);

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

  const total = items.reduce((sum, x) => sum + x.list_price * x.qty, 0);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <button className="underline" onClick={() => router.back()}>
          ← Tilbake
        </button>
        <button
          className="rounded-lg border px-3 py-2"
          onClick={() => {
            clearCart();
            setItems([]);
          }}
        >
          Tøm
        </button>
      </div>

      <h1 className="text-xl font-semibold">Handlevogn</h1>

      {items.length === 0 ? (
        <div className="rounded-lg border p-4 text-sm text-gray-600">
          Handlevognen er tom.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((x) => (
            <div key={x.product_id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm text-gray-600">{x.product_no}</div>
                  <div className="font-medium">{x.name}</div>
                  <div className="text-sm">
                    {formatNok(x.list_price)} × {x.qty}
                  </div>
                </div>
                <button
                  className="underline text-sm"
                  onClick={() => {
                    setItems(removeFromCart(x.product_id));
                  }}
                >
                  Fjern
                </button>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="font-semibold">Sum</div>
            <div className="font-semibold">{formatNok(total)}</div>
          </div>

          <button
  className="w-full rounded-lg bg-black px-4 py-2 text-white"
  onClick={() => router.push("/checkout")}
>
  Gå til bestilling
</button>
        </div>
      )}
    </div>
  );
}