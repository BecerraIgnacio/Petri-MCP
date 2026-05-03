#!/usr/bin/env node
import "dotenv/config";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runVibeIdentifier } from "./agents/vibe-identifier/index.js";
import { runUxUiEvolver } from "./agents/ux-ui-evolver/index.js";
import { VibeIdentifierOk } from "./agents/vibe-identifier/schema.js";
import { LocalFileSource, type FileSource } from "./shared/file-source.js";
import { GitHubFileSource } from "./shared/sources/github.js";
import { LiveSiteSource } from "./shared/sources/live-site.js";
import { runStartSplit } from "./shared/start-split.js";
import { runReadMetrics } from "./shared/events.js";
import { runScoreGeneration } from "./shared/score-generation.js";
import { runEvolveNext } from "./shared/evolve-next.js";
import { runConnectSite } from "./shared/connect-site.js";
import { startHttpTransport } from "./transports/http.js";

const PETRI_PUBLIC_BASE =
  process.env.PETRI_PUBLIC_BASE ?? "https://petri-mcp.vercel.app";

interface SourceInput {
  projectRoot?: string;
  repoUrl?: string;
  repoRef?: string;
  liveUrl?: string;
}

interface BuiltSource {
  source: FileSource;
  displayName: string;
}

function buildSource(input: SourceInput): BuiltSource {
  if (input.liveUrl) {
    const source = new LiveSiteSource({ url: input.liveUrl });
    return { source, displayName: source.displayName() };
  }
  if (input.projectRoot) {
    const root = path.resolve(input.projectRoot);
    return { source: new LocalFileSource(root), displayName: root };
  }
  if (input.repoUrl) {
    const source = new GitHubFileSource({ repoUrl: input.repoUrl, ref: input.repoRef });
    return { source, displayName: source.displayName() };
  }
  throw new Error("buildSource: expected one of liveUrl, projectRoot, or repoUrl");
}

function assertExactlyOneSource(v: SourceInput): void {
  const provided = (v.projectRoot ? 1 : 0) + (v.repoUrl ? 1 : 0) + (v.liveUrl ? 1 : 0);
  if (provided !== 1) {
    throw new Error("provide exactly one of liveUrl, projectRoot, or repoUrl");
  }
}

const projectRootField = z
  .string()
  .min(1)
  .optional()
  .describe("Absolute path to the project's root directory on the host filesystem.");

const repoUrlField = z
  .string()
  .url()
  .optional()
  .describe("Public GitHub URL: https://github.com/<owner>/<repo>");

const repoRefField = z
  .string()
  .optional()
  .describe("Optional git branch or tag. Defaults to the repo's default branch.");

