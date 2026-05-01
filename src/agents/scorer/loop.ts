import type OpenAI from "openai";
import { getClient, getModel } from "../../shared/llm.js";
import { SCORER_SYSTEM } from "./prompt.js";
import { submitScoresTool } from "./tools.js";
import { ScorerOutput, type ScorerInput } from "./schema.js";

const MAX_STEPS = 4;
const PER_VARIANT_EVENT_CAP = 200;
const TOTAL_EVENT_CAP = 1000;
const DEBUG = process.env.PETRI_DEBUG === "1";

function log(msg: string): void {
  if (DEBUG) process.stderr.write(`[scorer] ${msg}\n`);
}

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface ScorerDeps {
  client?: OpenAI;
  model?: string;
}

function tryExtractScoresFromContent(
  content: string | null | undefined,
): ScorerOutput | undefined {
  if (!content) return undefined;
  const candidates: string[] = [];
  const codeBlock = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock?.[1]) candidates.push(codeBlock[1].trim());
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(content.slice(firstBrace, lastBrace + 1));
  }
  for (const raw of candidates) {
    try {
      const parsed = JSON.parse(raw);
      const validated = ScorerOutput.safeParse(parsed);
      if (validated.success) return validated.data;
    } catch {
      // try next
    }
  }
  return undefined;
}

function buildUserMessage(input: ScorerInput): string {
  const totalIncoming = input.variants.reduce((sum, v) => sum + v.recent.length, 0);
  const perVariantCap = totalIncoming > TOTAL_EVENT_CAP
    ? Math.max(20, Math.floor(TOTAL_EVENT_CAP / input.variants.length))
    : PER_VARIANT_EVENT_CAP;

  const lines: string[] = [];
  lines.push(`Target metric: ${input.metric.name}`);
  lines.push(`Direction: ${input.metric.direction}`);
  lines.push(`Description: ${input.metric.description}`);
  lines.push("");
  lines.push("Variants and their recent events follow. Score each variant in [0,1] against the metric and call submit_scores.");
  lines.push("");

  for (const v of input.variants) {
    const sample = v.recent.slice(0, perVariantCap);
    lines.push(`### Variant ${v.variantId}`);
    lines.push(`totalEvents: ${v.totalEvents}, uniqueSessions: ${v.uniqueSessions}`);
    const counts = Object.entries(v.eventCounts)
      .map(([n, c]) => `${n}=${c}`)
      .join(", ");
    lines.push(`eventCounts: ${counts || "(none)"}`);
    lines.push(`recent (${sample.length} of ${v.recent.length}):`);
    lines.push("```json");
    lines.push(JSON.stringify(sample, null, 0));
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

export async function runScorer(
  input: ScorerInput,
  deps: ScorerDeps = {},
): Promise<ScorerOutput> {
  if (!input.variants || input.variants.length === 0) {
    throw new Error("runScorer: variants[] required and non-empty");
  }
  const client = deps.client ?? getClient();
  const model = deps.model ?? input.model ?? getModel();

  const messages: ChatMessage[] = [
    { role: "system", content: SCORER_SYSTEM },
    { role: "user", content: buildUserMessage(input) },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    log(`step ${step}: calling ${model}`);
    const t0 = Date.now();
    const completion = await client.chat.completions.create({
      model,
      messages,
      tools: [submitScoresTool],
      tool_choice: "required",
      temperature: 0.1,
    });
    log(`step ${step}: model returned in ${Date.now() - t0}ms`);

    const choice = completion.choices[0];
    if (!choice) throw new Error("scorer: no choices returned from model");
    const msg = choice.message;
    messages.push(msg as ChatMessage);

    const calls = msg.tool_calls ?? [];
    log(`step ${step}: ${calls.length} tool call(s)`);
    if (calls.length === 0) {
      const recovered = tryExtractScoresFromContent(msg.content);
      if (recovered) {
        log(`step ${step}: recovered scores from prose content`);
        return recovered;
      }
      messages.push({
        role: "user",
        content:
          "Output ONLY a tool call. Call submit_scores now with the variants array as the tool arguments.",
      });
      continue;
    }

    for (const call of calls) {
      if (call.type !== "function" || call.function.name !== "submit_scores") {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ error: `unknown tool: ${call.type === "function" ? call.function.name : call.type}` }),
        });
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(call.function.arguments);
      } catch (err) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            error: `invalid JSON in submit_scores arguments: ${(err as Error).message}`,
          }),
        });
        continue;
      }
      const validated = ScorerOutput.safeParse(parsed);
      if (!validated.success) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            error: "schema validation failed",
            issues: validated.error.issues.slice(0, 10),
          }),
        });
        continue;
      }
      const expectedIds = new Set(input.variants.map((v) => v.variantId));
      const gotIds = new Set(validated.data.variants.map((v) => v.variantId));
      const missing = [...expectedIds].filter((id) => !gotIds.has(id));
      if (missing.length > 0) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            error: `missing scores for variants: ${missing.join(", ")}`,
          }),
        });
        continue;
      }
      return validated.data;
    }
  }

  throw new Error(`scorer exhausted ${MAX_STEPS} steps without submitting scores`);
}
