import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runUxUiEvolver } from "../agents/ux-ui-evolver/index.js";
import type { Variant } from "../agents/ux-ui-evolver/schema.js";
import { LocalFileSource } from "./file-source.js";
import { applyVariant } from "./apply-mutations.js";
import { materializeChampion } from "./materialize-champion.js";
import { runScoreGeneration } from "./score-generation.js";
import {
  getLockManifest,
  getRunMeta,
} from "./run-store.js";
import { runStartSplit, type StartSplitResult } from "./start-split.js";
import type { ScoreGenerationResult } from "./score-generation.js";
import { isHtmlPath } from "./inject-reporter.js";

const DEFAULT_N_VARIANTS = 3;

export interface EvolveNextInput {
  runId: string;
  splitRatio?: number;
  nVariants?: number;
  publicBase: string;
}

export interface EvolveNextDeps {
  loadMeta?: typeof getRunMeta;
  loadLock?: typeof getLockManifest;
  scoreGeneration?: typeof runScoreGeneration;
  materialize?: typeof materializeChampion;
  evolver?: typeof runUxUiEvolver;
  startSplit?: typeof runStartSplit;
  /** Reads a file from the materialized champion dir; defaults to fs.readFile. */
  readChampionFile?: (dir: string, path: string) => Promise<string>;
}

export type EvolveNextResult =
  | {
      status: "no_promotion";
      runId: string;
      generation: number;
      score: ScoreGenerationResult;
    }
  | {
      status: "evolved";
      runId: string;
      previousGeneration: number;
      newGeneration: number;
      previousChampion: string;
      newChampion: string;
      newVariantIds: string[];
      runUrl: string;
      score: ScoreGenerationResult;
      split: StartSplitResult;
    };

async function defaultReadChampionFile(dir: string, path: string): Promise<string> {
  return await readFile(join(dir, path), "utf8");
}

function nextVariantIds(start: number, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(`v${start + i}`);
  return out;
}

export function findHighestVariantNumber(ids: string[]): number {
  let max = 0;
  for (const id of ids) {
    const m = id.match(/^v(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return max;
}

export async function runEvolveNext(
  input: EvolveNextInput,
  deps: EvolveNextDeps = {},
): Promise<EvolveNextResult> {
  const loadMeta = deps.loadMeta ?? getRunMeta;
  const loadLock = deps.loadLock ?? getLockManifest;
  const scoreGen = deps.scoreGeneration ?? runScoreGeneration;
  const materialize = deps.materialize ?? materializeChampion;
  const evolver = deps.evolver ?? runUxUiEvolver;
  const startSplit = deps.startSplit ?? runStartSplit;
  const readChamp = deps.readChampionFile ?? defaultReadChampionFile;

  const splitRatio = input.splitRatio ?? 90;
  const nVariants = input.nVariants ?? DEFAULT_N_VARIANTS;

  const meta = await loadMeta(input.runId);
  if (!meta) {
    throw new Error(`evolve_next_generation: unknown runId "${input.runId}"`);
  }
  const lock = await loadLock(input.runId);
  if (!lock) {
    throw new Error(
      `evolve_next_generation: run "${input.runId}" has no stored lock manifest. Pass lockManifest to start_split before evolving.`,
    );
  }

  const score = await scoreGen({
    runId: input.runId,
    minSessionsPerVariant: undefined,
  });

  if (!score.promotion.promoted) {
    return {
      status: "no_promotion",
      runId: input.runId,
      generation: score.generation,
      score,
    };
  }

  const newChampionId = score.promotion.newChampion;
  const championPaths = meta.files[newChampionId];
  if (!championPaths || championPaths.length === 0) {
    throw new Error(
      `evolve_next_generation: no published file paths for promoted variant "${newChampionId}"`,
    );
  }

  const promotedGeneration = meta.currentGeneration + 1;
  const matResult = await materialize({
    runId: input.runId,
    generation: promotedGeneration,
    variantId: newChampionId,
    blobBase: meta.blobBase,
    paths: championPaths,
  });

  const source = new LocalFileSource(matResult.dir);
  // Mirror inferredMetric onto the lockManifest so the evolver's own fallback path picks it up.
  const lockForEvolver = meta.inferredMetric && !lock.inferred_metric
    ? { ...lock, inferred_metric: meta.inferredMetric }
    : lock;
  const evolverArgs: {
    source: LocalFileSource;
    displayName: string;
    lockManifest: typeof lockForEvolver;
    nVariants: number;
    targetMetric?: { name: string; description: string; direction: "increase" | "decrease" };
  } = {
    source,
    displayName: `${input.runId}-gen${promotedGeneration}-${newChampionId}`,
    lockManifest: lockForEvolver,
    nVariants,
  };
  if (meta.targetMetric) evolverArgs.targetMetric = meta.targetMetric;
  const evolverOut = await evolver(evolverArgs);

  if (evolverOut.status === "out_of_scope") {
    throw new Error(
      `evolve_next_generation: evolver returned out_of_scope for ${input.runId}: ${evolverOut.reason}`,
    );
  }

  const championBaseFiles: Array<{ path: string; content: string }> = [];
  for (const p of championPaths) {
    const content = await readChamp(matResult.dir, p);
    championBaseFiles.push({ path: p, content });
  }

  const newVariantIdStart = findHighestVariantNumber(meta.variantIds) + 1;
  const newChallengerIds = nextVariantIds(newVariantIdStart, evolverOut.variants.length);

  const challengerVariants = evolverOut.variants.map((v: Variant, i: number) => {
    const newId = newChallengerIds[i]!;
    const files = championBaseFiles.map((f) => {
      if (!isHtmlPath(f.path)) return { path: f.path, content: f.content };
      const result = applyVariant(f.content, v);
      return { path: f.path, content: result.html };
    });
    return { id: newId, files };
  });

  const championVariant = {
    id: newChampionId,
    files: championBaseFiles.map((f) => ({ path: f.path, content: f.content })),
  };

  const split = await startSplit(
    {
      runId: input.runId,
      championVariantId: newChampionId,
      splitRatio,
      variants: [championVariant, ...challengerVariants],
    },
    input.publicBase,
  );

  return {
    status: "evolved",
    runId: input.runId,
    previousGeneration: score.generation,
    newGeneration: promotedGeneration,
    previousChampion: score.promotion.previousChampion,
    newChampion: newChampionId,
    newVariantIds: split.variantIds,
    runUrl: split.runUrl,
    score,
    split,
  };
}
