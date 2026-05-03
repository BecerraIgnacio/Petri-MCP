import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderLineageHtml } from "../src/shared/render-lineage-html.js";
import type { SimulationResult } from "../src/shared/simulation-types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const target = process.argv[2] ?? "demo/sim-seed42";
const dir = resolve(repoRoot, target);
const lineagePath = join(dir, "lineage.json");
const outPath = join(dir, "index.html");

const raw = await readFile(lineagePath, "utf8");
const result = JSON.parse(raw) as SimulationResult;

const html = renderLineageHtml(result);
await writeFile(outPath, html, "utf8");

console.log(`regenerated ${outPath} (${html.length} bytes)`);
