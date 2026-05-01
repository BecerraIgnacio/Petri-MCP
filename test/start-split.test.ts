import { describe, it, expect } from "vitest";
import { runStartSplit } from "../src/shared/start-split.js";
import type { RunMeta } from "../src/shared/run-meta.js";

const FAKE_BLOB_BASE = "https://test.public.blob.vercel-storage.com";

function makePublishStub() {
  const calls: Array<{ runId: string; variantId: string; paths: string[] }> = [];
  return {
    calls,
    publish: async (args: { runId: string; variantId: string; files: Array<{ path: string }> }) => {
      calls.push({
        runId: args.runId,
        variantId: args.variantId,
        paths: args.files.map((f) => f.path),
      });
      return {
        urls: args.files.map((f) => `${FAKE_BLOB_BASE}/variants/${args.runId}/${args.variantId}/${f.path}`),
        blobBase: FAKE_BLOB_BASE,
      };
    },
  };
}

function makeSaveStub() {
  const saved: RunMeta[] = [];
  return {
    saved,
    saveMeta: async (m: RunMeta) => {
      saved.push(m);
    },
  };
}

const HTML_FILES = [{ path: "index.html", content: "<!doctype html><html></html>" }];

describe("runStartSplit", () => {
  it("publishes every variant, saves meta, returns runUrl", async () => {
    const pub = makePublishStub();
    const save = makeSaveStub();

    const result = await runStartSplit(
      {
        runId: "demo-001",
        championVariantId: "v0",
        splitRatio: 90,
        variants: [
          { id: "v0", files: HTML_FILES },
          { id: "v1", files: HTML_FILES },
          { id: "v2", files: HTML_FILES },
        ],
      },
      "https://petri-mcp.vercel.app",
      { publish: pub.publish, saveMeta: save.saveMeta, now: () => 1730000000000 },
    );

    expect(result.status).toBe("ok");
    expect(result.runUrl).toBe("https://petri-mcp.vercel.app/p/demo-001/");
    expect(result.variantIds).toEqual(["v0", "v1", "v2"]);
    expect(result.blobBase).toBe(FAKE_BLOB_BASE);

    expect(pub.calls.map((c) => c.variantId)).toEqual(["v0", "v1", "v2"]);
    for (const c of pub.calls) expect(c.paths).toEqual(["index.html"]);

    expect(save.saved).toHaveLength(1);
    const saved = save.saved[0]!;
    expect(saved.runId).toBe("demo-001");
    expect(saved.championVariantId).toBe("v0");
    expect(saved.splitRatio).toBe(90);
    expect(saved.blobBase).toBe(FAKE_BLOB_BASE);
    expect(saved.files).toEqual({ v0: ["index.html"], v1: ["index.html"], v2: ["index.html"] });
    expect(saved.createdAt).toBe(1730000000000);
  });

  it("rejects when championVariantId is not in variants", async () => {
    const pub = makePublishStub();
    const save = makeSaveStub();
    await expect(
      runStartSplit(
        {
          runId: "demo-002",
          championVariantId: "ghost",
          splitRatio: 90,
          variants: [
            { id: "v0", files: HTML_FILES },
            { id: "v1", files: HTML_FILES },
          ],
        },
        "https://petri-mcp.vercel.app",
        { publish: pub.publish, saveMeta: save.saveMeta },
      ),
    ).rejects.toThrow(/championVariantId "ghost"/);
    expect(pub.calls).toHaveLength(0);
    expect(save.saved).toHaveLength(0);
  });

  it("rejects when variant ids are not unique", async () => {
    const pub = makePublishStub();
    const save = makeSaveStub();
    await expect(
      runStartSplit(
        {
          runId: "demo-003",
          championVariantId: "v1",
          splitRatio: 90,
          variants: [
            { id: "v1", files: HTML_FILES },
            { id: "v1", files: HTML_FILES },
          ],
        },
        "https://petri-mcp.vercel.app",
        { publish: pub.publish, saveMeta: save.saveMeta },
      ),
    ).rejects.toThrow(/variant ids must be unique/);
  });

  it("trims trailing slash from publicBase", async () => {
    const pub = makePublishStub();
    const save = makeSaveStub();
    const result = await runStartSplit(
      {
        runId: "demo-004",
        championVariantId: "v0",
        splitRatio: 80,
        variants: [
          { id: "v0", files: HTML_FILES },
          { id: "v1", files: HTML_FILES },
        ],
      },
      "https://petri-mcp.vercel.app///",
      { publish: pub.publish, saveMeta: save.saveMeta },
    );
    expect(result.runUrl).toBe("https://petri-mcp.vercel.app/p/demo-004/");
    expect(result.splitRatio).toBe(80);
  });

  it("validates the saved meta against the RunMeta schema", async () => {
    const pub = makePublishStub();
    const save = makeSaveStub();
    await runStartSplit(
      {
        runId: "demo-005",
        championVariantId: "v0",
        splitRatio: 90,
        variants: [
          { id: "v0", files: HTML_FILES },
          { id: "v1", files: HTML_FILES },
        ],
      },
      "https://petri-mcp.vercel.app",
      { publish: pub.publish, saveMeta: save.saveMeta },
    );
    const saved = save.saved[0]!;
    expect(saved.runId).toMatch(/^[a-z0-9][a-z0-9-]{0,59}$/);
    expect(saved.variantIds.length).toBeGreaterThan(0);
  });
});
