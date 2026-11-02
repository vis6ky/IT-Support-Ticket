import { describe, it, expect, beforeAll } from "vitest";
import http from "node:http";
import { Readable, Writable } from "node:stream";
import {
  createRequestHandler,
  createAppServer,
  type ServerDependencies,
} from "../src/server.js";
import { ClassifierService } from "../src/services/classifierService.js";
import { HybridSearchService } from "../src/services/hybridSearchService.js";
import { CopilotService } from "../src/services/copilotService.js";
import { BM25SearchService } from "../src/services/bm25SearchService.js";
import { VectorSearchService } from "../src/services/vectorSearchService.js";
import { MockEmbeddingClient } from "../src/clients/embeddingClient.js";
import { MockGeminiClient, type IGeminiClient } from "../src/clients/geminiClient.js";
import { FICTIONAL_RUNBOOKS } from "../src/data/knowledgeBase.js";
import { chunkDocument } from "../src/services/chunkingService.js";

interface TestResponse {
  status: number;
  headers: Record<string, string>;
  text: () => Promise<string>;
  json: () => Promise<any>;
}

/**
 * Lightweight in-memory HTTP dispatcher for deterministic, sandbox-safe testing.
 * Exercises real Node.js stream chunking, headers, and HTTP contracts without TCP loopback overhead.
 */
function dispatch(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>,
  options: {
    method?: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
  }
): Promise<TestResponse> {
  const method = (options.method ?? "GET").toUpperCase();
  const url = options.url;
  const headers = Object.fromEntries(
    Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])
  );

  const req = new Readable({
    read() {
      if (options.body) {
        this.push(Buffer.from(options.body, "utf-8"));
      }
      this.push(null);
    },
  }) as unknown as http.IncomingMessage;

  req.method = method;
  req.url = url;
  req.headers = headers;
  req.destroy = () => req;

  let statusCode = 200;
  const resHeaders: Record<string, string> = {};
  let bodyBuffer = "";

  return new Promise((resolve) => {
    const res = new Writable({
      write(chunk, _encoding, callback) {
        bodyBuffer += chunk.toString();
        callback();
      },
    }) as unknown as http.ServerResponse;

    res.writeHead = (code: number, headers?: any) => {
      statusCode = code;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          resHeaders[k.toLowerCase()] = String(v);
        }
      }
      return res;
    };

    res.setHeader = (k: string, v: any) => {
      resHeaders[k.toLowerCase()] = String(v);
      return res;
    };

    res.getHeader = (k: string) => resHeaders[k.toLowerCase()];

    res.end = (chunk?: any) => {
      if (chunk) {
        bodyBuffer += chunk.toString();
      }
      resolve({
        status: statusCode,
        headers: resHeaders,
        text: async () => bodyBuffer,
        json: async () => (bodyBuffer ? JSON.parse(bodyBuffer) : {}),
      });
      return res;
    };

    handler(req, res).catch((err) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    });
  });
}

