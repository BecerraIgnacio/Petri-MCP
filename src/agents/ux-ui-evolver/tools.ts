import type { OpenAI } from "openai";
import { fileExplorationToolDescriptors } from "../../shared/file-tools.js";
import { tupleFor, type LockTuple } from "./validator.js";
import { z } from "zod";
import { VibeIdentifierOk } from "../vibe-identifier/schema.js";
import { Mutation } from "./schema.js";

type LockManifest = z.infer<typeof VibeIdentifierOk>;

export const explorationTools: OpenAI.Chat.Completions.ChatCompletionTool[] =
  fileExplorationToolDescriptors;

export const lockCheckTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "lock_check",
    description:
      "Check whether a candidate mutation would overlap any locked tuple. Use BEFORE adding a mutation to a variant. Returns { overlaps: [...] } — empty array means safe to include.",
    parameters: {
      type: "object",
      description: "A single mutation object matching one of the Mutation kinds.",
    },
  },
};

export const submitVariantsTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "submit_variants",
    description:
      "Terminate the agent loop by submitting the final list of variants. Each variant has an id (v1, v2, …), a hypothesis sentence, and ≥1 mutations. The full output ({ status, variants[] } or { status: 'out_of_scope', reason }) is validated and lock-checked.",
    parameters: {
      type: "object",
      description: "The full Evolver output, matching the schema exactly.",
    },
  },
};

export function runLockCheck(
  manifest: LockManifest,
  rawArgs: string,
): string {
  let args: unknown;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch (err) {
    return JSON.stringify({ error: `invalid JSON arguments: ${(err as Error).message}` });
  }
  const parsed = Mutation.safeParse(args);
  if (!parsed.success) {
    return JSON.stringify({
      error: "argument is not a valid Mutation",
      issues: parsed.error.issues.slice(0, 5),
    });
  }
  const t = tupleFor(parsed.data);
  if (!t) {
    return JSON.stringify({ overlaps: [], note: "this mutation kind has no locking semantics in v1" });
  }
  const overlaps = manifest.locked_selectors.filter((lock) =>
    (lock.scope === "*" || lock.scope === t.scope) &&
    lock.selector === t.selector &&
    lock.property === t.property,
  );
  return JSON.stringify({ overlaps, derived_tuple: t });
}
