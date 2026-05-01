import { describe, it, expect } from "vitest";
import { runStartSplit } from "../src/shared/start-split.js";
import type { RunMeta } from "../src/shared/run-meta.js";
import type { z } from "zod";
import type { VibeIdentifierOk } from "../src/agents/vibe-identifier/schema.js";

type LockManifest = z.infer<typeof VibeIdentifierOk>;

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

  it("injects the reporter snippet into .html files by default", async () => {
    const captured: Array<{ variantId: string; html: string }> = [];
    const publish = async (args: { runId: string; variantId: string; files: Array<{ path: string; content: string }> }) => {
      const html = args.files[0]?.content ?? "";
      captured.push({ variantId: args.variantId, html });
      return {
        urls: [`https://test.public.blob.vercel-storage.com/variants/${args.runId}/${args.variantId}/index.html`],
        blobBase: "https://test.public.blob.vercel-storage.com",
      };
    };
    const save = makeSaveStub();
    const result = await runStartSplit(
      {
        runId: "demo-006",
        championVariantId: "v0",
        splitRatio: 90,
        variants: [
          { id: "v0", files: HTML_FILES },
          { id: "v1", files: HTML_FILES },
        ],
      },
      "https://petri-mcp.vercel.app",
      { publish, saveMeta: save.saveMeta },
    );
    expect(result.reporterInjected).toBe(true);
    expect(captured).toHaveLength(2);
    for (const c of captured) {
      expect(c.html).toContain('data-petri="reporter"');
      expect(c.html).toContain(`data-run="demo-006"`);
      expect(c.html).toContain(`data-variant="${c.variantId}"`);
      expect(c.html).toContain('data-endpoint="https://petri-mcp.vercel.app/api/events"');
    }
  });

  it("skips reporter injection when injectReporter: false", async () => {
    const captured: string[] = [];
    const publish = async (args: { runId: string; variantId: string; files: Array<{ path: string; content: string }> }) => {
      captured.push(args.files[0]?.content ?? "");
      return {
        urls: ["https://x"],
        blobBase: "https://test.public.blob.vercel-storage.com",
      };
    };
    const save = makeSaveStub();
    const result = await runStartSplit(
      {
        runId: "demo-007",
        championVariantId: "v0",
        splitRatio: 90,
        injectReporter: false,
        variants: [
          { id: "v0", files: HTML_FILES },
          { id: "v1", files: HTML_FILES },
        ],
      },
      "https://petri-mcp.vercel.app",
      { publish, saveMeta: save.saveMeta },
    );
    expect(result.reporterInjected).toBe(false);
    for (const html of captured) expect(html).not.toContain("data-petri");
  });

  it("persists targetMetric, inferredMetric, originSource onto RunMeta when provided", async () => {
    const pub = makePublishStub();
    const save = makeSaveStub();
    const savedLocks: Array<{ runId: string; manifest: LockManifest }> = [];
    await runStartSplit(
      {
        runId: "demo-cfg-001",
        championVariantId: "v0",
        splitRatio: 90,
        variants: [
          { id: "v0", files: HTML_FILES },
          { id: "v1", files: HTML_FILES },
        ],
        targetMetric: {
          name: "primary_cta_clicks",
          description: "clicks on hero CTA",
          direction: "increase",
        },
        inferredMetric: {
          name: "any_engagement",
          description: "any click off the hero",
          direction: "increase",
          reasoning: "fallback metric",
        },
        originSource: {
          kind: "github",
          repoUrl: "https://github.com/foo/bar",
          repoRef: "main",
        },
      },
      "https://petri-mcp.vercel.app",
      {
        publish: pub.publish,
        saveMeta: save.saveMeta,
        saveLock: async (runId: string, manifest: LockManifest) => {
          savedLocks.push({ runId, manifest });
        },
      },
    );
    const saved = save.saved[0]!;
    expect(saved.targetMetric?.name).toBe("primary_cta_clicks");
    expect(saved.inferredMetric?.reasoning).toBe("fallback metric");
    expect(saved.originSource).toMatchObject({ kind: "github", repoUrl: "https://github.com/foo/bar" });
    expect(savedLocks).toHaveLength(0); // no lockManifest passed
  });

  it("persists the lock manifest to its own KV key when lockManifest is provided", async () => {
    const pub = makePublishStub();
    const save = makeSaveStub();
    const savedLocks: Array<{ runId: string; manifest: LockManifest }> = [];
    const lock: LockManifest = {
      status: "ok",
      brand_name: "SimpleFit",
      logo: {
        type: "wordmark",
        value: "SimpleFit",
        selector: ".brand",
        evidence: { file: "index.html", line: 1, match: "SimpleFit" },
        confidence: 0.95,
      },
      key_phrases: [],
      palette: [],
      fonts: [],
      voice: { tone: [], vocabulary_signals: [], forbidden_drift: [] },
      locked_selectors: [
        { selector: ".brand", scope: "index.html", property: "text-content", reason: "wordmark" },
      ],
    };
    await runStartSplit(
      {
        runId: "demo-cfg-002",
        championVariantId: "v0",
        splitRatio: 90,
        variants: [
          { id: "v0", files: HTML_FILES },
          { id: "v1", files: HTML_FILES },
        ],
        lockManifest: lock,
      },
      "https://petri-mcp.vercel.app",
      {
        publish: pub.publish,
        saveMeta: save.saveMeta,
        saveLock: async (runId: string, manifest: LockManifest) => {
          savedLocks.push({ runId, manifest });
        },
      },
    );
    expect(savedLocks).toHaveLength(1);
    expect(savedLocks[0]!.runId).toBe("demo-cfg-002");
    expect(savedLocks[0]!.manifest.brand_name).toBe("SimpleFit");
  });

  it("does not modify non-HTML files", async () => {
    const captured: Array<{ path: string; content: string }> = [];
    const publish = async (args: { runId: string; variantId: string; files: Array<{ path: string; content: string }> }) => {
      for (const f of args.files) captured.push({ path: f.path, content: f.content });
      return {
        urls: args.files.map(() => "https://x"),
        blobBase: "https://test.public.blob.vercel-storage.com",
      };
    };
    const save = makeSaveStub();
    await runStartSplit(
      {
        runId: "demo-008",
        championVariantId: "v0",
        splitRatio: 90,
        variants: [
          {
            id: "v0",
            files: [
              { path: "index.html", content: "<html><head></head></html>" },
              { path: "style.css", content: "body { color: red; }" },
              { path: "logo.svg", content: "<svg></svg>" },
            ],
          },
          { id: "v1", files: HTML_FILES },
        ],
      },
      "https://petri-mcp.vercel.app",
      { publish, saveMeta: save.saveMeta },
    );
    const css = captured.find((c) => c.path === "style.css")!;
    const svg = captured.find((c) => c.path === "logo.svg")!;
    expect(css.content).toBe("body { color: red; }");
    expect(svg.content).toBe("<svg></svg>");
    const html = captured.find((c) => c.path === "index.html")!;
    expect(html.content).toContain("data-petri");
  });
});
