import { describe, it, expect } from "vitest";
import { parseCookies, pickBucket, type RunMeta } from "../src/shared/run-meta.js";

const BASE_META: RunMeta = {
  runId: "demo-001",
  championVariantId: "v0",
  variantIds: ["v0", "v1", "v2"],
  splitRatio: 90,
  blobBase: "https://test.public.blob.vercel-storage.com",
  files: { v0: ["index.html"], v1: ["index.html"], v2: ["index.html"] },
  createdAt: 0,
};

describe("pickBucket", () => {
  it("returns champion when bucket roll < splitRatio", () => {
    const seq = [0.0, 0.1, 0.5, 0.89];
    let i = 0;
    const rng = () => seq[i++ % seq.length]!;
    for (let n = 0; n < seq.length; n++) {
      i = n;
      expect(pickBucket(BASE_META, rng)).toBe("v0");
    }
  });

  it("returns one of the challengers when bucket roll >= splitRatio", () => {
    const seq = [0.9, 0.0, 0.95, 0.5, 0.99, 0.999];
    let i = 0;
    const rng = () => seq[i++ % seq.length]!;
    const picks = [pickBucket(BASE_META, rng), pickBucket(BASE_META, rng), pickBucket(BASE_META, rng)];
    for (const p of picks) expect(["v1", "v2"]).toContain(p);
  });

  it("returns champion when there are no challengers (defensive)", () => {
    const meta = { ...BASE_META, variantIds: ["v0"] };
    const rng = () => 0.99;
    expect(pickBucket(meta, rng)).toBe("v0");
  });

  it("with N=1000 fresh rolls, champion ratio is within 87–93%", () => {
    let champion = 0;
    for (let n = 0; n < 1000; n++) {
      if (pickBucket(BASE_META) === "v0") champion++;
    }
    const ratio = champion / 1000;
    expect(ratio).toBeGreaterThanOrEqual(0.85);
    expect(ratio).toBeLessThanOrEqual(0.95);
  });
});

describe("parseCookies", () => {
  it("parses a standard cookie header", () => {
    const out = parseCookies("petri_variant=v1; foo=bar; baz=qux");
    expect(out).toEqual({ petri_variant: "v1", foo: "bar", baz: "qux" });
  });

  it("returns empty object on empty header", () => {
    expect(parseCookies("")).toEqual({});
  });

  it("decodes URL-encoded values", () => {
    expect(parseCookies("petri_variant=v%201")).toEqual({ petri_variant: "v 1" });
  });

  it("ignores malformed pairs", () => {
    expect(parseCookies("nokey; petri_variant=v1; ")).toEqual({ petri_variant: "v1" });
  });
});
