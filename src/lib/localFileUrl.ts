// file: web/src/lib/localFileUrl.ts

// Viktig: encode hver path-del, ikke hele strengen.
export function localFileUrl(relativePath: string) {
  const cleaned = String(relativePath ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");

  return `/api/local-file/${cleaned
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/")}`;
}