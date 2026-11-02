import http from "node:http";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ticketInputSchema, type TicketInput } from "./schemas/ticketSchema.js";
import { ClassifierService } from "./services/classifierService.js";
import { HybridSearchService } from "./services/hybridSearchService.js";
import { CopilotService } from "./services/copilotService.js";
import { loadConfig } from "./config.js";
import { FICTIONAL_RUNBOOKS } from "./data/knowledgeBase.js";
import { chunkDocument } from "./services/chunkingService.js";
import { BM25SearchService } from "./services/bm25SearchService.js";
import { VectorSearchService } from "./services/vectorSearchService.js";
import {
  GeminiClient,
  MockGeminiClient,
  type IGeminiClient,
} from "./clients/geminiClient.js";
import {
  GeminiEmbeddingClient,
  MockEmbeddingClient,
  type IEmbeddingClient,
} from "./clients/embeddingClient.js";

const MAX_PAYLOAD_BYTES = 1024 * 1024; // 1MB payload ceiling

export interface ServerDependencies {
  classifierService: ClassifierService;
  hybridSearchService: HybridSearchService;
  copilotService: CopilotService;
  docCount?: number;
  chunkCount?: number;
}

export const ApiSearchRequestSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, "query must not be empty")
    .max(1000, "query must not exceed 1000 characters"),
  topK: z.number().int().positive().max(50).default(3).optional(),
  filterCategory: z.string().optional(),
});

export const ApiResolveRequestSchema = z
  .union([
    z.object({
      ticket: ticketInputSchema,
      topK: z.number().int().positive().max(50).default(3).optional(),
    }),
    ticketInputSchema.and(
      z.object({
        topK: z.number().int().positive().max(50).default(3).optional(),
      })
    ),
  ])
  .transform((val) => {
    if ("ticket" in val) {
      return { ticket: val.ticket, topK: val.topK ?? 3 };
    }
    const { topK, ...ticket } = val;
    return { ticket: ticket as TicketInput, topK: topK ?? 3 };
  });

/**
 * Sends a structured JSON HTTP response with security and CORS headers.
 */
function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  body: unknown,
  extraHeaders: Record<string, string> = {}
): void {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  res.end(json);
}

/**
 * Reads and buffers an incoming HTTP request stream up to MAX_PAYLOAD_BYTES.
 */
function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    let byteCount = 0;

    req.on("data", (chunk: Buffer) => {
      byteCount += chunk.length;
      if (byteCount > MAX_PAYLOAD_BYTES) {
        req.destroy();
        const err = new Error("Payload Too Large: exceeds 1MB limit");
        (err as unknown as { statusCode: number }).statusCode = 413;
        return reject(err);
      }
      raw += chunk.toString("utf-8");
    });

    req.on("end", () => {
      if (!raw.trim()) {
        return resolve({});
      }
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed);
      } catch {
        const err = new Error("Invalid JSON: request body must be valid JSON");
        (err as unknown as { statusCode: number }).statusCode = 400;
        reject(err);
      }
    });

    req.on("error", (err) => reject(err));
  });
}

/**
 * Creates the core HTTP request handler function.
 * Enables in-memory dispatch testing without requiring TCP loopback sockets.
 */
