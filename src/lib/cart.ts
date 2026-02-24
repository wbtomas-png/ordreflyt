// file: web/src/lib/cart.ts

export type CartItem = {
  product_id: string;
  product_no: string;
  name: string;
  list_price: number;
  qty: number;
};

const KEY = "internordrer_cart_v1";

export function getCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CartItem[]) : [];
  } catch {
    return [];
  }
}

export function setCart(items: CartItem[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function addToCart(item: Omit<CartItem, "qty">, qty = 1) {
  const cart = getCart();
  const existing = cart.find((x) => x.product_id === item.product_id);
  if (existing) existing.qty += qty;
  else cart.push({ ...item, qty });
  setCart(cart);
  return cart;
}

export function removeFromCart(product_id: string) {
  const cart = getCart().filter((x) => x.product_id !== product_id);
  setCart(cart);
  return cart;
}

export function clearCart() {
  setCart([]);
}