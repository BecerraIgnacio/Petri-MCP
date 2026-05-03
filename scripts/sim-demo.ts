#!/usr/bin/env tsx
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { runSimulateEvolution } from "../src/shared/simulate-evolution.js";
import { LocalFileSource } from "../src/shared/file-source.js";
import { VibeIdentifierOk } from "../src/agents/vibe-identifier/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIMPLEFIT_ROOT = path.resolve(__dirname, "../test/fixtures/simplefit");
const SIMPLEFIT_LOCK_PATH = path.resolve(__dirname, "../test/fixtures/simplefit-lock.json");

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY not set");
    process.exit(1);
  }
  const generations = Number(process.argv[2] ?? 3);
  const sessionsPerGen = Number(process.argv[3] ?? 1000);
  const seed = process.argv[4] ? Number(process.argv[4]) : 42;

  const lockManifest = VibeIdentifierOk.parse(
    JSON.parse(await fs.readFile(SIMPLEFIT_LOCK_PATH, "utf8")),
  );
  const renderToDir = path.resolve(__dirname, `../demo/sim-seed${seed}`);
  await fs.rm(renderToDir, { recursive: true, force: true });

  console.error(`[sim-demo] starting: ${generations} gens × ${sessionsPerGen} sessions, seed=${seed}`);
  console.error(`[sim-demo] rendering to: ${renderToDir}`);
  const t0 = Date.now();
  const result = await runSimulateEvolution({
    source: new LocalFileSource(SIMPLEFIT_ROOT),
    displayName: "simplefit",
    generations,
    sessionsPerGen,
    nVariants: 3,
    splitRatio: 90,
    seed,
    lockManifest,
    targetMetric: {
      name: "primary_cta_clicks",
      description:
        "Sessions where the user clicked the primary CTA in the hero (selector matching .btn-primary). A session counts if any click event with that selector exists.",
      direction: "increase",
    },
    renderToDir,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // lineage.json + index.html are written by the orchestrator when renderToDir is set.

  console.error(`[sim-demo] done in ${elapsed}s. Winner: ${result.winner}`);
  console.error("[sim-demo] lineage:");
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
  console.error("[sim-demo] generation summaries:");
  for (const g of result.generations) {
    const top = [...g.scorerVerdict].sort((a, b) => b.score - a.score)[0]!;
    console.error(
      `  gen${g.generation}: champion ${g.championAtStart} → top ${top.variantId}@${top.score.toFixed(2)} → ${g.promoted ? `PROMOTED ${g.promoted}` : "no promotion"} (${g.promotionReason})`,
    );
  }
  console.error("");
  console.error(`[sim-demo] explorer: open ${renderToDir}/index.html in a browser to navigate the full tree`);
  console.error(`[sim-demo] (winner direct: ${renderToDir}/gen${generations}/${result.winner}/index.html)`);
}

main().catch((err) => {
  console.error("[sim-demo] FAILED:", err);
  process.exit(1);
});
