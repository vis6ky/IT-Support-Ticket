import { describe, it, expect, beforeAll } from "vitest";
import http from "node:http";
import { Readable, Writable } from "node:stream";
import {
  CopilotService,
  type CopilotStreamEvent,
} from "../src/services/copilotService.js";
import { ClassifierService } from "../src/services/classifierService.js";
import { HybridSearchService } from "../src/services/hybridSearchService.js";
import { BM25SearchService } from "../src/services/bm25SearchService.js";
import { VectorSearchService } from "../src/services/vectorSearchService.js";
import { MockEmbeddingClient } from "../src/clients/embeddingClient.js";
import { MockGeminiClient, type IGeminiClient } from "../src/clients/geminiClient.js";
import { FICTIONAL_RUNBOOKS } from "../src/data/knowledgeBase.js";
import { chunkDocument } from "../src/services/chunkingService.js";
import { createRequestHandler } from "../src/server.js";

interface TestResponse {
  status: number;
  headers: Record<string, string>;
  text: () => Promise<string>;
  json: () => Promise<any>;
}

interface ParsedSseEvent {
  event: string;
  data: any;
}

/**
 * Parses raw Server-Sent Events text output into structured event blocks.
 */
function parseSseStream(rawText: string): ParsedSseEvent[] {
  const blocks = rawText.split("\n\n").filter((b) => b.trim().length > 0);
  const events: ParsedSseEvent[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    let eventName = "message";
    let dataStr = "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventName = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        dataStr = line.slice(6).trim();
      }
    }

    if (dataStr) {
      events.push({
        event: eventName,
        data: JSON.parse(dataStr),
      });
    }
  }

  return events;
}

