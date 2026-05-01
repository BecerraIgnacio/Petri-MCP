import { EventRecord, StoredEvent } from "./run-meta.js";
import { appendEvent, getEventCount, getRecentEvents, getRunMeta } from "./run-store.js";

export interface RecordEventDeps {
  append?: typeof appendEvent;
  loadMeta?: typeof getRunMeta;
  now?: () => number;
  randomId?: () => string;
}

export interface RecordResult {
  status: "ok";
  event_id: string;
}

function defaultRandomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function recordEvent(
  rawInput: unknown,
  deps: RecordEventDeps = {},
): Promise<RecordResult> {
  const append = deps.append ?? appendEvent;
  const loadMeta = deps.loadMeta ?? getRunMeta;
  const now = deps.now ?? Date.now;
  const randomId = deps.randomId ?? defaultRandomId;

  const parsed = EventRecord.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(`recordEvent: invalid event — ${parsed.error.message}`);
  }
  const ev = parsed.data;

  const meta = await loadMeta(ev.run_id);
  if (!meta) {
    throw new Error(`recordEvent: unknown run_id "${ev.run_id}"`);
  }
  if (!meta.variantIds.includes(ev.variant_id)) {
    throw new Error(
      `recordEvent: variant_id "${ev.variant_id}" not in run "${ev.run_id}" (variants: ${meta.variantIds.join(", ")})`,
    );
  }

  const stored: StoredEvent = {
    ...ev,
    event_id: randomId(),
    received_at: now(),
  };
  await append(stored);
  return { status: "ok", event_id: stored.event_id };
}

export interface ReadMetricsInput {
  runId: string;
  variantId?: string;
  sample?: number;
}

export interface VariantMetrics {
  variantId: string;
  totalEvents: number;
  eventCounts: Record<string, number>;
  uniqueSessions: number;
  recent: StoredEvent[];
}

export interface ReadMetricsResult {
  status: "ok";
  runId: string;
  champion: string;
  variants: VariantMetrics[];
}

export interface ReadMetricsDeps {
  loadMeta?: typeof getRunMeta;
  count?: typeof getEventCount;
  recent?: typeof getRecentEvents;
}

export async function runReadMetrics(
  input: ReadMetricsInput,
  deps: ReadMetricsDeps = {},
): Promise<ReadMetricsResult> {
  const loadMeta = deps.loadMeta ?? getRunMeta;
  const count = deps.count ?? getEventCount;
  const recent = deps.recent ?? getRecentEvents;

  const meta = await loadMeta(input.runId);
  if (!meta) {
    throw new Error(`read_metrics: unknown runId "${input.runId}"`);
  }

  const variantIds = input.variantId
    ? meta.variantIds.filter((v) => v === input.variantId)
    : meta.variantIds;
  if (input.variantId && variantIds.length === 0) {
    throw new Error(
      `read_metrics: variantId "${input.variantId}" not in run "${input.runId}"`,
    );
  }

  const sampleSize = Math.max(0, Math.min(input.sample ?? 50, 500));
  const variants: VariantMetrics[] = [];
  for (const variantId of variantIds) {
    const [total, sample] = await Promise.all([
      count(input.runId, variantId),
      sampleSize > 0 ? recent(input.runId, variantId, sampleSize) : Promise.resolve([]),
    ]);
    const eventCounts: Record<string, number> = {};
    const sessions = new Set<string>();
    for (const ev of sample) {
      eventCounts[ev.event_name] = (eventCounts[ev.event_name] ?? 0) + 1;
      sessions.add(ev.session_id);
    }
    variants.push({
      variantId,
      totalEvents: total,
      eventCounts,
      uniqueSessions: sessions.size,
      recent: sample,
    });
  }

  return {
    status: "ok",
    runId: input.runId,
    champion: meta.championVariantId,
    variants,
  };
}
