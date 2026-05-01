import { getRunMeta } from "./src/shared/run-store.js";
import { parseCookies, pickBucket } from "./src/shared/run-meta.js";

export const config = {
  matcher: "/p/:runId/:path*",
};

export default async function middleware(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const m = url.pathname.match(/^\/p\/([^/]+)\/?(.*)$/);
  if (!m) return new Response("not found", { status: 404 });

  const runId = m[1];
  const restRaw = m[2] ?? "";
  const rest = restRaw.length === 0 ? "index.html" : restRaw;

  if (!runId) return new Response("not found", { status: 404 });

  let meta;
  try {
    meta = await getRunMeta(runId);
  } catch (err) {
    return new Response(
      `petri middleware: failed to read run meta (${(err as Error).message})`,
      { status: 500 },
    );
  }
  if (!meta) {
    return new Response(`run "${runId}" not found`, { status: 404 });
  }

  const cookieJar = parseCookies(req.headers.get("cookie") ?? "");
  let chosen = cookieJar.petri_variant;
  let setCookie = false;
  if (!chosen || !meta.variantIds.includes(chosen)) {
    chosen = pickBucket(meta);
    setCookie = true;
  }

  const target = `${meta.blobBase}/variants/${runId}/${chosen}/${rest}`;
  const blobRes = await fetch(target);

  const headers = new Headers(blobRes.headers);
  headers.set("x-petri-variant", chosen);
  headers.set("x-petri-run", runId);
  if (setCookie) {
    headers.append(
      "Set-Cookie",
      `petri_variant=${encodeURIComponent(chosen)}; Path=/p/${runId}; Max-Age=2592000; SameSite=Lax`,
    );
  }
  return new Response(blobRes.body, { status: blobRes.status, headers });
}
