import { promises as fs } from "node:fs";
import path from "node:path";
import { glob as globPkg } from "glob";

const MAX_FILE_BYTES = 200_000;
const MAX_GLOB_RESULTS = 200;
const MAX_GREP_HITS = 100;
const TEXT_EXTENSIONS = new Set([
  ".html", ".htm", ".css", ".scss", ".sass",
  ".js", ".jsx", ".mjs", ".cjs",
  ".ts", ".tsx",
  ".json", ".md", ".mdx",
  ".svg", ".txt",
]);

export interface GrepHit {
  file: string;
  line: number;
  match: string;
}

export interface FileSource {
  readFile(args: { path: string }): Promise<string>;
  glob(args: { pattern: string }): Promise<string[]>;
  grep(args: { pattern: string; pathGlob?: string; flags?: string }): Promise<GrepHit[]>;
}

function looksTextual(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

export class LocalFileSource implements FileSource {
  private readonly root: string;

  constructor(projectRoot: string) {
    this.root = path.resolve(projectRoot);
  }

  private resolveInside(rel: string): string {
    const target = path.resolve(this.root, rel);
    if (target !== this.root && !target.startsWith(this.root + path.sep)) {
      throw new Error(`path escapes project root: ${rel}`);
    }
    return target;
  }

  async readFile(args: { path: string }): Promise<string> {
    const abs = this.resolveInside(args.path);
    const stat = await fs.stat(abs);
    if (!stat.isFile()) throw new Error(`not a file: ${args.path}`);
    if (stat.size > MAX_FILE_BYTES) {
      const buf = await fs.readFile(abs, { encoding: "utf8" });
      return buf.slice(0, MAX_FILE_BYTES) + `\n…[truncated, ${stat.size} bytes total]`;
    }
    return await fs.readFile(abs, "utf8");
  }

  async glob(args: { pattern: string }): Promise<string[]> {
    const matches = await globPkg(args.pattern, {
      cwd: this.root,
      nodir: true,
      dot: false,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
    });
    return matches.slice(0, MAX_GLOB_RESULTS).filter(looksTextual);
  }

  async grep(args: { pattern: string; pathGlob?: string; flags?: string }): Promise<GrepHit[]> {
    let regex: RegExp;
    try {
      regex = new RegExp(args.pattern, args.flags ?? "i");
    } catch (err) {
      throw new Error(`invalid regex: ${(err as Error).message}`);
    }
    const files = await this.glob({ pattern: args.pathGlob ?? "**/*" });
    const hits: GrepHit[] = [];
    for (const rel of files) {
      if (hits.length >= MAX_GREP_HITS) break;
      const abs = this.resolveInside(rel);
      let content: string;
      try {
        content = await fs.readFile(abs, "utf8");
      } catch {
        continue;
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined) continue;
        const m = line.match(regex);
        if (m) {
          hits.push({ file: rel, line: i + 1, match: line.trim().slice(0, 240) });
          if (hits.length >= MAX_GREP_HITS) break;
        }
      }
    }
    return hits;
  }
}
