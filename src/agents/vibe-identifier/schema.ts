import { z } from "zod";
import type { FileSource } from "../../shared/file-source.js";
import { InferredMetric } from "../../shared/run-meta.js";

const VibeIdentifierInputMeta = z.object({
  displayName: z.string().min(1),
  hints: z
    .object({
      brand_name: z.string().optional(),
      site_type: z
        .enum(["saas", "news", "ads", "ecommerce", "landing", "other"])
        .optional(),
    })
    .optional(),
});

export interface VibeIdentifierInput {
  source: FileSource;
  displayName: string;
  hints?: z.infer<typeof VibeIdentifierInputMeta>["hints"];
}

export function parseVibeIdentifierInput(raw: unknown): VibeIdentifierInput {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const source = obj.source as FileSource | undefined;
  if (!source || typeof source !== "object") {
    throw new Error("runVibeIdentifier: missing 'source' (a FileSource instance)");
  }
  const meta = VibeIdentifierInputMeta.parse({
    displayName: obj.displayName,
    hints: obj.hints,
  });
  return { source, displayName: meta.displayName, hints: meta.hints };
}

const Evidence = z.object({
  file: z.string(),
  line: z.number().int().nonnegative(),
  match: z.string(),
});

const Logo = z.object({
  type: z.enum(["wordmark", "image", "combination"]),
  value: z.string(),
  selector: z.string(),
  evidence: Evidence,
  confidence: z.number().min(0).max(1),
});

const KeyPhrase = z.object({
  text: z.string().min(1),
  kind: z.enum(["tagline", "headline", "recurring_slogan"]),
  selector: z.string(),
  evidence: Evidence,
  confidence: z.number().min(0).max(1),
});

const PaletteEntry = z.object({
  role: z.enum(["primary", "accent", "neutral_text", "neutral_bg", "border"]),
  hex: z.string().regex(/^#[0-9a-f]{6}$/, "lowercase #rrggbb"),
  css_variable: z.string().nullable(),
  evidence: Evidence,
  confidence: z.number().min(0).max(1),
});

const FontEntry = z.object({
  role: z.enum(["display", "body", "mono"]),
  stack: z.string(),
  evidence: Evidence,
  confidence: z.number().min(0).max(1),
});

const Voice = z.object({
  tone: z.array(z.string()),
  vocabulary_signals: z.array(z.string()),
  forbidden_drift: z.array(z.string()),
});

const LockedSelector = z.object({
  selector: z.string(),
  scope: z.string(),
  property: z.string(),
  reason: z.string(),
});

export const VibeIdentifierOk = z.object({
  status: z.literal("ok"),
  brand_name: z.string(),
  logo: Logo,
  key_phrases: z.array(KeyPhrase),
  palette: z.array(PaletteEntry),
  fonts: z.array(FontEntry),
  voice: Voice,
  locked_selectors: z.array(LockedSelector).min(1),
  inferred_metric: InferredMetric.optional(),
  notes: z.string().optional(),
});

export const VibeIdentifierOutOfScope = z.object({
  status: z.literal("out_of_scope"),
  reason: z.string().min(1),
});

export const VibeIdentifierOutput = z.discriminatedUnion("status", [
  VibeIdentifierOk,
  VibeIdentifierOutOfScope,
]);
export type VibeIdentifierOutput = z.infer<typeof VibeIdentifierOutput>;
