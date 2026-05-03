import { z } from "zod";
import { Mutation } from "../agents/ux-ui-evolver/schema.js";
import { ScoredVariant, TargetMetric } from "./run-meta.js";

export const LineageOutcome = z.enum([
  "promoted",
  "abandoned",
  "current_champion",
  "previous_champion",
]);
export type LineageOutcome = z.infer<typeof LineageOutcome>;

export const LineageRole = z.enum(["seed", "challenger"]);
export type LineageRole = z.infer<typeof LineageRole>;

export const ChampionRun = z.object({
  generation: z.number().int().min(1),
  sessions: z.number().int().nonnegative(),
  conversions: z.number().int().nonnegative(),
  observedRate: z.number().min(0).max(1),
});
export type ChampionRun = z.infer<typeof ChampionRun>;

export const LineageEntry = z.object({
  id: z.string().regex(/^v[0-9]+$/),
  parent: z.string().regex(/^v[0-9]+$/).nullable(),
  generation: z.number().int().nonnegative(),
  role: LineageRole,
  intrinsicRate: z.number().min(0).max(1),
  // sessions/conversions/observedRate are the FIRST-APPEARANCE snapshot
  // (challenger gen for promoted variants, gen 0 for the seed). They never
  // get overwritten when a variant later runs as champion — those subsequent
  // gens accumulate in `championRuns` instead.
  observedRate: z.number().min(0).max(1),
  sessions: z.number().int().nonnegative(),
  conversions: z.number().int().nonnegative(),
  hypothesis: z.string().optional(),
  mutations: z.array(Mutation).optional(),
  championRuns: z.array(ChampionRun).optional(),
  outcome: LineageOutcome,
});
export type LineageEntry = z.infer<typeof LineageEntry>;

export const SimGenerationSummary = z.object({
  generation: z.number().int().min(1),
  championAtStart: z.string().regex(/^v[0-9]+$/),
  variantIds: z.array(z.string().regex(/^v[0-9]+$/)).min(1),
  scorerVerdict: z.array(ScoredVariant).min(1),
  promoted: z.string().regex(/^v[0-9]+$/).nullable(),
  promotionReason: z.string(),
});
export type SimGenerationSummary = z.infer<typeof SimGenerationSummary>;

export const SimulationConfig = z.object({
  generations: z.number().int().min(1).max(10),
  sessionsPerGen: z.number().int().min(50).max(20_000),
  nVariants: z.number().int().min(1).max(5),
  splitRatio: z.number().int().min(0).max(100),
  seed: z.number().int().nonnegative(),
});
export type SimulationConfig = z.infer<typeof SimulationConfig>;

export const SimulationResult = z.object({
  status: z.literal("ok"),
  simId: z.string().min(1),
  displayName: z.string().min(1),
  metric: TargetMetric,
  config: SimulationConfig,
  generations: z.array(SimGenerationSummary),
  lineage: z.array(LineageEntry).min(1),
  winner: z.string().regex(/^v[0-9]+$/),
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative(),
  renderedToDir: z.string().nullable(),
});
export type SimulationResult = z.infer<typeof SimulationResult>;
