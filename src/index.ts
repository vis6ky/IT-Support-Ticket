import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { ClassifierService } from "./services/classifierService.js";
import { CopilotService } from "./services/copilotService.js";
import { GeminiClient, MockGeminiClient, type IGeminiClient } from "./clients/geminiClient.js";
import { FICTIONAL_RUNBOOKS } from "./data/knowledgeBase.js";
import { chunkDocument } from "./services/chunkingService.js";
import { BM25SearchService } from "./services/bm25SearchService.js";
import { VectorSearchService } from "./services/vectorSearchService.js";
import { MockEmbeddingClient, GeminiEmbeddingClient, type IEmbeddingClient } from "./clients/embeddingClient.js";
import { HybridSearchService } from "./services/hybridSearchService.js";

// Re-export core modules for external/programmatic consumers
export * from "./config.js";
export * from "./schemas/ticketSchema.js";
export * from "./schemas/classificationSchema.js";
export * from "./prompts/classifierPrompt.js";
export * from "./clients/geminiClient.js";
export * from "./services/actionSafetyGuardrail.js";
export * from "./services/classifierService.js";
export * from "./schemas/documentSchema.js";
export * from "./data/knowledgeBase.js";
export * from "./services/chunkingService.js";
export * from "./schemas/searchSchema.js";
export * from "./services/bm25SearchService.js";
export * from "./services/vectorMath.js";
export * from "./clients/embeddingClient.js";
export * from "./services/vectorSearchService.js";
export * from "./services/hybridSearchService.js";
export * from "./schemas/copilotSchema.js";
export * from "./prompts/copilotPrompt.js";
export * from "./services/copilotService.js";
export * from "./server.js";

/**
 * Executable CLI Entry Point.
 * Demonstrates the end-to-end RAG Copilot pipeline:
 * Triage -> Hybrid Retrieval -> Grounded Assembly -> Safety Inspection.
 */
async function main() {
  console.log("==================================================");
  console.log("  🤖 AI IT Support Copilot - Grounded RAG Pipeline ");
  console.log("==================================================");

  const config = loadConfig();
  let llmClient: IGeminiClient;
  let embeddingClient: IEmbeddingClient;

  if (config.GEMINI_API_KEY) {
    console.log(`[Config] Using live GeminiClient (Model: ${config.GEMINI_MODEL})`);
    llmClient = new GeminiClient(config.GEMINI_API_KEY, config.GEMINI_MODEL);
    embeddingClient = new GeminiEmbeddingClient(config.GEMINI_API_KEY);
  } else {
    console.log("[Config] No GEMINI_API_KEY detected in environment.");
    console.log("[Notice] Running demonstration using Mock clients (Zero API costs).");
    console.log("[Notice] To use live Gemini, create a .env file with GEMINI_API_KEY=your_key.\n");
    llmClient = new MockGeminiClient();
    embeddingClient = new MockEmbeddingClient(16);
  }

  // 1. Ingest & chunk knowledge base runbooks
  const allChunks = FICTIONAL_RUNBOOKS.flatMap((doc) =>
    chunkDocument(doc, { maxChunkSize: 350, overlap: 60 })
  );

  // 2. Build retrieval engines with graceful offline fallback
  const bm25Service = new BM25SearchService(allChunks);
  let vectorService = new VectorSearchService(embeddingClient);

  try {
    await vectorService.indexChunks(allChunks);
  } catch (err) {
    console.log("[Notice] Network unreachable for live embeddings. Falling back to Mock clients for demonstration.");
    llmClient = new MockGeminiClient();
    embeddingClient = new MockEmbeddingClient(16);
    vectorService = new VectorSearchService(embeddingClient);
    await vectorService.indexChunks(allChunks);
  }

  const hybridSearchService = new HybridSearchService(bm25Service, vectorService);

  // 3. Assemble services
  const classifierService = new ClassifierService({ client: llmClient });
  const copilotService = new CopilotService({
    classifierService,
    hybridSearchService,
    client: llmClient,
  });

  const sampleTicket = {
    id: "TICK-1042",
    title: "Cannot connect to company VPN after password reset",
    description:
      "I updated my corporate password this morning via Okta. Now Cisco AnyConnect keeps giving 'Authentication Failed' error when trying to connect to the US-East gateway. I am blocked from accessing staging databases.",
    senderEmail: "developer@example.com",
    submittedAt: new Date().toISOString(),
  };

  console.log("Processing Inbound Ticket:");
  console.log(`  ID:          ${sampleTicket.id}`);
  console.log(`  Title:       ${sampleTicket.title}`);
  console.log(`  Sender:      ${sampleTicket.senderEmail}`);
  console.log(`  Description: ${sampleTicket.description}\n`);

  const resolution = await copilotService.resolveTicket(sampleTicket, { topK: 3 });

  console.log("Copilot Resolution:");
  console.log(`  🏷️  Category:   ${resolution.category}`);
  console.log(`  ⚡ Urgency:    ${resolution.urgency}`);
  console.log(`  📖 Grounded:   ${resolution.groundedInRunbooks ? "Yes (Verified in Runbooks)" : "No (Escalated)"}`);
  console.log(`  💡 Summary:    ${resolution.summary}`);
  console.log("  📋 Resolution Steps:");
  resolution.resolutionSteps.forEach((step, idx) => {
    console.log(`     ${idx + 1}. ${step}`);
  });
  if (resolution.citations.length > 0) {
    console.log(`  🔖 Citations:  ${resolution.citations.join(", ")}`);
  }
  if (resolution.safetyWarning) {
    console.log(`  ⚠️  Safety:     ${resolution.safetyWarning}`);
  }
  console.log("==================================================");
}

// Execute only when run directly via Node / tsx, not when imported in test suites
const isDirectRun = Boolean(
  process.argv[1] &&
    (fileURLToPath(import.meta.url) === process.argv[1] ||
      process.argv[1].endsWith("/src/index.ts") ||
      process.argv[1].endsWith("/src/index.js"))
);

if (isDirectRun) {
  main().catch((err) => {
    console.error("[Fatal Error]:", err);
    process.exit(1);
  });
}
