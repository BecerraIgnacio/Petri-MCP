import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { LocalFileSource, type FileSource, type GrepHit } from "../file-source.js";

const runGit = promisify(execFile);

const CLONE_TIMEOUT_MS = 60_000;
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

export class GitHubFileSource implements FileSource {
  private readonly parsed: ParsedGitHubUrl;
  private readonly ref?: string;
  private readonly token?: string;
  private readonly cacheRoot: string;
  private readonly cloneUrl: string;
  private inner?: LocalFileSource;
  private clonePromise?: Promise<LocalFileSource>;

  constructor(opts: GitHubFileSourceOptions) {
    this.parsed = parseGitHubUrl(opts.repoUrl);
    this.ref = opts.ref ?? this.parsed.ref;
    this.token = opts.token;
    this.cacheRoot = opts.cacheRoot ?? DEFAULT_CACHE_ROOT;
    this.cloneUrl = buildCloneUrl(this.parsed, this.token);
  }

  displayName(): string {
    return `github.com/${this.parsed.owner}/${this.parsed.repo}@${this.ref ?? "default"}`;
  }

  async ensureReady(): Promise<void> {
    await this.ensureCloned();
  }

  async readFile(args: { path: string }): Promise<string> {
    return (await this.ensureCloned()).readFile(args);
  }

  async glob(args: { pattern: string }): Promise<string[]> {
    return (await this.ensureCloned()).glob(args);
  }

  async grep(args: { pattern: string; pathGlob?: string; flags?: string }): Promise<GrepHit[]> {
    return (await this.ensureCloned()).grep(args);
  }

  private async ensureCloned(): Promise<LocalFileSource> {
    if (this.inner) return this.inner;
    if (!this.clonePromise) this.clonePromise = this.cloneOnce();
    this.inner = await this.clonePromise;
    return this.inner;
  }

  private cacheDir(): string {
    const refKey = (this.ref ?? "default").replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(this.cacheRoot, `${this.parsed.owner}-${this.parsed.repo}-${refKey}`);
  }

  private async cloneOnce(): Promise<LocalFileSource> {
    const target = this.cacheDir();
    if (await dirIsPopulated(target)) {
      return new LocalFileSource(target);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    const args = ["clone", "--depth", "1"];
    if (this.ref) args.push("--branch", this.ref);
    args.push(this.cloneUrl, target);
    try {
      await runGit("git", args, { timeout: CLONE_TIMEOUT_MS });
    } catch (err) {
      const msg = (err as NodeJS.ErrnoException).message ?? String(err);
      throw new Error(`git clone failed for ${this.displayName()}: ${msg}`);
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

function buildCloneUrl(parsed: ParsedGitHubUrl, token?: string): string {
  const auth = token ? `x-access-token:${encodeURIComponent(token)}@` : "";
  return `https://${auth}github.com/${parsed.owner}/${parsed.repo}.git`;
}