export function createRequestHandler(
  deps: ServerDependencies
): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  return async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    // 1. CORS Preflight
    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      });
      res.end();
      return;
    }

    // 2. Health & Readiness Probe
    if (pathname === "/health") {
      if (method !== "GET") {
        return sendJson(
          res,
          405,
          { error: "Method Not Allowed. Use GET." },
          { Allow: "GET" }
        );
      }
      return sendJson(res, 200, {
        status: "ok",
        timestamp: new Date().toISOString(),
        version: "0.1.0",
        knowledgeBaseDocs: deps.docCount ?? 0,
        chunksIndexed: deps.chunkCount ?? 0,
      });
    }

    // 3. Triage & Classification Endpoint
    if (pathname === "/api/classify") {
      if (method !== "POST") {
        return sendJson(
          res,
          405,
          { error: "Method Not Allowed. Use POST." },
          { Allow: "POST" }
        );
      }

      try {
        const body = await readJsonBody(req);
        const parseResult = ticketInputSchema.safeParse(body);
        if (!parseResult.success) {
          return sendJson(res, 400, {
            error: "Validation failed: invalid ticket schema",
            issues: parseResult.error.issues,
          });
        }

        const classification = await deps.classifierService.classifyTicket(
          parseResult.data
        );
        return sendJson(res, 200, classification);
      } catch (err: unknown) {
        const error = err as { statusCode?: number; message?: string };
        const statusCode = error.statusCode ?? 500;
        return sendJson(res, statusCode, {
          error: error.message ?? "Internal server error during classification",
        });
      }
    }

    // 4. Hybrid Knowledge Retrieval Endpoint
    if (pathname === "/api/search") {
      if (method !== "POST") {
        return sendJson(
          res,
          405,
          { error: "Method Not Allowed. Use POST." },
          { Allow: "POST" }
        );
      }

      try {
        const body = await readJsonBody(req);
        const parseResult = ApiSearchRequestSchema.safeParse(body);
        if (!parseResult.success) {
          return sendJson(res, 400, {
            error: "Validation failed: invalid search query parameters",
            issues: parseResult.error.issues,
          });
        }

        const { query, topK, filterCategory } = parseResult.data;
        const results = await deps.hybridSearchService.search(query, {
          topK: topK ?? 3,
          filterCategory,
        });

        return sendJson(res, 200, {
          query,
          count: results.length,
          results,
        });
      } catch (err: unknown) {
        const error = err as { statusCode?: number; message?: string };
        const statusCode = error.statusCode ?? 500;
        return sendJson(res, statusCode, {
          error: error.message ?? "Internal server error during search",
        });
      }
    }

    // 5. End-to-End Grounded Copilot Resolution Endpoint
    if (pathname === "/api/resolve") {
      if (method !== "POST") {
        return sendJson(
          res,
          405,
          { error: "Method Not Allowed. Use POST." },
          { Allow: "POST" }
        );
      }

      try {
        const body = await readJsonBody(req);
        const parseResult = ApiResolveRequestSchema.safeParse(body);
        if (!parseResult.success) {
          return sendJson(res, 400, {
            error: "Validation failed: invalid ticket resolution request",
            issues: parseResult.error.issues,
          });
        }

        const { ticket, topK } = parseResult.data;
        const resolution = await deps.copilotService.resolveTicket(ticket, { topK });

        return sendJson(res, 200, resolution);
      } catch (err: unknown) {
        const error = err as { statusCode?: number; message?: string };
        const statusCode = error.statusCode ?? 500;
        return sendJson(res, statusCode, {
          error: error.message ?? "Internal server error during resolution",
        });
      }
    }

    // 6. Streaming Copilot Resolution Endpoint (Server-Sent Events)
    if (pathname === "/api/resolve/stream") {
      if (method !== "POST") {
        return sendJson(
          res,
          405,
          { error: "Method Not Allowed. Use POST." },
          { Allow: "POST" }
        );
      }

      try {
        const body = await readJsonBody(req);
        const parseResult = ApiResolveRequestSchema.safeParse(body);
        if (!parseResult.success) {
          return sendJson(res, 400, {
            error: "Validation failed: invalid ticket resolution request",
            issues: parseResult.error.issues,
          });
        }

        const { ticket, topK } = parseResult.data;

        // Establish SSE Connection Headers
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
          "Access-Control-Allow-Origin": "*",
        });

        let clientDisconnected = false;
        req.on("close", () => {
          clientDisconnected = true;
        });

        for await (const event of deps.copilotService.resolveTicketStream(ticket, { topK })) {
          if (clientDisconnected) break;
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
        }

        if (!clientDisconnected) {
          res.end();
        }
        return;
      } catch (err: unknown) {
        const error = err as { statusCode?: number; message?: string };
        const statusCode = error.statusCode ?? 500;
        return sendJson(res, statusCode, {
          error: error.message ?? "Internal server error during streaming resolution",
        });
      }
    }

    // 7. Known Route Method Check / Fallback
    const knownEndpoints = [
      "/health",
      "/api/classify",
      "/api/search",
      "/api/resolve",
      "/api/resolve/stream",
    ];
    if (knownEndpoints.includes(pathname)) {
      return sendJson(
        res,
        405,
        { error: `Method Not Allowed on ${pathname}` },
        { Allow: "GET, POST" }
      );
    }

    // 8. Route Not Found (404)
    return sendJson(res, 404, {
      error: `Route not found: ${method} ${pathname}`,
    });
  };
}

