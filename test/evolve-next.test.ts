import { describe, it, expect } from "vitest";
import { runEvolveNext } from "../src/shared/evolve-next.js";
import type { RunMeta, ScoresRecord } from "../src/shared/run-meta.js";
import type { ScoreGenerationResult } from "../src/shared/score-generation.js";
import type { EvolverOutput } from "../src/agents/ux-ui-evolver/schema.js";
import type { StartSplitResult, StartSplitInput } from "../src/shared/start-split.js";
import type { VibeIdentifierOk } from "../src/agents/vibe-identifier/schema.js";
import { z } from "zod";

type LockManifest = z.infer<typeof VibeIdentifierOk>;

const FAKE_BLOB_BASE = "https://test.public.blob.vercel-storage.com";

function makeMeta(overrides: Partial<RunMeta> = {}): RunMeta {
  return {
    runId: "demo-001",
    championVariantId: "v0",
    variantIds: ["v0", "v1", "v2"],
    splitRatio: 90,
    blobBase: FAKE_BLOB_BASE,
    files: { v0: ["index.html"], v1: ["index.html"], v2: ["index.html"] },
    createdAt: 1700000000000,
    currentGeneration: 1,
    targetMetric: {
      name: "primary_cta_clicks",
      description: "clicks on the hero CTA",
      direction: "increase",
    },
    ...overrides,
  };
}

