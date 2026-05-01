import type { OpenAI } from "openai";
import type { FileSource } from "./file-source.js";

export const fileExplorationToolDescriptors: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read a single text file from the project, relative to the project root. Returns the file contents (truncated if larger than 200KB).",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path relative to project root, e.g. 'index.html' or 'src/app.tsx'.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "glob",
      description:
        "List text files in the project matching a glob pattern. Use to discover files before reading. node_modules / .git / dist / build are excluded automatically.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Glob pattern, e.g. '**/*.css' or 'src/**/*.tsx'.",
          },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description:
        "Search for a regex across text files. Returns up to 100 hits as { file, line, match }. Use to locate selectors, tokens, or content.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "JavaScript regex source, e.g. '#[0-9a-f]{6}'." },
          pathGlob: {
            type: "string",
            description: "Optional glob to scope the search, e.g. '**/*.css'. Defaults to all text files.",
          },
          flags: { type: "string", description: "Regex flags, default 'i'." },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
    },
  },
];

/**
 * Dispatch a file-exploration tool call against a FileSource. Returns a string suitable
 * to send back as the tool result. Throws only on programmer errors; tool-level errors
 * are returned as JSON `{ error }` strings.
 */
export async function dispatchFileTool(
  source: FileSource,
  name: string,
  rawArgs: string,
): Promise<{ handled: true; result: string } | { handled: false }> {
  if (name !== "read_file" && name !== "glob" && name !== "grep") {
    return { handled: false };
  }
  let args: unknown;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch (err) {
    return { handled: true, result: JSON.stringify({ error: `invalid JSON arguments: ${(err as Error).message}` }) };
  }
  try {
    if (name === "read_file") {
      const content = await source.readFile(args as { path: string });
      return { handled: true, result: content };
    }
    if (name === "glob") {
      const files = await source.glob(args as { pattern: string });
      return { handled: true, result: JSON.stringify({ files }) };
    }
    const hits = await source.grep(args as { pattern: string; pathGlob?: string; flags?: string });
    return { handled: true, result: JSON.stringify({ hits }) };
  } catch (err) {
    return { handled: true, result: JSON.stringify({ error: (err as Error).message }) };
  }
}
