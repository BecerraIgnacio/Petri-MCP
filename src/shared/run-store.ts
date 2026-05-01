import { Redis } from "@upstash/redis";
import {
  EVENTS_KEY,
  MAX_EVENTS_PER_VARIANT,
  RUN_META_KEY,
  RunMeta,
  StoredEvent,
} from "./run-meta.js";

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
