import { z } from "zod";

export const TargetMetric = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  direction: z.enum(["increase", "decrease"]),
});
export type TargetMetric = z.infer<typeof TargetMetric>;

export const InferredMetric = TargetMetric.extend({
  reasoning: z.string().min(1),
});
export type InferredMetric = z.infer<typeof InferredMetric>;

export const OriginSource = z.union([
  z.object({
    kind: z.literal("local"),
    projectRoot: z.string().min(1),
  }),
  z.object({
    kind: z.literal("github"),
    repoUrl: z.string().url(),
    repoRef: z.string().min(1).optional(),
  }),
]);
export type OriginSource = z.infer<typeof OriginSource>;

export const RunMeta = z.object({
  runId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/),
  championVariantId: z.string().min(1),
  variantIds: z.array(z.string().min(1)).min(1),
  splitRatio: z.number().int().min(0).max(100),
  blobBase: z.string().url(),
  files: z.record(z.array(z.string().min(1))),
  createdAt: z.number().int().nonnegative(),
  currentGeneration: z.number().int().min(1).default(1),
  targetMetric: TargetMetric.optional(),
  inferredMetric: InferredMetric.optional(),
  originSource: OriginSource.optional(),
});

export type RunMeta = z.infer<typeof RunMeta>;

export const RUN_META_KEY = (runId: string): string => `petri:run:${runId}:meta`;
export const LOCK_KEY = (runId: string): string => `petri:run:${runId}:lock`;
export const SCORES_KEY = (runId: string, generation: number): string =>
  `petri:run:${runId}:scores:${generation}`;
export const GENERATIONS_KEY = (runId: string): string =>
  `petri:run:${runId}:generations`;

export const EventRecord = z.object({
  run_id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/),
  variant_id: z.string().min(1).max(120),
  session_id: z.string().min(1).max(120),
  event_name: z.string().min(1).max(60),
  payload: z.record(z.unknown()).optional(),
  ts: z.number().int().nonnegative(),
});

export type EventRecord = z.infer<typeof EventRecord>;

export const StoredEvent = EventRecord.extend({
  event_id: z.string().min(1),
  received_at: z.number().int().nonnegative(),
});

export type StoredEvent = z.infer<typeof StoredEvent>;

export const EVENTS_KEY = (runId: string, variantId: string): string =>
  `petri:run:${runId}:variant:${variantId}:events`;

export const MAX_EVENTS_PER_VARIANT = 10_000;

export const ScoredVariant = z.object({
  variantId: z.string().min(1),
  score: z.number().min(0).max(1),
  sessionsCounted: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1),
});
export type ScoredVariant = z.infer<typeof ScoredVariant>;

export const ScoresRecord = z.object({
  generation: z.number().int().min(1),
  scoredAt: z.number().int().nonnegative(),
  variants: z.array(ScoredVariant).min(1),
});
export type ScoresRecord = z.infer<typeof ScoresRecord>;

export const GenerationRecord = z.object({
  generation: z.number().int().min(1),
  championVariantId: z.string().min(1),
  variantIds: z.array(z.string().min(1)).min(1),
  scoresKey: z.string().min(1),
  promotedAt: z.number().int().nonnegative(),
});
export type GenerationRecord = z.infer<typeof GenerationRecord>;

export function pickBucket(meta: RunMeta, rng: () => number = Math.random): string {
  const roll = Math.floor(rng() * 100);
  if (roll < meta.splitRatio) return meta.championVariantId;
  const pool = meta.variantIds.filter((v) => v !== meta.championVariantId);
  if (pool.length === 0) return meta.championVariantId;
  const idx = Math.floor(rng() * pool.length);
  return pool[Math.min(idx, pool.length - 1)] ?? meta.championVariantId;
}

export function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}
