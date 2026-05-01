import type { IncomingMessage, ServerResponse } from "node:http";
import { buildServer } from "../src/server.js";
import { handleMcpRequest } from "../src/transports/http.js";

export const config = {
  maxDuration: 300,
};

// Vercel auto-parses application/json bodies into req.body and consumes the stream,
// so we forward the pre-parsed body to the MCP transport — otherwise it waits forever.
type VercelReq = IncomingMessage & { body?: unknown };

// MCP Streamable HTTP clients (including the Inspector) require a working GET SSE
// endpoint to consider a session "alive" — even when the server is in
// JSON-response mode and never pushes server-initiated messages. Rejecting GET
// with 405 makes Inspector stall before issuing any tool calls. Holding the GET
// open until Vercel's 300s maxDuration also fails (every request becomes a paid
// timeout). Compromise: respond with a valid empty SSE stream that emits a
// single keepalive comment and closes after 25s, well under Vercel's limit.
const SSE_HOLD_MS = 270_000;

function handleSseGet(res: ServerResponse): Promise<void> {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.write(": petri-mcp open\n\n");

  return new Promise<void>((resolve) => {
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": keepalive\n\n");
    }, 10_000);

    const close = (): void => {
      clearInterval(heartbeat);
      clearTimeout(timer);
      if (!res.writableEnded) res.end();
      resolve();
    };

    const timer = setTimeout(close, SSE_HOLD_MS);
    res.on("close", close);
  });
}

export default async function handler(req: VercelReq, res: ServerResponse): Promise<void> {
  if (req.method === "GET") {
    await handleSseGet(res);
    return;
  }
  try {
    await handleMcpRequest(req, res, buildServer, req.body);
  } catch (err) {
    process.stderr.write(`petri-mcp http error: ${(err as Error).message}\n`);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end();
    }
  }
}
