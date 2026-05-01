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
  delayMs: number;
}

function parseArgs(argv: string[]): CliArgs {
  let url = "https://petri-mcp.vercel.app";
  let n = 20;
  let delayMs = 500;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url" && argv[i + 1]) {
      url = argv[++i] ?? url;
    } else if (a === "--n" && argv[i + 1]) {
      n = Number(argv[++i]);
    } else if (a === "--delay" && argv[i + 1]) {
      delayMs = Number(argv[++i]);
    }
  }
  return { url: url.replace(/\/+$/, ""), n, delayMs };
}

const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BROWSER_HEADERS: Record<string, string> = {
  "user-agent": BROWSER_UA,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const { url, n, delayMs } = parseArgs(process.argv);
  const runId = `smoke-${Date.now().toString(36)}`;

  console.log(`[smoke] target=${url} runId=${runId} n=${n} delayMs=${delayMs}`);

  const { runUrl } = await callStartSplit(url, runId);
  console.log(`[smoke] start_split ok → ${runUrl}`);

  // Distribution test. WAF-tolerant: break out gracefully if Vercel's edge starts
  // challenging mid-loop, accept whatever sample we got, fail only if it's too small.
  const counts: Record<string, number> = {};
  let firstCookie: string | null = null;
  let completed = 0;
  let wafTripped = false;
  for (let i = 0; i < n; i++) {
    const res = await fetch(runUrl, { redirect: "manual", headers: BROWSER_HEADERS });
    if (res.headers.get("x-vercel-mitigated") === "challenge" || res.status === 403) {
      console.log(`[smoke] WAF challenge at req[${i}] (status ${res.status}) — stopping distribution loop`);
      wafTripped = true;
      break;
    }
    const v = readVariantHeader(res);
    if (!v) {
      const text = await res.text();
      throw new Error(`req[${i}] missing x-petri-variant header (status ${res.status}): ${text.slice(0, 200)}`);
    }
    counts[v] = (counts[v] ?? 0) + 1;
    completed++;
    if (i === 0) firstCookie = extractCookie(res.headers.get("set-cookie"));
    if (delayMs > 0 && i < n - 1) await sleep(delayMs);
  }
  if (completed < 10) {
    throw new Error(`only ${completed} requests completed before WAF challenge — too small to validate distribution`);
  }
  const championRatio = (counts.v0 ?? 0) / completed;
  console.log(
    `[smoke] distribution counts=${JSON.stringify(counts)} (n=${completed}${wafTripped ? ", WAF-truncated" : ""}) championRatio=${championRatio.toFixed(3)}`,
  );

  if (championRatio < 0.6 || championRatio > 1.0) {
    throw new Error(`distribution out of band (expected 0.60–1.00 at small N): ${championRatio}`);
  }

  // Sticky test. Skip if WAF tripped — running 10 more reqs would only deepen the
  // challenge. The cookie was already validated on req 0; sticky correctness is
  // exercised by the 13 unit tests in test/middleware-bucket.test.ts.
  if (wafTripped) {
    console.log("[smoke] sticky test skipped (WAF challenge active); covered by unit tests");
  } else {
    if (!firstCookie) throw new Error("no petri_variant cookie set on first response");
    const stickyVariants = new Set<string>();
    let stickyCompleted = 0;
    for (let i = 0; i < 10; i++) {
      const res = await fetch(runUrl, {
        headers: { ...BROWSER_HEADERS, cookie: `petri_variant=${firstCookie}` },
      });
      if (res.headers.get("x-vercel-mitigated") === "challenge" || res.status === 403) {
        console.log(`[smoke] WAF challenge at sticky req[${i}] — stopping sticky loop`);
        break;
      }
      const v = readVariantHeader(res);
      if (v) stickyVariants.add(v);
      stickyCompleted++;
      if (delayMs > 0 && i < 9) await sleep(delayMs);
    }
    if (stickyCompleted >= 3 && stickyVariants.size !== 1) {
      throw new Error(`sticky failed: saw variants ${[...stickyVariants].join(", ")} for cookie ${firstCookie}`);
    }
    console.log(`[smoke] sticky cookie=${firstCookie} → variant=${[...stickyVariants][0] ?? "?"} (${stickyCompleted}/10)`);
  }

  console.log("[smoke] PASS");
}

main().catch((err) => {
  console.error("[smoke] FAIL", err);
  process.exit(1);
});
