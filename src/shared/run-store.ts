import { Redis } from "@upstash/redis";
import {
  CONNECT_KEY,
  ConnectRecord,
  EVENTS_KEY,
  GENERATIONS_KEY,
  GenerationRecord,
  LOCK_KEY,
  MAX_EVENTS_PER_VARIANT,
  RUN_META_KEY,
  RunMeta,
  SCORES_KEY,
  ScoresRecord,
  StoredEvent,
} from "./run-meta.js";
import { VibeIdentifierOk } from "../agents/vibe-identifier/schema.js";

type LockManifest = ReturnType<typeof VibeIdentifierOk.parse>;

let cached: Redis | null = null;

function getRedis(): Redis {
  if (cached) return cached;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "run-store: missing redis env. Set KV_REST_API_URL + KV_REST_API_TOKEN (Vercel Marketplace) or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.",
    );
  }
  cached = new Redis({ url, token });
  return cached;
}

export async function getRunMeta(runId: string): Promise<RunMeta | null> {
  const raw = await getRedis().get(RUN_META_KEY(runId));
  if (raw == null) return null;
  return RunMeta.parse(raw);
}

export async function getConnectRecord(runId: string): Promise<ConnectRecord | null> {
  const raw = await getRedis().get(CONNECT_KEY(runId));
  if (raw == null) return null;
  return ConnectRecord.parse(raw);
}

export async function setConnectRecord(record: ConnectRecord): Promise<void> {
  ConnectRecord.parse(record);
  await getRedis().set(CONNECT_KEY(record.runId), record);
}

export async function setRunMeta(meta: RunMeta): Promise<void> {
  RunMeta.parse(meta);
  await getRedis().set(RUN_META_KEY(meta.runId), meta);
}

export async function appendEvent(event: StoredEvent): Promise<void> {
  const key = EVENTS_KEY(event.run_id, event.variant_id);
  const r = getRedis();
  await r.lpush(key, JSON.stringify(event));
  await r.ltrim(key, 0, MAX_EVENTS_PER_VARIANT - 1);
}

export async function getEventCount(
  runId: string,
  variantId: string,
): Promise<number> {
  return await getRedis().llen(EVENTS_KEY(runId, variantId));
}

export async function getRecentEvents(
  runId: string,
  variantId: string,
  limit: number,
): Promise<StoredEvent[]> {
  if (limit <= 0) return [];
  const raw = await getRedis().lrange(EVENTS_KEY(runId, variantId), 0, limit - 1);
  const out: StoredEvent[] = [];
  for (const r of raw) {
    try {
      const parsed = typeof r === "string" ? JSON.parse(r) : r;
      out.push(StoredEvent.parse(parsed));
    } catch {
      // skip malformed entries
    }
  }
  return out;
}

export async function getLockManifest(runId: string): Promise<LockManifest | null> {
  const raw = await getRedis().get(LOCK_KEY(runId));
  if (raw == null) return null;
  return VibeIdentifierOk.parse(raw);
}

export async function setLockManifest(
  runId: string,
  manifest: LockManifest,
): Promise<void> {
  VibeIdentifierOk.parse(manifest);
  await getRedis().set(LOCK_KEY(runId), manifest);
}

export async function getScores(
  runId: string,
  generation: number,
): Promise<ScoresRecord | null> {
  const raw = await getRedis().get(SCORES_KEY(runId, generation));
  if (raw == null) return null;
  return ScoresRecord.parse(raw);
}

export async function setScores(
  runId: string,
  scores: ScoresRecord,
): Promise<void> {
  ScoresRecord.parse(scores);
  await getRedis().set(SCORES_KEY(runId, scores.generation), scores);
}

export async function appendGeneration(
  runId: string,
  record: GenerationRecord,
): Promise<void> {
  GenerationRecord.parse(record);
  await getRedis().lpush(GENERATIONS_KEY(runId), JSON.stringify(record));
}

export async function getGenerations(runId: string): Promise<GenerationRecord[]> {
  const raw = await getRedis().lrange(GENERATIONS_KEY(runId), 0, -1);
  const out: GenerationRecord[] = [];
  for (const r of raw) {
    try {
      const parsed = typeof r === "string" ? JSON.parse(r) : r;
      out.push(GenerationRecord.parse(parsed));
    } catch {
      // skip malformed
    }
  }
  return out;
}
