import { describe, it, expect } from "vitest";
import type OpenAI from "openai";
import { runScorer } from "../src/agents/scorer/loop.js";
import type { ScorerInput } from "../src/agents/scorer/schema.js";
import type { StoredEvent } from "../src/shared/run-meta.js";

function makeEvents(variantId: string, sessions: number, clickRate: number): StoredEvent[] {
  const out: StoredEvent[] = [];
  for (let i = 0; i < sessions; i++) {
    const sessionId = `${variantId}-s${i}`;
    out.push({
      run_id: "r1",
      variant_id: variantId,
      session_id: sessionId,
      event_name: "impression",
      ts: 1700000000000 + i * 1000,
      event_id: `e-imp-${variantId}-${i}`,
      received_at: 1700000000000 + i * 1000,
    });
    if (Math.random() < clickRate) {
      out.push({
        run_id: "r1",
        variant_id: variantId,
        session_id: sessionId,
        event_name: "click",
        payload: { selector: ".btn-primary" },
        ts: 1700000000000 + i * 1000 + 500,
        event_id: `e-click-${variantId}-${i}`,
        received_at: 1700000000000 + i * 1000 + 500,
      });
    }
  }
  return out;
}

interface MockResponse {
  toolCalls?: Array<{ id: string; name: string; argumentsJson: string }>;
  content?: string;
}

function makeMockClient(responses: MockResponse[]): OpenAI {
  let i = 0;
  const create = async () => {
    const r = responses[Math.min(i++, responses.length - 1)] ?? {};
    const tool_calls = (r.toolCalls ?? []).map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.argumentsJson },
    }));
    return {
      choices: [
        {
          message: {
            role: "assistant",
            content: r.content ?? null,
            tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
          },
          index: 0,
          finish_reason: "stop",
        },
      ],
    };
  };
  return {
    chat: { completions: { create: create as never } },
  } as unknown as OpenAI;
}

const baseInput: ScorerInput = {
  metric: {
    name: "primary_cta_clicks",
    description: "Sessions that clicked the primary CTA in the hero",
    direction: "increase",
  },
  variants: [
    {
      variantId: "v0",
      totalEvents: 60,
      uniqueSessions: 30,
      eventCounts: { impression: 30, click: 12 },
      recent: makeEvents("v0", 30, 0.4),
    },
    {
      variantId: "v1",
      totalEvents: 50,
      uniqueSessions: 30,
      eventCounts: { impression: 30, click: 6 },
      recent: makeEvents("v1", 30, 0.2),
    },
  ],
};

describe("runScorer", () => {
  it("returns validated scores when the model calls submit_scores correctly", async () => {
    const happyOutput = {
      variants: [
        {
          variantId: "v0",
          score: 0.4,
          sessionsCounted: 30,
          confidence: 0.8,
          reasoning: "12 of 30 sessions clicked .btn-primary",
        },
        {
          variantId: "v1",
          score: 0.2,
          sessionsCounted: 30,
          confidence: 0.8,
          reasoning: "6 of 30 sessions clicked .btn-primary",
        },
      ],
    };
    const client = makeMockClient([
      {
        toolCalls: [
          { id: "c1", name: "submit_scores", argumentsJson: JSON.stringify(happyOutput) },
        ],
      },
    ]);
    const result = await runScorer(baseInput, { client, model: "test-model" });
    expect(result.variants).toHaveLength(2);
    expect(result.variants[0]!.variantId).toBe("v0");
    expect(result.variants[0]!.score).toBe(0.4);
    expect(result.variants[1]!.score).toBe(0.2);
  });

  it("recovers a JSON code block from prose content when the model skips the tool call", async () => {
    const recoveredOutput = {
      variants: [
        {
          variantId: "v0",
          score: 0.5,
          sessionsCounted: 30,
          confidence: 0.6,
          reasoning: "modest signal",
        },
        {
          variantId: "v1",
          score: 0.1,
          sessionsCounted: 30,
          confidence: 0.6,
          reasoning: "weak signal",
        },
      ],
    };
    const client = makeMockClient([
      {
        content:
          "Here are my scores:\n```json\n" +
          JSON.stringify(recoveredOutput) +
          "\n```",
      },
    ]);
    const result = await runScorer(baseInput, { client, model: "test-model" });
    expect(result.variants[0]!.score).toBe(0.5);
    expect(result.variants[1]!.score).toBe(0.1);
  });

  it("retries when a variant is missing from the scorer's output", async () => {
    const partial = {
      variants: [
        {
          variantId: "v0",
          score: 0.3,
          sessionsCounted: 30,
          confidence: 0.7,
          reasoning: "ok",
        },
      ],
    };
    const full = {
      variants: [
        ...partial.variants,
        {
          variantId: "v1",
          score: 0.1,
          sessionsCounted: 30,
          confidence: 0.7,
          reasoning: "ok",
        },
      ],
    };
    const client = makeMockClient([
      {
        toolCalls: [{ id: "c1", name: "submit_scores", argumentsJson: JSON.stringify(partial) }],
      },
      {
        toolCalls: [{ id: "c2", name: "submit_scores", argumentsJson: JSON.stringify(full) }],
      },
    ]);
    const result = await runScorer(baseInput, { client, model: "test-model" });
    expect(result.variants).toHaveLength(2);
  });

  it("throws when input.variants is empty", async () => {
    const client = makeMockClient([]);
    await expect(
      runScorer({ metric: baseInput.metric, variants: [] }, { client, model: "test-model" }),
    ).rejects.toThrow(/variants\[\] required/);
  });

  it("rejects schema-invalid scores (score > 1) and feeds error back to model", async () => {
    const bad = {
      variants: [
        { variantId: "v0", score: 1.5, sessionsCounted: 30, confidence: 0.8, reasoning: "x" },
        { variantId: "v1", score: 0.1, sessionsCounted: 30, confidence: 0.8, reasoning: "y" },
      ],
    };
    const fixed = {
      variants: [
        { variantId: "v0", score: 0.9, sessionsCounted: 30, confidence: 0.8, reasoning: "x" },
        { variantId: "v1", score: 0.1, sessionsCounted: 30, confidence: 0.8, reasoning: "y" },
      ],
    };
    const client = makeMockClient([
      {
        toolCalls: [{ id: "c1", name: "submit_scores", argumentsJson: JSON.stringify(bad) }],
      },
      {
        toolCalls: [{ id: "c2", name: "submit_scores", argumentsJson: JSON.stringify(fixed) }],
      },
    ]);
    const result = await runScorer(baseInput, { client, model: "test-model" });
    expect(result.variants[0]!.score).toBe(0.9);
  });
});
