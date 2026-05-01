import { Redis } from "@upstash/redis";
import { RUN_META_KEY, RunMeta } from "./run-meta.js";

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
