import type { IncomingMessage, ServerResponse } from "node:http";
import { buildServer } from "../src/server.js";
import { handleMcpRequest } from "../src/transports/http.js";

export const config = {
  maxDuration: 300,
};

// Vercel auto-parses application/json bodies into req.body and consumes the stream,
// so we forward the pre-parsed body to the MCP transport — otherwise it waits forever.
type VercelReq = IncomingMessage & { body?: unknown };

export default async function handler(req: VercelReq, res: ServerResponse): Promise<void> {
  // Streamable HTTP MCP opens long-lived GET SSE channels for server-pushed notifications.
  // On Vercel that just runs until the 300s maxDuration. We don't push notifications, so
  // reject GET and force the client to use POST-only (works in stateless+JSON mode).
  if (req.method === "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST, DELETE");
    res.end();
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
