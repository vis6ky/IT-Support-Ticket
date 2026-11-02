import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { GeminiEmbeddingClient } from "../clients/embeddingClient.js";
import { GeminiClient } from "../clients/geminiClient.js";
import { buildClassifierPrompt } from "../prompts/classifierPrompt.js";
import { classificationResultSchema } from "../schemas/classificationSchema.js";
import { FICTIONAL_RUNBOOKS } from "../data/knowledgeBase.js";
import { chunkDocument } from "../services/chunkingService.js";
import { BM25SearchService } from "../services/bm25SearchService.js";
import { VectorSearchService } from "../services/vectorSearchService.js";
import { HybridSearchService } from "../services/hybridSearchService.js";
import { ClassifierService } from "../services/classifierService.js";
import { CopilotService } from "../services/copilotService.js";

export interface VerificationReport {
  apiKeyDetected: boolean;
  model: string;
  embeddingModel: string;
  embeddingProbe: {
    status: "PASS" | "FAIL" | "SKIPPED";
    latencyMs?: number;
    dimensions?: number;
    error?: string;
  };
  classificationProbe: {
    status: "PASS" | "FAIL" | "SKIPPED";
    latencyMs?: number;
    category?: string;
    error?: string;
  };
  ragProbe: {
    status: "PASS" | "FAIL" | "SKIPPED";
    latencyMs?: number;
    citations?: string[];
    grounded?: boolean;
    error?: string;
  };
}

/**
 * Executes a full live health check and diagnostic probe of Google Gemini API integrations.
 */
