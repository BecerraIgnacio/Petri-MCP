#!/usr/bin/env -S tsx
/**
 * Phase 4 smoke. Validates:
 *  1. start_split returns reporterInjected: true.
 *  2. The served variant HTML contains the reporter <script>.
 *  3. POST /api/events accepts a few synthetic events and returns 200.
 *  4. read_metrics MCP tool returns the right counts.
 *
 * Usage:
 *   npm run smoke:events -- --url https://petri-mcp.vercel.app
 */
import "dotenv/config";

interface CliArgs { url: string; delayMs: number }

function parseArgs(argv: string[]): CliArgs {
  let url = "https://petri-mcp.vercel.app";
  let delayMs = 500;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url" && argv[i + 1]) url = argv[++i] ?? url;
    else if (a === "--delay" && argv[i + 1]) delayMs = Number(argv[++i]);
  }
  return { url: url.replace(/\/+$/, ""), delayMs };
}

const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface McpEnvelope {
  result?: { structuredContent?: unknown; content?: Array<{ type: string; text: string }>; isError?: boolean };
  error?: unknown;
}

async function callTool<T>(baseUrl: string, name: string, args: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  if (!res.ok) throw new Error(`${name} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as McpEnvelope;
  if (json.result?.isError) {
    const text = json.result.content?.[0]?.text ?? JSON.stringify(json);
    throw new Error(`${name} returned error: ${text}`);
  }
  return json.result?.structuredContent as T;
}

async function postEvent(baseUrl: string, event: unknown): Promise<void> {
  const res = await fetch(`${baseUrl}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST /api/events ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function main(): Promise<void> {
  const { url, delayMs } = parseArgs(process.argv);
  const runId = `smoke-ev-${Date.now().toString(36)}`;
  console.log(`[smoke-events] target=${url} runId=${runId}`);

  // 1. start_split
  const championHtml = "<!doctype html><html><head><title>champ</title></head><body><h1>Champion</h1></body></html>";
  const variantHtml = "<!doctype html><html><head><title>v1</title></head><body><h1>Challenger</h1></body></html>";
  const split = await callTool<{ runUrl: string; reporterInjected: boolean }>(url, "start_split", {
    runId,
    championVariantId: "v0",
    splitRatio: 90,
    variants: [
      { id: "v0", files: [{ path: "index.html", content: championHtml, contentType: "text/html; charset=utf-8" }] },
      { id: "v1", files: [{ path: "index.html", content: variantHtml, contentType: "text/html; charset=utf-8" }] },
    ],
  });
  if (!split.reporterInjected) throw new Error("start_split: reporterInjected was false; expected true");
  console.log(`[smoke-events] start_split ok → ${split.runUrl}`);

  // 2. Reporter injection visible in served HTML
  await sleep(delayMs);
  const variantRes = await fetch(split.runUrl, { headers: BROWSER_HEADERS });
  const variantBody = await variantRes.text();
  if (!variantBody.includes('data-petri="reporter"')) {
    throw new Error(`served variant body missing data-petri="reporter" tag: ${variantBody.slice(0, 200)}`);
  }
  if (!variantBody.includes(`data-run="${runId}"`)) {
    throw new Error(`served variant body missing data-run="${runId}"`);
  }
  console.log(`[smoke-events] reporter <script> present in served HTML`);

  // 3. Synthetic events
  const sessionId = `smoke-sess-${Math.random().toString(36).slice(2, 8)}`;
  const events = [
    { variant_id: "v0", event_name: "impression" },
    { variant_id: "v0", event_name: "click", payload: { selector: "h1" } },
    { variant_id: "v0", event_name: "click", payload: { selector: "button.cta" } },
    { variant_id: "v1", event_name: "impression" },
    { variant_id: "v1", event_name: "pagehide", payload: { duration_ms: 4321, max_scroll: 70 } },
  ];
  for (const ev of events) {
    await postEvent(url, {
      run_id: runId,
      session_id: sessionId,
      ts: Date.now(),
      ...ev,
    });
    await sleep(delayMs);
  }
  console.log(`[smoke-events] posted ${events.length} synthetic events`);

  // 4. read_metrics
  await sleep(delayMs);
  const metrics = await callTool<{
    champion: string;
    variants: Array<{ variantId: string; totalEvents: number; eventCounts: Record<string, number> }>;
  }>(url, "read_metrics", { runId, sample: 50 });
  console.log(`[smoke-events] read_metrics champion=${metrics.champion}`);
  for (const v of metrics.variants) {
    console.log(`  ${v.variantId}: total=${v.totalEvents} counts=${JSON.stringify(v.eventCounts)}`);
  }
  const v0 = metrics.variants.find((v) => v.variantId === "v0");
  const v1 = metrics.variants.find((v) => v.variantId === "v1");
  if (!v0 || v0.totalEvents < 3) throw new Error(`v0 expected ≥3 events, got ${v0?.totalEvents}`);
  if (!v1 || v1.totalEvents < 2) throw new Error(`v1 expected ≥2 events, got ${v1?.totalEvents}`);
  if ((v0.eventCounts.click ?? 0) < 2) throw new Error(`v0 expected ≥2 click events, got ${v0.eventCounts.click}`);

  console.log("[smoke-events] PASS");
}

main().catch((err) => {
  console.error("[smoke-events] FAIL", err);
  process.exit(1);
});
