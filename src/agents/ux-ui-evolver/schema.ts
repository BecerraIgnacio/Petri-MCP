import { z } from "zod";
import type { FileSource } from "../../shared/file-source.js";
import { VibeIdentifierOk } from "../vibe-identifier/schema.js";
import { TargetMetric } from "../../shared/run-meta.js";

export { TargetMetric };

const EvolverInputMeta = z.object({
  displayName: z.string().min(1),
  lockManifest: VibeIdentifierOk,
  targetMetric: TargetMetric.optional(),
  nVariants: z.number().int().min(1).max(5).default(3),
});

type TargetMetricType = z.infer<typeof TargetMetric>;

export interface EvolverInput {
  source: FileSource;
  displayName: string;
  lockManifest: z.infer<typeof VibeIdentifierOk>;
  targetMetric?: TargetMetricType;
  nVariants: number;
}

export function parseEvolverInput(raw: unknown): EvolverInput {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const source = obj.source as FileSource | undefined;
  if (!source || typeof source !== "object") {
    throw new Error("runUxUiEvolver: missing 'source' (a FileSource instance)");
  }
  const meta = EvolverInputMeta.parse({
    displayName: obj.displayName,
    lockManifest: obj.lockManifest,
    targetMetric: obj.targetMetric,
    nVariants: obj.nVariants,
  });
  return {
    source,
    displayName: meta.displayName,
    lockManifest: meta.lockManifest,
    ...(meta.targetMetric ? { targetMetric: meta.targetMetric } : {}),
    nVariants: meta.nVariants,
  };
}

export function resolveEvolverMetric(input: EvolverInput): TargetMetricType {
  if (input.targetMetric) return input.targetMetric;
  const inferred = input.lockManifest.inferred_metric;
  if (inferred) {
    return {
      name: inferred.name,
      description: inferred.description,
      direction: inferred.direction,
    };
  }
  throw new Error(
    "runUxUiEvolver: no targetMetric provided and lockManifest has no inferred_metric — pass targetMetric or run vibe_identifier with the inferred_metric prompt enabled.",
  );
}

const Reasoned = { reason: z.string().min(1) };

export const Mutation = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("css_property"),
    file: z.string().min(1),
    selector: z.string().min(1),
    property: z.string().min(1),
    value: z.string(),
    ...Reasoned,
  }),
  z.object({
    kind: z.literal("text_content"),
    file: z.string().min(1),
    selector: z.string().min(1),
    text: z.string(),
    ...Reasoned,
  }),
  z.object({
    kind: z.literal("attribute"),
    file: z.string().min(1),
    selector: z.string().min(1),
    attribute: z.string().min(1),
    value: z.string(),
    ...Reasoned,
  }),
  z.object({
    kind: z.literal("css_variable"),
    file: z.string().min(1),
    variable: z.string().regex(/^--[a-z0-9_-]+$/i, "must start with -- and use kebab/snake case"),
    value: z.string(),
    ...Reasoned,
  }),
  z.object({
    kind: z.literal("remove_node"),
    file: z.string().min(1),
    selector: z.string().min(1),
    ...Reasoned,
  }),
  z.object({
    kind: z.literal("add_node"),
    file: z.string().min(1),
    parent_selector: z.string().min(1),
    position: z.enum(["before", "after", "first_child", "last_child"]),
    html: z.string().min(1),
    ...Reasoned,
  }),
]);
export type Mutation = z.infer<typeof Mutation>;

export const Variant = z.object({
  id: z.string().regex(/^v[0-9]+$/, "use ids like v1, v2, v3"),
  hypothesis: z.string().min(1),
  mutations: z.array(Mutation).min(1),
});
export type Variant = z.infer<typeof Variant>;

export const EvolverOk = z.object({
  status: z.literal("ok"),
  variants: z.array(Variant).min(1).max(5),
});

export const EvolverOutOfScope = z.object({
  status: z.literal("out_of_scope"),
  reason: z.string().min(1),
});

export const EvolverOutput = z.discriminatedUnion("status", [
  EvolverOk,
  EvolverOutOfScope,
]);
export type EvolverOutput = z.infer<typeof EvolverOutput>;
