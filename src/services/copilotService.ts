import { ticketInputSchema, type TicketInput } from "../schemas/ticketSchema.js";
import {
  CopilotResponseSchema,
  type CopilotResponse,
} from "../schemas/copilotSchema.js";
import type { Chunk } from "../schemas/documentSchema.js";
import type { ClassificationResult } from "../schemas/classificationSchema.js";
import { buildCopilotPrompt } from "../prompts/copilotPrompt.js";
import { ClassifierService } from "./classifierService.js";
import { HybridSearchService } from "./hybridSearchService.js";
import { assessActionSafety } from "./actionSafetyGuardrail.js";
import type { IGeminiClient } from "../clients/geminiClient.js";

export type CopilotStreamPhase =
  | "classifying"
  | "retrieving"
  | "generating"
  | "safety_check";

export type CopilotStreamEvent =
  | {
      type: "status";
      data: { phase: CopilotStreamPhase; message: string };
    }
  | {
      type: "classification";
      data: ClassificationResult;
    }
  | {
      type: "citations";
      data: { count: number; citations: string[]; chunks: Chunk[] };
    }
  | {
      type: "delta";
      data: { text: string };
    }
  | {
      type: "guardrail";
      data: { isSafe: boolean; violations: string[] };
    }
  | {
      type: "done";
      data: CopilotResponse;
    }
  | {
      type: "error";
      data: { error: string; isFallback: boolean };
    };

export interface CopilotServiceOptions {
  classifierService: ClassifierService;
  hybridSearchService: HybridSearchService;
  client: IGeminiClient;
}

/**
 * End-to-End Grounded IT Support Copilot Service.
 *
 * ORCHESTRATION PIPELINE:
 * 1. Ingestion: Validates raw ticket input with strict Zod bounds.
 * 2. Triage / Classification: Runs ClassifierService to determine category and urgency.
 * 3. Grounded Retrieval: Queries HybridSearchService (RRF) for relevant runbooks.
 * 4. Context Assembly: Constructs delimited prompt with citations & anti-hallucination rules.
 * 5. Generation: Solicits structured remediation from LLM adapter.
 * 6. Safety Guardrail: Inspects proposed resolution steps for dangerous/destructive commands.
 * 7. Fallback: Defensively falls back to safe human escalation on malformed output or outages.
 */
export class CopilotService {
  private classifierService: ClassifierService;
  private hybridSearchService: HybridSearchService;
  private client: IGeminiClient;

  constructor(options: CopilotServiceOptions) {
    this.classifierService = options.classifierService;
    this.hybridSearchService = options.hybridSearchService;
    this.client = options.client;
  }

