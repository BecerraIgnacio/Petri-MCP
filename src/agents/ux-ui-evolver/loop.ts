import type OpenAI from "openai";
import { getClient, getModel } from "../../shared/llm.js";
import { UX_UI_EVOLVER_SYSTEM } from "./prompt.js";
import {
  explorationTools,
  lockCheckTool,
  submitVariantsTool,
  runLockCheck,
} from "./tools.js";
import { dispatchFileTool } from "../../shared/file-tools.js";
import {
  EvolverOutput,
  parseEvolverInput,
  resolveEvolverMetric,
  type EvolverInput as Input,
  type EvolverOutput as Output,
} from "./schema.js";
import type { TargetMetric } from "../../shared/run-meta.js";

type ResolvedMetric = ReturnType<typeof resolveEvolverMetric>;
import { findOverlaps } from "./validator.js";

const MAX_STEPS = 25;
const TOOL_RESULT_MAX_CHARS = 16_000;
const DEBUG = process.env.PETRI_DEBUG === "1";

function log(msg: string): void {
  if (DEBUG) process.stderr.write(`[evolver] ${msg}\n`);
}

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall;

function clip(text: string): string {
  if (text.length <= TOOL_RESULT_MAX_CHARS) return text;
  return text.slice(0, TOOL_RESULT_MAX_CHARS) + `\n…[clipped, ${text.length} chars total]`;
}

function summarizePreviousMutations(prev: Input["previousMutations"]): string[] {
  if (!prev || prev.length === 0) return [];
  // Group by kind+selector(+property) so "css_property padding × 4 gens on .btn-primary"
  // collapses to one bullet — the evolver cares about axes, not raw counts.
  const seen = new Map<string, { kind: string; target: string; gens: number[] }>();
  for (const m of prev) {
    const target = [m.selector, m.property, m.file].filter((x) => Boolean(x)).join(" · ");
    const key = `${m.kind}::${target}`;
    const entry = seen.get(key) ?? { kind: m.kind, target, gens: [] };
    entry.gens.push(m.generation);
    seen.set(key, entry);
  }
  const bullets = [...seen.values()].map((e) => {
    const gens = e.gens.sort((a, b) => a - b).join(",");
    const tail = e.target ? ` on ${e.target}` : "";
    return `- ${e.kind}${tail} (gen ${gens})`;
  });
  return [
    "",
    "The current champion lineage already explored these axes:",
    ...bullets,
    "",
    "**For maximum exploration this generation, prefer at least one variant that mutates a DIFFERENT kind/selector** than the bullets above. Re-doing the same axis is the lowest-information move; petri's value comes from breadth. Suggested directions still on the table for most sites: `text_content` on the headline / subhead, `attribute` changes (hrefs, alt, data-*), `add_node` for social proof / urgency / above-fold testimonial, `remove_node` for any visible distraction near the CTA, layout-impacting `css_property` (grid, flex, gap, max-width). Use these as inspiration — your hypothesis is still the boss.",
  ];
}

function buildUserMessage(input: Input, metric: ResolvedMetric): string {
  const fallbackNote =
    !input.targetMetric && input.lockManifest.inferred_metric
      ? " (inferred from the lock manifest — no explicit metric was provided by the caller)"
      : "";
  const lines = [
    `Project: ${input.displayName}`,
    `Variants requested: ${input.nVariants}`,
    "",
    `Target metric: ${metric.name}${fallbackNote}`,
    `Direction: ${metric.direction}`,
    `Description: ${metric.description}`,
    "",
    "Lock manifest (the brand-defining elements you must not mutate):",
    "```json",
    JSON.stringify(input.lockManifest, null, 2),
    "```",
    ...summarizePreviousMutations(input.previousMutations),
    "",
    `Produce ${input.nVariants} distinct variants. Each variant: one hypothesis, 1–3 small mutations. Use lock_check on every candidate mutation before including it. Submit via submit_variants.`,
  ];
  return lines.join("\n");
}

export async function runUxUiEvolver(rawInput: unknown): Promise<Output> {
  const input = parseEvolverInput(rawInput);
  const source = input.source;
  const client = getClient();
  const model = getModel();

  const metric: TargetMetric = resolveEvolverMetric(input);
  const messages: ChatMessage[] = [
    { role: "system", content: UX_UI_EVOLVER_SYSTEM },
    { role: "user", content: buildUserMessage(input, metric) },
  ];

  const tools = [...explorationTools, lockCheckTool, submitVariantsTool];

  for (let step = 0; step < MAX_STEPS; step++) {
    log(`step ${step}: calling ${model}`);
    const t0 = Date.now();
    const completion = await client.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.2,
    });
    log(`step ${step}: model returned in ${Date.now() - t0}ms`);

    const choice = completion.choices[0];
    if (!choice) throw new Error("no choices returned from model");
    const msg = choice.message;
    messages.push(msg as ChatMessage);

    const calls: ToolCall[] = msg.tool_calls ?? [];
    log(`step ${step}: ${calls.length} tool call(s) | content: ${msg.content?.slice(0, 100) ?? "<none>"}`);
    if (calls.length === 0) {
      throw new Error(
        `model returned no tool call at step ${step}; content: ${msg.content?.slice(0, 200) ?? "<empty>"}`,
      );
    }

    for (const call of calls) {
      if (call.type !== "function") continue;
      const fn = call.function;
      log(`  → ${fn.name}(${fn.arguments.slice(0, 120)})`);

      if (fn.name === "submit_variants") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(fn.arguments);
        } catch (err) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({
              error: `invalid JSON in submit_variants arguments: ${(err as Error).message}`,
            }),
          });
          continue;
        }
        const validated = EvolverOutput.safeParse(parsed);
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
        const result = validated.data;
        if (result.status === "ok") {
          if (result.variants.length !== input.nVariants) {
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify({
                error: `expected exactly ${input.nVariants} variants, got ${result.variants.length}`,
              }),
            });
            continue;
          }
          const overlaps = findOverlaps(result.variants, input.lockManifest);
          if (overlaps.length > 0) {
            log(`  ✗ ${overlaps.length} lock overlap(s) — feeding back`);
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify({
                error: "lock_overlap: one or more mutations touch a locked tuple",
                overlaps: overlaps.slice(0, 10).map((o) => ({
                  variantId: o.variantId,
                  mutationIndex: o.mutationIndex,
                  mutation: o.mutation,
                  conflicting_lock: o.lockEntry,
                })),
              }),
            });
            continue;
          }
          const ids = new Set(result.variants.map((v) => v.id));
          if (ids.size !== result.variants.length) {
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify({ error: "duplicate variant ids" }),
            });
            continue;
          }
        }
        return result;
      }

      if (fn.name === "lock_check") {
        const out = runLockCheck(input.lockManifest, fn.arguments);
        messages.push({ role: "tool", tool_call_id: call.id, content: out });
        continue;
      }

      const dispatched = await dispatchFileTool(source, fn.name, fn.arguments);
      if (!dispatched.handled) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ error: `unknown tool: ${fn.name}` }),
        });
        continue;
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: clip(dispatched.result) });
    }
  }

  throw new Error(`ux-ui-evolver exhausted ${MAX_STEPS} steps without submitting variants`);
}
