import { z } from "zod";
import { Type, type Schema } from "@google/genai";

export const TicketCategoryEnum = z.enum([
  "HARDWARE",
  "SOFTWARE",
  "ACCESS_AND_IDENTITY",
  "NETWORK",
  "OTHER",
]);

export type TicketCategory = z.infer<typeof TicketCategoryEnum>;

export const TicketUrgencyEnum = z.enum([
  "CRITICAL", // e.g. company-wide outage, VIP security incident
  "HIGH",     // e.g. single user completely blocked on core work
  "MEDIUM",   // e.g. degraded experience, workaround available
  "LOW",      // e.g. general questions, minor cosmetic bug
]);

export type TicketUrgency = z.infer<typeof TicketUrgencyEnum>;

/**
 * Output Classification Contract.
 * Validates the parsed LLM response to guarantee downstream consumer safety.
 * Includes optional safetyWarning populated by application guardrails.
 */
export const classificationResultSchema = z.object({
  category: TicketCategoryEnum,
  urgency: TicketUrgencyEnum,
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(5).max(300),
  suggestedAction: z.string().min(5).max(300),
  safetyWarning: z.string().optional(),
  isFallback: z.boolean().default(false),
});

export type ClassificationResult = z.infer<typeof classificationResultSchema>;

/**
 * Native Gemini Response Schema definition for structured JSON generation.
 * Enforces structured output at the token generation stage.
 */
export const geminiClassificationSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    category: {
      type: Type.STRING,
      enum: ["HARDWARE", "SOFTWARE", "ACCESS_AND_IDENTITY", "NETWORK", "OTHER"],
      description: "Primary department or technical domain for the ticket",
    },
    urgency: {
      type: Type.STRING,
      enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
      description: "Assessed business urgency level",
    },
    confidence: {
      type: Type.NUMBER,
      description: "Confidence score between 0.0 and 1.0",
    },
    reasoning: {
      type: Type.STRING,
      description: "Brief rationale (1-2 sentences) explaining the classification",
    },
    suggestedAction: {
      type: Type.STRING,
      description: "Recommended next operational step or team assignment",
    },
  },
  required: ["category", "urgency", "confidence", "reasoning", "suggestedAction"],
};
