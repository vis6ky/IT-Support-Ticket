import { z } from "zod";
import { Type, type Schema } from "@google/genai";
import { TicketCategoryEnum, TicketUrgencyEnum } from "./classificationSchema.js";

/**
 * Strong runtime contract for the Grounded Copilot Resolution.
 * Guarantees that every resolution includes verified steps, explicit citations,
 * grounding status, and safety metadata.
 */
export const CopilotResponseSchema = z.object({
  ticketId: z.string().min(1, "Ticket ID is required"),
  category: TicketCategoryEnum,
  urgency: TicketUrgencyEnum,
  summary: z.string().min(5).max(300),
  resolutionSteps: z
    .array(z.string().min(3))
    .min(1, "At least one resolution step must be provided"),
  citations: z.array(z.string()).default([]),
  groundedInRunbooks: z.boolean(),
  isFallback: z.boolean().default(false),
  safetyWarning: z.string().optional(),
});

export type CopilotResponse = z.infer<typeof CopilotResponseSchema>;

/**
 * Native Gemini Response Schema for structured token generation.
 */
export const geminiCopilotResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    ticketId: {
      type: Type.STRING,
      description: "Identifier of the support ticket being resolved",
    },
    category: {
      type: Type.STRING,
      enum: ["HARDWARE", "SOFTWARE", "ACCESS_AND_IDENTITY", "NETWORK", "OTHER"],
      description: "Assigned technical domain",
    },
    urgency: {
      type: Type.STRING,
      enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
      description: "Assessed business urgency level",
    },
    summary: {
      type: Type.STRING,
      description: "One-sentence diagnosis and summary of the resolution",
    },
    resolutionSteps: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
      },
      description: "Ordered, numbered technical actions the user or technician should take",
    },
    citations: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
      },
      description: "List of chunk IDs or document IDs cited in the resolution (e.g. ['KB-VPN-001#chunk-0'])",
    },
    groundedInRunbooks: {
      type: Type.BOOLEAN,
      description: "True if resolution steps are derived from the provided knowledge base; false if escalated",
    },
  },
  required: [
    "ticketId",
    "category",
    "urgency",
    "summary",
    "resolutionSteps",
    "citations",
    "groundedInRunbooks",
  ],
};
