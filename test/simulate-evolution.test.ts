import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSimulateEvolution } from "../src/shared/simulate-evolution.js";
import { LocalFileSource } from "../src/shared/file-source.js";
import type { EvolverOutput, Variant } from "../src/agents/ux-ui-evolver/schema.js";
import type { ScorerOutput } from "../src/agents/scorer/schema.js";
import type { z } from "zod";
import type { VibeIdentifierOk } from "../src/agents/vibe-identifier/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIMPLEFIT_ROOT = path.resolve(__dirname, "fixtures/simplefit");

type LockManifest = z.infer<typeof VibeIdentifierOk>;

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

function makeEvolverStub(perGenVariants: Variant[][]) {
  let i = 0;
  return async (): Promise<EvolverOutput> => {
    const variants = perGenVariants[Math.min(i++, perGenVariants.length - 1)] ?? [];
    return { status: "ok", variants };
  };
}

function makeScorerStub(
  scoresByGen: Array<Record<string, number>>,
) {
  let i = 0;
  return async (input: { variants: Array<{ variantId: string; uniqueSessions: number }> }): Promise<ScorerOutput> => {
    const idx = Math.min(i++, scoresByGen.length - 1);
    const scoreMap = scoresByGen[idx] ?? {};
    return {
      variants: input.variants.map((v) => ({
        variantId: v.variantId,
        score: scoreMap[v.variantId] ?? 0,
        sessionsCounted: v.uniqueSessions,
        confidence: 0.8,
        reasoning: `stub gen ${idx} score for ${v.variantId}`,
      })),
    };
  };
}

const TEXT_MUTATION = (file: string, selector: string, text: string): Variant["mutations"][number] => ({
  kind: "text_content",
  file,
  selector,
  text,
  reason: "stub",
});

