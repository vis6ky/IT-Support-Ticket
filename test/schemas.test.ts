import { describe, it, expect } from "vitest";
import { ticketInputSchema } from "../src/schemas/ticketSchema.js";
import {
  classificationResultSchema,
  TicketCategoryEnum,
  TicketUrgencyEnum,
} from "../src/schemas/classificationSchema.js";

describe("Domain Schemas & Validation Boundary", () => {
  describe("ticketInputSchema", () => {
    it("should accept a well-formed ticket", () => {
      const validTicket = {
        id: "TCK-101",
        title: "Laptop screen flickering",
        description: "My external Dell monitor flickers black every 10 seconds when plugged into USB-C.",
        senderEmail: "user@company.com",
      };

      const result = ticketInputSchema.safeParse(validTicket);
      expect(result.success).toBe(true);
    });

    it("should reject tickets with empty or too-short titles", () => {
      const invalid = {
        id: "TCK-102",
        title: "Hi",
        description: "Valid description here.",
      };

      const result = ticketInputSchema.safeParse(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("at least 3 characters");
      }
    });

    it("should reject oversized ticket descriptions to prevent DoS/token exhaustion", () => {
      const oversizedTicket = {
        id: "TCK-103",
        title: "Huge log upload",
        description: "A".repeat(4001), // Max allowed is 4000
      };

      const result = ticketInputSchema.safeParse(oversizedTicket);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("cannot exceed 4000 characters");
      }
    });

    it("should sanitize and strip null bytes from text inputs", () => {
      const nullByteTicket = {
        id: "TCK-104",
        title: "Malicious\0 title with null bytes",
        description: "Null byte \0 in description text.",
      };

      const parsed = ticketInputSchema.parse(nullByteTicket);
      expect(parsed.title).toBe("Malicious title with null bytes");
      expect(parsed.description).toBe("Null byte  in description text.");
    });
  });

  describe("classificationResultSchema", () => {
    it("should accept valid LLM classification output", () => {
      const validOutput = {
        category: "HARDWARE",
        urgency: "HIGH",
        confidence: 0.92,
        reasoning: "Screen flickering prevents monitor from functioning.",
        suggestedAction: "Dispatch replacement USB-C cable or swap monitor.",
      };

      const result = classificationResultSchema.safeParse(validOutput);
      expect(result.success).toBe(true);
    });

    it("should reject hallucinated or invalid categories", () => {
      const hallucinated = {
        category: "FOOD_SERVICES", // Invalid category
        urgency: "LOW",
        confidence: 0.8,
        reasoning: "User wants lunch.",
        suggestedAction: "Order pizza.",
      };

      const result = classificationResultSchema.safeParse(hallucinated);
      expect(result.success).toBe(false);
    });

    it("should reject out-of-range confidence scores", () => {
      const invalidConfidence = {
        category: "SOFTWARE",
        urgency: "MEDIUM",
        confidence: 1.5, // Exceeds max 1.0
        reasoning: "Valid reasoning.",
        suggestedAction: "Valid action.",
      };

      const result = classificationResultSchema.safeParse(invalidConfidence);
      expect(result.success).toBe(false);
    });
  });
});
