import { describe, it, expect } from "vitest";
import { recordEvent, runReadMetrics } from "../src/shared/events.js";
import type { RunMeta, StoredEvent } from "../src/shared/run-meta.js";

const META: RunMeta = {
  runId: "demo-001",
  championVariantId: "v0",
  variantIds: ["v0", "v1", "v2"],
  splitRatio: 90,
  blobBase: "https://test.public.blob.vercel-storage.com",
  files: { v0: ["index.html"], v1: ["index.html"], v2: ["index.html"] },
  createdAt: 0,
};

function makeStubs(metaByRun: Record<string, RunMeta>) {
  const events: StoredEvent[] = [];
  const append = async (ev: StoredEvent) => {
    events.push(ev);
  };
  const loadMeta = async (runId: string) => metaByRun[runId] ?? null;
  const count = async (runId: string, variantId: string) =>
    events.filter((e) => e.run_id === runId && e.variant_id === variantId).length;
  const recent = async (runId: string, variantId: string, limit: number) =>
    events
      .filter((e) => e.run_id === runId && e.variant_id === variantId)
      .slice(-limit)
      .reverse();
  return { events, append, loadMeta, count, recent };
}

describe("recordEvent", () => {
  it("appends a valid event with synthesized event_id + received_at", async () => {
    const stubs = makeStubs({ "demo-001": META });
    const result = await recordEvent(
      {
        run_id: "demo-001",
        variant_id: "v1",
        session_id: "s-abc",
        event_name: "click",
        payload: { selector: "button.cta" },
        ts: 1730000000000,
      },
      { append: stubs.append, loadMeta: stubs.loadMeta, now: () => 1730000001000, randomId: () => "evid-1" },
    );
    expect(result.status).toBe("ok");
    expect(result.event_id).toBe("evid-1");
    expect(stubs.events).toHaveLength(1);
    const stored = stubs.events[0]!;
    expect(stored).toMatchObject({
      run_id: "demo-001",
      variant_id: "v1",
      session_id: "s-abc",
      event_name: "click",
      ts: 1730000000000,
      event_id: "evid-1",
      received_at: 1730000001000,
    });
  });

  it("rejects unknown run_id with a recognizable message", async () => {
    const stubs = makeStubs({});
    await expect(
      recordEvent(
        {
          run_id: "ghost-run",
          variant_id: "v1",
          session_id: "s-abc",
          event_name: "click",
          ts: 0,
        },
        { append: stubs.append, loadMeta: stubs.loadMeta },
      ),
    ).rejects.toThrow(/unknown run_id "ghost-run"/);
    expect(stubs.events).toHaveLength(0);
  });

  it("rejects variant_id not in the run's variantIds", async () => {
    const stubs = makeStubs({ "demo-001": META });
    await expect(
      recordEvent(
        {
          run_id: "demo-001",
          variant_id: "ghost",
          session_id: "s-abc",
          event_name: "click",
          ts: 0,
        },
        { append: stubs.append, loadMeta: stubs.loadMeta },
      ),
    ).rejects.toThrow(/variant_id "ghost" not in run/);
  });

  it("rejects malformed input shape", async () => {
    const stubs = makeStubs({ "demo-001": META });
    await expect(
      recordEvent({ foo: "bar" }, { append: stubs.append, loadMeta: stubs.loadMeta }),
    ).rejects.toThrow(/invalid event/);
  });

  it("rejects runId that violates the kebab-case regex", async () => {
    const stubs = makeStubs({ "demo-001": META });
    await expect(
      recordEvent(
        {
          run_id: "BAD UPPERCASE",
          variant_id: "v0",
          session_id: "s",
          event_name: "x",
          ts: 0,
        },
        { append: stubs.append, loadMeta: stubs.loadMeta },
      ),
    ).rejects.toThrow();
  });
});

describe("runReadMetrics", () => {
  it("returns per-variant counts + champion when no variantId filter is given", async () => {
    const stubs = makeStubs({ "demo-001": META });
    const ts = 1730000000000;
    let id = 0;
    for (const ev of [
      { variant: "v0", name: "impression", session: "s1" },
      { variant: "v0", name: "click", session: "s1" },
      { variant: "v0", name: "impression", session: "s2" },
      { variant: "v1", name: "impression", session: "s3" },
    ]) {
      await stubs.append({
        run_id: "demo-001",
        variant_id: ev.variant,
        session_id: ev.session,
        event_name: ev.name,
        payload: {},
        ts,
        event_id: `e${++id}`,
        received_at: ts,
      });
    }
    const result = await runReadMetrics(
      { runId: "demo-001" },
      { loadMeta: stubs.loadMeta, count: stubs.count, recent: stubs.recent },
    );
    expect(result.status).toBe("ok");
    expect(result.champion).toBe("v0");
    const v0 = result.variants.find((v) => v.variantId === "v0")!;
    const v1 = result.variants.find((v) => v.variantId === "v1")!;
    expect(v0.totalEvents).toBe(3);
    expect(v0.eventCounts).toEqual({ impression: 2, click: 1 });
    expect(v0.uniqueSessions).toBe(2);
    expect(v1.totalEvents).toBe(1);
  });

  it("filters to one variant when variantId is set", async () => {
    const stubs = makeStubs({ "demo-001": META });
    const result = await runReadMetrics(
      { runId: "demo-001", variantId: "v1" },
      { loadMeta: stubs.loadMeta, count: stubs.count, recent: stubs.recent },
    );
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]!.variantId).toBe("v1");
  });

  it("rejects unknown runId", async () => {
    const stubs = makeStubs({});
    await expect(
      runReadMetrics(
        { runId: "ghost" },
        { loadMeta: stubs.loadMeta, count: stubs.count, recent: stubs.recent },
      ),
    ).rejects.toThrow(/unknown runId "ghost"/);
  });

  it("rejects variantId not in the run", async () => {
    const stubs = makeStubs({ "demo-001": META });
    await expect(
      runReadMetrics(
        { runId: "demo-001", variantId: "ghost" },
        { loadMeta: stubs.loadMeta, count: stubs.count, recent: stubs.recent },
      ),
    ).rejects.toThrow(/variantId "ghost"/);
  });

  it("respects sample=0 (no recent events fetched)", async () => {
    const stubs = makeStubs({ "demo-001": META });
    await stubs.append({
      run_id: "demo-001",
      variant_id: "v0",
      session_id: "s",
      event_name: "x",
      payload: {},
      ts: 0,
      event_id: "e1",
      received_at: 0,
    });
    const result = await runReadMetrics(
      { runId: "demo-001", sample: 0 },
      { loadMeta: stubs.loadMeta, count: stubs.count, recent: stubs.recent },
    );
    const v0 = result.variants.find((v) => v.variantId === "v0")!;
    expect(v0.totalEvents).toBe(1);
    expect(v0.recent).toEqual([]);
    expect(v0.eventCounts).toEqual({});
  });
});
