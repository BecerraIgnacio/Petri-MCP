import type OpenAI from "openai";
import { getClient, getModel } from "../../shared/llm.js";
import { VIBE_IDENTIFIER_SYSTEM } from "./prompt.js";
import { explorationTools, submitFindingsTool } from "./tools.js";
import { dispatchFileTool } from "../../shared/file-tools.js";
import { preloadEntryFiles, formatPreloadSection } from "./preload.js";
import {
  VibeIdentifierOutput,
  parseVibeIdentifierInput,
  type VibeIdentifierInput,
  type VibeIdentifierOutput as Output,
} from "./schema.js";

const MAX_STEPS = 10;
const TOOL_RESULT_MAX_CHARS = 16_000;
const DEBUG = process.env.PETRI_DEBUG === "1";

function log(msg: string): void {
  if (DEBUG) process.stderr.write(`[vibe] ${msg}\n`);
}

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall;

function clip(text: string): string {
  if (text.length <= TOOL_RESULT_MAX_CHARS) return text;
  return text.slice(0, TOOL_RESULT_MAX_CHARS) + `\n…[clipped, ${text.length} chars total]`;
}

/**
 * Kimi via OpenRouter sometimes ignores `tool_choice: "required"` and emits prose
 * with a JSON object (often inside a ```json code block) instead of calling
 * submit_findings. If the content contains a valid VibeIdentifierOutput, accept
 * it and treat the run as successful.
 */
function tryExtractFindingsFromContent(content: string | null | undefined): Output | undefined {
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
      const validated = VibeIdentifierOutput.safeParse(parsed);
      if (validated.success) return validated.data;
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

function buildUserMessage(input: VibeIdentifierInput, preloadBlock: string): string {
  const lines: string[] = [];
  if (preloadBlock) {
    lines.push(preloadBlock, "");
  }
  lines.push(`Project: ${input.displayName}`);
  if (input.hints?.brand_name) lines.push(`Hint — brand_name: ${input.hints.brand_name}`);
  if (input.hints?.site_type) lines.push(`Hint — site_type: ${input.hints.site_type}`);
  lines.push(
    "",
    "If PRELOADED FILES above contains everything you need, skip straight to submit_findings. Otherwise glob to discover, read sparingly, grep for tokens, and submit findings.",
  );
  return lines.join("\n");
}

export async function runVibeIdentifier(rawInput: unknown): Promise<Output> {
  const input = parseVibeIdentifierInput(rawInput);
  const source = input.source;
  const client = getClient();
  const model = getModel();

  const preloaded = await preloadEntryFiles(source).catch((err) => {
    log(`preload failed: ${(err as Error).message}`);
    return [];
  });
  log(`preloaded ${preloaded.length} file(s): ${preloaded.map((f) => f.path).join(", ")}`);
  const preloadBlock = formatPreloadSection(preloaded);

  const messages: ChatMessage[] = [
    { role: "system", content: VIBE_IDENTIFIER_SYSTEM },
    { role: "user", content: buildUserMessage(input, preloadBlock) },
  ];

  const tools = [...explorationTools, submitFindingsTool];

  for (let step = 0; step < MAX_STEPS; step++) {
    log(`step ${step}: calling ${model}`);
    const t0 = Date.now();
    const completion = await client.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: "required",
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
      const recovered = tryExtractFindingsFromContent(msg.content);
      if (recovered) {
        log(`step ${step}: recovered findings from prose content`);
        return recovered;
      }
      log(`step ${step}: no tool call AND no recoverable JSON — nudging`);
      messages.push({
        role: "user",
        content:
          "Output ONLY tool calls. Do not write prose or JSON in content. Call submit_findings now with your findings as the tool arguments.",
      });
      continue;
    }

    for (const call of calls) {
      if (call.type !== "function") continue;
      const fn = call.function;
      log(`  → ${fn.name}(${fn.arguments.slice(0, 120)})`);
      if (fn.name === "submit_findings") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(fn.arguments);
        } catch (err) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({
              error: `invalid JSON in submit_findings arguments: ${(err as Error).message}`,
            }),
          });
          continue;
        }
        const validated = VibeIdentifierOutput.safeParse(parsed);
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
        return validated.data;
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
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: clip(dispatched.result),
      });
    }
  }

  throw new Error(`vibe-identifier exhausted ${MAX_STEPS} steps without submitting findings`);
}
