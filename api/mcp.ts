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