describe("Native REST API Server (Integration Suite)", () => {
  let handler: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;
  let defaultDeps: ServerDependencies;

  beforeAll(async () => {
    // 1. Prepare deterministic mock dependencies
    const allChunks = FICTIONAL_RUNBOOKS.flatMap((doc) =>
      chunkDocument(doc, { maxChunkSize: 350, overlap: 60 })
    );

    const bm25Service = new BM25SearchService(allChunks);
    const mockEmbeddingClient = new MockEmbeddingClient(16);
    const vectorService = new VectorSearchService(mockEmbeddingClient);
    await vectorService.indexChunks(allChunks);

    const hybridSearchService = new HybridSearchService(bm25Service, vectorService);
    const mockLlmClient = new MockGeminiClient();
    const classifierService = new ClassifierService({ client: mockLlmClient });
    const copilotService = new CopilotService({
      classifierService,
      hybridSearchService,
      client: mockLlmClient,
    });

    defaultDeps = {
      classifierService,
      hybridSearchService,
      copilotService,
      docCount: FICTIONAL_RUNBOOKS.length,
      chunkCount: allChunks.length,
    };

    handler = createRequestHandler(defaultDeps);
  });

  describe("Server Factory", () => {
    it("should instantiate an http.Server instance from createAppServer", () => {
      const server = createAppServer(defaultDeps);
      expect(server).toBeInstanceOf(http.Server);
    });
  });

  describe("CORS Preflight", () => {
    it("should respond to OPTIONS request with 204 No Content and CORS headers", async () => {
      const res = await dispatch(handler, {
        method: "OPTIONS",
        url: "/api/resolve",
      });

      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe("*");
      expect(res.headers["access-control-allow-methods"]).toContain("POST");
    });
  });

  describe("GET /health", () => {
    it("should return 200 OK with server health, version, and index statistics", async () => {
      const res = await dispatch(handler, { url: "/health" });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/json");

      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(body.version).toBe("0.1.0");
      expect(body.knowledgeBaseDocs).toBe(8);
      expect(body.chunksIndexed).toBeGreaterThan(0);
      expect(body.timestamp).toBeDefined();
    });

    it("should return 405 Method Not Allowed when accessed via POST", async () => {
      const res = await dispatch(handler, {
        method: "POST",
        url: "/health",
      });
      expect(res.status).toBe(405);
      expect(res.headers["allow"]).toBe("GET");
    });
  });

  describe("POST /api/classify", () => {
    it("should return 200 OK with classification for a valid ticket", async () => {
      const validTicket = {
        id: "TICK-REST-1",
        title: "VPN password expired",
        description: "Cannot connect to Cisco AnyConnect after password change in Okta.",
        sender: "user@example.com",
      };

      const res = await dispatch(handler, {
        method: "POST",
        url: "/api/classify",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validTicket),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.category).toBe("ACCESS_AND_IDENTITY");
      expect(data.urgency).toBeDefined();
      expect(data.confidence).toBeGreaterThan(0);
      expect(data.suggestedAction).toBeDefined();
    });

    it("should return 400 Bad Request with validation issues when ticket is missing fields", async () => {
      const invalidTicket = {
        title: "Missing ID and sender",
      };

      const res = await dispatch(handler, {
        method: "POST",
        url: "/api/classify",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invalidTicket),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Validation failed");
      expect(data.issues).toBeDefined();
      expect(data.issues.length).toBeGreaterThan(0);
    });
  });

  describe("POST /api/search", () => {
    it("should return 200 OK with hybrid search results matching the query", async () => {
      const res = await dispatch(handler, {
        method: "POST",
        url: "/api/search",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "Cisco AnyConnect VPN authentication failed",
          topK: 2,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.query).toBe("Cisco AnyConnect VPN authentication failed");
      expect(data.count).toBe(2);
      expect(data.results.length).toBe(2);
      expect(data.results[0].chunk.documentId).toBe("KB-VPN-001");
      expect(data.results[0].score).toBeGreaterThan(0);
    });

    it("should respect category filtering in search", async () => {
      const res = await dispatch(handler, {
        method: "POST",
        url: "/api/search",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "screen display flickering",
          filterCategory: "HARDWARE",
          topK: 1,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.results.length).toBe(1);
      expect(data.results[0].chunk.category).toBe("HARDWARE");
    });

    it("should return 400 Bad Request when query is empty", async () => {
      const res = await dispatch(handler, {
        method: "POST",
        url: "/api/search",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "   " }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Validation failed");
    });
  });

  describe("POST /api/resolve", () => {
    it("should return 200 OK with a grounded copilot response for a valid ticket", async () => {
      const ticket = {
        id: "TICK-REST-100",
        title: "Lost MFA device and cannot login to AWS",
        description: "My work phone was dropped in water. Need emergency access code.",
        sender: "dev@corp.internal",
      };

      const res = await dispatch(handler, {
        method: "POST",
        url: "/api/resolve",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ticket),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ticketId).toBe("TICK-REST-100");
      expect(data.category).toBe("ACCESS_AND_IDENTITY");
      expect(data.resolutionSteps.length).toBeGreaterThan(0);
      expect(data.groundedInRunbooks).toBe(true);
      expect(data.citations).toContain("KB-AUTH-002#chunk-0");
    });

    it("should support wrapped format { ticket, topK }", async () => {
      const payload = {
        ticket: {
          id: "TICK-REST-101",
          title: "MacBook CorpNet-Secure 802.1X certificate error",
          description: "Cannot join conference room Wi-Fi network.",
          sender: "analyst@corp.internal",
        },
        topK: 2,
      };

      const res = await dispatch(handler, {
        method: "POST",
        url: "/api/resolve",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ticketId).toBe("TICK-REST-101");
      expect(data.groundedInRunbooks).toBe(true);
    });

    it("should quarantine dangerous remediation commands via action safety guardrail", async () => {
      // Specialized handler with a mock LLM that generates a destructive command
      const maliciousMockClient: IGeminiClient = {
        async generateClassification() {
          return {
            category: "SOFTWARE",
            urgency: "HIGH",
            confidence: 0.95,
            reasoning: "Disk full issue",
            suggestedAction: "Wipe disk",
          };
        },
        async generateCopilotResolution() {
          return {
            ticketId: "TICK-ATTACK",
            category: "SOFTWARE",
            urgency: "HIGH",
            summary: "Wiping filesystem to free up inodes.",
            resolutionSteps: [
              "Run rm -rf /var/log/* to clear all disk space immediately.",
              "Reboot the machine.",
            ],
            citations: ["KB-SOFT-001#chunk-0"],
            groundedInRunbooks: true,
          };
        },
      };

      const attackClassifier = new ClassifierService({ client: maliciousMockClient });
      const attackCopilot = new CopilotService({
        classifierService: attackClassifier,
        hybridSearchService: new HybridSearchService(
          new BM25SearchService([]),
          new VectorSearchService(new MockEmbeddingClient(16))
        ),
        client: maliciousMockClient,
      });

      const attackHandler = createRequestHandler({
        classifierService: attackClassifier,
        hybridSearchService: new HybridSearchService(
          new BM25SearchService([]),
          new VectorSearchService(new MockEmbeddingClient(16))
        ),
        copilotService: attackCopilot,
      });

      const res = await dispatch(attackHandler, {
        method: "POST",
        url: "/api/resolve",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "TICK-ATTACK",
          title: "Server disk full",
          description: "Root partition full.",
          sender: "admin@corp.internal",
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.safetyWarning).toContain("Blocked high-risk remediation patterns");
      expect(data.resolutionSteps[0]).toContain("[BLOCKED UNSAFE ACTION");
      expect(data.resolutionSteps[0]).not.toContain("rm -rf");
    });

    it("should return 400 Bad Request when request body is malformed JSON", async () => {
      const res = await dispatch(handler, {
        method: "POST",
        url: "/api/resolve",
        headers: { "Content-Type": "application/json" },
        body: "{ this is not json }",
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid JSON");
    });
  });

  describe("HTTP Error Boundaries & Routing", () => {
    it("should return 405 Method Not Allowed when hitting /api/resolve with GET", async () => {
      const res = await dispatch(handler, {
        method: "GET",
        url: "/api/resolve",
      });
      expect(res.status).toBe(405);
      expect(res.headers["allow"]).toContain("POST");
    });

    it("should return 404 Not Found for unregistered routes", async () => {
      const res = await dispatch(handler, {
        method: "GET",
        url: "/api/nonexistent-endpoint",
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("Route not found");
    });
  });
});
