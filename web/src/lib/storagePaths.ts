export function productImagePath(productId: string, fileName: string) {
  const safe = fileName.replaceAll(" ", "_");
  return `products/${productId}/images/${Date.now()}_${safe}`;
}

export function productThumbPath(productId: string, fileName: string) {
  const safe = fileName.replaceAll(" ", "_");
  return `products/${productId}/thumb/${Date.now()}_${safe}`;
}

export function productFilePath(productId: string, fileName: string) {
  const safe = fileName.replaceAll(" ", "_");
  return `products/${productId}/files/${Date.now()}_${safe}`;
}