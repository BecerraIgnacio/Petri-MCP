import type { IncomingMessage, ServerResponse } from "node:http";
import { runSimulateEvolution } from "../src/shared/simulate-evolution.js";
import { publishSimulationToBlob } from "../src/shared/publish-simulation.js";
import { GitHubFileSource } from "../src/shared/sources/github.js";
import { LiveSiteSource } from "../src/shared/sources/live-site.js";
import type { FileSource } from "../src/shared/file-source.js";
import { getConnectRecord } from "../src/shared/run-store.js";

export const config = {
  maxDuration: 300,
};

interface SimulateParams {
  url: string;
  repoRef?: string;
  generations: number;
  sessionsPerGen: number;
  nVariants: number;
  splitRatio: number;
  seed?: number;
}

const GITHUB_URL_RE = /^https?:\/\/(www\.)?github\.com\//i;

function isGithubUrl(u: string): boolean {
  return GITHUB_URL_RE.test(u) || u.endsWith(".git");
}

function buildSource(p: SimulateParams): { source: FileSource & { ensureReady?: () => Promise<void>; displayName?: () => string }; displayName: string } {
  if (isGithubUrl(p.url)) {
    const opts: { repoUrl: string; ref?: string } = { repoUrl: p.url };
    if (p.repoRef) opts.ref = p.repoRef;
    const src = new GitHubFileSource(opts);
    return { source: src, displayName: src.displayName() };
  }
  const src = new LiveSiteSource({ url: p.url });
  return { source: src, displayName: src.displayName() };
}

function parseQuery(req: IncomingMessage): URLSearchParams {
  const host = req.headers.host ?? "localhost";
  const protocol = (req.headers["x-forwarded-proto"] as string) ?? "https";
  const url = new URL(req.url ?? "/", `${protocol}://${host}`);
  return url.searchParams;
}

