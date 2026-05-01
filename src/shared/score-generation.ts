import { runScorer, type ScorerInput } from "../agents/scorer/index.js";
import {
  appendGeneration,
  getRunMeta,
  getScores,
  setRunMeta,
  setScores,
} from "./run-store.js";
import {
  GenerationRecord,
  RunMeta,
  SCORES_KEY,
  ScoresRecord,
  ScoredVariant,
  TargetMetric,
} from "./run-meta.js";
import { runReadMetrics, type ReadMetricsResult } from "./events.js";

const DEFAULT_MIN_SESSIONS = 30;
const DEFAULT_SAMPLE_SIZE = 200;

export interface ScoreGenerationInput {
  runId: string;
  minSessionsPerVariant?: number;
  sampleSize?: number;
}

export interface ScoreGenerationDeps {
  loadMeta?: typeof getRunMeta;
  saveMeta?: typeof setRunMeta;
  saveScores?: typeof setScores;
  loadScores?: typeof getScores;
  appendGen?: typeof appendGeneration;
  readMetrics?: typeof runReadMetrics;
  scorer?: typeof runScorer;
  now?: () => number;
}

export interface ScoreGenerationResult {
  status: "ok";
  runId: string;
  generation: number;
  scores: ScoresRecord;
  promotion:
    | { promoted: true; previousChampion: string; newChampion: string }
    | { promoted: false; reason: string };
}

function pickEffectiveMetric(meta: RunMeta): TargetMetric | null {
  if (meta.targetMetric) return meta.targetMetric;
  if (meta.inferredMetric) {
    const { name, description, direction } = meta.inferredMetric;
    return { name, description, direction };
  }
  return null;
}

export function pickPromotion(
  scores: ScoredVariant[],
  championId: string,
  minSessions: number,
): { promoted: boolean; reason?: string; newChampion?: string } {
  const eligible = scores.filter((s) => s.sessionsCounted >= minSessions);
  if (eligible.length === 0) {
    return {
      promoted: false,
      reason: `no variant cleared sample threshold (min ${minSessions} sessions)`,
    };
  }
  const champion = scores.find((s) => s.variantId === championId);
  if (!champion) {
    return {
      promoted: false,
      reason: `champion "${championId}" missing from scores`,
    };
  }
  const sorted = [...eligible].sort((a, b) => b.score - a.score);
  const top = sorted[0]!;
  if (top.variantId === championId) {
    return {
      promoted: false,
      reason: `champion held: ${championId} top-scored at ${top.score.toFixed(3)}`,
    };
  }
  if (top.score <= champion.score) {
    return {
      promoted: false,
      reason: `top variant ${top.variantId} (${top.score.toFixed(3)}) did not strictly beat champion ${championId} (${champion.score.toFixed(3)})`,
    };
  }
  return { promoted: true, newChampion: top.variantId };
}

export async function runScoreGeneration(
  input: ScoreGenerationInput,
  deps: ScoreGenerationDeps = {},
): Promise<ScoreGenerationResult> {
  const loadMeta = deps.loadMeta ?? getRunMeta;
  const saveMeta = deps.saveMeta ?? setRunMeta;
  const saveScores = deps.saveScores ?? setScores;
  const appendGen = deps.appendGen ?? appendGeneration;
  const readMetrics = deps.readMetrics ?? runReadMetrics;
  const scorer = deps.scorer ?? runScorer;
  const now = deps.now ?? Date.now;
  const minSessions = input.minSessionsPerVariant ?? DEFAULT_MIN_SESSIONS;
  const sampleSize = input.sampleSize ?? DEFAULT_SAMPLE_SIZE;

  const meta = await loadMeta(input.runId);
  if (!meta) {
    throw new Error(`score_generation: unknown runId "${input.runId}"`);
  }
  const metric = pickEffectiveMetric(meta);
  if (!metric) {
    throw new Error(
      `score_generation: run "${input.runId}" has no targetMetric and no inferredMetric — set one via start_split before scoring.`,
    );
  }

  const metrics: ReadMetricsResult = await readMetrics({
    runId: input.runId,
    sample: sampleSize,
  });

  const scorerInput: ScorerInput = {
    metric,
    variants: metrics.variants.map((v) => ({
      variantId: v.variantId,
      totalEvents: v.totalEvents,
      uniqueSessions: v.uniqueSessions,
      eventCounts: v.eventCounts,
      recent: v.recent,
    })),
  };
  const scorerOut = await scorer(scorerInput);

  const scoresRecord: ScoresRecord = {
    generation: meta.currentGeneration,
    scoredAt: now(),
    variants: scorerOut.variants,
  };
  await saveScores(input.runId, scoresRecord);

  const decision = pickPromotion(scorerOut.variants, meta.championVariantId, minSessions);

  if (!decision.promoted) {
    return {
      status: "ok",
      runId: input.runId,
      generation: meta.currentGeneration,
      scores: scoresRecord,
      promotion: { promoted: false, reason: decision.reason ?? "no promotion" },
    };
  }

  const previousChampion = meta.championVariantId;
  const newChampion = decision.newChampion!;
  const generationRecord: GenerationRecord = {
    generation: meta.currentGeneration,
    championVariantId: newChampion,
    variantIds: meta.variantIds,
    scoresKey: SCORES_KEY(input.runId, meta.currentGeneration),
    promotedAt: now(),
  };
  await appendGen(input.runId, generationRecord);

  const updated: RunMeta = {
    ...meta,
    championVariantId: newChampion,
    currentGeneration: meta.currentGeneration + 1,
  };
  await saveMeta(updated);

  return {
    status: "ok",
    runId: input.runId,
    generation: scoresRecord.generation,
    scores: scoresRecord,
    promotion: { promoted: true, previousChampion, newChampion },
  };
}
