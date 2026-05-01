import { put } from "@vercel/blob";

export interface PublishFile {
  path: string;
  content: string;
  contentType?: string;
}

export interface PublishVariantArgs {
  runId: string;
  variantId: string;
  files: PublishFile[];
}

export interface PublishVariantResult {
  urls: string[];
  blobBase: string;
}

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  mjs: "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  ico: "image/x-icon",
  txt: "text/plain; charset=utf-8",
};

function guessContentType(p: string): string {
  const dot = p.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  const ext = p.slice(dot + 1).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

function normalizePath(p: string): string {
  let s = p.replace(/^\/+/, "");
  if (s.includes("..")) throw new Error(`publish: refusing path traversal in "${p}"`);
  return s;
}

export async function publishVariantFiles(
  args: PublishVariantArgs,
): Promise<PublishVariantResult> {
  if (args.files.length === 0) {
    throw new Error("publish: variant must have at least one file");
  }
  const urls: string[] = [];
  let blobBase = "";
  for (const f of args.files) {
    const safePath = normalizePath(f.path);
    const pathname = `variants/${args.runId}/${args.variantId}/${safePath}`;
    const res = await put(pathname, f.content, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: f.contentType ?? guessContentType(safePath),
    });
    urls.push(res.url);
    if (!blobBase) blobBase = new URL(res.url).origin;
  }
  return { urls, blobBase };
}
