import { z } from "zod";
import { ScoredVariant, TargetMetric, type StoredEvent } from "../../shared/run-meta.js";

export const VariantEvents = z.object({
  variantId: z.string().min(1),
  totalEvents: z.number().int().nonnegative(),
  uniqueSessions: z.number().int().nonnegative(),
  eventCounts: z.record(z.number().int().nonnegative()),
  recent: z.array(z.unknown()).max(500),
});

export interface ScorerInput {
  metric: z.infer<typeof TargetMetric>;
  variants: Array<{
    variantId: string;
    totalEvents: number;
    uniqueSessions: number;
    eventCounts: Record<string, number>;
    recent: StoredEvent[];
  }>;
  model?: string;
}

export const ScorerOutput = z.object({
  variants: z.array(ScoredVariant).min(1),
});
export type ScorerOutput = z.infer<typeof ScorerOutput>;
