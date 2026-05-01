import type { FileSource } from "../../shared/file-source.js";

const PER_FILE_CAP = 24_000;
const TOTAL_CAP = 80_000;
const ROOT_CANDIDATES = ["index.html", "package.json", "README.md"];

export interface PreloadedFile {
  path: string;
  content: string;
  truncated: boolean;
}

/**
 * Reads a small, predictable set of entry files from the source so the LLM
 * doesn't have to discover them via tool calls. Missing files are skipped
 * silently. If `index.html` isn't at the root, falls back to a single
 * `**\/index.html` glob — but only takes a result when there's exactly one
 * match (multi-page projects fall through to the explore loop).
 */
export async function preloadEntryFiles(source: FileSource): Promise<PreloadedFile[]> {
  const out: PreloadedFile[] = [];
  let total = 0;

  const tryRead = async (path: string): Promise<void> => {
    if (total >= TOTAL_CAP) return;
    try {
      const raw = await source.readFile({ path });
      const truncated = raw.length > PER_FILE_CAP;
      const content = truncated ? raw.slice(0, PER_FILE_CAP) : raw;
      out.push({ path, content, truncated });
      total += content.length;
    } catch {
      // missing file — skip
    }
  };

  for (const path of ROOT_CANDIDATES) {
    await tryRead(path);
  }

  const hasIndex = out.some((f) => f.path === "index.html");
  if (!hasIndex && total < TOTAL_CAP) {
    try {
      const matches = await source.glob({ pattern: "**/index.html" });
      if (matches.length === 1 && matches[0]) {
        await tryRead(matches[0]);
      }
    } catch {
      // glob failed — skip
    }
  }

  return out;
}

export function formatPreloadSection(files: PreloadedFile[]): string {
  if (files.length === 0) return "";
  const lines: string[] = [
    "PRELOADED FILES — these are already read for you. Do not call read_file on these paths.",
    "",
  ];
  for (const f of files) {
    const suffix = f.truncated ? `, truncated to ${PER_FILE_CAP} chars` : "";
    lines.push(`--- file: ${f.path} (${f.content.length} chars${suffix}) ---`);
    lines.push(f.content);
    lines.push("");
  }
  return lines.join("\n");
}
