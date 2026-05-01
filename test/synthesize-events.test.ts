import { describe, it, expect } from "vitest";
import { synthesizeEvents } from "../src/shared/synthesize-events.js";

const baseInput = {
  runId: "sim-001",
  championVariantId: "v0",
  variants: [
    { id: "v0", intrinsicRate: 0.20 },
    { id: "v1", intrinsicRate: 0.30 },
    { id: "v2", intrinsicRate: 0.10 },
    { id: "v3", intrinsicRate: 0.25 },
  ],
  totalSessions: 1000,
  splitRatio: 90,
  seed: 42,
};

describe("synthesizeEvents", () => {
  it("is deterministic for the same seed", () => {
    const a = synthesizeEvents(baseInput);
    const b = synthesizeEvents(baseInput);
    expect(a.events.length).toBe(b.events.length);
    expect(JSON.stringify(a.stats)).toBe(JSON.stringify(b.stats));
    // Spot-check a few events for byte-equality
    expect(a.events[0]).toEqual(b.events[0]);
    expect(a.events[a.events.length - 1]).toEqual(b.events[b.events.length - 1]);
  });

  it("respects the 90/10 traffic split — champion gets ~900 of 1000 sessions", () => {
    const { stats } = synthesizeEvents(baseInput);
    const champ = stats.find((s) => s.variantId === "v0")!;
    const challengers = stats.filter((s) => s.variantId !== "v0");
    expect(champ.sessions).toBeGreaterThan(850);
    expect(champ.sessions).toBeLessThan(950);
    const totalChallengerSessions = challengers.reduce((sum, s) => sum + s.sessions, 0);
    expect(champ.sessions + totalChallengerSessions).toBe(1000);
    // Each challenger gets some sessions in expectation (100 / 3 ≈ 33)
    for (const c of challengers) {
      expect(c.sessions).toBeGreaterThan(15);
      expect(c.sessions).toBeLessThan(60);
    }
  });

  it("reveals each variant's intrinsic conversion rate within ±5% over enough samples", () => {
    // Over-sample challengers so each gets ~330 sessions instead of ~33.
    // Rate convergence depends on n; champion converges tighter than challengers.
    const big = { ...baseInput, totalSessions: 10_000, splitRatio: 50 };
    const { stats } = synthesizeEvents(big);
    for (const s of stats) {
      const expected = baseInput.variants.find((v) => v.id === s.variantId)!.intrinsicRate;
      expect(Math.abs(s.observedRate - expected)).toBeLessThan(0.05);
    }
  });

  it("emits 3 events per session (impression + maybe click + pagehide)", () => {
    const { events, stats } = synthesizeEvents(baseInput);
    const totalSessions = stats.reduce((sum, s) => sum + s.sessions, 0);
    const totalConversions = stats.reduce((sum, s) => sum + s.conversions, 0);
    // 2 events per session (impression + pagehide) + 1 extra per converting session.
    expect(events.length).toBe(totalSessions * 2 + totalConversions);
    const impressionCount = events.filter((e) => e.event_name === "impression").length;
    const pagehideCount = events.filter((e) => e.event_name === "pagehide").length;
    const clickCount = events.filter((e) => e.event_name === "click").length;
    expect(impressionCount).toBe(totalSessions);
    expect(pagehideCount).toBe(totalSessions);
    expect(clickCount).toBe(totalConversions);
  });

  it("clicks carry `.btn-primary` selector matching the scorer's expected metric", () => {
    const { events } = synthesizeEvents(baseInput);
    const clicks = events.filter((e) => e.event_name === "click");
    expect(clicks.length).toBeGreaterThan(0);
    for (const c of clicks) {
      expect(c.payload?.selector).toBe(".btn-primary");
    }
  });

  it("rejects championVariantId not in variants[]", () => {
    expect(() =>
      synthesizeEvents({ ...baseInput, championVariantId: "ghost" }),
    ).toThrow(/not in variants/);
  });

  it("different seeds produce different outcomes (sanity)", () => {
    const a = synthesizeEvents({ ...baseInput, seed: 1 });
    const b = synthesizeEvents({ ...baseInput, seed: 2 });
    // Champions get different conversion counts under different seeds (vanishing chance of collision)
    const aChamp = a.stats.find((s) => s.variantId === "v0")!.conversions;
    const bChamp = b.stats.find((s) => s.variantId === "v0")!.conversions;
    expect(aChamp).not.toBe(bChamp);
  });
});
