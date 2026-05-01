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
import { startHttpTransport } from "./transports/http.js";

interface SourceInput {
  projectRoot?: string;
  repoUrl?: string;
  repoRef?: string;
}

interface BuiltSource {
  source: FileSource;
  displayName: string;
}

function buildSource(input: SourceInput): BuiltSource {
  if (input.projectRoot) {
    const root = path.resolve(input.projectRoot);
    return { source: new LocalFileSource(root), displayName: root };
  }
  if (input.repoUrl) {
    const source = new GitHubFileSource({ repoUrl: input.repoUrl, ref: input.repoRef });
    return { source, displayName: source.displayName() };
  }
  throw new Error("buildSource: expected projectRoot or repoUrl");
}

function assertExactlyOneSource(v: { projectRoot?: string; repoUrl?: string }): void {
  const provided = (v.projectRoot ? 1 : 0) + (v.repoUrl ? 1 : 0);
  if (provided !== 1) {
    throw new Error("provide exactly one of projectRoot or repoUrl");
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
      if (source instanceof GitHubFileSource) await source.ensureReady();
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
        lockManifest: VibeIdentifierOk.describe(
          "The full Vibe Identifier output (status: 'ok' variant) for this project.",
        ),
        targetMetric: z
          .object({
            name: z.string(),
            description: z.string(),
            direction: z.enum(["increase", "decrease"]),
          })
          .describe("The metric the variants should optimize for."),
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
      if (source instanceof GitHubFileSource) await source.ensureReady();
      const result = await runUxUiEvolver({
        source,
        displayName,
        lockManifest: args.lockManifest,
        targetMetric: args.targetMetric,
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

main().catch((err) => {
  console.error("petri-mcp failed to start:", err);
  process.exit(1);
});
