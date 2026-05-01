import type { OpenAI } from "openai";

export const submitScoresTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "submit_scores",
    description:
      "Terminate the loop by submitting per-variant scores. Each variant must have a score in [0,1], confidence in [0,1], and a one-sentence reasoning grounded in the recent events.",
    parameters: {
      type: "object",
      description: "The full Scorer output { variants: [...] }, matching the schema exactly.",
    },
  },
};
