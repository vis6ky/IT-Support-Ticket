import { describe, it, expect } from "vitest";
import { ClassifierService } from "../src/services/classifierService.js";
import { MockGeminiClient } from "../src/clients/geminiClient.js";

describe("ClassifierService (Unit & Mocked Service Tests)", () => {
  it("should classify a valid ticket using the mock Gemini adapter", () => {
    const mockClient = new MockGeminiClient({
      category: "NETWORK",
      urgency: "HIGH",
      confidence: 0.94,
      reasoning: "Core router interface failure affecting entire floor.",
      suggestedAction: "Reboot switch 3B and dispatch network engineer.",
    });

    const service = new ClassifierService({ client: mockClient });

    return service
      .classifyTicket({
        id: "TICK-301",
        title: "Entire 2nd floor has no internet",
        description: "Ethernet ports and APs in the building east wing have no link light.",
      })
      .then((result) => {
        expect(result.category).toBe("NETWORK");
        expect(result.urgency).toBe("HIGH");
        expect(result.confidence).toBe(0.94);
        expect(result.suggestedAction).toContain("dispatch network engineer");
        expect(result.isFallback).toBe(false);
      });
  });

  it("should reject invalid tickets at the ingestion boundary before invoking LLM", async () => {
    const mockClient = new MockGeminiClient();
    const service = new ClassifierService({ client: mockClient });

    await expect(
      service.classifyTicket({
        id: "", // Invalid empty ID
        title: "OK",
        description: "Short",
      })
    ).rejects.toThrow();

    // Verify LLM client was never called
    expect(mockClient.lastPromptReceived).toBeUndefined();
  });

  it("should provide a safe fallback when LLM output violates schema contract", async () => {
    const mockClient = new MockGeminiClient({
      category: "INVALID_CATEGORY_DOES_NOT_EXIST",
      urgency: "UNKNOWN_URGENCY",
      confidence: "not-a-number",
      reasoning: "bad output",
      suggestedAction: "nothing",
    });

    const service = new ClassifierService({ client: mockClient });

    const result = await service.classifyTicket({
      id: "TICK-302",
      title: "Broken mouse",
      description: "My scroll wheel stopped scrolling down.",
    });

    expect(result.category).toBe("OTHER");
    expect(result.urgency).toBe("MEDIUM");
    expect(result.confidence).toBe(0);
    expect(result.suggestedAction).toContain("manual triage queue");
    expect(result.isFallback).toBe(true);
  });

  it("should provide a safe fallback when LLM client throws a network or SDK exception", async () => {
    const mockClient = new MockGeminiClient(new Error("Gemini API rate limit exceeded (429)"));
    const service = new ClassifierService({ client: mockClient });

    const result = await service.classifyTicket({
      id: "TICK-303",
      title: "Password reset request",
      description: "Please reset my domain password.",
    });

    expect(result.category).toBe("OTHER");
    expect(result.urgency).toBe("MEDIUM");
    expect(result.confidence).toBe(0);
    expect(result.reasoning).toContain("429");
    expect(result.isFallback).toBe(true);
  });
});
