import "dotenv/config";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { runUxUiEvolver } from "../src/agents/ux-ui-evolver/index.js";
import { findOverlaps } from "../src/agents/ux-ui-evolver/validator.js";
import { VibeIdentifierOk } from "../src/agents/vibe-identifier/schema.js";
import { LocalFileSource } from "../src/shared/file-source.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIMPLEFIT_ROOT = path.resolve(__dirname, "fixtures/simplefit");
const LOCK_PATH = path.resolve(__dirname, "fixtures/simplefit-lock.json");

const HAS_KEY = !!process.env.OPENROUTER_API_KEY;

describe.skipIf(!HAS_KEY)("UX/UI Evolver — simplefit + simplefit-lock", () => {
  it("produces 3 lock-respecting variants for a CTA-clicks metric", async () => {
    const lockManifest = VibeIdentifierOk.parse(
      JSON.parse(await fs.readFile(LOCK_PATH, "utf8")),
    );

    const result = await runUxUiEvolver({
      source: new LocalFileSource(SIMPLEFIT_ROOT),
      displayName: SIMPLEFIT_ROOT,
      lockManifest,
      targetMetric: {
        name: "primary_cta_clicks",
        description:
          "Increase clicks on the hero CTA button. Users should be more likely to start the primary action.",
        direction: "increase",
      },
      nVariants: 3,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.variants).toHaveLength(3);

    const ids = result.variants.map((v) => v.id);
    expect(new Set(ids).size).toBe(3);

    for (const v of result.variants) {
      expect(v.hypothesis.length).toBeGreaterThan(10);
      expect(v.mutations.length).toBeGreaterThan(0);
      for (const m of v.mutations) {
        expect(m.reason.length).toBeGreaterThan(0);
        expect(m.file.length).toBeGreaterThan(0);
      }
    }

    const overlaps = findOverlaps(result.variants, lockManifest);
    expect(overlaps).toHaveLength(0);

    const hypotheses = result.variants.map((v) => v.hypothesis.toLowerCase().trim());
    expect(new Set(hypotheses).size).toBe(3);
  });
});
