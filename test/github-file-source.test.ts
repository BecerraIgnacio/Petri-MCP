import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { GitHubFileSource } from "../src/shared/sources/github.js";

const SKIP_NET = process.env.PETRI_SKIP_NET === "1";
const TEST_REPO = "https://github.com/BecerraIgnacio/petri-MCP";

describe.skipIf(SKIP_NET)("GitHubFileSource", () => {
  let cacheRoot: string;

  beforeAll(async () => {
    cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "petri-cache-test-"));
  });

  afterAll(async () => {
    if (cacheRoot) await fs.rm(cacheRoot, { recursive: true, force: true });
  });

  it(
    "clones a public repo on first call and reuses cache on second call",
    async () => {
      const first = new GitHubFileSource({ repoUrl: TEST_REPO, cacheRoot });
      const filesA = await first.glob({ pattern: "**/*.md" });
      expect(filesA.length).toBeGreaterThan(0);
      expect(filesA).toContain("README.md");

      const second = new GitHubFileSource({ repoUrl: TEST_REPO, cacheRoot });
      const t0 = Date.now();
      const filesB = await second.glob({ pattern: "**/*.md" });
      const elapsed = Date.now() - t0;
      expect(filesB).toContain("README.md");
      expect(elapsed).toBeLessThan(500);
    },
    90_000,
  );

  it("respects sandboxing — readFile rejects path-traversal", async () => {
    const source = new GitHubFileSource({ repoUrl: TEST_REPO, cacheRoot });
    await source.ensureReady();
    await expect(source.readFile({ path: "../../../etc/passwd" })).rejects.toThrow(
      /escapes project root/,
    );
  });
});

describe("GitHubFileSource — URL parsing", () => {
  it("rejects non-GitHub URLs", () => {
    expect(() => new GitHubFileSource({ repoUrl: "https://gitlab.com/foo/bar" })).toThrow(
      /expected GitHub URL/,
    );
  });

  it("rejects URLs missing owner or repo", () => {
    expect(() => new GitHubFileSource({ repoUrl: "https://github.com/onlyowner" })).toThrow(
      /expected GitHub URL/,
    );
  });

  it("extracts ref from /tree/<branch> URL form when not provided explicitly", () => {
    const source = new GitHubFileSource({
      repoUrl: "https://github.com/BecerraIgnacio/petri-MCP/tree/main",
    });
    expect(source.displayName()).toBe("github.com/BecerraIgnacio/petri-MCP@main");
  });

  it("explicit ref overrides the URL's /tree/<branch> form", () => {
    const source = new GitHubFileSource({
      repoUrl: "https://github.com/BecerraIgnacio/petri-MCP/tree/main",
      ref: "feature-x",
    });
    expect(source.displayName()).toBe("github.com/BecerraIgnacio/petri-MCP@feature-x");
  });

  it("strips a trailing .git suffix", () => {
    const source = new GitHubFileSource({
      repoUrl: "https://github.com/BecerraIgnacio/petri-MCP.git",
    });
    expect(source.displayName()).toBe("github.com/BecerraIgnacio/petri-MCP@default");
  });
});
