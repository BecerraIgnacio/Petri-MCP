import type { StoredEvent } from "./run-meta.js";

/** mulberry32 — deterministic, public-domain, ~32 bits of state. Good enough for simulation. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SynthesizeVariant {
  id: string;
  intrinsicRate: number;
}

export interface SynthesizeEventsInput {
  runId: string;
  championVariantId: string;
  variants: SynthesizeVariant[];
  totalSessions: number;
  splitRatio: number;
  seed: number;
  /** Base timestamp in ms — defaults to a fixed point for reproducibility. */
  baseTs?: number;
}

export interface PerVariantStats {
  variantId: string;
  sessions: number;
  conversions: number;
  observedRate: number;
}

export interface SynthesizeEventsResult {
  events: StoredEvent[];
  stats: PerVariantStats[];
}

/** Mirrors the cookie-bucket logic from `repo/middleware.ts`: roll [0,100); roll <splitRatio → champion, else uniform across challengers. */
function pickBucket(
  championId: string,
  challengerIds: string[],
  splitRatio: number,
  rng: () => number,
): string {
  const roll = Math.floor(rng() * 100);
  if (roll < splitRatio) return championId;
  if (challengerIds.length === 0) return championId;
  const idx = Math.floor(rng() * challengerIds.length);
  return challengerIds[Math.min(idx, challengerIds.length - 1)] ?? championId;
}

export function synthesizeEvents(input: SynthesizeEventsInput): SynthesizeEventsResult {
  const baseTs = input.baseTs ?? 1700000000000;
  const rng = mulberry32(input.seed);
  const variantIds = input.variants.map((v) => v.id);
  if (!variantIds.includes(input.championVariantId)) {
    throw new Error(
      `synthesizeEvents: championVariantId "${input.championVariantId}" not in variants`,
    );
  }
  const challengerIds = variantIds.filter((id) => id !== input.championVariantId);
  const rateByVariant = new Map(input.variants.map((v) => [v.id, v.intrinsicRate]));

  const events: StoredEvent[] = [];
  const sessionCounts = new Map<string, number>(variantIds.map((id) => [id, 0]));
  const convCounts = new Map<string, number>(variantIds.map((id) => [id, 0]));

  let seq = 0;
  for (let i = 0; i < input.totalSessions; i++) {
    const variantId = pickBucket(input.championVariantId, challengerIds, input.splitRatio, rng);
    sessionCounts.set(variantId, (sessionCounts.get(variantId) ?? 0) + 1);
    const sessionId = `sim-s${i}-${variantId}`;
    const ts = baseTs + i * 1000;

    events.push({
      run_id: input.runId,
      variant_id: variantId,
      session_id: sessionId,
      event_name: "impression",
      payload: { ua: "sim", w: 1280, h: 720 },
      ts,
      event_id: `e-${seq++}`,
      received_at: ts,
    });

    const rate = rateByVariant.get(variantId) ?? 0;
    if (rng() < rate) {
      convCounts.set(variantId, (convCounts.get(variantId) ?? 0) + 1);
      events.push({
        run_id: input.runId,
        variant_id: variantId,
        session_id: sessionId,
        event_name: "click",
        payload: { selector: ".btn-primary", text: "Get started" },
        ts: ts + 500,
        event_id: `e-${seq++}`,
        received_at: ts + 500,
      });
    }

    events.push({
      run_id: input.runId,
      variant_id: variantId,
      session_id: sessionId,
      event_name: "pagehide",
      payload: { duration_ms: 5000, max_scroll: 60 },
      ts: ts + 5000,
      event_id: `e-${seq++}`,
      received_at: ts + 5000,
    });
  }

  const stats: PerVariantStats[] = variantIds.map((id) => {
    const sessions = sessionCounts.get(id) ?? 0;
    const conversions = convCounts.get(id) ?? 0;
    return {
      variantId: id,
      sessions,
      conversions,
      observedRate: sessions === 0 ? 0 : conversions / sessions,
    };
  });

  return { events, stats };
}
