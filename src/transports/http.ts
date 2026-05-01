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
    handleMcpRequest(req, res, buildServer).catch((err) => {
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

/**
 * Handle a single MCP HTTP request. Exported so serverless hosts (Vercel Node Functions, etc.)
 * can call this directly without spinning up a long-lived http.Server.
 *
 * `parsedBody` is for hosts that consume the request stream before invoking the handler
 * (Vercel auto-parses application/json into req.body). Pass it through so the transport
 * doesn't hang waiting for bytes that already left.
 */
export async function handleMcpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  buildServer: () => McpServer,
  parsedBody?: unknown,
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
  await transport.handleRequest(req, res, parsedBody);
}