const liveUrlField = z
  .string()
  .url()
  .optional()
  .describe(
    "Public URL of a deployed page (typically a v0 site on Vercel). petri fetches the rendered HTML and treats it as a single virtual `index.html` for evolution. Use this for v0/Next.js projects — repoUrl alone won't work because the source is .tsx, not HTML.",
  );

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "petri-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "vibe_identifier",
    {
      title: "Vibe Identifier",
      description:
        "Scan a v0 project (local path or GitHub repo URL) and return a JSON manifest of brand-defining elements (logo, key phrases, palette, fonts, voice) plus the locked_selectors[] list the UX/UI Evolver must not mutate.",
      inputSchema: {
        projectRoot: projectRootField,
        repoUrl: repoUrlField,
        repoRef: repoRefField,
        liveUrl: liveUrlField,
        hints: z
          .object({
            brand_name: z.string().optional(),
            site_type: z
              .enum(["saas", "news", "ads", "ecommerce", "landing", "other"])
              .optional(),
          })
          .optional()
          .describe("Optional caller hints to anchor the search."),
      },
    },
    async (args) => {
      assertExactlyOneSource(args);
      const { source, displayName } = buildSource(args);
      if (source instanceof GitHubFileSource || source instanceof LiveSiteSource) await source.ensureReady();
      const result = await runVibeIdentifier({ source, displayName, hints: args.hints });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "ux_ui_evolver",
    {
      title: "UX/UI Evolver",
      description:
        "Given a v0 project (local path or GitHub repo URL), a Vibe Identifier lock manifest, and a target metric, produce N small variants of the project. Each variant has a hypothesis and ≥1 typed mutations. Mutations whose tuples overlap any locked entry are rejected by construction.",
      inputSchema: {
        projectRoot: projectRootField,
        repoUrl: repoUrlField,
        repoRef: repoRefField,
        liveUrl: liveUrlField,
        lockManifest: VibeIdentifierOk.describe(
          "The full Vibe Identifier output (status: 'ok' variant) for this project.",
        ),
        targetMetric: z
          .object({
            name: z.string(),
            description: z.string(),
            direction: z.enum(["increase", "decrease"]),
          })
          .optional()
          .describe("The metric the variants should optimize for. Optional — falls back to lockManifest.inferred_metric when omitted."),
        nVariants: z
          .number()
          .int()
          .min(1)
          .max(5)
          .default(3)
          .describe("How many variants to produce per generation. 1–5; default 3."),
      },
    },
    async (args) => {
      assertExactlyOneSource(args);
      const { source, displayName } = buildSource(args);
      if (source instanceof GitHubFileSource || source instanceof LiveSiteSource) await source.ensureReady();
      const result = await runUxUiEvolver({
        source,
        displayName,
        lockManifest: args.lockManifest,
        ...(args.targetMetric ? { targetMetric: args.targetMetric } : {}),
        nVariants: args.nVariants,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "start_split",
    {
      title: "Start traffic split",
      description:
        "Publish a champion + N variants to petri-hosted Vercel Blob and register a sticky-bucket split (default 90/10). Returns a public petri URL that serves the right bucket per visitor via the petri_variant cookie. Each variant ships its own file set; one of them must be the champion.",
      inputSchema: {
        runId: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,59}$/)
          .describe("kebab-case identifier, ≤60 chars. Used in URLs and KV keys."),
        championVariantId: z
          .string()
          .min(1)
          .describe("ID of the variant in `variants` that should serve as champion (≈splitRatio% of traffic)."),
        splitRatio: z
          .number()
          .int()
          .min(0)
          .max(100)
          .default(90)
          .describe("Percent of traffic served the champion. Default 90."),
        variants: z
          .array(
            z.object({
              id: z
                .string()
                .min(1)
                .describe("Variant id. Conventionally `v0`/`champion` for the champion and `v1`,`v2`,… for challengers."),
              files: z
                .array(
                  z.object({
                    path: z
                      .string()
                      .min(1)
                      .describe("Relative path inside the variant, e.g. `index.html`."),
                    content: z.string(),
                    contentType: z.string().optional(),
                  }),
                )
                .min(1),
            }),
          )
          .min(2)
          .describe("Champion + ≥1 challenger. Each variant carries its own files."),
        targetMetric: z
          .object({
            name: z.string(),
            description: z.string(),
            direction: z.enum(["increase", "decrease"]),
          })
          .optional()
          .describe("Run-level target metric. Required for later score_generation calls; pass it here on the first start_split."),
        lockManifest: VibeIdentifierOk
          .optional()
          .describe("Vibe Identifier output for this project. Required if you plan to call evolve_next_generation later — it persists to KV under petri:run:<id>:lock."),
        originSource: z
          .union([
            z.object({ kind: z.literal("local"), projectRoot: z.string().min(1) }),
            z.object({
              kind: z.literal("github"),
              repoUrl: z.string().url(),
              repoRef: z.string().min(1).optional(),
            }),
          ])
          .optional()
          .describe("Where the run's original source lives. Optional — useful for reproducibility/audit."),
      },
    },
    async (args) => {
      const result = await runStartSplit(
        {
          runId: args.runId,
          championVariantId: args.championVariantId,
          splitRatio: args.splitRatio ?? 90,
          variants: args.variants.map((v) => ({
            id: v.id,
            files: v.files.map((f) => ({
              path: f.path,
              content: f.content,
              ...(f.contentType ? { contentType: f.contentType } : {}),
            })),
          })),
          ...(args.targetMetric ? { targetMetric: args.targetMetric } : {}),
          ...(args.lockManifest ? { lockManifest: args.lockManifest } : {}),
          ...(args.originSource ? { originSource: args.originSource } : {}),
        },
        PETRI_PUBLIC_BASE,
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: { ...result } as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "read_metrics",
    {
      title: "Read variant metrics",
      description:
        "Aggregate event counts per variant for a given run, plus a sample of recent events. Powered by the reporter snippet that start_split injects into every variant's <head>.",
      inputSchema: {
        runId: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,59}$/)
          .describe("The runId previously registered via start_split."),
        variantId: z
          .string()
          .min(1)
          .optional()
          .describe("Restrict to a single variant. Omit to aggregate across all variants."),
        sample: z
          .number()
          .int()
          .min(0)
          .max(500)
          .default(50)
          .describe("How many recent events to sample per variant (for breakdown + uniqueSessions). 0 disables sampling."),
      },
    },
    async (args) => {
      const result = await runReadMetrics({
        runId: args.runId,
        ...(args.variantId ? { variantId: args.variantId } : {}),
        sample: args.sample ?? 50,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: { ...result } as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "score_generation",
    {
      title: "Score the current generation",
      description:
        "Read recent events for every variant in a run, ask the Scorer LLM to grade each variant against the run's target metric (or inferred fallback), and promote the highest-scoring variant if it strictly beat the champion above the sample threshold. Writes scores to petri:run:<id>:scores:<gen>; on promotion, increments currentGeneration and appends to petri:run:<id>:generations.",
      inputSchema: {
        runId: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,59}$/)
          .describe("The runId previously registered via start_split."),
        minSessionsPerVariant: z
          .number()
          .int()
          .min(1)
          .max(10000)
          .default(30)
          .describe("Minimum unique sessions a variant needs before it can be promoted. Default 30."),
        sampleSize: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(200)
          .describe("How many recent events per variant to feed the Scorer. Default 200."),
      },
    },
    async (args) => {
      const result = await runScoreGeneration({
        runId: args.runId,
        minSessionsPerVariant: args.minSessionsPerVariant ?? 30,
        sampleSize: args.sampleSize ?? 200,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: { ...result } as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "evolve_next_generation",
    {
      title: "Evolve the next generation",
      description:
        "Score the current generation and, if a challenger strictly beat the champion, materialize the new champion's HTML, run the UX/UI Evolver against it, apply each variant's mutations, and publish the new champion + N evolved challengers back to petri-hosted Vercel Blob behind the same runId. Returns the new run URL. No-op (no_promotion) when the champion held.",
      inputSchema: {
        runId: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,59}$/)
          .describe("The runId previously registered via start_split. Run must have a stored lockManifest in KV (pass lockManifest to start_split first)."),
        splitRatio: z
          .number()
          .int()
          .min(0)
          .max(100)
          .default(90)
          .describe("Percent of traffic for the new champion. Default 90."),
        nVariants: z
          .number()
          .int()
          .min(1)
          .max(5)
          .default(3)
          .describe("How many evolved challengers to generate alongside the new champion. Default 3."),
      },
    },
    async (args) => {
      const result = await runEvolveNext({
        runId: args.runId,
        splitRatio: args.splitRatio ?? 90,
        nVariants: args.nVariants ?? 3,
        publicBase: PETRI_PUBLIC_BASE,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: { ...result } as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "connect_site",
    {
      title: "Connect a site to petri",
      description:
        "Register a site (GitHub repo, deployed v0 URL, or local path) with petri-mcp and return a control panel URL. This is the cheap, no-LLM entry point: it mints a runId, persists the site identifier to KV, and hands back a clickable URL where the user can run a simulation or kick off real evolution. Pass repoUrl for a static-HTML GitHub repo, liveUrl for a deployed v0/Next.js site (petri fetches the rendered HTML), or projectRoot for local development.",
      inputSchema: {
        projectRoot: projectRootField,
        repoUrl: repoUrlField,
        repoRef: repoRefField,
        liveUrl: liveUrlField,
        name: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,59}$/)
          .optional()
          .describe(
            "Optional kebab-case slug (≤60 chars) used as both the runId and the URL path component. If omitted, petri generates one like `petri-a3k9pw`.",
          ),
      },
    },
    async (args) => {
      const result = await runConnectSite(
        {
          ...(args.projectRoot ? { projectRoot: args.projectRoot } : {}),
          ...(args.repoUrl ? { repoUrl: args.repoUrl } : {}),
          ...(args.repoRef ? { repoRef: args.repoRef } : {}),
          ...(args.liveUrl ? { liveUrl: args.liveUrl } : {}),
          ...(args.name ? { name: args.name } : {}),
        },
        PETRI_PUBLIC_BASE,
      );
      // Inline the URL in the text content so MCP clients that hide
      // structured content still surface it to the user.
      const text = [
        `Connected. Open the control panel:`,
        result.controlPanelUrl,
        ``,
        JSON.stringify(result, null, 2),
      ].join("\n");
      return {
        content: [{ type: "text", text }],
        structuredContent: { ...result } as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "start_petri",
    {
      title: "Start a real petri evolution run",
      description:
        "Kick off a real-traffic 90/10 evolution loop on a previously-connected site. Currently gated: requires the Vercel Blob and Upstash Redis Marketplace integrations to be provisioned on the petri-mcp project. Until then, this tool returns a clear gated message with the control panel URL — where the user can run a deterministic simulation instead.",
      inputSchema: {
        runId: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,59}$/)
          .describe("The runId returned by connect_site for the target site."),
        targetMetric: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Free-text description of what to optimize for, e.g. 'time on site', 'sign-up conversion', 'scroll depth'. Parsed when the gate lifts.",
          ),
        sessionTarget: z
          .number()
          .int()
          .min(50)
          .max(1_000_000)
          .optional()
          .describe(
            "How many real visitor sessions to collect per generation before scoring. Parsed when the gate lifts.",
          ),
      },
    },
    async (args) => {
      const base = PETRI_PUBLIC_BASE.replace(/\/+$/, "");
      const controlPanelUrl = `${base}/r/${args.runId}`;
      const payload = {
        status: "gated" as const,
        runId: args.runId,
        controlPanelUrl,
        reason:
          "Real petri requires the Vercel Blob and Upstash Redis Marketplace integrations to be provisioned on the petri-mcp project. Until they're enabled, real traffic-split evolution is not available.",
        suggestion:
          "Open the control panel and click 'Run Simulation' to evolve the site against synthetic users (deterministic, ~4 minutes, no production traffic needed).",
        requestedTargetMetric: args.targetMetric ?? null,
        requestedSessionTarget: args.sessionTarget ?? null,
      };
      const text = [
        `Real petri is gated. Open the control panel and run a simulation:`,
        controlPanelUrl,
        ``,
        JSON.stringify(payload, null, 2),
      ].join("\n");
      return {
        content: [{ type: "text", text }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    },
  );

  return server;
}

async function main() {
  const mode = process.env.PETRI_TRANSPORT ?? "stdio";
  if (mode === "http") {
    const port = Number(process.env.PETRI_PORT ?? 8787);
    await startHttpTransport(buildServer, port);
    return;
  }
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("petri-mcp listening on stdio");
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  main().catch((err) => {
    console.error("petri-mcp failed to start:", err);
    process.exit(1);
  });
}