/**
 * Lightweight in-memory HTTP dispatcher for testing SSE endpoints.
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

describe("Real-Time Streaming & Server-Sent Events (SSE)", () => {
  let copilotService: CopilotService;
  let hybridSearchService: HybridSearchService;
  let mockLlm: MockGeminiClient;

  beforeAll(async () => {
    const allChunks = FICTIONAL_RUNBOOKS.flatMap((doc) =>
      chunkDocument(doc, { maxChunkSize: 350, overlap: 60 })
    );

    const bm25Service = new BM25SearchService(allChunks);
    const vectorService = new VectorSearchService(new MockEmbeddingClient(16));
    await vectorService.indexChunks(allChunks);

    hybridSearchService = new HybridSearchService(bm25Service, vectorService);
    mockLlm = new MockGeminiClient(
      {
        category: "ACCESS_AND_IDENTITY",
        urgency: "HIGH",
        confidence: 0.95,
        reasoning: "User lost MFA device and is locked out.",
        suggestedAction: "Issue emergency temporary MFA token.",
      },
      {
        ticketId: "TICK-STREAM-TEST",
        category: "ACCESS_AND_IDENTITY",
        urgency: "HIGH",
        summary: "Emergency Okta MFA token generation.",
        resolutionSteps: [
          "Verify user identity via voice callback.",
          "Issue a temporary 4-hour Okta bypass token.",
        ],
        citations: ["KB-AUTH-002#chunk-0"],
        groundedInRunbooks: true,
      }
    );

    const classifierService = new ClassifierService({ client: mockLlm });
    copilotService = new CopilotService({
      classifierService,
      hybridSearchService,
      client: mockLlm,
    });
  });

  // =========================================================================
  // 1. Service-Level Stream Event Generation
  // =========================================================================
  describe("CopilotService.resolveTicketStream (Unit)", () => {
    it("should emit progressive events in strict architectural order", async () => {
      const ticket = {
        id: "TICK-STREAM-101",
        title: "Lost phone with Okta Verify",
        description: "Dropped phone in water, need bypass code for urgent deploy.",
        sender: "dev@corp.internal",
      };

      const events: CopilotStreamEvent[] = [];
      for await (const event of copilotService.resolveTicketStream(ticket, { topK: 2 })) {
        events.push(event);
      }

      const eventTypes = events.map((e) => e.type);

      // Verify sequence of lifecycle events
      expect(eventTypes[0]).toBe("status"); // phase: classifying
      expect(eventTypes[1]).toBe("classification");
      expect(eventTypes[2]).toBe("status"); // phase: retrieving
      expect(eventTypes[3]).toBe("citations");
      expect(eventTypes[4]).toBe("status"); // phase: generating
      expect(eventTypes).toContain("delta"); // token streaming
      expect(eventTypes).toContain("guardrail"); // safety evaluation
      expect(eventTypes[eventTypes.length - 1]).toBe("done"); // authoritative response
    });

    it("should deliver citations before token generation completes", async () => {
      const ticket = {
        id: "TICK-STREAM-102",
        title: "MacBook cannot connect to CorpNet-Secure Wi-Fi",
        description: "802.1X certificate validation error.",
        sender: "analyst@corp.internal",
      };

      const events: CopilotStreamEvent[] = [];
      for await (const event of copilotService.resolveTicketStream(ticket)) {
        events.push(event);
      }

      const citationsIndex = events.findIndex((e) => e.type === "citations");
      const deltaIndex = events.findIndex((e) => e.type === "delta");
      const doneIndex = events.findIndex((e) => e.type === "done");

      expect(citationsIndex).toBeGreaterThan(-1);
      expect(deltaIndex).toBeGreaterThan(citationsIndex);
      expect(doneIndex).toBeGreaterThan(deltaIndex);

      const citationsEvent = events[citationsIndex] as {
        type: "citations";
        data: { citations: string[]; count: number };
      };
      expect(citationsEvent.data.citations.length).toBeGreaterThan(0);
    });

    it("should flag unsafe remediation in guardrail event and quarantine in done event", async () => {
      const maliciousClient: IGeminiClient = {
        async generateClassification() {
          return {
            category: "SOFTWARE",
            urgency: "HIGH",
            confidence: 0.9,
            reasoning: "Disk full issue",
            suggestedAction: "Wipe disk",
          };
        },
        async generateCopilotResolution() {
          return {
            ticketId: "TICK-ATTACK",
            category: "SOFTWARE",
            urgency: "HIGH",
            summary: "Wiping root disk",
            resolutionSteps: ["Execute rm -rf / to clear all space."],
            citations: [],
            groundedInRunbooks: false,
          };
        },
        async *streamCopilotResolution() {
          yield JSON.stringify({
            ticketId: "TICK-ATTACK",
            category: "SOFTWARE",
            urgency: "HIGH",
            summary: "Wiping root disk",
            resolutionSteps: ["Execute rm -rf / to clear all space."],
            citations: [],
            groundedInRunbooks: false,
          });
        },
      };

      const attackService = new CopilotService({
        classifierService: new ClassifierService({ client: maliciousClient }),
        hybridSearchService,
        client: maliciousMockClient(maliciousClient),
      });

      const events: CopilotStreamEvent[] = [];
      for await (const event of attackService.resolveTicketStream({
        id: "TICK-ATTACK",
        title: "Clear disk space",
        description: "Root drive 100% full.",
        sender: "admin@corp.internal",
      })) {
        events.push(event);
      }

      const guardrailEvent = events.find((e) => e.type === "guardrail") as {
        type: "guardrail";
        data: { isSafe: boolean; violations: string[] };
      };
      expect(guardrailEvent).toBeDefined();
      expect(guardrailEvent.data.isSafe).toBe(false);
      expect(guardrailEvent.data.violations.length).toBeGreaterThan(0);

      const doneEvent = events.find((e) => e.type === "done") as {
        type: "done";
        data: any;
      };
      expect(doneEvent.data.safetyWarning).toContain("Blocked high-risk remediation patterns");
      expect(doneEvent.data.resolutionSteps[0]).toContain("[BLOCKED UNSAFE ACTION");
    });

    it("should emit error and fallback when LLM client throws an exception", async () => {
      const failingClient: IGeminiClient = {
        async generateClassification() {
          return {
            category: "OTHER",
            urgency: "LOW",
            confidence: 0.5,
            reasoning: "Test",
            suggestedAction: "Test",
          };
        },
        async generateCopilotResolution() {
          throw new Error("Gemini API rate limit exceeded");
        },
        async *streamCopilotResolution() {
          throw new Error("Gemini API rate limit exceeded");
        },
      };

      const failingService = new CopilotService({
        classifierService: new ClassifierService({ client: failingClient }),
        hybridSearchService,
        client: failingClient,
      });

      const events: CopilotStreamEvent[] = [];
      for await (const event of failingService.resolveTicketStream({
        id: "TICK-FAIL",
        title: "System broken",
        description: "Test error fallback.",
        sender: "user@corp.internal",
      })) {
        events.push(event);
      }

      const errorEvent = events.find((e) => e.type === "error") as {
        type: "error";
        data: { error: string; isFallback: boolean };
      };
      expect(errorEvent).toBeDefined();
      expect(errorEvent.data.isFallback).toBe(true);

      const doneEvent = events.find((e) => e.type === "done") as {
        type: "done";
        data: any;
      };
      expect(doneEvent.data.isFallback).toBe(true);
      expect(doneEvent.data.groundedInRunbooks).toBe(false);
    });
  });

  // =========================================================================
  // 2. HTTP Server SSE Integration Tests
  // =========================================================================
  describe("HTTP POST /api/resolve/stream (Server Integration)", () => {
    let handler: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;

    beforeAll(() => {
      handler = createRequestHandler({
        classifierService: new ClassifierService({ client: mockLlm }),
        hybridSearchService,
        copilotService,
        docCount: FICTIONAL_RUNBOOKS.length,
        chunkCount: 25,
      });
    });

    it("should respond with 200 and text/event-stream headers", async () => {
      const res = await dispatch(handler, {
        method: "POST",
        url: "/api/resolve/stream",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "TICK-SSE-1",
          title: "VPN password reset issue",
          description: "Cannot connect to Cisco AnyConnect after password reset.",
          sender: "user@corp.internal",
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/event-stream");
      expect(res.headers["cache-control"]).toContain("no-cache");
      expect(res.headers["connection"]).toBe("keep-alive");

      const rawText = await res.text();
      const sseEvents = parseSseStream(rawText);

      expect(sseEvents.length).toBeGreaterThan(4);
      expect(sseEvents.some((e) => e.event === "status")).toBe(true);
      expect(sseEvents.some((e) => e.event === "classification")).toBe(true);
      expect(sseEvents.some((e) => e.event === "citations")).toBe(true);
      expect(sseEvents.some((e) => e.event === "done")).toBe(true);
    });

    it("should support wrapped { ticket, topK } body in SSE endpoint", async () => {
      const res = await dispatch(handler, {
        method: "POST",
        url: "/api/resolve/stream",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket: {
            id: "TICK-SSE-2",
            title: "Emergency MFA reset",
            description: "Phone dropped in water.",
            sender: "user@corp.internal",
          },
          topK: 2,
        }),
      });

      expect(res.status).toBe(200);
      const rawText = await res.text();
      const sseEvents = parseSseStream(rawText);

      const doneEvent = sseEvents.find((e) => e.event === "done");
      expect(doneEvent).toBeDefined();
      expect(doneEvent?.data.ticketId).toBe("TICK-SSE-2");
    });

    it("should reject invalid ticket with 400 Bad Request BEFORE opening SSE stream", async () => {
      const res = await dispatch(handler, {
        method: "POST",
        url: "/api/resolve/stream",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Missing ID and sender" }),
      });

      expect(res.status).toBe(400);
      expect(res.headers["content-type"]).toContain("application/json");
      const body = await res.json();
      expect(body.error).toContain("Validation failed");
    });

    it("should return 405 Method Not Allowed when accessed via GET", async () => {
      const res = await dispatch(handler, {
        method: "GET",
        url: "/api/resolve/stream",
      });

      expect(res.status).toBe(405);
      expect(res.headers["allow"]).toContain("POST");
    });
  });
});

function maliciousMockClient(client: IGeminiClient): IGeminiClient {
  return client;
}
