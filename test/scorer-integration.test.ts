import "dotenv/config";
import { describe, it, expect } from "vitest";
import { runScorer } from "../src/agents/scorer/loop.js";
import type { ScorerInput } from "../src/agents/scorer/schema.js";
import type { StoredEvent } from "../src/shared/run-meta.js";

const HAS_KEY = !!process.env.OPENROUTER_API_KEY;

const BASE_TS = 1700000000000;

function makeEvents(
  variantId: string,
  sessions: number,
  clickRate: number,
  startSeq: number,
): StoredEvent[] {
  const out: StoredEvent[] = [];
  let seq = startSeq;
  for (let i = 0; i < sessions; i++) {
    const sessionId = `${variantId}-s${i}`;
    const ts = BASE_TS + i * 1000;
    out.push({
      run_id: "demo-scorer-int",
      variant_id: variantId,
      session_id: sessionId,
      event_name: "impression",
      payload: { ua: "test", w: 1280, h: 720 },
      ts,
      event_id: `e-${seq++}`,
      received_at: ts,
    });
    // Deterministic click distribution: floor(i * clickRate) — gives an exact rate, no RNG flakes.
    const clickedThisSession = Math.floor((i + 1) * clickRate) - Math.floor(i * clickRate) === 1;
    if (clickedThisSession) {
      out.push({
        run_id: "demo-scorer-int",
        variant_id: variantId,
        session_id: sessionId,
        event_name: "click",
        payload: { selector: ".btn-primary", text: "Get started" },
        ts: ts + 500,
        event_id: `e-${seq++}`,
        received_at: ts + 500,
      });
    }
    out.push({
      run_id: "demo-scorer-int",
      variant_id: variantId,
      session_id: sessionId,
      event_name: "pagehide",
      payload: { duration_ms: 5000, max_scroll: 40 },
      ts: ts + 5000,
      event_id: `e-${seq++}`,
      received_at: ts + 5000,
    });
  }
  return out;
}

describe.skipIf(!HAS_KEY)("Scorer — live LLM with synthetic biased events", () => {
  it("scores the biased winner highest with non-trivial confidence", async () => {
    const SESSIONS = 30;
    const variants = [
      { variantId: "v0", clickRate: 0.2, startSeq: 1000 }, // baseline / champion
      { variantId: "v1", clickRate: 0.7, startSeq: 2000 }, // biased winner
      { variantId: "v2", clickRate: 0.05, startSeq: 3000 }, // clear loser
    ];

    const scorerInput: ScorerInput = {
      metric: {
        name: "primary_cta_clicks",
        description:
          "Sessions where the user clicked the hero primary CTA (matches selector `.btn-primary`). A session counts if any click event with that selector exists.",
        direction: "increase",
      },
      variants: variants.map((v) => {
        const events = makeEvents(v.variantId, SESSIONS, v.clickRate, v.startSeq);
        const sessions = new Set(events.map((e) => e.session_id));
        const counts: Record<string, number> = {};
        for (const e of events) counts[e.event_name] = (counts[e.event_name] ?? 0) + 1;
        return {
          variantId: v.variantId,
          totalEvents: events.length,
          uniqueSessions: sessions.size,
          eventCounts: counts,
          recent: events,
        };
      }),
    };

    const out = await runScorer(scorerInput);

    expect(out.variants).toHaveLength(3);
    const byId = new Map(out.variants.map((v) => [v.variantId, v]));
    const v0 = byId.get("v0")!;
    const v1 = byId.get("v1")!;
    const v2 = byId.get("v2")!;

    // The biased winner must score strictly higher than both other variants.
    expect(v1.score).toBeGreaterThan(v0.score);
    expect(v1.score).toBeGreaterThan(v2.score);
    // v0 (baseline 0.2) should beat v2 (0.05).
    expect(v0.score).toBeGreaterThan(v2.score);
    // Reasonable scale checks against the underlying click rates (allow some LLM slack).
    expect(v1.score).toBeGreaterThan(0.5);
    expect(v2.score).toBeLessThan(0.2);
    // Confidence on a 30-session signal should be at least modest.
    expect(v1.confidence).toBeGreaterThanOrEqual(0.4);
    // Each reasoning string should mention something concrete, not be a stub.
    for (const v of out.variants) {
      expect(v.reasoning.length).toBeGreaterThan(15);
      expect(v.sessionsCounted).toBeGreaterThan(0);
    }
  }, 90_000);
});
