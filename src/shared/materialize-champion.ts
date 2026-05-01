import { mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

export interface MaterializeChampionInput {
  runId: string;
  generation: number;
  variantId: string;
  blobBase: string;
  paths: string[];
}

export interface MaterializeChampionDeps {
  fetcher?: typeof fetch;
  rootDir?: string;
  /** Force a re-fetch even when the dir already exists (test override). */
  force?: boolean;
}

export interface MaterializeChampionResult {
  dir: string;
  reused: boolean;
  fetched: number;
}

function variantBlobUrl(blobBase: string, runId: string, variantId: string, path: string): string {
  const trimmedBase = blobBase.replace(/\/+$/, "");
  const trimmedPath = path.replace(/^\/+/, "");
  return `${trimmedBase}/variants/${runId}/${variantId}/${trimmedPath}`;
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function materializeChampion(
  input: MaterializeChampionInput,
  deps: MaterializeChampionDeps = {},
): Promise<MaterializeChampionResult> {
  if (input.paths.length === 0) {
    throw new Error("materializeChampion: paths[] is empty");
  }
  const fetcher = deps.fetcher ?? fetch;
  const rootDir = deps.rootDir ?? join(tmpdir(), "petri-cache", "runs");
  const dirName = `${input.runId}-gen${input.generation}-${input.variantId}`;
  const dir = join(rootDir, dirName);

  if (!deps.force && (await dirExists(dir))) {
    return { dir, reused: true, fetched: 0 };
  }

  await mkdir(dir, { recursive: true });

  let fetched = 0;
  for (const path of input.paths) {
    const url = variantBlobUrl(input.blobBase, input.runId, input.variantId, path);
    const res = await fetcher(url);
    if (!res.ok) {
      throw new Error(
        `materializeChampion: GET ${url} returned ${res.status} ${res.statusText}`,
      );
    }
    const body = await res.text();
    const dest = join(dir, path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, body, "utf8");
    fetched++;
  }

  return { dir, reused: false, fetched };
}