async function readParams(qs: URLSearchParams): Promise<SimulateParams | { error: string }> {
  // Three input modes:
  //   1. runId: look up the ConnectRecord and synthesize url + repoRef from originSource.
  //   2. url: explicit (used by the global /dashboard form).
  //   3. repoUrl: alias for url (back-compat).
  let url = qs.get("url") ?? qs.get("repoUrl");
  let repoRef = qs.get("repoRef");

  const runId = qs.get("runId");
  if (runId) {
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(runId)) {
      return { error: `invalid runId: ${runId}` };
    }
    let record;
    try {
      record = await getConnectRecord(runId);
    } catch (err) {
      return { error: `failed to read connect record: ${(err as Error).message}` };
    }
    if (!record) {
      return { error: `runId not found: ${runId}` };
    }
    const o = record.originSource;
    if (o.kind === "github") {
      url = o.repoUrl;
      if (!repoRef && o.repoRef) repoRef = o.repoRef;
    } else if (o.kind === "live") {
      url = o.liveUrl;
    } else {
      // local projectRoot — not reachable from a hosted Vercel function
      return { error: `runId ${runId} is local-only; simulate from the MCP stdio transport instead` };
    }
  }

  if (!url) return { error: "missing required param: url or runId" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: `invalid url: ${url}` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: `unsupported protocol: ${parsed.protocol}` };
  }
  const generations = clampInt(qs.get("generations"), 2, 1, 10);
  const sessionsPerGen = clampInt(qs.get("sessionsPerGen"), 1000, 50, 20_000);
  const nVariants = clampInt(qs.get("nVariants"), 3, 1, 5);
  const splitRatio = clampInt(qs.get("splitRatio"), 90, 0, 100);
  const seedRaw = qs.get("seed");
  const params: SimulateParams = {
    url,
    generations,
    sessionsPerGen,
    nVariants,
    splitRatio,
  };
  if (repoRef) params.repoRef = repoRef;
  if (seedRaw !== null && seedRaw !== "") {
    const n = Number(seedRaw);
    if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) params.seed = n;
  }
  return params;
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function writeSseEvent(res: ServerResponse, event: string, data: unknown): void {
  if (res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

interface ClassifiedError {
  code: "no_tokens" | "rate_limited" | "invalid_key" | "provider_down" | "unknown";
  title: string;
  message: string;
  raw: string;
}

// Map LLM provider failures (OpenRouter via OpenAI SDK) to short, user-facing
// messages. We surface these in the SSE error event so the sim page can render
// a clean banner instead of a stack trace.
function classifyError(err: unknown): ClassifiedError {
  const raw = (err as Error)?.message ?? String(err);
  const status = (err as { status?: number })?.status;
  const lower = raw.toLowerCase();
  const mentionsCredits =
    lower.includes("credit") ||
    lower.includes("insufficient") ||
    lower.includes("quota") ||
    lower.includes("balance") ||
    lower.includes("payment required");
  if (status === 402 || mentionsCredits) {
    return {
      code: "no_tokens",
      title: "Out of LLM credits",
      message:
        "The OpenRouter account backing petri-mcp ran out of credits. Top up at openrouter.ai/credits and re-run the simulation.",
      raw,
    };
  }
  if (status === 429 || lower.includes("rate limit") || lower.includes("too many requests")) {
    return {
      code: "rate_limited",
      title: "Rate limited",
      message:
        "The LLM provider is throttling requests. Wait a minute and try again, or lower sessions/gen.",
      raw,
    };
  }
  if (status === 401 || lower.includes("api key") || lower.includes("unauthorized")) {
    return {
      code: "invalid_key",
      title: "Invalid API key",
      message:
        "The OPENROUTER_API_KEY env var is missing or rejected. Check the petri-mcp Vercel project settings.",
      raw,
    };
  }
  if (status === 503 || lower.includes("upstream") || lower.includes("provider")) {
    return {
      code: "provider_down",
      title: "Upstream provider error",
      message:
        "OpenRouter (or the underlying model) returned an upstream error. Try again, or set PETRI_MODEL to a different model.",
      raw,
    };
  }
  return { code: "unknown", title: "Simulation failed", message: raw, raw };
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end("method not allowed");
    return;
  }

  const qs = parseQuery(req);
  const parsed = await readParams(qs);
  if ("error" in parsed) {
    res.statusCode = 400;
    res.end(parsed.error);
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // First chunk forces clients (and Vercel's edge) to flush headers.
  res.write(": petri-simulate open\n\n");

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": keepalive\n\n");
  }, 15_000);

  try {
    writeSseEvent(res, "started", {
      url: parsed.url,
      sourceKind: isGithubUrl(parsed.url) ? "github" : "live",
      generations: parsed.generations,
      sessionsPerGen: parsed.sessionsPerGen,
      nVariants: parsed.nVariants,
      splitRatio: parsed.splitRatio,
      seed: parsed.seed ?? null,
    });

    const { source, displayName } = buildSource(parsed);
    writeSseEvent(res, "phase", {
      phase: isGithubUrl(parsed.url) ? "fetch_repo" : "fetch_live",
      message: `fetching ${parsed.url}`,
    });
    if (source instanceof GitHubFileSource || source instanceof LiveSiteSource) {
      await source.ensureReady();
    }

    writeSseEvent(res, "phase", { phase: "vibe", message: "identifying brand-locked elements" });

    const simInput = {
      source,
      displayName,
      generations: parsed.generations,
      sessionsPerGen: parsed.sessionsPerGen,
      nVariants: parsed.nVariants,
      splitRatio: parsed.splitRatio,
      ...(parsed.seed !== undefined ? { seed: parsed.seed } : {}),
    };

    const result = await runSimulateEvolution(simInput, {
      onGenerationComplete: ({ generation, summary, lineageSnapshot }) => {
        writeSseEvent(res, "progress", { generation, summary, lineage: lineageSnapshot });
      },
      onVariantsReady: async ({ simId, result: r, variantsByGeneration }) => {
        writeSseEvent(res, "phase", { phase: "publish", message: "uploading explorer to Blob" });
        const { explorerUrl, blobBase } = await publishSimulationToBlob({
          simId,
          result: r,
          variantsByGeneration,
        });
        writeSseEvent(res, "done", {
          simId,
          explorerUrl,
          blobBase,
          winner: r.winner,
          lineage: r.lineage,
        });
      },
    });

    // Belt-and-suspenders: if onVariantsReady didn't fire (shouldn't happen), still emit done.
    if (!res.writableEnded) {
      writeSseEvent(res, "done", {
        simId: result.simId,
        explorerUrl: null,
        winner: result.winner,
        lineage: result.lineage,
      });
    }
  } catch (err) {
    const classified = classifyError(err);
    writeSseEvent(res, "error", {
      code: classified.code,
      title: classified.title,
      message: classified.message,
      raw: classified.raw,
      stack: (err as Error).stack?.split("\n").slice(0, 5).join("\n"),
    });
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
}
