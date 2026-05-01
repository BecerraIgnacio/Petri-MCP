import http from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

/**
 * Stateless HTTP transport. Each incoming request gets a fresh McpServer + transport pair —
 * no session state crosses requests. Matches the canonical pattern for serverless hosts
 * (Vercel Node Functions, Cloudflare, etc.) where every invocation is request-scoped.
 */
export async function startHttpTransport(
  buildServer: () => McpServer,
  port: number,
): Promise<void> {
  const httpServer = http.createServer((req, res) => {
    handle(req, res, buildServer).catch((err) => {
      process.stderr.write(`petri-mcp http error: ${(err as Error).message}\n`);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end();
      }
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, () => resolve());
  });

  process.stderr.write(`petri-mcp listening on http://localhost:${port}\n`);
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  buildServer: () => McpServer,
): Promise<void> {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res);
}
