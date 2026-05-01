import type { OpenAI } from "openai";
import { fileExplorationToolDescriptors } from "../../shared/file-tools.js";

export const explorationTools: OpenAI.Chat.Completions.ChatCompletionTool[] =
  fileExplorationToolDescriptors;

export const submitFindingsTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "submit_findings",
    description:
      "Terminate the agent loop by submitting the final findings. Call exactly once when you have collected enough evidence to lock the brand. Pass either an 'ok' payload with all required fields, or an 'out_of_scope' payload with a reason.",
    parameters: {
      type: "object",
      description: "The full Vibe Identifier output, matching the schema exactly.",
    },
  },
};
