import { describe, it, expect } from "vitest";
import {
  buildReporterTag,
  injectReporter,
  isHtmlPath,
} from "../src/shared/inject-reporter.js";
import { REPORTER_JS } from "../src/runtime/reporter.js";

const ENDPOINT = "https://petri-mcp.vercel.app/api/events";

describe("buildReporterTag", () => {
  it("includes data-run, data-variant, data-endpoint and the snippet body", () => {
    const tag = buildReporterTag("demo-001", "v1", ENDPOINT);
    expect(tag).toContain('data-run="demo-001"');
    expect(tag).toContain('data-variant="v1"');
    expect(tag).toContain(`data-endpoint="${ENDPOINT}"`);
    expect(tag).toContain('data-petri="reporter"');
    expect(tag).toContain(REPORTER_JS);
  });

  it("escapes HTML-dangerous characters in data attributes", () => {
    const tag = buildReporterTag('"&<bad>', "v1", ENDPOINT);
    expect(tag).toContain('data-run="&quot;&amp;&lt;bad&gt;"');
  });
});

describe("injectReporter", () => {
  it("injects before </head> when present", () => {
    const html = "<html><head><title>x</title></head><body>hi</body></html>";
    const out = injectReporter({ html, runId: "r1", variantId: "v0", endpoint: ENDPOINT });
    expect(out).toContain("<title>x</title>");
    expect(out.indexOf('data-petri="reporter"')).toBeLessThan(out.indexOf("</head>"));
    expect(out.indexOf('data-petri="reporter"')).toBeGreaterThan(out.indexOf("<title>x</title>"));
  });

  it("injects right after <body> when there's no <head>", () => {
    const html = "<html><body><h1>x</h1></body></html>";
    const out = injectReporter({ html, runId: "r1", variantId: "v0", endpoint: ENDPOINT });
    const bodyIdx = out.indexOf("<body>");
    const scriptIdx = out.indexOf('data-petri="reporter"');
    const h1Idx = out.indexOf("<h1>");
    expect(scriptIdx).toBeGreaterThan(bodyIdx);
    expect(scriptIdx).toBeLessThan(h1Idx);
  });

  it("prepends the script for naked HTML with no head/body", () => {
    const html = "<h1>x</h1>";
    const out = injectReporter({ html, runId: "r1", variantId: "v0", endpoint: ENDPOINT });
    expect(out.startsWith('<script data-petri="reporter"')).toBe(true);
    expect(out).toContain("<h1>x</h1>");
  });

  it("preserves existing <head> attributes when injecting", () => {
    const html =
      '<html><head lang="en" data-test="1"><meta charset="utf-8"></head><body></body></html>';
    const out = injectReporter({ html, runId: "r1", variantId: "v0", endpoint: ENDPOINT });
    expect(out).toContain('<head lang="en" data-test="1">');
    expect(out).toContain("<meta charset=\"utf-8\">");
    expect(out).toContain('data-petri="reporter"');
  });
});

describe("isHtmlPath", () => {
  it("matches .html and .htm in any case", () => {
    expect(isHtmlPath("index.html")).toBe(true);
    expect(isHtmlPath("nested/page.HTM")).toBe(true);
    expect(isHtmlPath("INDEX.HTML")).toBe(true);
  });

  it("rejects non-HTML extensions", () => {
    expect(isHtmlPath("style.css")).toBe(false);
    expect(isHtmlPath("logo.svg")).toBe(false);
    expect(isHtmlPath("readme.md")).toBe(false);
    expect(isHtmlPath("noext")).toBe(false);
  });
});
