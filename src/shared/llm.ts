import OpenAI from "openai";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_MODEL = "moonshotai/kimi-k2-0905";

let cached: OpenAI | undefined;

export function getClient(): OpenAI {
  if (cached) return cached;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  cached = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/BecerraIgnacio/petri-MCP",
      "X-Title": "petri-mcp",
    },
  });
  return cached;
}

export function getModel(): string {
  return process.env.PETRI_MODEL ?? DEFAULT_MODEL;
}
