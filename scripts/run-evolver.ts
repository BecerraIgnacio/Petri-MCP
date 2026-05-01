#!/usr/bin/env -S tsx
import "dotenv/config";
import path from "node:path";
import { promises as fs } from "node:fs";
import { runUxUiEvolver } from "../src/agents/ux-ui-evolver/index.js";
import { LocalFileSource } from "../src/shared/file-source.js";

async function main() {
  const projectArg = process.argv[2];
  const lockArg = process.argv[3];
  if (!projectArg || !lockArg) {
    console.error("usage: tsx scripts/run-evolver.ts <projectRoot> <lock-manifest.json>");
    process.exit(2);
  }
  const projectRoot = path.resolve(projectArg);
  const lockPath = path.resolve(lockArg);
  const lockManifest = JSON.parse(await fs.readFile(lockPath, "utf8"));

  const result = await runUxUiEvolver({
    source: new LocalFileSource(projectRoot),
    displayName: projectRoot,
    lockManifest,
    targetMetric: {
      name: "primary_cta_clicks",
      description:
        "Increase clicks on the hero CTA button. Users should be more likely to start the primary action.",
      direction: "increase",
    },
    nVariants: 3,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