  /**
   * Processes a support ticket end-to-end to generate a grounded, cited resolution.
   *
   * @param rawTicket - Untrusted input from user or support portal
   * @param options - Configurable retrieval depth (topK)
   * @returns Strongly-typed, safety-inspected CopilotResponse
   */
  public async resolveTicket(
    rawTicket: unknown,
    options?: { topK?: number }
  ): Promise<CopilotResponse> {
    const topK = options?.topK ?? 3;

    // 1. Ingestion Boundary: Validate raw input
    const ticket: TicketInput = ticketInputSchema.parse(rawTicket);

    // 2. Triage Boundary: Classify ticket
    const classification = await this.classifierService.classifyTicket(ticket);

    // 3. Retrieval Boundary: Query Hybrid Search engine
    // Search query combines title and description for full technical context
    const searchQuery = `${ticket.title} ${ticket.description}`;
    let searchResults = await this.hybridSearchService.search(searchQuery, {
      topK,
      filterCategory: classification.category,
    });

    // If category-filtered search returned 0 items, broaden search across all runbooks
    if (searchResults.length === 0) {
      searchResults = await this.hybridSearchService.search(searchQuery, { topK });
    }

    const retrievedChunks = searchResults.map((r) => r.chunk);

    // 4. Prompt Boundary: Build Grounded Context Assembly
    const prompt = buildCopilotPrompt(ticket, classification, retrievedChunks);

    try {
      // 5. LLM Adapter Boundary: Generate resolution
      const rawResponse = await this.client.generateCopilotResolution(prompt);

      // 6. Egress Boundary: Runtime schema validation
      const parseResult = CopilotResponseSchema.safeParse(rawResponse);

      if (!parseResult.success) {
        console.warn(
          `[CopilotService] Output contract violation: ${parseResult.error.message}`
        );
        return this.createFallbackResponse(
          ticket.id,
          classification.category,
          classification.urgency,
          `LLM response contract violation: ${parseResult.error.issues.map((i) => i.message).join(", ")}`
        );
      }

      const copilotResponse: CopilotResponse = {
        ...parseResult.data,
        ticketId: ticket.id, // Strictly preserve identity lineage to inbound ticket
      };

      // 7. Action Safety Boundary: Inspect proposed steps for dangerous commands
      const combinedActionText = `${copilotResponse.summary} ${copilotResponse.resolutionSteps.join(" ")}`;
      const safety = assessActionSafety(combinedActionText);

      if (!safety.isSafe) {
        console.warn(
          `[CopilotService] Unsafe resolution action blocked: ${safety.summary}`
        );

        return {
          ...copilotResponse,
          resolutionSteps: copilotResponse.resolutionSteps.map((step) => {
            const stepSafety = assessActionSafety(step);
            if (!stepSafety.isSafe) {
              return `[BLOCKED UNSAFE ACTION: ${stepSafety.violations[0]}] Action quarantined. Escalated to IT Security for manual authorization.`;
            }
            return step;
          }),
          safetyWarning: `Blocked high-risk remediation patterns: ${safety.violations.join("; ")}`,
          isFallback: false,
        };
      }

      return copilotResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[CopilotService] Generation provider failure: ${message}`);
      return this.createFallbackResponse(
        ticket.id,
        classification.category,
        classification.urgency,
        `Automated resolution generation failed: ${message}`
      );
    }
  }

  /**
   * Processes a support ticket end-to-end via an asynchronous event stream.
   * Emits progressive status updates, classification, citations, generation deltas,
   * guardrail evaluation, and the final validated resolution object.
   *
   * @param rawTicket - Untrusted input from user or support portal
   * @param options - Configurable retrieval depth (topK)
   */
  public async *resolveTicketStream(
    rawTicket: unknown,
    options?: { topK?: number }
  ): AsyncGenerator<CopilotStreamEvent, void, unknown> {
    const topK = options?.topK ?? 3;

    // 1. Ingestion Boundary: Validate raw input
    const ticket: TicketInput = ticketInputSchema.parse(rawTicket);

    let classification: ClassificationResult | undefined;

    try {
      // 2. Triage Boundary
      yield {
        type: "status",
        data: {
          phase: "classifying",
          message: "Classifying ticket category and urgency...",
        },
      };

      classification = await this.classifierService.classifyTicket(ticket);

      yield {
        type: "classification",
        data: classification,
      };

      // 3. Retrieval Boundary
      yield {
        type: "status",
        data: {
          phase: "retrieving",
          message: "Searching knowledge base for relevant runbooks...",
        },
      };

      const searchQuery = `${ticket.title} ${ticket.description}`;
      let searchResults = await this.hybridSearchService.search(searchQuery, {
        topK,
        filterCategory: classification.category,
      });

      if (searchResults.length === 0) {
        searchResults = await this.hybridSearchService.search(searchQuery, { topK });
      }

      const retrievedChunks = searchResults.map((r) => r.chunk);
      const citations = Array.from(new Set(retrievedChunks.map((c) => c.chunkId)));

      yield {
        type: "citations",
        data: {
          count: retrievedChunks.length,
          citations,
          chunks: retrievedChunks,
        },
      };

      // 4. Context Assembly Boundary
      yield {
        type: "status",
        data: {
          phase: "generating",
          message: "Generating grounded resolution steps...",
        },
      };

      const prompt = buildCopilotPrompt(ticket, classification, retrievedChunks);

      // 5. LLM Generation Boundary: Stream tokens or emit single result
      let rawBuffer = "";
      if (typeof this.client.streamCopilotResolution === "function") {
        for await (const chunk of this.client.streamCopilotResolution(prompt)) {
          rawBuffer += chunk;
          yield {
            type: "delta",
            data: { text: chunk },
          };
        }
      } else {
        const rawResponse = await this.client.generateCopilotResolution(prompt);
        rawBuffer =
          typeof rawResponse === "string"
            ? rawResponse
            : JSON.stringify(rawResponse);
        yield {
          type: "delta",
          data: { text: rawBuffer },
        };
      }

      // 6. Egress Validation
      let parsedRaw: unknown;
      try {
        parsedRaw = JSON.parse(rawBuffer);
      } catch {
        parsedRaw = rawBuffer;
      }

      const parseResult = CopilotResponseSchema.safeParse(parsedRaw);
      if (!parseResult.success) {
        console.warn(
          `[CopilotService] Output contract violation: ${parseResult.error.message}`
        );
        const fallback = this.createFallbackResponse(
          ticket.id,
          classification.category,
          classification.urgency,
          `LLM response contract violation: ${parseResult.error.issues.map((i) => i.message).join(", ")}`
        );
        yield {
          type: "done",
          data: fallback,
        };
        return;
      }

      const copilotResponse: CopilotResponse = {
        ...parseResult.data,
        ticketId: ticket.id,
      };

      // 7. Action Safety Boundary
      yield {
        type: "status",
        data: {
          phase: "safety_check",
          message: "Evaluating resolution action safety...",
        },
      };

      const combinedActionText = `${copilotResponse.summary} ${copilotResponse.resolutionSteps.join(" ")}`;
      const safety = assessActionSafety(combinedActionText);

      yield {
        type: "guardrail",
        data: {
          isSafe: safety.isSafe,
          violations: safety.violations,
        },
      };

      if (!safety.isSafe) {
        console.warn(
          `[CopilotService] Unsafe resolution action blocked: ${safety.summary}`
        );

        const quarantinedResponse: CopilotResponse = {
          ...copilotResponse,
          resolutionSteps: copilotResponse.resolutionSteps.map((step) => {
            const stepSafety = assessActionSafety(step);
            if (!stepSafety.isSafe) {
              return `[BLOCKED UNSAFE ACTION: ${stepSafety.violations[0]}] Action quarantined. Escalated to IT Security for manual authorization.`;
            }
            return step;
          }),
          safetyWarning: `Blocked high-risk remediation patterns: ${safety.violations.join("; ")}`,
          isFallback: false,
        };

        yield {
          type: "done",
          data: quarantinedResponse,
        };
        return;
      }

      yield {
        type: "done",
        data: copilotResponse,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[CopilotService] Streaming generation failure: ${message}`);
      yield {
        type: "error",
        data: {
          error: message,
          isFallback: true,
        },
      };

      const fallback = this.createFallbackResponse(
        ticket.id,
        classification?.category ?? "OTHER",
        classification?.urgency ?? "HIGH",
        `Automated resolution generation failed: ${message}`
      );

      yield {
        type: "done",
        data: fallback,
      };
    }
  }

  /**
   * Safe fallback ensuring that downstream systems always receive a valid CopilotResponse
   * directing the user safely to human Tier 2 engineering.
   */
  private createFallbackResponse(
    ticketId: string,
    category: CopilotResponse["category"],
    urgency: CopilotResponse["urgency"],
    reason: string
  ): CopilotResponse {
    return {
      ticketId,
      category,
      urgency,
      summary: "Automated resolution unavailable. Escalating to human IT Tier 2 queue.",
      resolutionSteps: [
        "Capture local system logs and current error dialog screenshot.",
        "Verify network connectivity and authentication status.",
        "A human support engineer has been notified and will triage this ticket directly.",
      ],
      citations: [],
      groundedInRunbooks: false,
      isFallback: true,
      safetyWarning: reason.slice(0, 300),
    };
  }
}
