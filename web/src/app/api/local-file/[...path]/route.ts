// file: web/src/app/api/local-file/[...path]/route.ts
export const runtime = "nodejs";

import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

function getMimeType(ext: string) {
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".pdf":
      return "application/pdf";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".csv":
      return "text/csv; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function safeResolve(root: string, relPath: string) {
  // Normaliser: fjern leading slashes, og bytt windows backslash til /
  const cleaned = String(relPath ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");

  const rootResolved = path.resolve(root);
  const fullResolved = path.resolve(path.join(rootResolved, cleaned));

  // Sørg for at fullResolved faktisk ligger under rootResolved
  // (bruk path.sep for å unngå at "C:\InternordrerX" matcher "C:\Internordrer")
  const rootWithSep = rootResolved.endsWith(path.sep)
    ? rootResolved
    : rootResolved + path.sep;

  // Windows er case-insensitive, så vi sammenligner lower-case
  const fullCmp = fullResolved.toLowerCase();
  const rootCmp = rootWithSep.toLowerCase();

  if (!fullCmp.startsWith(rootCmp)) {
    throw new Error("Invalid path");
  }

  return fullResolved;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: parts } = await ctx.params;

    const root = process.env.FILE_STORAGE_ROOT || "C:\\Internordrer";
    const rel = (parts ?? []).join("/");

    if (!rel) return new NextResponse("Bad request", { status: 400 });

    const full = safeResolve(root, rel);

    if (!fs.existsSync(full)) {
      return new NextResponse("Not found", { status: 404 });
    }

    const ext = path.extname(full).toLowerCase();
    const mime = getMimeType(ext);

    const buf = fs.readFileSync(full);

    // Inline for bilder/PDF, attachment for “andre” filer
    const isInline = mime.startsWith("image/") || mime === "application/pdf";
    const filename = path.basename(full);

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(buf.byteLength),
        "Cache-Control": "private, max-age=60",
        "Content-Disposition": `${isInline ? "inline" : "attachment"}; filename="${encodeURIComponent(
          filename
        )}"`,
        Vary: "Authorization, Cookie",
      },
    });
  } catch (e) {
    console.error("[local-file] error:", e);
    return new NextResponse("Bad request", { status: 400 });
  }
}