#!/usr/bin/env -S tsx
/**
 * Read live metrics for a petri runId from the deployed MCP.
 *
 * Usage:
 *   npm run metrics -- --runId smoke-ev-monf72xb
 *   npm run metrics -- --runId smoke-ev-monf72xb --variantId v0
 *   npm run metrics -- --runId smoke-ev-monf72xb --url https://petri-mcp.vercel.app
 */
import "dotenv/config";

interface CliArgs {
  url: string;
  runId: string;
  variantId?: string;
  sample: number;
}

function parseArgs(argv: string[]): CliArgs {
  let url = "https://petri-mcp.vercel.app";
  let runId = "";
  let variantId: string | undefined;
  let sample = 50;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url" && argv[i + 1]) url = argv[++i] ?? url;
    else if (a === "--runId" && argv[i + 1]) runId = argv[++i] ?? "";
    else if (a === "--variantId" && argv[i + 1]) variantId = argv[++i];
    else if (a === "--sample" && argv[i + 1]) sample = Number(argv[++i]);
  }
  return { url: url.replace(/\/+$/, ""), runId, ...(variantId ? { variantId } : {}), sample };
}

async function main(): Promise<void> {
  const { url, runId, variantId, sample } = parseArgs(process.argv);
  if (!runId) {
    console.error("usage: npm run metrics -- --runId <runId> [--variantId <vId>] [--url <baseUrl>] [--sample <n>]");
    process.exit(2);
  }
  const args: Record<string, unknown> = { runId, sample };
  if (variantId) args.variantId = variantId;

  const res = await fetch(`${url}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "read_metrics", arguments: args },
    }),
  });
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    process.exit(1);
  }
  const json = (await res.json()) as {
    result?: { structuredContent?: unknown; content?: Array<{ text: string }>; isError?: boolean };
  };
  if (json.result?.isError) {
    console.error("MCP error:", json.result.content?.[0]?.text ?? JSON.stringify(json));
    process.exit(1);
  }
  console.log(JSON.stringify(json.result?.structuredContent, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
