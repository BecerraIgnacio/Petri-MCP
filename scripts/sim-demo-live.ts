#!/usr/bin/env tsx
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { runSimulateEvolution } from "../src/shared/simulate-evolution.js";
import { LiveSiteSource } from "../src/shared/sources/live-site.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function safeHostnameFor(url: string): string {
  const u = new URL(url);
  const slug = `${u.hostname}${u.pathname === "/" ? "" : u.pathname}`.replace(
    /[^a-zA-Z0-9._-]+/g,
    "-",
  );
  return slug.replace(/^-+|-+$/g, "");
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY not set");
    process.exit(1);
  }
  const url = process.argv[2];
  if (!url) {
    console.error(
      "usage: tsx scripts/sim-demo-live.ts <url> [generations=2] [sessionsPerGen=1000] [seed=42]",
    );
    process.exit(2);
  }
  const generations = Number(process.argv[3] ?? 2);
  const sessionsPerGen = Number(process.argv[4] ?? 1000);
  const seed = Number(process.argv[5] ?? 42);

  const slug = safeHostnameFor(url);
  const renderToDir = path.resolve(__dirname, `../demo/sim-live-${slug}`);
  await fs.rm(renderToDir, { recursive: true, force: true });

  console.error(
    `[sim-demo-live] starting: ${generations} gens × ${sessionsPerGen} sessions, seed=${seed}, url=${url}`,
  );
  console.error(`[sim-demo-live] rendering to: ${renderToDir}`);
  const source = new LiveSiteSource({ url });
  await source.ensureReady();
  console.error(`[sim-demo-live] fetched ${url} (${source.displayName()})`);

  const t0 = Date.now();
  const result = await runSimulateEvolution(
    {
      source,
      displayName: source.displayName(),
      generations,
      sessionsPerGen,
      nVariants: 3,
      splitRatio: 90,
      seed,
      renderToDir,
    },
    {
      onGenerationComplete: ({ generation, summary }) => {
        const top = [...summary.scorerVerdict].sort((a, b) => b.score - a.score)[0];
        console.error(
          `[sim-demo-live] gen${generation} done · top ${top?.variantId}@${top?.score.toFixed(2)} · ${
            summary.promoted ? `PROMOTED ${summary.promoted}` : "no promotion"
          }`,
        );
      },
    },
  );
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.error(`[sim-demo-live] done in ${elapsed}s. Winner: ${result.winner}`);
  console.error("[sim-demo-live] lineage:");
  for (const e of result.lineage) {
    const arrow = e.parent ? `${e.parent} → ${e.id}` : `${e.id} (seed)`;
    const tag =
      e.outcome === "current_champion"
        ? "🏆"
        : e.outcome === "previous_champion"
          ? "🥈"
          : e.outcome === "promoted"
            ? "✓"
            : "·";
    console.error(
      `  ${tag} gen${e.generation} ${arrow}  intrinsic=${e.intrinsicRate.toFixed(3)}  observed=${e.observedRate.toFixed(3)} (${e.conversions}/${e.sessions})  [${e.outcome}]`,
    );
  }
  console.error("");
  console.error(`[sim-demo-live] explorer: open ${renderToDir}/index.html in a browser`);
  console.error(
    `[sim-demo-live] (winner direct: ${renderToDir}/gen${generations}/${result.winner}/index.html)`,
  );
}

main().catch((err) => {
  console.error("[sim-demo-live] FAILED:", err);
  process.exit(1);
});
