import { describe, it, expect, beforeAll } from "vitest";
import { FICTIONAL_RUNBOOKS } from "../src/data/knowledgeBase.js";
import { chunkDocument } from "../src/services/chunkingService.js";
import { BM25SearchService } from "../src/services/bm25SearchService.js";
import { VectorSearchService } from "../src/services/vectorSearchService.js";
import { MockEmbeddingClient } from "../src/clients/embeddingClient.js";
import { HybridSearchService } from "../src/services/hybridSearchService.js";
import type { Chunk } from "../src/schemas/documentSchema.js";

describe("Hybrid Search Engine (Reciprocal Rank Fusion)", () => {
  let allChunks: Chunk[];
  let bm25Service: BM25SearchService;
  let vectorService: VectorSearchService;
  let hybridService: HybridSearchService;

  beforeAll(async () => {
    // 1. Chunk all 8 fictional runbooks
    allChunks = FICTIONAL_RUNBOOKS.flatMap((doc) =>
      chunkDocument(doc, { maxChunkSize: 350, overlap: 60 })
    );

    // 2. Initialize BM25 lexical engine
    bm25Service = new BM25SearchService(allChunks);

    // 3. Initialize Dense Vector engine with deterministic MockEmbeddingClient
    const embeddingClient = new MockEmbeddingClient(16);
    vectorService = new VectorSearchService(embeddingClient);
    await vectorService.indexChunks(allChunks);

    // 4. Initialize Hybrid Search Service
    hybridService = new HybridSearchService(bm25Service, vectorService);
  });

  // =========================================================================
  // 1. Consensus Promotion (RRF Synergy)
  // =========================================================================
  describe("RRF Consensus Promotion", () => {
    it("should compute accurate RRF score and boost items found by both engines", async () => {
      // Query with both technical code and conceptual terms
      const query = "GlobalProtect VPN connection troubleshooting";
      const results = await hybridService.search(query, { topK: 3 });

      expect(results.length).toBeGreaterThan(0);
      const topResult = results[0];

      // Verifies top result is the VPN runbook
      expect(topResult.chunk.documentId).toBe("KB-VPN-001");
      expect(topResult.lexicalRank).not.toBeNull();
      expect(topResult.vectorRank).not.toBeNull();

      // Theoretical check of RRF math:
      // Score = 1 / (60 + lexicalRank) + 1 / (60 + vectorRank)
      const expectedScore =
        1 / (60 + (topResult.lexicalRank ?? 0)) +
        1 / (60 + (topResult.vectorRank ?? 0));

      expect(topResult.score).toBeCloseTo(expectedScore, 5);
      expect(topResult.matchedTerms.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 2. Exact Code Recovery (Lexical Engine Dominance)
  // =========================================================================
  describe("Exact Code Recovery", () => {
    it("should successfully recover KB-NET-004 for exact code '802.1X' via lexical channel", async () => {
      const results = await hybridService.search("802.1X Wi-Fi certificate", {
        topK: 3,
      });

      expect(results.length).toBeGreaterThan(0);
      const targetResult = results.find((r) => r.chunk.documentId === "KB-NET-004");

      expect(targetResult).toBeDefined();
      expect(targetResult?.lexicalRank).toBe(1); // BM25 captured exact code at rank 1
      expect(targetResult?.matchedTerms).toContain("802.1x");
    });
  });

  // =========================================================================
  // 3. Semantic Concept Recovery (Dense Vector Engine Dominance)
  // =========================================================================
  describe("Semantic Concept Recovery", () => {
    it("should successfully recover KB-HW-003 for conceptual query with zero exact token match", async () => {
      // "portable machine display is completely dark" has NO exact token overlap with "laptop screen"
      const results = await hybridService.search("portable machine display is completely dark", {
        topK: 3,
      });

      expect(results.length).toBeGreaterThan(0);
      const topResult = results[0];

      // Vector engine carries the retrieval despite lexical engine returning null
      expect(topResult.chunk.documentId).toBe("KB-HW-003");
      expect(topResult.chunk.category).toBe("HARDWARE");
      expect(topResult.vectorRank).toBe(1);
    });
  });

  // =========================================================================
  // 4. Weighted RRF
  // =========================================================================
  describe("Weighted RRF Tuning", () => {
    it("should alter relative scoring when custom weights are provided", async () => {
      const query = "Slack guest channel access";

      const unweighted = await hybridService.search(query, {
        topK: 3,
        lexicalWeight: 1.0,
        vectorWeight: 1.0,
      });

      const lexicalBiased = await hybridService.search(query, {
        topK: 3,
        lexicalWeight: 3.0,
        vectorWeight: 1.0,
      });

      expect(lexicalBiased[0].score).toBeGreaterThan(unweighted[0].score);
    });
  });

  // =========================================================================
  // 5. Category Filtering & Top-K Slicing
  // =========================================================================
  describe("Filtering & Limits", () => {
    it("should restrict hybrid results strictly to the specified category", async () => {
      const results = await hybridService.search("reset password access", {
        topK: 5,
        filterCategory: "ACCESS_AND_IDENTITY",
      });

      expect(results.length).toBeGreaterThan(0);
      for (const res of results) {
        expect(res.chunk.category).toBe("ACCESS_AND_IDENTITY");
      }
    });

    it("should strictly respect requested topK count", async () => {
      const results = await hybridService.search("corporate policy guidelines", {
        topK: 2,
      });
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  // =========================================================================
  // 6. Empty Queries & Unknown Terms
  // =========================================================================
  describe("Empty and No-Match Edge Cases", () => {
    it("should return empty array for empty query string", async () => {
      const results = await hybridService.search("");
      expect(results).toEqual([]);
    });

    it("should return empty array for whitespace only", async () => {
      const results = await hybridService.search("   \t\n  ");
      expect(results).toEqual([]);
    });

    it("should return empty array for query with minScore exceeding maximum possible RRF", async () => {
      const results = await hybridService.search("printer queue", {
        minScore: 10.0, // RRF scores are typically < 0.1
      });
      expect(results).toEqual([]);
    });
  });

  // =========================================================================
  // 7. Deterministic Tie-Breaking
  // =========================================================================
  describe("Deterministic Tie-Breaking", () => {
    it("should break exact RRF score ties deterministically by documentId and chunkIndex", async () => {
      const chunkA: Chunk = {
        chunkId: "KB-AAA#chunk-0",
        documentId: "KB-AAA",
        documentTitle: "Doc A",
        source: "source-a",
        category: "OTHER",
        content: "Alpha test content.",
        chunkIndex: 0,
        totalChunks: 1,
        metadata: { source: "source-a", category: "OTHER", tags: [] },
      };

      const chunkZ: Chunk = {
        chunkId: "KB-ZZZ#chunk-0",
        documentId: "KB-ZZZ",
        documentTitle: "Doc Z",
        source: "source-z",
        category: "OTHER",
        content: "Omega test content.",
        chunkIndex: 0,
        totalChunks: 1,
        metadata: { source: "source-z", category: "OTHER", tags: [] },
      };

      // Mock rankers to produce symmetric rank positions:
      // BM25: Rank 1 = Z, Rank 2 = A
      // Vector: Rank 1 = A, Rank 2 = Z
      // Both chunks receive mathematically IDENTICAL RRF score: 1/(60+1) + 1/(60+2)
      const mockBM25 = {
        search: () => [
          { chunk: chunkZ, score: 5.0, matchedTerms: ["test"] },
          { chunk: chunkA, score: 4.0, matchedTerms: ["test"] },
        ],
      } as unknown as BM25SearchService;

      const mockVector = {
        search: () =>
          Promise.resolve([
            { chunk: chunkA, score: 0.95 },
            { chunk: chunkZ, score: 0.85 },
          ]),
      } as unknown as VectorSearchService;

      const tieService = new HybridSearchService(mockBM25, mockVector);
      const results = await tieService.search("test", { topK: 2 });

      expect(results.length).toBe(2);
      // Verify exact numerical equality of RRF scores
      expect(results[0].score).toBe(results[1].score);

      // Deterministic tie-breaker: KB-AAA must sort before KB-ZZZ
      expect(results[0].chunk.documentId).toBe("KB-AAA");
      expect(results[1].chunk.documentId).toBe("KB-ZZZ");
    });
  });

  // =========================================================================
  // 8. Evaluation Benchmark Suite (Recall@K and MRR)
  // =========================================================================
  describe("Hybrid Search Evaluation Benchmark (Recall@K & MRR)", () => {
    const EVALUATION_DATASET = [
      {
        queryId: "Q1",
        query: "GlobalProtect gateway unreachable error in US-East",
        expectedDocId: "KB-VPN-001",
      },
      {
        queryId: "Q2",
        query: "Okta verify phone wiped need MFA token reset",
        expectedDocId: "KB-AUTH-002",
      },
      {
        queryId: "Q3",
        query: "ThinkPad T14 laptop battery swollen replacement",
        expectedDocId: "KB-HW-003",
      },
      {
        queryId: "Q4",
        query: "CorpSecure Wi-Fi 802.1X certificate rejected",
        expectedDocId: "KB-NET-004",
      },
      {
        queryId: "Q5",
        query: "Slack guest invitation for multi-channel external contractor",
        expectedDocId: "KB-SOFT-005",
      },
      {
        queryId: "Q6",
        query: "Suspicious phishing email reporting button Outlook",
        expectedDocId: "KB-SEC-006",
      },
      {
        queryId: "Q7",
        query: "FollowMe cloud badge tap print queue spooler",
        expectedDocId: "KB-PRINT-007",
      },
      {
        queryId: "Q8",
        query: "Google Workspace drive pooled storage quota 100 GB",
        expectedDocId: "KB-DATA-008",
      },
    ];

    it("should achieve high Recall@1, 100% Recall@3, and strong MRR across the benchmark dataset", async () => {
      let hitsAt1 = 0;
      let hitsAt3 = 0;
      let reciprocalRankSum = 0;

      for (const item of EVALUATION_DATASET) {
        const results = await hybridService.search(item.query, { topK: 3 });

        const rankIndex = results.findIndex(
          (r) => r.chunk.documentId === item.expectedDocId
        );

        if (rankIndex === 0) {
          hitsAt1++;
        }
        if (rankIndex >= 0 && rankIndex < 3) {
          hitsAt3++;
          reciprocalRankSum += 1 / (rankIndex + 1);
        }
      }

      const totalQueries = EVALUATION_DATASET.length;
      const recallAt1 = hitsAt1 / totalQueries;
      const recallAt3 = hitsAt3 / totalQueries;
      const mrr = reciprocalRankSum / totalQueries;

      console.log("==========================================");
      console.log("  🚀 Hybrid Search (RRF) Benchmark       ");
      console.log("==========================================");
      console.log(`  Total Evaluation Queries: ${totalQueries}`);
      console.log(`  Recall@1:                 ${(recallAt1 * 100).toFixed(1)}%`);
      console.log(`  Recall@3:                 ${(recallAt3 * 100).toFixed(1)}%`);
      console.log(`  Mean Reciprocal Rank:     ${mrr.toFixed(3)}`);
      console.log("==========================================");

      expect(recallAt1).toBeGreaterThanOrEqual(0.85); // At least 85% at rank 1
      expect(recallAt3).toBe(1.0);                   // 100% in top 3
      expect(mrr).toBeGreaterThanOrEqual(0.90);       // High Mean Reciprocal Rank
    });
  });
});
