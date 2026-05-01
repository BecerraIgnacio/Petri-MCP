import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { runUxUiEvolver } from "../agents/ux-ui-evolver/index.js";
import type { EvolverOutput, Mutation, Variant } from "../agents/ux-ui-evolver/schema.js";
import { runScorer } from "../agents/scorer/index.js";
import { runVibeIdentifier } from "../agents/vibe-identifier/index.js";
import type { VibeIdentifierOk } from "../agents/vibe-identifier/schema.js";
import { LocalFileSource, type FileSource } from "./file-source.js";
import { applyVariant } from "./apply-mutations.js";
import { isHtmlPath } from "./inject-reporter.js";
import { pickPromotion } from "./score-generation.js";
import { findHighestVariantNumber } from "./evolve-next.js";
import { synthesizeEvents, type SynthesizeVariant } from "./synthesize-events.js";
import type { ScoredVariant, TargetMetric } from "./run-meta.js";
import type {
  LineageEntry,
  SimGenerationSummary,
  SimulationResult,
} from "./simulation-types.js";
import { writeLineageHtml } from "./render-lineage-html.js";
import type { z } from "zod";

const DEFAULT_GENERATIONS = 3;
const DEFAULT_SESSIONS_PER_GEN = 1000;
const DEFAULT_N_VARIANTS = 3;
const DEFAULT_SPLIT_RATIO = 90;
const SEED_RATE_MIN = 0.10;
const SEED_RATE_MAX = 0.30;
const CHALLENGER_RATE_NOISE_SIGMA = 0.05;
// Simulation-specific minimum: lower than production's 30 because judges run small
// (200-session) demos where 90/10 leaves only ~6-7 sessions per challenger. The
// production loop (`runScoreGeneration`) keeps its stricter default.
const SIM_MIN_SESSIONS = 5;

type LockManifest = z.infer<typeof VibeIdentifierOk>;
type VariantFiles = Map<string, string>;
type VariantStore = Map<string, VariantFiles>;

export interface SimulateEvolutionInput {
  source: FileSource;
  displayName: string;
  generations?: number;
  sessionsPerGen?: number;
  nVariants?: number;
  splitRatio?: number;
  seed?: number;
  /** If provided, reuse this lock manifest; otherwise run vibe-identifier once. */
  lockManifest?: LockManifest;
  /** If provided, override the metric resolved from the lock manifest. */
  targetMetric?: TargetMetric;
  /** If set, write every variant of every generation to <renderToDir>/gen<n>/<vid>/<path>. */
  renderToDir?: string;
}

export interface SimulateEvolutionDeps {
  evolver?: typeof runUxUiEvolver;
  scorer?: typeof runScorer;
  vibe?: typeof runVibeIdentifier;
  rng?: () => number;
  now?: () => number;
}

/** mulberry32 again — keep simulator and synthesize-events on the same PRNG so a fixed seed gives a stable end-to-end story. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number, mean: number, sigma: number): number {
  // Box-Muller, single sample
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + sigma * z;
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function uniform(rng: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

function pickEffectiveMetric(
  input: SimulateEvolutionInput,
  lock: LockManifest,
): TargetMetric {
  if (input.targetMetric) return input.targetMetric;
  const inferred = lock.inferred_metric;
  if (inferred) {
    return {
      name: inferred.name,
      description: inferred.description,
      direction: inferred.direction,
    };
  }
  // Hackathon fallback for fixtures without inferred_metric.
  return {
    name: "primary_cta_clicks",
    description:
      "Sessions where the user clicked the primary CTA in the hero (selector matching .btn-primary or similar). A session counts if any click event with that selector exists.",
    direction: "increase",
  };
}

async function readAllFiles(source: FileSource): Promise<VariantFiles> {
  const out: VariantFiles = new Map();
  const paths = await source.glob({ pattern: "**/*" });
  for (const p of paths) {
    try {
      const content = await source.readFile({ path: p });
      out.set(p, content);
    } catch {
      // skip unreadable paths
    }
  }
  if (out.size === 0) {
    throw new Error("simulate_evolution: source contains no readable files");
  }
  return out;
}

async function materializeToTmp(files: VariantFiles): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "petri-sim-gen-"));
  for (const [path, content] of files) {
    const dest = join(dir, path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content, "utf8");
  }
  return dir;
}

