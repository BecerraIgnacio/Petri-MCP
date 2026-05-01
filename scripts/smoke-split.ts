#!/usr/bin/env -S tsx
/**
 * Smoke test for the Phase 3 traffic-split flow against a deployed petri-mcp.
 *
 * Usage:
 *   tsx scripts/smoke-split.ts --url https://petri-mcp.vercel.app
 *
 * What it does:
 *  1. Calls the deployed `start_split` MCP tool with two tiny HTML variants under a fresh runId.
 *  2. Hits /p/<runId>/ N=200 times with fresh cookies → tallies champion ratio.
 *  3. Hits /p/<runId>/ 10 times reusing the cookie from the first call → asserts sticky.
 */
import "dotenv/config";

interface CliArgs {
  url: string;
  n: number;
}

function parseArgs(argv: string[]): CliArgs {
  let url = "https://petri-mcp.vercel.app";
  let n = 200;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url" && argv[i + 1]) {
      url = argv[++i] ?? url;
    } else if (a === "--n" && argv[i + 1]) {
      n = Number(argv[++i]);
    }
  }
  return { url: url.replace(/\/+$/, ""), n };
}

async function callStartSplit(baseUrl: string, runId: string): Promise<{ runUrl: string }> {
  const championHtml =
    "<!doctype html><html><head><title>champion</title></head><body><h1 data-variant='v0'>Champion</h1></body></html>";
  const variantHtml =
    "<!doctype html><html><head><title>v1</title></head><body><h1 data-variant='v1'>Challenger</h1></body></html>";

  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "start_split",
      arguments: {
        runId,
        championVariantId: "v0",
        splitRatio: 90,
        variants: [
          { id: "v0", files: [{ path: "index.html", content: championHtml, contentType: "text/html; charset=utf-8" }] },
          { id: "v1", files: [{ path: "index.html", content: variantHtml, contentType: "text/html; charset=utf-8" }] },
        ],
      },
    },
  };

  const res = await fetch(`${baseUrl}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`start_split HTTP ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { result?: { structuredContent?: { runUrl?: string } } };
  const runUrl = json.result?.structuredContent?.runUrl;
  if (!runUrl) throw new Error(`start_split: response missing runUrl: ${JSON.stringify(json)}`);
  return { runUrl };
}

function readVariantHeader(res: Response): string | null {
  return res.headers.get("x-petri-variant");
}

function extractCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const m = setCookie.match(/petri_variant=([^;]+)/);
  return m?.[1] ?? null;
}

async function main(): Promise<void> {
  const { url, n } = parseArgs(process.argv);
  const runId = `smoke-${Date.now().toString(36)}`;

  console.log(`[smoke] target=${url} runId=${runId} n=${n}`);

  const { runUrl } = await callStartSplit(url, runId);
  console.log(`[smoke] start_split ok → ${runUrl}`);

  // Distribution test.
  const counts: Record<string, number> = {};
  let firstCookie: string | null = null;
  for (let i = 0; i < n; i++) {
    const res = await fetch(runUrl, { redirect: "manual" });
    const v = readVariantHeader(res);
    if (!v) {
      const text = await res.text();
      throw new Error(`req[${i}] missing x-petri-variant header (status ${res.status}): ${text.slice(0, 200)}`);
    }
    counts[v] = (counts[v] ?? 0) + 1;
    if (i === 0) firstCookie = extractCookie(res.headers.get("set-cookie"));
  }
  const championRatio = (counts.v0 ?? 0) / n;
  console.log(`[smoke] distribution counts=${JSON.stringify(counts)} championRatio=${championRatio.toFixed(3)}`);

  if (championRatio < 0.8 || championRatio > 0.95) {
    throw new Error(`distribution out of band (expected 0.80–0.95): ${championRatio}`);
  }

  // Sticky test.
  if (!firstCookie) throw new Error("no petri_variant cookie set on first response");
  const stickyVariants = new Set<string>();
  for (let i = 0; i < 10; i++) {
    const res = await fetch(runUrl, { headers: { cookie: `petri_variant=${firstCookie}` } });
    const v = readVariantHeader(res);
    if (v) stickyVariants.add(v);
  }
  if (stickyVariants.size !== 1) {
    throw new Error(`sticky failed: saw variants ${[...stickyVariants].join(", ")} for cookie ${firstCookie}`);
  }
  console.log(`[smoke] sticky cookie=${firstCookie} → variant=${[...stickyVariants][0]} (10/10)`);

  console.log("[smoke] PASS");
}

main().catch((err) => {
  console.error("[smoke] FAIL", err);
  process.exit(1);
});
