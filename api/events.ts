import { recordEvent } from "../src/shared/events.js";

export const config = {
  runtime: "edge",
};

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response("method not allowed", {
      status: 405,
      headers: { "content-type": "text/plain", ...CORS_HEADERS },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ status: "error", error: "invalid JSON body" }, 400);
  }

  try {
    const result = await recordEvent(body);
    return jsonResponse(result, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /unknown run_id|not in run/.test(msg) ? 404 : 400;
    return jsonResponse({ status: "error", error: msg }, status);
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}
