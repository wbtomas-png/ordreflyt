// file: web/src/app/cart/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { CartItem, clearCart, getCart, removeFromCart } from "@/lib/cart";

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

export default function CartPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);

      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.replace("/login");
        return;
      }

      if (!alive) return;
      setItems(getCart());
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [router, supabase]);

  const total = useMemo(
    () => items.reduce((sum, x) => sum + (Number(x.list_price) || 0) * (Number(x.qty) || 0), 0),
    [items]
  );

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1200);
  }

  function onClear() {
    clearCart();
    setItems([]);
    showToast("Handlevogn tømt");
  }

  function onRemove(productId: string) {
    setItems(removeFromCart(productId));
    showToast("Fjernet");
    try {
      window.dispatchEvent(new Event("cart:updated"));
    } catch {
      // ignore
    }
  }

  return (
    <div
      className={cn(
        "min-h-screen p-4 md:p-6",
        "bg-gray-950 text-gray-100 md:bg-white md:text-gray-900"
      )}
    >
      <div className="mx-auto max-w-3xl space-y-4">
        {/* Top */}
        <div className="flex items-center justify-between gap-3">
          <button
            className={cn(
              "rounded-xl border px-3 py-2 text-sm",
              "border-gray-800 bg-gray-900 hover:bg-gray-800 text-gray-100",
              "md:border-gray-300 md:bg-white md:text-gray-900 md:hover:bg-gray-50"
            )}
            onClick={() => router.back()}
          >
            ← Tilbake
          </button>

          <button
            className={cn(
              "rounded-xl border px-3 py-2 text-sm",
              "border-gray-800 bg-gray-900 hover:bg-gray-800 text-gray-100",
              "md:border-gray-300 md:bg-white md:text-gray-900 md:hover:bg-gray-50"
            )}
            onClick={onClear}
            disabled={items.length === 0}
            title="Tøm handlevogn"
          >
            Tøm
          </button>
        </div>

        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Handlevogn</h1>
          <div className="text-xs text-gray-400 md:text-gray-600">
            {items.length} varelinje(r)
          </div>
        </div>

        {toast ? (
          <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200 md:border-emerald-200 md:bg-white md:text-emerald-700">
            {toast}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5 text-sm text-gray-200 md:border-gray-200 md:bg-white md:text-gray-700">
            Laster…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5 text-sm text-gray-200 md:border-gray-200 md:bg-white md:text-gray-700">
            Handlevognen er tom.
          </div>
        ) : (
          <div className="space-y-3">
            {/* Items */}
            <ul className="space-y-2">
              {items.map((x) => {
                const line = (Number(x.list_price) || 0) * (Number(x.qty) || 0);
                return (
                  <li
                    key={x.product_id}
                    className={cn(
                      "rounded-2xl border p-4",
                      "border-gray-800 bg-gray-900/40 md:border-gray-200 md:bg-white"
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-xs font-mono text-gray-400 md:text-gray-500">
                          {x.product_no}
                        </div>
                        <div className="mt-0.5 truncate font-medium text-gray-100 md:text-gray-900">
                          {x.name}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                          <span className="text-gray-200 md:text-gray-700">
                            {formatNok(Number(x.list_price) || 0)} × {x.qty}
                          </span>
                          <span className="text-gray-400 md:text-gray-500">·</span>
                          <span className="font-semibold text-gray-100 md:text-gray-900">
                            {formatNok(line)}
                          </span>
                        </div>
                      </div>

                      <button
                        className={cn(
                          "shrink-0 rounded-xl px-3 py-2 text-sm",
                          "border border-red-700/40 bg-red-950/30 text-red-200 hover:bg-red-950/50",
                          "md:border-red-200 md:bg-white md:text-red-700 md:hover:bg-red-50"
                        )}
                        onClick={() => onRemove(x.product_id)}
                        title="Fjern vare"
                      >
                        Fjern
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Summary */}
            <div
              className={cn(
                "rounded-2xl border p-4",
                "border-gray-800 bg-gray-900/40 md:border-gray-200 md:bg-white"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="font-semibold">Sum</div>
                <div className="font-semibold">{formatNok(total)}</div>
              </div>

              <button
                className={cn(
                  "mt-4 w-full rounded-xl px-4 py-3 text-sm font-semibold",
                  "bg-white/10 text-white hover:bg-white/15",
                  "md:bg-black md:text-white md:hover:opacity-90"
                )}
                onClick={() => router.push("/checkout")}
              >
                Gå til bestilling
              </button>

              <div className="mt-2 text-xs text-gray-400 md:text-gray-500">
                Du kan redigere ordreinfo i neste steg.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}