import "dotenv/config";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { GitHubFileSource } from "../src/shared/sources/github.js";
import { runVibeIdentifier } from "../src/agents/vibe-identifier/index.js";

const HAS_KEY = !!process.env.OPENROUTER_API_KEY;
const SKIP_NET = process.env.PETRI_SKIP_NET === "1";
const TEST_REPO = "https://github.com/BecerraIgnacio/petri-MCP";

describe.skipIf(!HAS_KEY || SKIP_NET)("GitHubFileSource — vibe-identifier round trip", () => {
  let cacheRoot: string;

  beforeAll(async () => {
    cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "petri-cache-vibe-"));
  });

  afterAll(async () => {
    if (cacheRoot) await fs.rm(cacheRoot, { recursive: true, force: true });
  });

  it(
    "runs Vibe Identifier through GitHubFileSource and returns a non-empty lock manifest",
    async () => {
      const source = new GitHubFileSource({ repoUrl: TEST_REPO, cacheRoot });
      await source.ensureReady();
      const result = await runVibeIdentifier({
        source,
        displayName: source.displayName(),
      });

      expect(["ok", "out_of_scope"]).toContain(result.status);
      if (result.status === "ok") {
        expect(result.locked_selectors.length).toBeGreaterThan(0);
        for (const lock of result.locked_selectors) {
          expect(lock.selector.length).toBeGreaterThan(0);
          expect(lock.property.length).toBeGreaterThan(0);
          expect(lock.scope.length).toBeGreaterThan(0);
        }
      }
    },
    180_000,
  );
});
