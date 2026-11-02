import { describe, it, expect, beforeAll } from "vitest";
import { CopilotService } from "../src/services/copilotService.js";
import { ClassifierService } from "../src/services/classifierService.js";
import { HybridSearchService } from "../src/services/hybridSearchService.js";
import { BM25SearchService } from "../src/services/bm25SearchService.js";
import { VectorSearchService } from "../src/services/vectorSearchService.js";
import { MockEmbeddingClient } from "../src/clients/embeddingClient.js";
import { MockGeminiClient } from "../src/clients/geminiClient.js";
import { FICTIONAL_RUNBOOKS } from "../src/data/knowledgeBase.js";
import { chunkDocument } from "../src/services/chunkingService.js";

describe("CopilotService (End-to-End Grounded RAG Pipeline)", () => {
  let hybridSearchService: HybridSearchService;

  beforeAll(async () => {
    const allChunks = FICTIONAL_RUNBOOKS.flatMap((doc) =>
      chunkDocument(doc, { maxChunkSize: 350, overlap: 60 })
    );

    const bm25Service = new BM25SearchService(allChunks);
    const vectorService = new VectorSearchService(new MockEmbeddingClient(16));
    await vectorService.indexChunks(allChunks);

    hybridSearchService = new HybridSearchService(bm25Service, vectorService);
  });

  // =========================================================================
  // 1. Grounded Resolution with Verified Citations
  // =========================================================================
  describe("Grounded Resolution Generation", () => {
    it("should generate a grounded resolution with citations using retrieved runbooks", async () => {
      const mockLLM = new MockGeminiClient(
        // Classification response
        {
          category: "ACCESS_AND_IDENTITY",
          urgency: "HIGH",
          confidence: 0.95,
          reasoning: "User is locked out of MFA following phone replacement.",
          suggestedAction: "Execute Okta MFA reset procedure.",
        },
        // Copilot grounded resolution response
        {
          ticketId: "TCK-100",
          category: "ACCESS_AND_IDENTITY",
          urgency: "HIGH",
          summary: "Self-service Okta MFA migration via trusted browser.",
          resolutionSteps: [
            "Log into https://auth.corp.internal on a previously trusted computer browser.",
            "Click profile avatar -> Settings -> Extra Verification.",
            "Click 'Set up another' under Okta Verify and scan the QR code with new device.",
          ],
          citations: ["KB-AUTH-002#chunk-0"],
          groundedInRunbooks: true,
        }
      );

      const classifierService = new ClassifierService({ client: mockLLM });
      const copilotService = new CopilotService({
        classifierService,
        hybridSearchService,
        client: mockLLM,
      });

      const response = await copilotService.resolveTicket({
        id: "TCK-100",
        title: "New phone, cannot complete Okta MFA push",
        description: "I received a new mobile phone today and Okta Verify notifications no longer arrive.",
      });

      expect(response.ticketId).toBe("TCK-100");
      expect(response.category).toBe("ACCESS_AND_IDENTITY");
      expect(response.urgency).toBe("HIGH");
      expect(response.groundedInRunbooks).toBe(true);
      expect(response.citations).toContain("KB-AUTH-002#chunk-0");
      expect(response.resolutionSteps.length).toBe(3);
      expect(response.isFallback).toBe(false);

      // Verify that the prompt sent to the LLM actually contained the grounded KB chunk
      const lastPrompt = mockLLM.lastCopilotPromptReceived;
      expect(lastPrompt?.userContent).toContain("<grounded_knowledge_base>");
      expect(lastPrompt?.userContent).toContain("KB-AUTH-002");
      expect(lastPrompt?.userContent).toContain("<ticket_data>");
    });
  });

  // =========================================================================
  // 2. Hallucination Defense & Unmatched Escalation
  // =========================================================================
  describe("Hallucination Defense & Escalation", () => {
    it("should gracefully handle ungrounded inquiries by escalating when runbooks do not match", async () => {
      const mockLLM = new MockGeminiClient(
        {
          category: "OTHER",
          urgency: "LOW",
          confidence: 0.8,
          reasoning: "Inquiry about corporate catering budget, not an IT technical issue.",
          suggestedAction: "Redirect to Facilities.",
        },
        {
          ticketId: "TCK-200",
          category: "OTHER",
          urgency: "LOW",
          summary: "Catering and kitchen budget questions are outside IT operational runbooks.",
          resolutionSteps: [
            "No standard IT runbook exists for cafeteria catering requests.",
            "Please redirect this request to the Facilities & Workplace Services portal.",
          ],
          citations: [],
          groundedInRunbooks: false,
        }
      );

      const classifierService = new ClassifierService({ client: mockLLM });
      const copilotService = new CopilotService({
        classifierService,
        hybridSearchService,
        client: mockLLM,
      });

      const response = await copilotService.resolveTicket({
        id: "TCK-200",
        title: "Catering budget for upcoming team event",
        description: "Need to know the reimbursement limit for Friday pizza order.",
      });

      expect(response.groundedInRunbooks).toBe(false);
      expect(response.citations).toEqual([]);
      expect(response.isFallback).toBe(false);
    });
  });

  // =========================================================================
  // 3. Action Safety Guardrail Enforcement
  // =========================================================================
  describe("Action Safety Guardrail Enforcement", () => {
    it("should intercept and quarantine dangerous commands generated in resolution steps", async () => {
      const mockLLM = new MockGeminiClient(
        {
          category: "SOFTWARE",
          urgency: "HIGH",
          confidence: 0.9,
          reasoning: "Corrupted lock file on developer machine.",
          suggestedAction: "Clear lock file.",
        },
        // Adversarial model generation attempting dangerous command
        {
          ticketId: "TCK-300",
          category: "SOFTWARE",
          urgency: "HIGH",
          summary: "Fix permissions and purge corrupted files.",
          resolutionSteps: [
            "Open your terminal application.",
            "Run rm -rf / on the system to purge corrupted system lockfiles.",
            "Restart your workstation.",
          ],
          citations: [],
          groundedInRunbooks: false,
        }
      );

      const classifierService = new ClassifierService({ client: mockLLM });
      const copilotService = new CopilotService({
        classifierService,
        hybridSearchService,
        client: mockLLM,
      });

      const response = await copilotService.resolveTicket({
        id: "TCK-300",
        title: "Apt package lock corrupted",
        description: "Need help fixing dpkg frontend lock error.",
      });

      // The dangerous command must be intercepted and quarantined
      expect(response.resolutionSteps[1]).not.toContain("rm -rf /");
      expect(response.resolutionSteps[1]).toContain("[BLOCKED UNSAFE ACTION");
      expect(response.resolutionSteps[1]).toContain("Action quarantined");
      expect(response.safetyWarning).toContain("Destructive filesystem");
      // Other safe steps must be preserved
      expect(response.resolutionSteps[0]).toBe("Open your terminal application.");
      expect(response.resolutionSteps[2]).toBe("Restart your workstation.");
    });
  });

  // =========================================================================
  // 4. Defensive Fallback on Malformed Output or Exceptions
  // =========================================================================
  describe("Defensive Fallback Handling", () => {
    it("should safely fall back and set isFallback=true when model outputs malformed JSON", async () => {
      const mockLLM = new MockGeminiClient();
      // Inject malformed copilot response
      mockLLM.setCopilotResponse({
        invalidKey: "missing required resolution steps and ticketId",
      });

      const classifierService = new ClassifierService({ client: mockLLM });
      const copilotService = new CopilotService({
        classifierService,
        hybridSearchService,
        client: mockLLM,
      });

      const response = await copilotService.resolveTicket({
        id: "TCK-400",
        title: "Monitor broken",
        description: "Screen cracked.",
      });

      expect(response.isFallback).toBe(true);
      expect(response.groundedInRunbooks).toBe(false);
      expect(response.summary).toContain("Automated resolution unavailable");
      expect(response.resolutionSteps[2]).toContain("human support engineer has been notified");
    });

    it("should safely fall back when generation client throws a network exception", async () => {
      const mockLLM = new MockGeminiClient();
      mockLLM.setCopilotResponse(new Error("Gemini API 503 Service Unavailable"));

      const classifierService = new ClassifierService({ client: mockLLM });
      const copilotService = new CopilotService({
        classifierService,
        hybridSearchService,
        client: mockLLM,
      });

      const response = await copilotService.resolveTicket({
        id: "TCK-500",
        title: "VPN keeps disconnecting",
        description: "Cisco AnyConnect drops every 2 minutes.",
      });

      expect(response.isFallback).toBe(true);
      expect(response.safetyWarning).toContain("503 Service Unavailable");
      expect(response.resolutionSteps.length).toBeGreaterThan(0);
    });
  });
});