/**
 * Creates and configures the native Node.js HTTP server.
 * Decoupled from port listening to allow isolated integration tests and flexible deployments.
 */
export function createAppServer(deps: ServerDependencies): http.Server {
  return http.createServer(createRequestHandler(deps));
}

/**
 * Initializes all required knowledge base chunks, embedding indices, and
 * service dependencies for the default server environment.
 */
export async function initializeDefaultServer(): Promise<{
  server: http.Server;
  deps: ServerDependencies;
}> {
  const config = loadConfig();
  let llmClient: IGeminiClient;
  let embeddingClient: IEmbeddingClient;

  if (config.GEMINI_API_KEY) {
    llmClient = new GeminiClient(config.GEMINI_API_KEY, config.GEMINI_MODEL);
    embeddingClient = new GeminiEmbeddingClient(config.GEMINI_API_KEY);
  } else {
    llmClient = new MockGeminiClient();
    embeddingClient = new MockEmbeddingClient(16);
  }

  // 1. Ingest & chunk runbooks
  const allChunks = FICTIONAL_RUNBOOKS.flatMap((doc) =>
    chunkDocument(doc, { maxChunkSize: 350, overlap: 60 })
  );

  // 2. Build retrieval engines with graceful offline fallback
  const bm25Service = new BM25SearchService(allChunks);
  let vectorService = new VectorSearchService(embeddingClient);

  try {
    await vectorService.indexChunks(allChunks);
  } catch {
    console.log("[Server] Live embedding unreachable; falling back to mock embeddings.");
    llmClient = new MockGeminiClient();
    embeddingClient = new MockEmbeddingClient(16);
    vectorService = new VectorSearchService(embeddingClient);
    await vectorService.indexChunks(allChunks);
  }

  const hybridSearchService = new HybridSearchService(bm25Service, vectorService);
  const classifierService = new ClassifierService({ client: llmClient });
  const copilotService = new CopilotService({
    classifierService,
    hybridSearchService,
    client: llmClient,
  });

  const deps: ServerDependencies = {
    classifierService,
    hybridSearchService,
    copilotService,
    docCount: FICTIONAL_RUNBOOKS.length,
    chunkCount: allChunks.length,
  };

  const server = createAppServer(deps);
  return { server, deps };
}

// Direct Execution Entry Point (e.g. `npm run serve`)
const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  const config = loadConfig();
  const port = config.PORT;

  initializeDefaultServer()
    .then(({ server, deps }) => {
      server.listen(port, () => {
        console.log("==================================================");
        console.log(`  🚀 AI IT Support Copilot REST API Online`);
        console.log(`  🌐 Listening on: http://localhost:${port}`);
        console.log(`  📚 Runbooks:     ${deps.docCount} docs (${deps.chunkCount} chunks)`);
        console.log("==================================================");
        console.log("Available Endpoints:");
        console.log(`  GET  /health`);
        console.log(`  POST /api/classify`);
        console.log(`  POST /api/search`);
        console.log(`  POST /api/resolve`);
        console.log(`  POST /api/resolve/stream`);
        console.log("==================================================");
      });

      const shutdown = () => {
        console.log("\n[Server] Shutting down gracefully...");
        server.close(() => {
          console.log("[Server] Server closed. Exiting process.");
          process.exit(0);
        });
      };

      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);
    })
    .catch((err) => {
      console.error("[Server] Fatal startup failure:", err);
      process.exit(1);
    });
}
