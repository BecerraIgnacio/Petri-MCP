#!/usr/bin/env -S tsx
import "dotenv/config";
import path from "node:path";
import { runVibeIdentifier } from "../src/agents/vibe-identifier/index.js";
import { LocalFileSource } from "../src/shared/file-source.js";

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: pnpm agent:vibe <projectRoot>");
    process.exit(2);
  }
  const projectRoot = path.resolve(arg);
  const result = await runVibeIdentifier({
    source: new LocalFileSource(projectRoot),
    displayName: projectRoot,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