export async function runLiveVerification(): Promise<VerificationReport> {
  const config = loadConfig();
  const apiKey = config.GEMINI_API_KEY;

  const isPlaceholderKey =
    !apiKey ||
    apiKey === "your_gemini_api_key_here" ||
    apiKey.startsWith("your_");

  const report: VerificationReport = {
    apiKeyDetected: Boolean(apiKey) && !isPlaceholderKey,
    model: config.GEMINI_MODEL,
    embeddingModel: "text-embedding-004",
    embeddingProbe: { status: "SKIPPED" },
    classificationProbe: { status: "SKIPPED" },
    ragProbe: { status: "SKIPPED" },
  };

  if (isPlaceholderKey) {
    console.log("==================================================");
    console.log("  ⚠️  Live Gemini Verification: Placeholder or No Key");
    console.log("==================================================");
    console.log("Status: OFFLINE (Operating with Mock LLM & Embeddings)");
    console.log("\nTo test with real Google Gemini models:");
    console.log("  1. Replace GEMINI_API_KEY in your .env file with your real key:");
    console.log("     GEMINI_API_KEY=AIzaSyYourActualGeminiApiKey");
    console.log("     (Get a free key from Google AI Studio: https://aistudio.google.com/app/apikey)");
    console.log("  2. Re-run: npm run verify:live");
    console.log("==================================================");
    return report;
  }

  console.log("==================================================");
  console.log("  🔍 Google Gemini Live API Diagnostic Probe     ");
  console.log("==================================================");
  console.log(`API Key:       [DETECTED] ${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`);
  console.log(`LLM Model:     ${config.GEMINI_MODEL}`);
  console.log(`Embeddings:    text-embedding-004 (768 dimensions)\n`);

  // Probe 1: Live Embeddings Probe
  try {
    process.stdout.write("1. Probing text-embedding-004... ");
    const embeddingClient = new GeminiEmbeddingClient(apiKey, "text-embedding-004", 768);
    const start = Date.now();
    const vec = await embeddingClient.embedText("Ping test for semantic embedding vector generation.");
    const latency = Date.now() - start;

    report.embeddingProbe = {
      status: "PASS",
      latencyMs: latency,
      dimensions: vec.length,
    };
    console.log(`\x1b[32mPASS\x1b[0m (${latency}ms, ${vec.length} dims)`);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    report.embeddingProbe = { status: "FAIL", error: errorMsg };
    console.log(`\x1b[31mFAIL\x1b[0m (${errorMsg})`);
  }

  // Probe 2: Live Structured Classification Probe
  try {
    process.stdout.write("2. Probing gemini-2.5-flash classification... ");
    const llmClient = new GeminiClient(apiKey, config.GEMINI_MODEL);
    const testPrompt = buildClassifierPrompt({
      id: "TICK-LIVE-PROBE",
      title: "VPN password reset",
      description: "Cannot connect to Cisco AnyConnect after password reset in Okta.",
      senderEmail: "test@example.com",
      submittedAt: new Date().toISOString(),
    });

    const start = Date.now();
    const rawResult = await llmClient.generateClassification(testPrompt);
    const latency = Date.now() - start;
    const validated = classificationResultSchema.parse(rawResult);

    report.classificationProbe = {
      status: "PASS",
      latencyMs: latency,
      category: validated.category,
    };
    console.log(`\x1b[32mPASS\x1b[0m (${latency}ms, Category: ${validated.category})`);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    report.classificationProbe = { status: "FAIL", error: errorMsg };
    console.log(`\x1b[31mFAIL\x1b[0m (${errorMsg})`);
  }

  // Probe 3: End-to-End Grounded RAG Pipeline
  try {
    process.stdout.write("3. Probing live Grounded RAG pipeline (index + retrieve + generate)... ");
    const embeddingClient = new GeminiEmbeddingClient(apiKey, "text-embedding-004", 768);
    const llmClient = new GeminiClient(apiKey, config.GEMINI_MODEL);

    const allChunks = FICTIONAL_RUNBOOKS.flatMap((doc) =>
      chunkDocument(doc, { maxChunkSize: 350, overlap: 60 })
    );

    const bm25 = new BM25SearchService(allChunks);
    const vectorService = new VectorSearchService(embeddingClient);
    await vectorService.indexChunks(allChunks);

    const hybrid = new HybridSearchService(bm25, vectorService);
    const classifier = new ClassifierService({ client: llmClient });
    const copilot = new CopilotService({
      classifierService: classifier,
      hybridSearchService: hybrid,
      client: llmClient,
    });

    const start = Date.now();
    const resolution = await copilot.resolveTicket({
      id: "TICK-LIVE-RAG",
      title: "Lost phone with Okta Verify",
      description: "Need emergency bypass token for AWS deploy.",
      senderEmail: "dev@corp.internal",
    });
    const latency = Date.now() - start;

    report.ragProbe = {
      status: "PASS",
      latencyMs: latency,
      citations: resolution.citations,
      grounded: resolution.groundedInRunbooks,
    };
    console.log(
      `\x1b[32mPASS\x1b[0m (${latency}ms, Citations: ${resolution.citations.join(", ")})`
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    report.ragProbe = { status: "FAIL", error: errorMsg };
    console.log(`\x1b[31mFAIL\x1b[0m (${errorMsg})`);
  }

  console.log("\n==================================================");
  console.log("  📊 Diagnostic Scorecard                        ");
  console.log("==================================================");
  console.log(`  Embeddings (text-embedding-004): ${formatStatus(report.embeddingProbe.status)} (${report.embeddingProbe.latencyMs ?? 0}ms)`);
  console.log(`  LLM Triage (gemini-2.5-flash):   ${formatStatus(report.classificationProbe.status)} (${report.classificationProbe.latencyMs ?? 0}ms)`);
  console.log(`  Grounded RAG Copilot:            ${formatStatus(report.ragProbe.status)} (${report.ragProbe.latencyMs ?? 0}ms)`);
  console.log("==================================================");

  return report;
}

function formatStatus(status: "PASS" | "FAIL" | "SKIPPED"): string {
  if (status === "PASS") return "\x1b[32m[HEALTHY]\x1b[0m";
  if (status === "FAIL") return "\x1b[31m[FAILED]\x1b[0m";
  return "\x1b[33m[SKIPPED]\x1b[0m";
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  runLiveVerification()
    .then((report) => {
      const anyFail =
        report.embeddingProbe.status === "FAIL" ||
        report.classificationProbe.status === "FAIL" ||
        report.ragProbe.status === "FAIL";
      process.exit(anyFail ? 1 : 0);
    })
    .catch((err) => {
      console.error("[Fatal Verification Error]:", err);
      process.exit(1);
    });
}