async function dumpVariant(
  rootDir: string,
  generation: number,
  variantId: string,
  files: VariantFiles,
): Promise<void> {
  const dir = join(rootDir, `gen${generation}`, variantId);
  for (const [path, content] of files) {
    const dest = join(dir, path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content, "utf8");
  }
}

function applyMutationsToFiles(
  base: VariantFiles,
  variant: Variant,
): VariantFiles {
  const next: VariantFiles = new Map(base);
  // Group mutations by file. Each mutation's `file` is a relative path.
  const byFile = new Map<string, Mutation[]>();
  for (const m of variant.mutations) {
    const list = byFile.get(m.file) ?? [];
    list.push(m);
    byFile.set(m.file, list);
  }
  for (const [filePath, fileMutations] of byFile) {
    if (!isHtmlPath(filePath)) continue;
    const original = next.get(filePath);
    if (!original) continue;
    const result = applyVariant(original, { ...variant, mutations: fileMutations });
    next.set(filePath, result.html);
  }
  return next;
}

export async function runSimulateEvolution(
  input: SimulateEvolutionInput,
  deps: SimulateEvolutionDeps = {},
): Promise<SimulationResult> {
  const evolver = deps.evolver ?? runUxUiEvolver;
  const scorer = deps.scorer ?? runScorer;
  const vibe = deps.vibe ?? runVibeIdentifier;
  const now = deps.now ?? Date.now;

  const generations = input.generations ?? DEFAULT_GENERATIONS;
  const sessionsPerGen = input.sessionsPerGen ?? DEFAULT_SESSIONS_PER_GEN;
  const nVariants = input.nVariants ?? DEFAULT_N_VARIANTS;
  const splitRatio = input.splitRatio ?? DEFAULT_SPLIT_RATIO;
  const seed = input.seed ?? Math.floor(Math.random() * 0x7fffffff);

  const rng = deps.rng ?? mulberry32(seed);
  const startedAt = now();
  const simId = `sim-${seed}-${startedAt.toString(36)}`;

  // 1) Lock manifest — provided or computed once via vibe.
  let lock: LockManifest;
  if (input.lockManifest) {
    lock = input.lockManifest;
  } else {
    const result = await vibe({ source: input.source, displayName: input.displayName });
    if (result.status !== "ok") {
      throw new Error(
        `simulate_evolution: vibe-identifier returned out_of_scope: ${result.reason}`,
      );
    }
    lock = result;
  }
  const metric = pickEffectiveMetric(input, lock);

  // 2) Read every file from source into the seed champion's VariantStore entry.
  const seedFiles = await readAllFiles(input.source);
  const store: VariantStore = new Map();
  store.set("v0", seedFiles);

  // Track each variant's lineage entry as we build them. Sessions/conversions/observed rate get
  // filled in when the variant participates in a generation.
  const lineageById = new Map<string, LineageEntry>();
  const seedRate = clamp01(uniform(rng, SEED_RATE_MIN, SEED_RATE_MAX));
  lineageById.set("v0", {
    id: "v0",
    parent: null,
    generation: 0,
    role: "seed",
    intrinsicRate: seedRate,
    observedRate: 0,
    sessions: 0,
    conversions: 0,
    outcome: "current_champion", // updated as we go
  });

  let championId = "v0";
  const generationSummaries: SimGenerationSummary[] = [];

  if (input.renderToDir) {
    await mkdir(input.renderToDir, { recursive: true });
    await dumpVariant(input.renderToDir, 0, "v0", seedFiles);
  }

  for (let gen = 1; gen <= generations; gen++) {
    // 3) Materialize current champion to a temp dir for the evolver.
    const championFiles = store.get(championId)!;
    const tmpRoot = await materializeToTmp(championFiles);
    const localSource = new LocalFileSource(tmpRoot);

    // 4) Evolve.
    let evolverOut: EvolverOutput;
    try {
      evolverOut = await evolver({
        source: localSource,
        displayName: `${input.displayName}-gen${gen}-${championId}`,
        lockManifest: lock,
        targetMetric: metric,
        nVariants,
      });
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
    if (evolverOut.status !== "ok") {
      throw new Error(
        `simulate_evolution: evolver out_of_scope at gen ${gen}: ${evolverOut.reason}`,
      );
    }

    // 5) Assign new IDs (flat namespace, monotonic).
    const baseNumber = findHighestVariantNumber([...lineageById.keys()]) + 1;
    const challengers = evolverOut.variants.map((v, i) => {
      const newId = `v${baseNumber + i}`;
      const parentRate = lineageById.get(championId)!.intrinsicRate;
      const intrinsicRate = clamp01(gaussian(rng, parentRate, CHALLENGER_RATE_NOISE_SIGMA));
      return { id: newId, hypothesis: v.hypothesis, mutations: v.mutations, intrinsicRate };
    });

    // 6) Apply mutations + register in store + lineage.
    for (const c of challengers) {
      const newFiles = applyMutationsToFiles(championFiles, {
        id: c.id,
        hypothesis: c.hypothesis,
        mutations: c.mutations,
      });
      store.set(c.id, newFiles);
      lineageById.set(c.id, {
        id: c.id,
        parent: championId,
        generation: gen,
        role: "challenger",
        intrinsicRate: c.intrinsicRate,
        observedRate: 0,
        sessions: 0,
        conversions: 0,
        hypothesis: c.hypothesis,
        mutations: c.mutations,
        outcome: "abandoned", // updated on promotion
      });
      if (input.renderToDir) {
        await dumpVariant(input.renderToDir, gen, c.id, newFiles);
      }
    }

    // 7) Synthesize events for this gen's split.
    const synthVariants: SynthesizeVariant[] = [
      { id: championId, intrinsicRate: lineageById.get(championId)!.intrinsicRate },
      ...challengers.map((c) => ({ id: c.id, intrinsicRate: c.intrinsicRate })),
    ];
    const genSeed = (seed + gen * 1000003) >>> 0;
    const synth = synthesizeEvents({
      runId: simId,
      championVariantId: championId,
      variants: synthVariants,
      totalSessions: sessionsPerGen,
      splitRatio,
      seed: genSeed,
    });

    // Populate per-variant stats for THIS gen's lineage entries (champion already has prior gen's stats).
    const championLineage = lineageById.get(championId)!;
    for (const stat of synth.stats) {
      const e = lineageById.get(stat.variantId)!;
      // For challengers, this is their first appearance — set sessions/conversions/observedRate.
      // For the champion, accumulate (but show the latest snapshot as the canonical rate).
      e.sessions = stat.sessions;
      e.conversions = stat.conversions;
      e.observedRate = stat.observedRate;
    }

    // 8) Score.
    const scorerOut = await scorer({
      metric,
      variants: synth.stats.map((s) => {
        const eventsForVariant = synth.events.filter((e) => e.variant_id === s.variantId);
        return {
          variantId: s.variantId,
          totalEvents: eventsForVariant.length,
          uniqueSessions: s.sessions,
          eventCounts: eventsForVariant.reduce<Record<string, number>>((acc, e) => {
            acc[e.event_name] = (acc[e.event_name] ?? 0) + 1;
            return acc;
          }, {}),
          recent: eventsForVariant.slice(0, 200),
        };
      }),
    });

    // 9) Promote.
    const decision = pickPromotion(scorerOut.variants, championId, SIM_MIN_SESSIONS);
    let promoted: string | null = null;
    if (decision.promoted && decision.newChampion) {
      promoted = decision.newChampion;
      lineageById.get(promoted)!.outcome = "promoted";
      // The previous champion was "current_champion" — now it's just "abandoned" history.
      championLineage.outcome = "abandoned";
      championId = promoted;
      lineageById.get(championId)!.outcome = "current_champion";
    }

    generationSummaries.push({
      generation: gen,
      championAtStart: championLineage.id,
      variantIds: [championLineage.id, ...challengers.map((c) => c.id)],
      scorerVerdict: scorerOut.variants as ScoredVariant[],
      promoted,
      promotionReason: decision.reason ?? (promoted ? `promoted ${promoted}` : "no promotion"),
    });
  }

  const finishedAt = now();

  // Lineage list — preserve insertion order (gen 0 first, then gen 1 challengers in id order, etc).
  const lineage = [...lineageById.values()];

  const result: SimulationResult = {
    status: "ok",
    simId,
    displayName: input.displayName,
    metric,
    config: {
      generations,
      sessionsPerGen,
      nVariants,
      splitRatio,
      seed,
    },
    generations: generationSummaries,
    lineage,
    winner: championId,
    startedAt,
    finishedAt,
    renderedToDir: input.renderToDir ?? null,
  };

  if (input.renderToDir) {
    await writeFile(
      join(input.renderToDir, "lineage.json"),
      JSON.stringify(result, null, 2),
      "utf8",
    );
    await writeLineageHtml(result, input.renderToDir);
  }

  return result;
}
