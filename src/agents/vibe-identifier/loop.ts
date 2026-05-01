import type OpenAI from "openai";
import { getClient, getModel } from "../../shared/llm.js";
import { VIBE_IDENTIFIER_SYSTEM } from "./prompt.js";
import { explorationTools, submitFindingsTool } from "./tools.js";
import { dispatchFileTool } from "../../shared/file-tools.js";
import {
  VibeIdentifierOutput,
  parseVibeIdentifierInput,
  type VibeIdentifierInput,
  type VibeIdentifierOutput as Output,
} from "./schema.js";

const MAX_STEPS = 15;
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

function buildUserMessage(input: VibeIdentifierInput): string {
  const lines = [
    `Project: ${input.displayName}`,
  ];
  if (input.hints?.brand_name) lines.push(`Hint — brand_name: ${input.hints.brand_name}`);
  if (input.hints?.site_type) lines.push(`Hint — site_type: ${input.hints.site_type}`);
  lines.push(
    "",
    "Begin by globbing the project. Then read the highest-signal files. Use grep to locate colors, headlines, and logo elements. Submit findings via the submit_findings tool when you have enough evidence.",
  );
  return lines.join("\n");
}

export async function runVibeIdentifier(rawInput: unknown): Promise<Output> {
  const input = parseVibeIdentifierInput(rawInput);
  const source = input.source;
  const client = getClient();
  const model = getModel();

  const messages: ChatMessage[] = [
    { role: "system", content: VIBE_IDENTIFIER_SYSTEM },
    { role: "user", content: buildUserMessage(input) },
  ];

  const tools = [...explorationTools, submitFindingsTool];

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
