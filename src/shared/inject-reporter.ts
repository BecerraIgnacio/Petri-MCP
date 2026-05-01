import { REPORTER_JS } from "../runtime/reporter.js";

export interface InjectReporterArgs {
  html: string;
  runId: string;
  variantId: string;
  endpoint: string;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildReporterTag(
  runId: string,
  variantId: string,
  endpoint: string,
): string {
  return (
    `<script data-petri="reporter"` +
    ` data-run="${escapeAttr(runId)}"` +
    ` data-variant="${escapeAttr(variantId)}"` +
    ` data-endpoint="${escapeAttr(endpoint)}">` +
    REPORTER_JS +
    `</script>`
  );
}

export function injectReporter(args: InjectReporterArgs): string {
  const tag = buildReporterTag(args.runId, args.variantId, args.endpoint);
  const html = args.html;

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${tag}</head>`);
  }
  const bodyOpen = html.match(/<body[^>]*>/i);
  if (bodyOpen) {
    return html.replace(bodyOpen[0], `${bodyOpen[0]}${tag}`);
  }
  return tag + html;
}

export function isHtmlPath(p: string): boolean {
  const lower = p.toLowerCase();
  return lower.endsWith(".html") || lower.endsWith(".htm");
}
