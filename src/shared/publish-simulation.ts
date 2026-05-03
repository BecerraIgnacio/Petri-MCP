import { put } from "@vercel/blob";
import { renderLineageHtml } from "./render-lineage-html.js";
import type { SimVariantFile } from "./simulate-evolution.js";
import type { SimulationResult } from "./simulation-types.js";

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
  return MIME[p.slice(dot + 1).toLowerCase()] ?? "application/octet-stream";
}

function normalizePath(p: string): string {
  const s = p.replace(/^\/+/, "");
  if (s.includes("..")) throw new Error(`publish-simulation: path traversal in "${p}"`);
  return s;
}

async function putPublic(pathname: string, content: string): Promise<string> {
  const res = await put(pathname, content, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: guessContentType(pathname),
  });
  return res.url;
}

export interface PublishSimulationArgs {
  simId: string;
  result: SimulationResult;
  variantsByGeneration: Map<number, Map<string, SimVariantFile[]>>;
}

export interface PublishSimulationResult {
  explorerUrl: string;
  blobBase: string;
}

/**
 * Uploads a complete simulation tree to Vercel Blob under `petri-sim/<simId>/`,
 * matching the layout `renderLineageHtml`'s iframes expect:
 *   petri-sim/<simId>/index.html        — the explorer
 *   petri-sim/<simId>/lineage.json      — full result for debugging
 *   petri-sim/<simId>/gen<N>/<vid>/...  — each variant's files
 *
 * Returns the public explorer URL.
 */
export async function publishSimulationToBlob(
  args: PublishSimulationArgs,
): Promise<PublishSimulationResult> {
  const { simId, result, variantsByGeneration } = args;
  const prefix = `petri-sim/${simId}`;

  const indexHtml = renderLineageHtml(result);
  const indexUrl = await putPublic(`${prefix}/index.html`, indexHtml);
  const blobBase = new URL(indexUrl).origin;

  await putPublic(`${prefix}/lineage.json`, JSON.stringify(result, null, 2));

  for (const [gen, byVariant] of variantsByGeneration) {
    for (const [vid, files] of byVariant) {
      for (const f of files) {
        const safePath = normalizePath(f.path);
        await putPublic(`${prefix}/gen${gen}/${vid}/${safePath}`, f.content);
      }
    }
  }

  return { explorerUrl: indexUrl, blobBase };
}
