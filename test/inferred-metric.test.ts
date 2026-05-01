import { describe, it, expect } from "vitest";
import { VibeIdentifierOk, VibeIdentifierOutput } from "../src/agents/vibe-identifier/schema.js";

const baseManifest = {
  status: "ok" as const,
  brand_name: "SimpleFit",
  logo: {
    type: "wordmark" as const,
    value: "SimpleFit",
    selector: ".brand",
    evidence: { file: "index.html", line: 12, match: "SimpleFit" },
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

describe("VibeIdentifierOk inferred_metric", () => {
  it("accepts a manifest WITHOUT inferred_metric (backward compatible)", () => {
    const parsed = VibeIdentifierOk.safeParse(baseManifest);
    expect(parsed.success).toBe(true);
  });

  it("accepts a manifest WITH a valid inferred_metric", () => {
    const withMetric = {
      ...baseManifest,
      inferred_metric: {
        name: "primary_cta_conversion",
        description: "Clicks on the hero Get Started button leading to /signup",
        direction: "increase" as const,
        reasoning: "Hero CTA reads 'Get started' and the only nav action is 'Sign up'.",
      },
    };
    const parsed = VibeIdentifierOk.safeParse(withMetric);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.inferred_metric?.direction).toBe("increase");
      expect(parsed.data.inferred_metric?.name).toBe("primary_cta_conversion");
    }
  });

  it("rejects an inferred_metric with an invalid direction", () => {
    const bad = {
      ...baseManifest,
      inferred_metric: {
        name: "x",
        description: "y",
        direction: "sideways",
        reasoning: "z",
      },
    };
    const parsed = VibeIdentifierOk.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it("validates as part of the discriminated VibeIdentifierOutput union", () => {
    const withMetric = {
      ...baseManifest,
      inferred_metric: {
        name: "scroll_depth",
        description: "Readers scroll past the article body",
        direction: "increase" as const,
        reasoning: "Body content is ~5 paragraphs; engagement = reading.",
      },
    };
    const parsed = VibeIdentifierOutput.safeParse(withMetric);
    expect(parsed.success).toBe(true);
  });
});