describe("runSimulateEvolution", () => {
  it("preserves every variant in the lineage (winners + losers + seed) across N generations", async () => {
    const result = await runSimulateEvolution(
      {
        source: new LocalFileSource(SIMPLEFIT_ROOT),
        displayName: "simplefit-sim",
        generations: 3,
        sessionsPerGen: 200,
        nVariants: 3,
        splitRatio: 90,
        seed: 7,
        lockManifest: lock,
        targetMetric: { name: "primary_cta_clicks", description: "x", direction: "increase" },
      },
      {
        evolver: makeEvolverStub([
          [
            { id: "v1", hypothesis: "h1", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "Buy 1")] },
            { id: "v2", hypothesis: "h2", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "Buy 2")] },
            { id: "v3", hypothesis: "h3", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "Buy 3")] },
          ],
          [
            { id: "v1", hypothesis: "h4", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "Buy 4")] },
            { id: "v2", hypothesis: "h5", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "Buy 5")] },
            { id: "v3", hypothesis: "h6", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "Buy 6")] },
          ],
          [
            { id: "v1", hypothesis: "h7", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "Buy 7")] },
            { id: "v2", hypothesis: "h8", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "Buy 8")] },
            { id: "v3", hypothesis: "h9", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "Buy 9")] },
          ],
        ]),
        scorer: makeScorerStub([
          // Gen 1: champion v0 → 0.2, v2 wins at 0.6
          { v0: 0.2, v1: 0.3, v2: 0.6, v3: 0.4 },
          // Gen 2: champion v5 (v2 promoted, gen-2 challengers v4/v5/v6 — v5 is winner) → 0.7
          { v5: 0.4, v7: 0.5, v8: 0.7, v9: 0.6 },
          // Gen 3: champion v8 holds → 0.9; nothing beats it
          { v8: 0.9, v10: 0.5, v11: 0.6, v12: 0.7 },
        ]),
      },
    );

    expect(result.status).toBe("ok");
    expect(result.generations).toHaveLength(3);
    // Lineage: 1 seed + 3*3 challengers = 10 entries
    expect(result.lineage).toHaveLength(10);
    const ids = result.lineage.map((e) => e.id);
    expect(new Set(ids).size).toBe(10); // unique
    // Seed entry
    const seed = result.lineage.find((e) => e.id === "v0")!;
    expect(seed.parent).toBeNull();
    expect(seed.generation).toBe(0);
    expect(seed.role).toBe("seed");
    // Gen-1 challengers parented to v0
    for (const id of ["v1", "v2", "v3"]) {
      const e = result.lineage.find((x) => x.id === id)!;
      expect(e.parent).toBe("v0");
      expect(e.generation).toBe(1);
      expect(e.role).toBe("challenger");
    }
    // Gen-2 challengers (next 3 IDs starting from highest+1 = v4) parented to gen-1's promoted v2
    const gen2Ids = result.lineage.filter((e) => e.generation === 2).map((e) => e.id).sort();
    expect(gen2Ids).toEqual(["v4", "v5", "v6"]);
    for (const id of gen2Ids) {
      const e = result.lineage.find((x) => x.id === id)!;
      expect(e.parent).toBe("v2");
    }
    // Gen-3 challengers (v7/v8/v9) parented to gen-2's promoted v5
    const gen3Ids = result.lineage.filter((e) => e.generation === 3).map((e) => e.id).sort();
    expect(gen3Ids).toEqual(["v7", "v8", "v9"]);
    for (const id of gen3Ids) {
      const e = result.lineage.find((x) => x.id === id)!;
      expect(e.parent).toBe("v5");
    }
  });

  it("tags outcomes correctly (promoted / abandoned / current_champion / previous_champion)", async () => {
    const result = await runSimulateEvolution(
      {
        source: new LocalFileSource(SIMPLEFIT_ROOT),
        displayName: "simplefit-sim",
        generations: 2,
        sessionsPerGen: 200,
        nVariants: 3,
        splitRatio: 90,
        seed: 11,
        lockManifest: lock,
        targetMetric: { name: "x", description: "y", direction: "increase" },
      },
      {
        evolver: makeEvolverStub([
          [
            { id: "v1", hypothesis: "a", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "A")] },
            { id: "v2", hypothesis: "b", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "B")] },
            { id: "v3", hypothesis: "c", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "C")] },
          ],
          [
            { id: "v1", hypothesis: "d", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "D")] },
            { id: "v2", hypothesis: "e", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "E")] },
            { id: "v3", hypothesis: "f", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "F")] },
          ],
        ]),
        scorer: makeScorerStub([
          // Gen 1: v3 wins (0.7 > champion v0 at 0.2)
          { v0: 0.2, v1: 0.3, v2: 0.4, v3: 0.7 },
          // Gen 2: champion v3 (after promotion) holds at 0.8
          { v3: 0.8, v4: 0.5, v5: 0.6, v6: 0.7 },
        ]),
      },
    );

    const byId = new Map(result.lineage.map((e) => [e.id, e]));
    // v0 was champion in gen 1 then demoted by v3 — it belongs in the winning
    // lineage chain, not lumped with abandoned siblings.
    expect(byId.get("v0")!.outcome).toBe("previous_champion");
    expect(byId.get("v3")!.outcome).toBe("current_champion"); // promoted gen 1, held gen 2
    expect(byId.get("v1")!.outcome).toBe("abandoned");
    expect(byId.get("v2")!.outcome).toBe("abandoned");
    expect(byId.get("v4")!.outcome).toBe("abandoned");
    expect(byId.get("v5")!.outcome).toBe("abandoned");
    expect(byId.get("v6")!.outcome).toBe("abandoned");
    expect(result.winner).toBe("v3");
  });

  it("preserves challenger-gen stats when a variant becomes champion (championRuns is append-only)", async () => {
    const result = await runSimulateEvolution(
      {
        source: new LocalFileSource(SIMPLEFIT_ROOT),
        displayName: "simplefit-sim",
        generations: 2,
        sessionsPerGen: 1000,
        nVariants: 3,
        splitRatio: 90,
        seed: 13,
        lockManifest: lock,
        targetMetric: { name: "x", description: "y", direction: "increase" },
      },
      {
        evolver: makeEvolverStub([
          [
            { id: "v1", hypothesis: "a", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "A")] },
            { id: "v2", hypothesis: "b", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "B")] },
            { id: "v3", hypothesis: "c", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "C")] },
          ],
          [
            { id: "v1", hypothesis: "d", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "D")] },
            { id: "v2", hypothesis: "e", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "E")] },
            { id: "v3", hypothesis: "f", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "F")] },
          ],
        ]),
        scorer: makeScorerStub([
          // Gen 1: v2 wins (the small-sample challenger we want to track)
          { v0: 0.2, v1: 0.3, v2: 0.7, v3: 0.4 },
          // Gen 2: v2 holds
          { v2: 0.8, v4: 0.4, v5: 0.5, v6: 0.6 },
        ]),
      },
    );
    const v2 = result.lineage.find((e) => e.id === "v2")!;
    // v2's primary sessions/conversions reflect its CHALLENGER appearance in gen 1
    // (small sample, ~1/(nVariants+champ-share) of 1000), not its gen-2 champion run.
    expect(v2.sessions).toBeLessThan(100);
    expect(v2.championRuns).toBeDefined();
    expect(v2.championRuns!).toHaveLength(1);
    expect(v2.championRuns![0]!.generation).toBe(2);
    // Champion run gets the lion's share (90/10 of 1000).
    expect(v2.championRuns![0]!.sessions).toBeGreaterThan(800);
  });

  it("is deterministic for a fixed seed (lineage IDs + intrinsic rates byte-identical)", async () => {
    const seedRun = (s: number) =>
      runSimulateEvolution(
        {
          source: new LocalFileSource(SIMPLEFIT_ROOT),
          displayName: "simplefit-sim",
          generations: 2,
          sessionsPerGen: 200,
          nVariants: 3,
          splitRatio: 90,
          seed: s,
          lockManifest: lock,
          targetMetric: { name: "x", description: "y", direction: "increase" },
        },
        {
          evolver: makeEvolverStub([
            [
              { id: "v1", hypothesis: "a", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "A")] },
              { id: "v2", hypothesis: "b", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "B")] },
              { id: "v3", hypothesis: "c", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "C")] },
            ],
            [
              { id: "v1", hypothesis: "d", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "D")] },
              { id: "v2", hypothesis: "e", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "E")] },
              { id: "v3", hypothesis: "f", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "F")] },
            ],
          ]),
          scorer: makeScorerStub([
            { v0: 0.2, v1: 0.3, v2: 0.4, v3: 0.7 },
            { v3: 0.8, v4: 0.5, v5: 0.6, v6: 0.7 },
          ]),
          now: () => 1700000000000,
        },
      );
    const a = await seedRun(99);
    const b = await seedRun(99);
    // Compare the parts that should be deterministic (LineageEntry values, not Date.now-dependent simId).
    expect(a.lineage.map((e) => `${e.id}:${e.intrinsicRate.toFixed(6)}:${e.observedRate.toFixed(6)}`))
      .toEqual(b.lineage.map((e) => `${e.id}:${e.intrinsicRate.toFixed(6)}:${e.observedRate.toFixed(6)}`));
    expect(a.winner).toBe(b.winner);
  });

  it("90/10 split delivers most sessions to the champion, rest to challengers", async () => {
    const result = await runSimulateEvolution(
      {
        source: new LocalFileSource(SIMPLEFIT_ROOT),
        displayName: "simplefit-sim",
        generations: 1,
        sessionsPerGen: 1000,
        nVariants: 3,
        splitRatio: 90,
        seed: 33,
        lockManifest: lock,
        targetMetric: { name: "x", description: "y", direction: "increase" },
      },
      {
        evolver: makeEvolverStub([
          [
            { id: "v1", hypothesis: "a", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "A")] },
            { id: "v2", hypothesis: "b", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "B")] },
            { id: "v3", hypothesis: "c", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "C")] },
          ],
        ]),
        scorer: makeScorerStub([{ v0: 0.5, v1: 0.4, v2: 0.3, v3: 0.2 }]),
      },
    );
    const champ = result.lineage.find((e) => e.id === "v0")!;
    expect(champ.sessions).toBeGreaterThan(850);
    expect(champ.sessions).toBeLessThan(950);
    const totalChallengerSessions = result.lineage
      .filter((e) => e.generation === 1)
      .reduce((sum, e) => sum + e.sessions, 0);
    expect(champ.sessions + totalChallengerSessions).toBe(1000);
  });

  it("champion holding through every generation makes the seed the final winner", async () => {
    const result = await runSimulateEvolution(
      {
        source: new LocalFileSource(SIMPLEFIT_ROOT),
        displayName: "simplefit-sim",
        generations: 2,
        sessionsPerGen: 200,
        nVariants: 3,
        splitRatio: 90,
        seed: 55,
        lockManifest: lock,
        targetMetric: { name: "x", description: "y", direction: "increase" },
      },
      {
        evolver: makeEvolverStub([
          [
            { id: "v1", hypothesis: "a", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "A")] },
            { id: "v2", hypothesis: "b", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "B")] },
            { id: "v3", hypothesis: "c", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "C")] },
          ],
          [
            { id: "v1", hypothesis: "d", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "D")] },
            { id: "v2", hypothesis: "e", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "E")] },
            { id: "v3", hypothesis: "f", mutations: [TEXT_MUTATION("index.html", ".hero-cta", "F")] },
          ],
        ]),
        scorer: makeScorerStub([
          // Champion v0 strictly above everyone in both gens
          { v0: 0.9, v1: 0.3, v2: 0.4, v3: 0.5 },
          { v0: 0.9, v4: 0.3, v5: 0.4, v6: 0.5 },
        ]),
      },
    );
    expect(result.winner).toBe("v0");
    expect(result.lineage.find((e) => e.id === "v0")!.outcome).toBe("current_champion");
    const promotions = result.generations.filter((g) => g.promoted !== null);
    expect(promotions).toHaveLength(0);
  });
});
