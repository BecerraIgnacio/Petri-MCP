import { describe, it, expect } from "vitest";
import {
  parseEvolverInput,
  resolveEvolverMetric,
} from "../src/agents/ux-ui-evolver/schema.js";
import type { LocalFileSource } from "../src/shared/file-source.js";
import type { z } from "zod";
import type { VibeIdentifierOk } from "../src/agents/vibe-identifier/schema.js";

type LockManifest = z.infer<typeof VibeIdentifierOk>;

const baseLock: LockManifest = {
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

const fakeSource = {} as unknown as LocalFileSource;

describe("ux-ui-evolver targetMetric fallback", () => {
  it("uses the explicit targetMetric when provided", () => {
    const input = parseEvolverInput({
      source: fakeSource,
      displayName: "demo",
      lockManifest: baseLock,
      targetMetric: {
        name: "explicit_metric",
        description: "explicit",
        direction: "increase",
      },
      nVariants: 3,
    });
    const metric = resolveEvolverMetric(input);
    expect(metric.name).toBe("explicit_metric");
  });

  it("falls back to lockManifest.inferred_metric when targetMetric is absent", () => {
    const input = parseEvolverInput({
      source: fakeSource,
      displayName: "demo",
      lockManifest: {
        ...baseLock,
        inferred_metric: {
          name: "primary_cta_conversion",
          description: "Hero CTA clicks lead to signup",
          direction: "increase",
          reasoning: "main page action",
        },
      },
      nVariants: 3,
    });
    expect(input.targetMetric).toBeUndefined();
    const metric = resolveEvolverMetric(input);
    expect(metric.name).toBe("primary_cta_conversion");
    expect(metric.direction).toBe("increase");
  });

  it("throws a clear error when neither targetMetric nor inferred_metric is set", () => {
    const input = parseEvolverInput({
      source: fakeSource,
      displayName: "demo",
      lockManifest: baseLock,
      nVariants: 3,
    });
    expect(() => resolveEvolverMetric(input)).toThrow(/no targetMetric provided/);
  });

  it("explicit targetMetric overrides lockManifest.inferred_metric (caller intent wins)", () => {
    const input = parseEvolverInput({
      source: fakeSource,
      displayName: "demo",
      lockManifest: {
        ...baseLock,
        inferred_metric: {
          name: "scroll_depth",
          description: "fallback",
          direction: "increase",
          reasoning: "x",
        },
      },
      targetMetric: {
        name: "checkout_clicks",
        description: "explicit",
        direction: "increase",
      },
      nVariants: 3,
    });
    const metric = resolveEvolverMetric(input);
    expect(metric.name).toBe("checkout_clicks");
  });
});
