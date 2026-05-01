import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeChampion } from "../src/shared/materialize-champion.js";

const FAKE_BLOB_BASE = "https://test.public.blob.vercel-storage.com";

function makeFetchStub(files: Record<string, string>) {
  const calls: string[] = [];
  return {
    calls,
    fetch: (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      const path = url.replace(`${FAKE_BLOB_BASE}/`, "");
      if (!(path in files)) {
        return new Response("not found", { status: 404, statusText: "Not Found" });
      }
      return new Response(files[path]!, { status: 200 });
    }) as typeof fetch,
  };
}

describe("materializeChampion", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "petri-mat-test-"));
  });

  it("downloads each variant file into a runId-genN-variant dir", async () => {
    const stub = makeFetchStub({
      "variants/demo-001/v1/index.html": "<!doctype html><h1>v1</h1>",
      "variants/demo-001/v1/style.css": "h1{color:red}",
    });
    const result = await materializeChampion(
      {
        runId: "demo-001",
        generation: 2,
        variantId: "v1",
        blobBase: FAKE_BLOB_BASE,
        paths: ["index.html", "style.css"],
      },
      { fetcher: stub.fetch, rootDir: workDir },
    );

    expect(result.reused).toBe(false);
    expect(result.fetched).toBe(2);
    expect(result.dir).toBe(join(workDir, "demo-001-gen2-v1"));
    expect(stub.calls).toEqual([
      `${FAKE_BLOB_BASE}/variants/demo-001/v1/index.html`,
      `${FAKE_BLOB_BASE}/variants/demo-001/v1/style.css`,
    ]);
    const html = await readFile(join(result.dir, "index.html"), "utf8");
    const css = await readFile(join(result.dir, "style.css"), "utf8");
    expect(html).toBe("<!doctype html><h1>v1</h1>");
    expect(css).toBe("h1{color:red}");
  });

  it("is idempotent: a second call against the same dir reuses without re-fetching", async () => {
    const stub = makeFetchStub({
      "variants/demo-002/v0/index.html": "<!doctype html><body>champ</body>",
    });
    const args = {
      runId: "demo-002",
      generation: 1,
      variantId: "v0",
      blobBase: FAKE_BLOB_BASE,
      paths: ["index.html"],
    };
    const first = await materializeChampion(args, { fetcher: stub.fetch, rootDir: workDir });
    const second = await materializeChampion(args, { fetcher: stub.fetch, rootDir: workDir });

    expect(first.reused).toBe(false);
    expect(first.fetched).toBe(1);
    expect(second.reused).toBe(true);
    expect(second.fetched).toBe(0);
    expect(stub.calls).toHaveLength(1);
  });

  it("creates nested directories when paths contain subfolders", async () => {
    const stub = makeFetchStub({
      "variants/demo-003/v2/pages/about.html": "<h1>about</h1>",
      "variants/demo-003/v2/assets/logo.svg": "<svg/>",
    });
    const result = await materializeChampion(
      {
        runId: "demo-003",
        generation: 1,
        variantId: "v2",
        blobBase: FAKE_BLOB_BASE,
        paths: ["pages/about.html", "assets/logo.svg"],
      },
      { fetcher: stub.fetch, rootDir: workDir },
    );
    expect(result.fetched).toBe(2);
    const html = await readFile(join(result.dir, "pages/about.html"), "utf8");
    const svg = await readFile(join(result.dir, "assets/logo.svg"), "utf8");
    expect(html).toBe("<h1>about</h1>");
    expect(svg).toBe("<svg/>");
    await rm(workDir, { recursive: true, force: true });
  });

  it("throws when a fetch returns non-OK", async () => {
    const stub = makeFetchStub({});
    await expect(
      materializeChampion(
        {
          runId: "demo-004",
          generation: 1,
          variantId: "v0",
          blobBase: FAKE_BLOB_BASE,
          paths: ["missing.html"],
        },
        { fetcher: stub.fetch, rootDir: workDir },
      ),
    ).rejects.toThrow(/404 Not Found/);
  });

  it("throws when paths[] is empty", async () => {
    await expect(
      materializeChampion(
        {
          runId: "demo-005",
          generation: 1,
          variantId: "v0",
          blobBase: FAKE_BLOB_BASE,
          paths: [],
        },
        { rootDir: workDir },
      ),
    ).rejects.toThrow(/paths\[\] is empty/);
  });
});
