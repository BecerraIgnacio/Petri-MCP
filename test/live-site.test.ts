import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LiveSiteSource } from "../src/shared/sources/live-site.js";

const SAMPLE_HTML = `<!doctype html>
<html><head><title>SimpleFit</title></head>
<body>
  <a class="btn btn-primary" href="#cta">Start Free Trial</a>
  <section class="hero">a hero</section>
</body></html>`;

function htmlResponse(body: string, status = 200, contentType = "text/html; charset=utf-8"): Response {
  return new Response(body, {
    status,
    headers: { "content-type": contentType },
  });
}

describe("LiveSiteSource", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches the URL once, exposes the body as virtual index.html, and caches subsequent reads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(htmlResponse(SAMPLE_HTML));
    vi.stubGlobal("fetch", fetchMock);

    const src = new LiveSiteSource({ url: "https://my-v0-site.vercel.app/" });
    await src.ensureReady();

    const body = await src.readFile({ path: "index.html" });
    expect(body).toBe(SAMPLE_HTML);

    // Same content via leading-slash variant.
    expect(await src.readFile({ path: "/index.html" })).toBe(SAMPLE_HTML);

    // glob is index-only.
    expect(await src.glob({ pattern: "**/*" })).toEqual(["index.html"]);
    expect(await src.glob({ pattern: "**/*.tsx" })).toEqual([]);

    // grep finds the CTA copy.
    const hits = await src.grep({ pattern: "Start Free Trial" });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.file).toBe("index.html");
    expect(hits[0]?.match).toContain("Start Free Trial");

    // Network only hit once across all reads.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects non-HTML responses with a clear, actionable error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(htmlResponse(`{"ok":true}`, 200, "application/json"));
    vi.stubGlobal("fetch", fetchMock);

    const src = new LiveSiteSource({ url: "https://example.com/api/foo" });
    await expect(src.ensureReady()).rejects.toThrow(/expected text\/html/i);
    await expect(src.ensureReady()).rejects.toThrow(/application\/json/);
  });

  it("surfaces fetch failures with the originating URL in the message", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    vi.stubGlobal("fetch", fetchMock);

    const src = new LiveSiteSource({ url: "https://broken.example.com/" });
    await expect(src.ensureReady()).rejects.toThrow(/broken\.example\.com/);
    await expect(src.ensureReady()).rejects.toThrow(/ECONNRESET/);
  });

  it("rejects non-2xx responses with status + URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(htmlResponse("not found", 404));
    vi.stubGlobal("fetch", fetchMock);

    const src = new LiveSiteSource({ url: "https://example.com/missing" });
    await expect(src.ensureReady()).rejects.toThrow(/404/);
  });

  it("exposes getLiveUrl() so callers can build a <base href>", () => {
    const src = new LiveSiteSource({ url: "https://my-v0-site.vercel.app/pricing" });
    expect(src.getLiveUrl()).toBe("https://my-v0-site.vercel.app/pricing");
  });

  it("rejects unsupported protocols at construction", () => {
    expect(() => new LiveSiteSource({ url: "file:///tmp/foo.html" })).toThrow(
      /unsupported protocol/i,
    );
  });
});
