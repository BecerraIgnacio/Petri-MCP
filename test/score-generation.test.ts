import { describe, it, expect } from "vitest";
import { runScoreGeneration } from "../src/shared/score-generation.js";
import type { RunMeta, ScoresRecord, GenerationRecord } from "../src/shared/run-meta.js";
import type { ScorerOutput } from "../src/agents/scorer/schema.js";
import type { ReadMetricsResult } from "../src/shared/events.js";

function makeMeta(overrides: Partial<RunMeta> = {}): RunMeta {
  return {
    runId: "demo-001",
    championVariantId: "v0",
    variantIds: ["v0", "v1", "v2"],
    splitRatio: 90,
    blobBase: "https://test.public.blob.vercel-storage.com",
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

function makeStubs(meta: RunMeta, scorerOut: ScorerOutput) {
  const savedMeta: RunMeta[] = [];
  const savedScores: Array<{ runId: string; record: ScoresRecord }> = [];
  const appendedGenerations: Array<{ runId: string; record: GenerationRecord }> = [];
  return {
    savedMeta,
    savedScores,
    appendedGenerations,
    deps: {
      loadMeta: async (runId: string) => (runId === meta.runId ? meta : null),
      saveMeta: async (m: RunMeta) => {
        savedMeta.push(m);
      },
      saveScores: async (runId: string, record: ScoresRecord) => {
        savedScores.push({ runId, record });
      },
      appendGen: async (runId: string, record: GenerationRecord) => {
        appendedGenerations.push({ runId, record });
      },
      readMetrics: async (): Promise<ReadMetricsResult> => ({
        status: "ok",
        runId: meta.runId,
        champion: meta.championVariantId,
        variants: meta.variantIds.map((id) => ({
          variantId: id,
          totalEvents: 60,
          eventCounts: { impression: 30, click: 12 },
          uniqueSessions: 30,
          recent: [],
        })),
      }),
      scorer: async () => scorerOut,
      now: () => 1700000999000,
    },
  };
}

describe("runScoreGeneration", () => {
  it("promotes a challenger when it strictly beats the champion above the sample threshold", async () => {
    const meta = makeMeta();
    const scorerOut: ScorerOutput = {
      variants: [
        { variantId: "v0", score: 0.2, sessionsCounted: 50, confidence: 0.8, reasoning: "champion baseline" },
        { variantId: "v1", score: 0.45, sessionsCounted: 50, confidence: 0.8, reasoning: "winner" },
        { variantId: "v2", score: 0.3, sessionsCounted: 50, confidence: 0.8, reasoning: "ok" },
      ],
    };
    const { savedMeta, savedScores, appendedGenerations, deps } = makeStubs(meta, scorerOut);

    const result = await runScoreGeneration({ runId: meta.runId }, deps);

    expect(result.promotion.promoted).toBe(true);
    if (result.promotion.promoted) {
      expect(result.promotion.previousChampion).toBe("v0");
      expect(result.promotion.newChampion).toBe("v1");
    }
    expect(result.generation).toBe(1);
    expect(savedScores).toHaveLength(1);
    expect(savedScores[0]!.record.generation).toBe(1);
    expect(savedScores[0]!.record.variants).toHaveLength(3);
    expect(appendedGenerations).toHaveLength(1);
    expect(appendedGenerations[0]!.record.championVariantId).toBe("v1");
    expect(appendedGenerations[0]!.record.scoresKey).toBe("petri:run:demo-001:scores:1");
    expect(savedMeta).toHaveLength(1);
    expect(savedMeta[0]!.championVariantId).toBe("v1");
    expect(savedMeta[0]!.currentGeneration).toBe(2);
  });

  it("does not promote when the champion still has the highest score", async () => {
    const meta = makeMeta();
    const scorerOut: ScorerOutput = {
      variants: [
        { variantId: "v0", score: 0.5, sessionsCounted: 50, confidence: 0.8, reasoning: "champion" },
        { variantId: "v1", score: 0.4, sessionsCounted: 50, confidence: 0.8, reasoning: "challenger" },
        { variantId: "v2", score: 0.3, sessionsCounted: 50, confidence: 0.8, reasoning: "challenger" },
      ],
    };
    const { savedMeta, savedScores, appendedGenerations, deps } = makeStubs(meta, scorerOut);

    const result = await runScoreGeneration({ runId: meta.runId }, deps);

    expect(result.promotion.promoted).toBe(false);
    if (!result.promotion.promoted) {
      expect(result.promotion.reason).toMatch(/champion held/);
    }
    expect(savedScores).toHaveLength(1);
    expect(appendedGenerations).toHaveLength(0);
    expect(savedMeta).toHaveLength(0); // RunMeta not updated
  });

  it("does not promote when no variant cleared the sample threshold", async () => {
    const meta = makeMeta();
    const scorerOut: ScorerOutput = {
      variants: [
        { variantId: "v0", score: 0.2, sessionsCounted: 5, confidence: 0.3, reasoning: "tiny sample" },
        { variantId: "v1", score: 0.7, sessionsCounted: 4, confidence: 0.3, reasoning: "tiny sample" },
        { variantId: "v2", score: 0.5, sessionsCounted: 6, confidence: 0.3, reasoning: "tiny sample" },
      ],
    };
    const { savedMeta, appendedGenerations, deps } = makeStubs(meta, scorerOut);

    const result = await runScoreGeneration(
      { runId: meta.runId, minSessionsPerVariant: 30 },
      deps,
    );

    expect(result.promotion.promoted).toBe(false);
    if (!result.promotion.promoted) {
      expect(result.promotion.reason).toMatch(/sample threshold/);
    }
    expect(appendedGenerations).toHaveLength(0);
    expect(savedMeta).toHaveLength(0);
  });

  it("falls back on inferredMetric when targetMetric is absent", async () => {
    const meta = makeMeta({
      targetMetric: undefined,
      inferredMetric: {
        name: "scroll_depth",
        description: "scrolled past the article body",
        direction: "increase",
        reasoning: "content site",
      },
    });
    const scorerOut: ScorerOutput = {
      variants: [
        { variantId: "v0", score: 0.5, sessionsCounted: 50, confidence: 0.8, reasoning: "ok" },
        { variantId: "v1", score: 0.4, sessionsCounted: 50, confidence: 0.8, reasoning: "ok" },
        { variantId: "v2", score: 0.3, sessionsCounted: 50, confidence: 0.8, reasoning: "ok" },
      ],
    };
    const stubs = makeStubs(meta, scorerOut);
    let metricSeen: { name: string; direction: string } | null = null;
    stubs.deps.scorer = async (input) => {
      metricSeen = { name: input.metric.name, direction: input.metric.direction };
      return scorerOut;
    };

    const result = await runScoreGeneration({ runId: meta.runId }, stubs.deps);
    expect(result.promotion.promoted).toBe(false);
    expect(metricSeen).toEqual({ name: "scroll_depth", direction: "increase" });
  });

  it("throws when neither targetMetric nor inferredMetric is set", async () => {
    const meta = makeMeta({ targetMetric: undefined, inferredMetric: undefined });
    const scorerOut: ScorerOutput = { variants: [] as never };
    const { deps } = makeStubs(meta, scorerOut);
    await expect(runScoreGeneration({ runId: meta.runId }, deps)).rejects.toThrow(
      /no targetMetric and no inferredMetric/,
    );
  });

  it("throws when the runId is unknown", async () => {
    const meta = makeMeta();
    const scorerOut: ScorerOutput = { variants: [] as never };
    const { deps } = makeStubs(meta, scorerOut);
    await expect(runScoreGeneration({ runId: "ghost" }, deps)).rejects.toThrow(
      /unknown runId "ghost"/,
    );
  });
});
