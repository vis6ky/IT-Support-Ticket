import { z } from "zod";

/**
 * Inbound Support Ticket Schema.
 * Enforces input boundary sanitization, preventing denial-of-service via token exhaustion
 * and rejecting null bytes or empty inputs.
 */
export const ticketInputSchema = z.object({
  id: z.string().min(1, "Ticket ID is required"),
  title: z
    .string()
    .trim()
    .min(3, "Title must be at least 3 characters")
    .max(200, "Title cannot exceed 200 characters")
    .transform((str) => str.replace(/\0/g, "")), // Strip null bytes
  description: z
    .string()
    .trim()
    .min(5, "Description must be at least 5 characters")
    .max(4000, "Description cannot exceed 4000 characters") // Guard against oversized prompts
    .transform((str) => str.replace(/\0/g, "")),
  senderEmail: z.string().email("Invalid sender email format").optional(),
  submittedAt: z.string().datetime().optional().default(() => new Date().toISOString()),
});

export type TicketInput = z.infer<typeof ticketInputSchema>;
export type TicketRawInput = z.input<typeof ticketInputSchema>;
