#!/usr/bin/env tsx
import { promises as fs } from "node:fs";
import path from "node:path";
import { writeLineageHtml } from "../src/shared/render-lineage-html.js";
import { SimulationResult } from "../src/shared/simulation-types.js";

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: tsx scripts/render-explorer.ts <dir-with-lineage.json>");
    process.exit(1);
  }
  const lineagePath = path.resolve(dir, "lineage.json");
  const raw = await fs.readFile(lineagePath, "utf8");
  const parsed = JSON.parse(raw);
  const result = SimulationResult.parse(parsed);
  const out = await writeLineageHtml(result, path.resolve(dir));
  console.error(`[render-explorer] wrote ${out}`);
}

main().catch((err) => {
  console.error("[render-explorer] FAILED:", err);
  process.exit(1);
});
