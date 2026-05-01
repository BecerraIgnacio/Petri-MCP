import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { runVibeIdentifier } from "../src/agents/vibe-identifier/index.js";
import { LocalFileSource } from "../src/shared/file-source.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIMPLEFIT_ROOT = path.resolve(__dirname, "fixtures/simplefit");

const HAS_KEY = !!process.env.OPENROUTER_API_KEY;

describe.skipIf(!HAS_KEY)("Vibe Identifier — simplefit fixture", () => {
  it("locks the brand on a single-file v0 fitness landing", async () => {
    const result = await runVibeIdentifier({
      source: new LocalFileSource(SIMPLEFIT_ROOT),
      displayName: SIMPLEFIT_ROOT,
      hints: { brand_name: "SimpleFit", site_type: "landing" },
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const hexes = result.palette.map((p) => p.hex);
    expect(hexes).toContain("#22c55e");

    const phrases = result.key_phrases.map((p) => p.text.toLowerCase());
    expect(phrases.some((p) => p.includes("get fit in 20 minutes a day"))).toBe(true);

    expect(result.fonts.length).toBeGreaterThan(0);
    expect(result.locked_selectors.length).toBeGreaterThan(0);

    for (const lock of result.locked_selectors) {
      expect(lock.selector.length).toBeGreaterThan(0);
      expect(lock.property.length).toBeGreaterThan(0);
      expect(lock.scope.length).toBeGreaterThan(0);
    }
  });
});
