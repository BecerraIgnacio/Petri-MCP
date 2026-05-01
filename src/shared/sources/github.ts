import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { x as tarExtract } from "tar";
import { LocalFileSource, type FileSource, type GrepHit } from "../file-source.js";

const FETCH_TIMEOUT_MS = 60_000;
const DEFAULT_CACHE_ROOT = path.join(os.tmpdir(), "petri-cache");

export interface GitHubFileSourceOptions {
  repoUrl: string;
  ref?: string;
  token?: string;
  cacheRoot?: string;
}

interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  ref?: string;
}

/**
 * Downloads a GitHub repo as a tarball via the GitHub API and extracts it to a
 * cache directory, then delegates all I/O to a LocalFileSource. Uses tarball
 * (not `git clone`) because Vercel's Node Lambda runtime doesn't include the
 * git binary.
 */
export class GitHubFileSource implements FileSource {
  private readonly parsed: ParsedGitHubUrl;
  private readonly ref?: string;
  private readonly token?: string;
  private readonly cacheRoot: string;
  private inner?: LocalFileSource;
  private downloadPromise?: Promise<LocalFileSource>;

  constructor(opts: GitHubFileSourceOptions) {
    this.parsed = parseGitHubUrl(opts.repoUrl);
    this.ref = opts.ref ?? this.parsed.ref;
    this.token = opts.token;
    this.cacheRoot = opts.cacheRoot ?? DEFAULT_CACHE_ROOT;
  }

  displayName(): string {
    return `github.com/${this.parsed.owner}/${this.parsed.repo}@${this.ref ?? "default"}`;
  }

  async ensureReady(): Promise<void> {
    await this.ensureDownloaded();
  }

  async readFile(args: { path: string }): Promise<string> {
    return (await this.ensureDownloaded()).readFile(args);
  }

  async glob(args: { pattern: string }): Promise<string[]> {
    return (await this.ensureDownloaded()).glob(args);
  }

  async grep(args: { pattern: string; pathGlob?: string; flags?: string }): Promise<GrepHit[]> {
    return (await this.ensureDownloaded()).grep(args);
  }

  private async ensureDownloaded(): Promise<LocalFileSource> {
    if (this.inner) return this.inner;
    if (!this.downloadPromise) this.downloadPromise = this.downloadOnce();
    this.inner = await this.downloadPromise;
    return this.inner;
  }

  private cacheDir(): string {
    const refKey = (this.ref ?? "default").replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(this.cacheRoot, `${this.parsed.owner}-${this.parsed.repo}-${refKey}`);
  }

  private async downloadOnce(): Promise<LocalFileSource> {
    const target = this.cacheDir();
    if (await dirIsPopulated(target)) {
      return new LocalFileSource(target);
    }

    const tmpTarget = `${target}.partial-${process.pid}-${Date.now()}`;
    await fs.mkdir(tmpTarget, { recursive: true });

    try {
      const refPath = this.ref ? `/${encodeURIComponent(this.ref)}` : "";
      const url = `https://api.github.com/repos/${this.parsed.owner}/${this.parsed.repo}/tarball${refPath}`;
      const headers: Record<string, string> = {
        "User-Agent": "petri-mcp",
        Accept: "application/vnd.github+json",
      };
      if (this.token) headers["Authorization"] = `token ${this.token}`;

      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok || !res.body) {
        throw new Error(
          `github tarball fetch failed for ${this.displayName()}: ${res.status} ${res.statusText}`,
        );
      }

      // node-tar autodetects gzip; strip the top-level <owner>-<repo>-<sha>/ folder
      await pipeline(
        Readable.fromWeb(res.body as unknown as ReadableStream<Uint8Array>),
        tarExtract({ cwd: tmpTarget, strip: 1 }),
      );

      // Atomic-ish swap so partial extracts don't poison the cache
      await fs.rename(tmpTarget, target);
    } catch (err) {
      await fs.rm(tmpTarget, { recursive: true, force: true }).catch(() => {});
      const msg = (err as Error).message ?? String(err);
      throw new Error(`github tarball download failed for ${this.displayName()}: ${msg}`);
    }

    return new LocalFileSource(target);
  }
}

async function dirIsPopulated(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

function parseGitHubUrl(url: string): ParsedGitHubUrl {
  const trimmed = url.trim().replace(/\.git$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`expected GitHub URL: got ${url}`);
  }
  if (parsed.host !== "github.com") {
    throw new Error(`expected GitHub URL: got ${url}`);
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new Error(`expected GitHub URL: got ${url}`);
  }
  const [owner, repo, maybeTree, ...rest] = segments;
  if (!owner || !repo) {
    throw new Error(`expected GitHub URL: got ${url}`);
  }
  let ref: string | undefined;
  if (maybeTree === "tree" && rest.length > 0) {
    ref = rest.join("/");
  }
  return { owner, repo, ref };
}
