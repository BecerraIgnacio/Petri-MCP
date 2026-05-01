import * as cheerio from "cheerio";
import type { Mutation, Variant } from "../agents/ux-ui-evolver/schema.js";

export type ApplyResult =
  | { ok: true; html: string }
  | { ok: false; error: string };

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Apply a mutation that targets CSS rules inside &lt;style&gt; blocks (css_property, css_variable).
 * We do a targeted textual edit on the matched rule block — robust enough for v0-style
 * single-file projects with well-formatted inline CSS, but not a full CSS parser.
 */
function applyStyleEdit(
  html: string,
  selector: string,
  property: string,
  newValue: string,
): { ok: boolean; html: string } {
  const styleBlockRe = /<style\b[^>]*>([\s\S]*?)<\/style>/g;
  let mutated = false;
  let out = html.replace(styleBlockRe, (whole, css: string) => {
    const replaceRe = new RegExp(
      `(${escapeRegex(selector)}\\s*\\{[^}]*?)(\\b${escapeRegex(property)}\\s*:\\s*)([^;}]+)`,
      "g",
    );
    let touched = false;
    let next = css.replace(replaceRe, (_m, head: string, propLead: string) => {
      touched = true;
      return `${head}${propLead}${newValue}`;
    });
    if (!touched) {
      // Selector exists but property doesn't — append before the closing brace.
      const insertRe = new RegExp(
        `(${escapeRegex(selector)}\\s*\\{[^}]*?)(\\s*\\})`,
      );
      if (insertRe.test(next)) {
        next = next.replace(insertRe, `$1  ${property}: ${newValue};$2`);
        touched = true;
      }
    }
    if (touched) {
      mutated = true;
      return whole.replace(css, next);
    }
    return whole;
  });

  if (mutated) return { ok: true, html: out };

  // Neither the property nor the selector exist anywhere — append a new rule to the last <style> block.
  const lastStyleRe = /<\/style>(?![\s\S]*<\/style>)/;
  if (lastStyleRe.test(out)) {
    const newRule = `\n${selector} { ${property}: ${newValue}; }\n`;
    out = out.replace(lastStyleRe, `${newRule}</style>`);
    return { ok: true, html: out };
  }
  return { ok: false, html: out };
}

function applyOne(html: string, m: Mutation): ApplyResult {
  if (m.kind === "css_property") {
    const r = applyStyleEdit(html, m.selector, m.property, m.value);
    if (!r.ok) return { ok: false, error: `css_property: rule not found for selector "${m.selector}" property "${m.property}"` };
    return { ok: true, html: r.html };
  }

  if (m.kind === "css_variable") {
    const r = applyStyleEdit(html, ":root", m.variable, m.value);
    if (!r.ok) return { ok: false, error: `css_variable: ${m.variable} not found in :root` };
    return { ok: true, html: r.html };
  }

  const $ = cheerio.load(html, { xml: false });

  if (m.kind === "text_content") {
    const el = $(m.selector);
    if (el.length === 0) return { ok: false, error: `text_content: selector "${m.selector}" matched 0 elements` };
    el.first().text(m.text);
    return { ok: true, html: $.html() };
  }

  if (m.kind === "attribute") {
    const el = $(m.selector);
    if (el.length === 0) return { ok: false, error: `attribute: selector "${m.selector}" matched 0 elements` };
    el.first().attr(m.attribute, m.value);
    return { ok: true, html: $.html() };
  }

  if (m.kind === "remove_node") {
    const el = $(m.selector);
    if (el.length === 0) return { ok: false, error: `remove_node: selector "${m.selector}" matched 0 elements` };
    el.first().remove();
    return { ok: true, html: $.html() };
  }

  // add_node
  const parent = $(m.parent_selector);
  if (parent.length === 0) {
    return { ok: false, error: `add_node: parent_selector "${m.parent_selector}" matched 0 elements` };
  }
  const target = parent.first();
  switch (m.position) {
    case "before":      target.before(m.html); break;
    case "after":       target.after(m.html); break;
    case "first_child": target.prepend(m.html); break;
    case "last_child":  target.append(m.html); break;
  }
  return { ok: true, html: $.html() };
}

export type ApplyMutationsResult = {
  html: string;
  applied: number;
  failures: Array<{ index: number; mutation: Mutation; error: string }>;
};

/**
 * Apply every mutation in order, accumulating failures rather than aborting on the first one.
 * Returns the resulting HTML plus a list of any mutations that failed.
 */
export function applyMutations(html: string, mutations: Mutation[]): ApplyMutationsResult {
  let current = html;
  let applied = 0;
  const failures: ApplyMutationsResult["failures"] = [];
  for (let i = 0; i < mutations.length; i++) {
    const m = mutations[i];
    if (!m) continue;
    const r = applyOne(current, m);
    if (r.ok) {
      current = r.html;
      applied++;
    } else {
      failures.push({ index: i, mutation: m, error: r.error });
    }
  }
  return { html: current, applied, failures };
}

export function applyVariant(html: string, variant: Variant): ApplyMutationsResult {
  return applyMutations(html, variant.mutations);
}