function makeLock(): LockManifest {
  return {
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
}

function makeNoPromotionScore(meta: RunMeta): ScoreGenerationResult {
  return {
    status: "ok",
    runId: meta.runId,
    generation: meta.currentGeneration,
    scores: {
      generation: meta.currentGeneration,
      scoredAt: 1700001000000,
      variants: [
        { variantId: "v0", score: 0.5, sessionsCounted: 50, confidence: 0.8, reasoning: "champion holds" },
        { variantId: "v1", score: 0.3, sessionsCounted: 50, confidence: 0.8, reasoning: "no" },
        { variantId: "v2", score: 0.2, sessionsCounted: 50, confidence: 0.8, reasoning: "no" },
      ],
    },
    promotion: { promoted: false, reason: "champion held" },
  };
}

function makePromotionScore(meta: RunMeta, newChampion: string): ScoreGenerationResult {
  const scores: ScoresRecord = {
    generation: meta.currentGeneration,
    scoredAt: 1700001000000,
    variants: [
      { variantId: "v0", score: 0.2, sessionsCounted: 50, confidence: 0.8, reasoning: "lost" },
      { variantId: "v1", score: 0.6, sessionsCounted: 50, confidence: 0.9, reasoning: "winner" },
      { variantId: "v2", score: 0.3, sessionsCounted: 50, confidence: 0.7, reasoning: "ok" },
    ],
  };
  return {
    status: "ok",
    runId: meta.runId,
    generation: meta.currentGeneration,
    scores,
    promotion: {
      promoted: true,
      previousChampion: meta.championVariantId,
      newChampion,
    },
  };
}

describe("runEvolveNext", () => {
  it("returns no_promotion when score_generation declines to promote", async () => {
    const meta = makeMeta();
    const lock = makeLock();
    const calls = { evolver: 0, materialize: 0, startSplit: 0 };
    const result = await runEvolveNext(
      { runId: meta.runId, publicBase: "https://petri-mcp.vercel.app" },
      {
        loadMeta: async () => meta,
        loadLock: async () => lock,
        scoreGeneration: async () => makeNoPromotionScore(meta),
        materialize: async () => {
          calls.materialize++;
          return { dir: "/tmp/should-not-happen", reused: false, fetched: 0 };
        },
        evolver: async () => {
          calls.evolver++;
          return { status: "ok", variants: [] } as EvolverOutput;
        },
        startSplit: async () => {
          calls.startSplit++;
          return {} as StartSplitResult;
        },
      },
    );
    expect(result.status).toBe("no_promotion");
    if (result.status === "no_promotion") {
      expect(result.score.promotion.promoted).toBe(false);
    }
    expect(calls.evolver).toBe(0);
    expect(calls.materialize).toBe(0);
    expect(calls.startSplit).toBe(0);
  });

  it("on promotion: materializes champion → evolves → publishes new split with v3..vN ids", async () => {
    const meta = makeMeta();
    const lock = makeLock();
    const evolverVariants: EvolverOutput = {
      status: "ok",
      variants: [
        {
          id: "v1",
          hypothesis: "stronger CTA copy",
          mutations: [
            { kind: "text_content", file: "index.html", selector: ".hero-cta", text: "Start now", reason: "urgency" },
          ],
        },
        {
          id: "v2",
          hypothesis: "shorter sub",
          mutations: [
            { kind: "text_content", file: "index.html", selector: ".hero-sub", text: "Fewer words.", reason: "scan" },
          ],
        },
        {
          id: "v3",
          hypothesis: "remove distraction",
          mutations: [
            { kind: "remove_node", file: "index.html", selector: ".secondary-promo", reason: "focus" },
          ],
        },
      ],
    };

    const startSplitCalls: Array<StartSplitInput> = [];
    let evolverInput: { displayName: string; metricName: string } | null = null;

    const result = await runEvolveNext(
      { runId: meta.runId, publicBase: "https://petri-mcp.vercel.app", nVariants: 3 },
      {
        loadMeta: async () => meta,
        loadLock: async () => lock,
        scoreGeneration: async () => makePromotionScore(meta, "v1"),
        materialize: async (args) => ({
          dir: `/tmp/petri/${args.runId}-gen${args.generation}-${args.variantId}`,
          reused: false,
          fetched: 1,
        }),
        readChampionFile: async () => "<!doctype html><body><a class='hero-cta'>Old</a><div class='hero-sub'>old sub</div><div class='secondary-promo'/></body>",
        evolver: async (input) => {
          const i = input as { displayName: string; targetMetric: { name: string } };
          evolverInput = { displayName: i.displayName, metricName: i.targetMetric.name };
          return evolverVariants;
        },
        startSplit: async (input) => {
          startSplitCalls.push(input);
          return {
            status: "ok",
            runId: input.runId,
            runUrl: `https://petri-mcp.vercel.app/p/${input.runId}/`,
            championVariantId: input.championVariantId,
            variantIds: input.variants.map((v) => v.id),
            splitRatio: input.splitRatio,
            blobBase: FAKE_BLOB_BASE,
            files: Object.fromEntries(input.variants.map((v) => [v.id, v.files.map((f) => f.path)])),
            reporterInjected: true,
          };
        },
      },
    );

    expect(result.status).toBe("evolved");
    if (result.status !== "evolved") return;
    expect(result.previousChampion).toBe("v0");
    expect(result.newChampion).toBe("v1");
    expect(result.newGeneration).toBe(2);
    expect(result.newVariantIds).toEqual(["v1", "v3", "v4", "v5"]);
    expect(evolverInput!.metricName).toBe("primary_cta_clicks");
    expect(evolverInput!.displayName).toBe("demo-001-gen2-v1");
    expect(startSplitCalls).toHaveLength(1);
    expect(startSplitCalls[0]!.championVariantId).toBe("v1");
    expect(startSplitCalls[0]!.splitRatio).toBe(90);
    expect(startSplitCalls[0]!.variants.map((v) => v.id)).toEqual(["v1", "v3", "v4", "v5"]);
  });

  it("uses inferredMetric when targetMetric is absent", async () => {
    const meta = makeMeta({
      targetMetric: undefined,
      inferredMetric: {
        name: "scroll_depth",
        description: "scroll past article body",
        direction: "increase",
        reasoning: "content site",
      },
    });
    const lock = makeLock();
    let observed: { targetMetric: unknown; inferredOnLock: string | undefined } | null = null;
    await runEvolveNext(
      { runId: meta.runId, publicBase: "https://petri-mcp.vercel.app" },
      {
        loadMeta: async () => meta,
        loadLock: async () => lock,
        scoreGeneration: async () => makePromotionScore(meta, "v1"),
        materialize: async () => ({ dir: "/tmp/x", reused: true, fetched: 0 }),
        readChampionFile: async () => "<html></html>",
        evolver: async (input) => {
          const i = input as {
            targetMetric?: { name: string };
            lockManifest: { inferred_metric?: { name: string } };
          };
          observed = {
            targetMetric: i.targetMetric,
            inferredOnLock: i.lockManifest.inferred_metric?.name,
          };
          return {
            status: "ok",
            variants: [
              {
                id: "v1",
                hypothesis: "x",
                mutations: [
                  { kind: "text_content", file: "index.html", selector: ".x", text: "y", reason: "z" },
                ],
              },
            ],
          } as EvolverOutput;
        },
        startSplit: async (input) => ({
          status: "ok",
          runId: input.runId,
          runUrl: "x",
          championVariantId: input.championVariantId,
          variantIds: input.variants.map((v) => v.id),
          splitRatio: input.splitRatio,
          blobBase: FAKE_BLOB_BASE,
          files: {},
          reporterInjected: true,
        }),
      },
    );
    // Orchestrator should NOT synthesize targetMetric when only inferredMetric is set —
    // it threads the inferred metric onto lockManifest.inferred_metric so the evolver's
    // own fallback path (resolveEvolverMetric) picks it up. Caller intent ↔ derived intent.
    expect(observed!.targetMetric).toBeUndefined();
    expect(observed!.inferredOnLock).toBe("scroll_depth");
  });

  it("throws when the run has no stored lock manifest", async () => {
    const meta = makeMeta();
    await expect(
      runEvolveNext(
        { runId: meta.runId, publicBase: "https://petri-mcp.vercel.app" },
        { loadMeta: async () => meta, loadLock: async () => null },
      ),
    ).rejects.toThrow(/no stored lock manifest/);
  });

  it("throws when the runId is unknown", async () => {
    await expect(
      runEvolveNext(
        { runId: "ghost", publicBase: "https://petri-mcp.vercel.app" },
        { loadMeta: async () => null, loadLock: async () => null },
      ),
    ).rejects.toThrow(/unknown runId "ghost"/);
  });
});
