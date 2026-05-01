#!/usr/bin/env -S tsx
import "dotenv/config";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { runUxUiEvolver } from "../src/agents/ux-ui-evolver/index.js";
import { applyVariant } from "../src/shared/apply-mutations.js";
import { VibeIdentifierOk } from "../src/agents/vibe-identifier/schema.js";
import type { Variant, EvolverOutput } from "../src/agents/ux-ui-evolver/schema.js";
import { LocalFileSource } from "../src/shared/file-source.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const FIXTURE_ROOT = path.join(REPO_ROOT, "test/fixtures/simplefit");
const LOCK_PATH = path.join(REPO_ROOT, "test/fixtures/simplefit-lock.json");
const DEMO_DIR = path.join(REPO_ROOT, "demo");

const TARGET_METRIC = {
  name: "primary_cta_clicks",
  description:
    "Increase clicks on the hero CTA button. Users should be more likely to start the primary action.",
  direction: "increase" as const,
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function describeMutation(m: Variant["mutations"][number]): string {
  switch (m.kind) {
    case "text_content":
      return `<code>text_content</code> on <code>${escapeHtml(m.selector)}</code> → ${escapeHtml(JSON.stringify(m.text))}`;
    case "css_property":
      return `<code>css_property</code> on <code>${escapeHtml(m.selector)}</code> set <code>${escapeHtml(m.property)}: ${escapeHtml(m.value)}</code>`;
    case "attribute":
      return `<code>attribute</code> on <code>${escapeHtml(m.selector)}</code> set <code>${escapeHtml(m.attribute)}=${escapeHtml(JSON.stringify(m.value))}</code>`;
    case "css_variable":
      return `<code>css_variable</code> set <code>${escapeHtml(m.variable)}: ${escapeHtml(m.value)}</code>`;
    case "remove_node":
      return `<code>remove_node</code> <code>${escapeHtml(m.selector)}</code>`;
    case "add_node":
      return `<code>add_node</code> ${escapeHtml(m.position)} <code>${escapeHtml(m.parent_selector)}</code>`;
  }
}

function buildIndex(args: {
  metric: typeof TARGET_METRIC;
  variants: Array<{
    variant: Variant;
    file: string;
    appliedCount: number;
    failures: Array<{ index: number; error: string }>;
  }>;
}): string {
  const cards = args.variants
    .map(({ variant, file, appliedCount, failures }) => {
      const mutationsList = variant.mutations
        .map(
          (m, i) => `
        <li>
          ${describeMutation(m)}
          <div class="reason">${escapeHtml(m.reason)}</div>
          ${failures.find((f) => f.index === i) ? `<div class="failure">⚠ apply failed: ${escapeHtml(failures.find((f) => f.index === i)!.error)}</div>` : ""}
        </li>`,
        )
        .join("");
      return `
    <article class="card">
      <header>
        <h2>${escapeHtml(variant.id)}</h2>
        <a class="open" href="./${escapeHtml(file)}" target="_blank" rel="noopener">open ↗</a>
      </header>
      <p class="hypothesis">${escapeHtml(variant.hypothesis)}</p>
      <div class="meta">${appliedCount}/${variant.mutations.length} mutations applied</div>
      <ul class="mutations">${mutationsList}</ul>
    </article>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>petri-mcp — Evolver demo (simplefit)</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;background:#fafafa;line-height:1.55;padding:48px 24px}
  .container{max-width:980px;margin:0 auto}
  h1{font-size:1.875rem;font-weight:800;letter-spacing:-0.02em;margin-bottom:8px}
  .lede{color:#525866;font-size:1rem;margin-bottom:32px}
  .metric{display:inline-block;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;margin-bottom:32px;font-size:0.9375rem}
  .metric strong{color:#22c55e}
  .original{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:24px}
  .original h2{font-size:1.125rem;font-weight:700;margin-bottom:8px}
  .original a{color:#16a34a;font-weight:600;text-decoration:none}
  .original a:hover{text-decoration:underline}
  .grid{display:grid;gap:20px}
  .card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px}
  .card header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
  .card h2{font-size:1.25rem;font-weight:700;color:#22c55e;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .open{color:#16a34a;font-weight:600;text-decoration:none;font-size:0.9375rem}
  .open:hover{text-decoration:underline}
  .hypothesis{font-size:1rem;font-weight:500;margin-bottom:8px}
  .meta{font-size:0.8125rem;color:#6b7280;margin-bottom:16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .mutations{list-style:none;display:grid;gap:12px}
  .mutations li{padding:12px 14px;background:#f9fafb;border:1px solid #f0f1f3;border-radius:8px;font-size:0.875rem}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#eef0f2;padding:1px 5px;border-radius:4px;font-size:0.8125rem}
  .reason{margin-top:6px;color:#525866;font-size:0.8125rem;font-style:italic}
  .failure{margin-top:6px;color:#dc2626;font-size:0.8125rem;font-weight:600}
  footer{margin-top:48px;padding-top:24px;border-top:1px solid #e5e7eb;font-size:0.8125rem;color:#6b7280}
  footer code{font-size:0.75rem}
</style>
</head>
<body>
<div class="container">
  <h1>petri-mcp — Evolver demo</h1>
  <p class="lede">Three variants of <strong>simplefit</strong> produced by the UX/UI Evolver, applied to a copy of the original HTML, all respecting the Vibe Identifier's lock.</p>

  <div class="metric">
    Target metric: <strong>${escapeHtml(args.metric.name)}</strong> · ${escapeHtml(args.metric.direction)} · ${escapeHtml(args.metric.description)}
  </div>

  <div class="original">
    <h2>0 · Original</h2>
    <a href="./original.html" target="_blank" rel="noopener">open the baseline →</a>
  </div>

  <section class="grid">${cards}
  </section>

  <footer>
    Pipeline: <code>vibe_identifier</code> → lock manifest → <code>ux_ui_evolver</code> → variants → <code>applyMutations()</code> → these files. Generated by <code>scripts/build-demo.ts</code>.
  </footer>
</div>
</body>
</html>`;
}

async function main() {
  console.log("[demo] loading lock fixture from", LOCK_PATH);
  const lockManifest = VibeIdentifierOk.parse(
    JSON.parse(await fs.readFile(LOCK_PATH, "utf8")),
  );

  console.log("[demo] running UX/UI Evolver (this hits OpenRouter — ~80s)...");
  const result: EvolverOutput = await runUxUiEvolver({
    source: new LocalFileSource(FIXTURE_ROOT),
    displayName: FIXTURE_ROOT,
    lockManifest,
    targetMetric: TARGET_METRIC,
    nVariants: 3,
  });

  if (result.status !== "ok") {
    console.error("[demo] evolver returned out_of_scope:", result.reason);
    process.exit(1);
  }

  await fs.mkdir(DEMO_DIR, { recursive: true });
  const originalHtml = await fs.readFile(path.join(FIXTURE_ROOT, "index.html"), "utf8");
  await fs.writeFile(path.join(DEMO_DIR, "original.html"), originalHtml);

  const variantSummaries: Parameters<typeof buildIndex>[0]["variants"] = [];
  for (const variant of result.variants) {
    const out = applyVariant(originalHtml, variant);
    const file = `${variant.id}.html`;
    await fs.writeFile(path.join(DEMO_DIR, file), out.html);
    console.log(
      `[demo] ${variant.id}: applied ${out.applied}/${variant.mutations.length} mutations` +
        (out.failures.length ? ` (${out.failures.length} failed)` : ""),
    );
    for (const f of out.failures) {
      console.warn(`  ✗ mutation #${f.index} (${f.mutation.kind}): ${f.error}`);
    }
    variantSummaries.push({
      variant,
      file,
      appliedCount: out.applied,
      failures: out.failures.map((f) => ({ index: f.index, error: f.error })),
    });
  }

  const indexHtml = buildIndex({ metric: TARGET_METRIC, variants: variantSummaries });
  await fs.writeFile(path.join(DEMO_DIR, "index.html"), indexHtml);

  await fs.writeFile(
    path.join(DEMO_DIR, "evolver-output.json"),
    JSON.stringify(result, null, 2),
  );

  console.log("\n[demo] done.");
  console.log(`[demo] open: file://${path.join(DEMO_DIR, "index.html")}`);
}

main().catch((err) => {
  console.error("[demo] failed:", err);
  process.exit(1);
});
