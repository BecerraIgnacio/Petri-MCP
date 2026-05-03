import type { FileSource, GrepHit } from "../file-source.js";

const DEFAULT_USER_AGENT = "petri-mcp/0.1 (+https://github.com/BecerraIgnacio/petri-MCP)";
const DEFAULT_FETCH_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 1_500_000;
const MAX_GREP_HITS = 100;
const VIRTUAL_PATH = "index.html";

export interface LiveSiteSourceOptions {
  url: string;
  userAgent?: string;
  fetchTimeoutMs?: number;
}

/**
 * Fetches the rendered HTML of a deployed page (typically a v0/Next.js site
 * on Vercel) and exposes it as a single virtual file named `index.html`. The
 * existing simulator pipeline can then mutate the rendered DOM via cheerio.
 *
 * Mutations against `<style>` blocks usually find nothing on a Next.js page
 * (CSS lives in external `_next/static/css/...`); text/attribute/add/remove
 * mutations work normally and produce visible visual differences when the
 * mutated copy is iframed with a `<base href>` pointing at the live origin.
 */
export class LiveSiteSource implements FileSource {
  private readonly url: URL;
  private readonly userAgent: string;
  private readonly fetchTimeoutMs: number;
  private cached?: string;
  private fetchPromise?: Promise<string>;

  constructor(opts: LiveSiteSourceOptions) {
    this.url = new URL(opts.url);
    if (this.url.protocol !== "http:" && this.url.protocol !== "https:") {
      throw new Error(`LiveSiteSource: unsupported protocol "${this.url.protocol}" — must be http(s)`);
    }
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchTimeoutMs = opts.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  }

  /** Public origin of the live page — used by simulate-evolution to inject `<base href>` into mutated copies. */
  getLiveUrl(): string {
    return this.url.toString();
  }

  /** Hostname-only display string for log/debug output. */
  displayName(): string {
    return `live: ${this.url.hostname}${this.url.pathname === "/" ? "" : this.url.pathname}`;
  }

  async ensureReady(): Promise<void> {
    await this.fetchOnce();
  }

  async readFile(args: { path: string }): Promise<string> {
    const normalized = args.path.replace(/^\/+/, "").toLowerCase();
    if (normalized !== VIRTUAL_PATH) {
      throw new Error(
        `LiveSiteSource: only "${VIRTUAL_PATH}" is exposed; requested "${args.path}"`,
      );
    }
    return await this.fetchOnce();
  }

  async glob(args: { pattern: string }): Promise<string[]> {
    const p = args.pattern.toLowerCase();
    const matchesIndex =
      p === "index.html" ||
      p === "/index.html" ||
      p === "*.html" ||
      p === "**/*.html" ||
      p === "**/*" ||
      p === "*";
    if (!matchesIndex) return [];
    await this.fetchOnce();
    return [VIRTUAL_PATH];
  }

  async grep(args: { pattern: string; pathGlob?: string; flags?: string }): Promise<GrepHit[]> {
    if (args.pathGlob) {
      const matches = await this.glob({ pattern: args.pathGlob });
      if (matches.length === 0) return [];
    }
    let regex: RegExp;
    try {
      regex = new RegExp(args.pattern, args.flags ?? "i");
    } catch (err) {
      throw new Error(`invalid regex: ${(err as Error).message}`);
    }
    const body = await this.fetchOnce();
    const lines = body.split("\n");
    const hits: GrepHit[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (hits.length >= MAX_GREP_HITS) break;
      const line = lines[i];
      if (line === undefined) continue;
      if (regex.test(line)) {
        hits.push({ file: VIRTUAL_PATH, line: i + 1, match: line.trim().slice(0, 240) });
      }
    }
    return hits;
  }

  private async fetchOnce(): Promise<string> {
    if (this.cached !== undefined) return this.cached;
    if (!this.fetchPromise) this.fetchPromise = this.doFetch();
    this.cached = await this.fetchPromise;
    return this.cached;
  }

  private async doFetch(): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
    let res: Response;
    try {
      res = await fetch(this.url.toString(), {
        method: "GET",
        headers: {
          "User-Agent": this.userAgent,
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
        signal: controller.signal,
      });
    } catch (err) {
      const e = err as Error;
      if (e.name === "AbortError") {
        throw new Error(
          `LiveSiteSource: timed out after ${this.fetchTimeoutMs}ms fetching ${this.url.toString()}`,
        );
      }
      throw new Error(`LiveSiteSource: fetch failed for ${this.url.toString()}: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new Error(
        `LiveSiteSource: ${res.status} ${res.statusText} fetching ${this.url.toString()}`,
      );
    }

    const ct = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(ct)) {
      throw new Error(
        `LiveSiteSource: expected text/html, got "${ct}" from ${this.url.toString()}. Pass a page URL, not an API endpoint.`,
      );
    }

    const body = await res.text();
    if (body.length > MAX_BODY_BYTES) {
      throw new Error(
        `LiveSiteSource: response from ${this.url.toString()} is ${body.length} bytes, exceeds ${MAX_BODY_BYTES} limit`,
      );
    }
    return body;
  }
}
