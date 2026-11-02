import { ticketInputSchema, type TicketInput } from "../schemas/ticketSchema.js";
import {
  classificationResultSchema,
  type ClassificationResult,
} from "../schemas/classificationSchema.js";
import { buildClassifierPrompt } from "../prompts/classifierPrompt.js";
import type { IGeminiClient } from "../clients/geminiClient.js";
import { assessActionSafety } from "./actionSafetyGuardrail.js";

export interface ClassifierServiceOptions {
  client: IGeminiClient;
}

/**
 * Core Ticket Classification Orchestrator.
 * Coordinates input validation, prompt construction, LLM execution,
 * schema parsing, and action safety guardrails with defensive fallback behavior.
 */
export class ClassifierService {
  private client: IGeminiClient;

  constructor(options: ClassifierServiceOptions) {
    this.client = options.client;
  }

  /**
   * Classifies an incoming support ticket.
   *
   * @param rawTicket - Untrusted raw ticket data
   * @returns Validated, strongly-typed classification result
   */
  async classifyTicket(rawTicket: unknown): Promise<ClassificationResult> {
    // 1. Ingestion Boundary: Validate and sanitize untrusted input
    const ticket: TicketInput = ticketInputSchema.parse(rawTicket);

    // 2. Prompt Boundary: Construct injection-defended prompt
    const prompt = buildClassifierPrompt(ticket);

    try {
      // 3. Client Boundary: Invoke LLM adapter
      const rawResponse = await this.client.generateClassification(prompt);

      // 4. Egress Boundary: Runtime schema verification
      const parseResult = classificationResultSchema.safeParse(rawResponse);

      if (parseResult.success) {
        // 5. Action Safety Boundary: Inspect both suggested action and reasoning for dangerous patterns
        const actionAndReasoning = `${parseResult.data.suggestedAction} ${parseResult.data.reasoning}`;
        const safety = assessActionSafety(actionAndReasoning);
        if (!safety.isSafe) {
          console.warn(
            `[ClassifierService] Unsafe remediation blocked: ${safety.summary}`
          );
          return {
            ...parseResult.data,
            suggestedAction: `[BLOCKED UNSAFE ACTION: ${safety.violations[0]}] Route to IT Security team for manual review.`,
            safetyWarning: `Blocked high-risk patterns: ${safety.violations.join("; ")}`,
            isFallback: false,
          };
        }
        return parseResult.data;
      }

      // If the LLM returned JSON that does not adhere to the contract:
      console.warn(
        `[ClassifierService] LLM output contract violation: ${parseResult.error.message}`
      );
      return this.createFallbackResult(
        `LLM response contract violation: ${parseResult.error.issues.map((i) => i.message).join(", ")}`
      );
    } catch (error) {
      // If the provider fails or network fails:
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[ClassifierService] Classification provider failure: ${message}`);
      return this.createFallbackResult(`Automated classification failed: ${message}`);
    }
  }

  /**
   * Safe fallback ensuring that downstream systems always receive a valid ClassificationResult
   * even during upstream LLM outages or malformed outputs.
   */
  private createFallbackResult(reason: string): ClassificationResult {
    return {
      category: "OTHER",
      urgency: "MEDIUM",
      confidence: 0,
      reasoning: reason.slice(0, 300),
      suggestedAction: "Route to IT Tier 1 manual triage queue.",
      isFallback: true,
    };
  }
}
