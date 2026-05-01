import type { IncomingMessage, ServerResponse } from "node:http";
import { buildServer } from "../src/server.js";
import { handleMcpRequest } from "../src/transports/http.js";

export const config = {
  maxDuration: 300,
};

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await handleMcpRequest(req, res, buildServer);
  } catch (err) {
    process.stderr.write(`petri-mcp http error: ${(err as Error).message}\n`);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end();
    }
  }
}
