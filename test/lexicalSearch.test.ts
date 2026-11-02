import { describe, it, expect, beforeAll } from "vitest";
import { FICTIONAL_RUNBOOKS } from "../src/data/knowledgeBase.js";
import { chunkDocument } from "../src/services/chunkingService.js";
import { BM25SearchService } from "../src/services/bm25SearchService.js";
import type { Chunk } from "../src/schemas/documentSchema.js";

describe("BM25 Lexical Retrieval Engine", () => {
  let allChunks: Chunk[];
  let searchService: BM25SearchService;

  beforeAll(() => {
    // Ingest and chunk all 8 fictional runbooks
    allChunks = FICTIONAL_RUNBOOKS.flatMap((doc) =>
      chunkDocument(doc, { maxChunkSize: 350, overlap: 60 })
    );
    searchService = new BM25SearchService(allChunks);
  });

  // =========================================================================
  // 1. Exact Term Matching & Relevance Ranking
  // =========================================================================
  describe("Exact Term Matching & Relevance Ranking", () => {
    it("should retrieve KB-NET-004 as rank 1 for exact technical term 802.1X", () => {
      const results = searchService.search("802.1X wireless certificate", { topK: 3 });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].chunk.documentId).toBe("KB-NET-004");
      expect(results[0].chunk.documentTitle).toContain("Office Wi-Fi");
      expect(results[0].matchedTerms).toContain("802.1x");
      expect(results[0].score).toBeGreaterThan(0);
    });

    it("should retrieve KB-VPN-001 as rank 1 for specific gateway hostname", () => {
      const results = searchService.search("gw-useast.corp.internal unreachable", { topK: 3 });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].chunk.documentId).toBe("KB-VPN-001");
      expect(results[0].matchedTerms).toContain("gw-useast.corp.internal");
    });
  });

  // =========================================================================
  // 2. Term Frequency Scaling
  // =========================================================================
  describe("Term Frequency Scaling", () => {
    it("should score chunks with multiple term occurrences higher than single occurrences", () => {
      // Synthetic chunks to isolate term frequency effect
      const syntheticChunks: Chunk[] = [
        {
          chunkId: "SYNTH-01#chunk-0",
          documentId: "SYNTH-01",
          documentTitle: "Single Mention",
          source: "wiki.corp.internal/test1",
          category: "SOFTWARE",
          content: "The user has reported an issue with the printer spooler driver.",
          chunkIndex: 0,
          totalChunks: 1,
          metadata: { source: "test1", category: "SOFTWARE", tags: [] },
        },
        {
          chunkId: "SYNTH-02#chunk-0",
          documentId: "SYNTH-02",
          documentTitle: "Triple Mention",
          source: "wiki.corp.internal/test2",
          category: "SOFTWARE",
          content: "The printer queue failed. Restart the printer daemon and check printer status.",
          chunkIndex: 0,
          totalChunks: 1,
          metadata: { source: "test2", category: "SOFTWARE", tags: [] },
        },
      ];

      const testService = new BM25SearchService(syntheticChunks);
      const results = testService.search("printer", { topK: 2 });

      expect(results.length).toBe(2);
      // SYNTH-02 has 3 occurrences of 'printer' vs 1 in SYNTH-01
      expect(results[0].chunk.documentId).toBe("SYNTH-02");
      expect(results[1].chunk.documentId).toBe("SYNTH-01");
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });
  });

  // =========================================================================
  // 3. Punctuation & Case Normalization
  // =========================================================================
  describe("Punctuation & Case Normalization", () => {
    it("should produce identical matched terms and top result regardless of case or punctuation", () => {
      const queryLower = "okta verify mfa reset";
      const queryUpper = "OKTA VERIFY MFA RESET!!!";
      const queryMixed = "Okta, 'Verify'? (MFA: Reset.)";

      const resLower = searchService.search(queryLower, { topK: 1 });
      const resUpper = searchService.search(queryUpper, { topK: 1 });
      const resMixed = searchService.search(queryMixed, { topK: 1 });

      expect(resLower[0].chunk.chunkId).toBe(resUpper[0].chunk.chunkId);
      expect(resLower[0].chunk.chunkId).toBe(resMixed[0].chunk.chunkId);
      expect(resLower[0].score).toBeCloseTo(resUpper[0].score, 4);
    });
  });

  // =========================================================================
  // 4. Empty Queries & Unknown Terms
  // =========================================================================
  describe("Empty Queries & No-Match Handling", () => {
    it("should return an empty array for an empty query string", () => {
      const results = searchService.search("");
      expect(results).toEqual([]);
    });

    it("should return an empty array for whitespace and punctuation only", () => {
      const results = searchService.search("   !?? ,, --  ");
      expect(results).toEqual([]);
    });

    it("should return an empty array when no query terms exist in the corpus", () => {
      const results = searchService.search("supercalifragilisticexpialidocious99999");
      expect(results).toEqual([]);
    });
  });

  // =========================================================================
  // 5. Top-K Limiting & Score Thresholds
  // =========================================================================
  describe("Top-K Limiting and MinScore Filtering", () => {
    it("should limit results strictly to requested topK", () => {
      const results = searchService.search("network error", { topK: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("should filter out results below minScore", () => {
      const allResults = searchService.search("network", { topK: 10 });
      if (allResults.length > 1) {
        const highestScore = allResults[0].score;
        const filtered = searchService.search("network", {
          topK: 10,
          minScore: highestScore + 1.0, // Set threshold above max score
        });
        expect(filtered.length).toBe(0);
      }
    });

    it("should filter results by category when filterCategory is provided", () => {
      const results = searchService.search("password reset credentials", {
        topK: 5,
        filterCategory: "ACCESS_AND_IDENTITY",
      });

      expect(results.length).toBeGreaterThan(0);
      results.forEach((res) => {
        expect(res.chunk.category).toBe("ACCESS_AND_IDENTITY");
      });
    });
  });

  // =========================================================================
  // 6. Deterministic Tie-Breaking
  // =========================================================================
  describe("Deterministic Tie-Breaking", () => {
    it("should break exact score ties deterministically by documentId and chunkIndex", () => {
      // Synthetic chunks with identical content to force exact score tie
      const identicalChunks: Chunk[] = [
        {
          chunkId: "KB-ZZZ#chunk-0",
          documentId: "KB-ZZZ",
          documentTitle: "Doc Z",
          source: "source-z",
          category: "OTHER",
          content: "Identical unique keyword match.",
          chunkIndex: 0,
          totalChunks: 1,
          metadata: { source: "source-z", category: "OTHER", tags: [] },
        },
        {
          chunkId: "KB-AAA#chunk-0",
          documentId: "KB-AAA",
          documentTitle: "Doc A",
          source: "source-a",
          category: "OTHER",
          content: "Identical unique keyword match.",
          chunkIndex: 0,
          totalChunks: 1,
          metadata: { source: "source-a", category: "OTHER", tags: [] },
        },
      ];

      const testService = new BM25SearchService(identicalChunks);
      const results1 = testService.search("unique", { topK: 2 });
      const results2 = testService.search("unique", { topK: 2 });

      expect(results1.length).toBe(2);
      expect(results1[0].score).toBe(results1[1].score);

      // Tie-breaker: KB-AAA must sort before KB-ZZZ
      expect(results1[0].chunk.documentId).toBe("KB-AAA");
      expect(results1[1].chunk.documentId).toBe("KB-ZZZ");

      // Verify stability across runs
      expect(results1[0].chunk.chunkId).toBe(results2[0].chunk.chunkId);
      expect(results1[1].chunk.chunkId).toBe(results2[1].chunk.chunkId);
    });
  });

  // =========================================================================
  // 7. Metadata Lineage Preservation
  // =========================================================================
  describe("Metadata Lineage", () => {
    it("should preserve complete document and chunk metadata in search results", () => {
      const results = searchService.search("phishing email reporting outlook", { topK: 1 });

      expect(results.length).toBe(1);
      const item = results[0];

      expect(item.chunk.chunkId).toBeDefined();
      expect(item.chunk.documentId).toBe("KB-SEC-006");
      expect(item.chunk.documentTitle).toBe("Phishing Incident Reporting & Suspicious Email Quarantine");
      expect(item.chunk.source).toBe("wiki.corp.internal/it/security/phishing-reporting");
      expect(item.chunk.category).toBe("ACCESS_AND_IDENTITY");
      expect(item.chunk.chunkIndex).toBeGreaterThanOrEqual(0);
      expect(item.chunk.totalChunks).toBeGreaterThan(0);
      expect(item.matchedTerms.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 8. Retrieval Evaluation Dataset: Recall@K and MRR Benchmark
  // =========================================================================
  describe("Retrieval Evaluation Benchmark (Recall@K and MRR)", () => {
    interface EvaluationQuery {
      queryId: string;
      query: string;
      expectedDocId: string;
    }

    const EVALUATION_DATASET: EvaluationQuery[] = [
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

    it("should achieve high Recall@1, Recall@3, and MRR on the benchmark dataset", () => {
      let hitsAt1 = 0;
      let hitsAt3 = 0;
      let reciprocalRankSum = 0;

      for (const evalItem of EVALUATION_DATASET) {
        const results = searchService.search(evalItem.query, { topK: 3 });

        // Find the rank (1-based index) of the expected document
        const rankIndex = results.findIndex(
          (res) => res.chunk.documentId === evalItem.expectedDocId
        );

        if (rankIndex === 0) {
          hitsAt1++;
        }
        if (rankIndex >= 0 && rankIndex < 3) {
          hitsAt3++;
          reciprocalRankSum += 1 / (rankIndex + 1);
        } else {
          // If not found in top 3, reciprocal rank is 0
          reciprocalRankSum += 0;
        }
      }

      const totalQueries = EVALUATION_DATASET.length;
      const recallAt1 = hitsAt1 / totalQueries;
      const recallAt3 = hitsAt3 / totalQueries;
      const mrr = reciprocalRankSum / totalQueries;

      console.log("==========================================");
      console.log("  📊 BM25 Retrieval Evaluation Metrics   ");
      console.log("==========================================");
      console.log(`  Total Evaluation Queries: ${totalQueries}`);
      console.log(`  Recall@1:                 ${(recallAt1 * 100).toFixed(1)}%`);
      console.log(`  Recall@3:                 ${(recallAt3 * 100).toFixed(1)}%`);
      console.log(`  Mean Reciprocal Rank:     ${mrr.toFixed(3)}`);
      console.log("==========================================");

      // Verification assertions for baseline quality
      expect(recallAt1).toBeGreaterThanOrEqual(0.75); // At least 75% at rank 1
      expect(recallAt3).toBe(1.0);                   // 100% in top 3
      expect(mrr).toBeGreaterThanOrEqual(0.85);       // Mean Reciprocal Rank >= 0.85
    });
  });
});
