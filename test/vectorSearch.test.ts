import { describe, it, expect, beforeAll } from "vitest";
import {
  dotProduct,
  magnitude,
  normalizeVector,
  cosineSimilarity,
} from "../src/services/vectorMath.js";
import { MockEmbeddingClient } from "../src/clients/embeddingClient.js";
import { VectorSearchService } from "../src/services/vectorSearchService.js";
import { FICTIONAL_RUNBOOKS } from "../src/data/knowledgeBase.js";
import { chunkDocument } from "../src/services/chunkingService.js";
import type { Chunk } from "../src/schemas/documentSchema.js";

describe("Dense Vector Embeddings & Vector Search", () => {
  // =========================================================================
  // 1. Vector Math Utilities
  // =========================================================================
  describe("VectorMath Utilities", () => {
    it("should compute accurate dot product", () => {
      const a = [1, 2, 3];
      const b = [4, 5, 6];
      // 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
      expect(dotProduct(a, b)).toBe(32);
    });

    it("should throw error on dimension mismatch for dot product", () => {
      expect(() => dotProduct([1, 2], [1, 2, 3])).toThrow(/Dimension mismatch/);
    });

    it("should compute accurate Euclidean magnitude", () => {
      const v = [3, 4]; // 3^2 + 4^2 = 25 -> sqrt(25) = 5
      expect(magnitude(v)).toBe(5);
    });

    it("should normalize a vector to unit length (L2 norm = 1.0)", () => {
      const v = [3, 4];
      const normalized = normalizeVector(v);
      expect(normalized[0]).toBeCloseTo(0.6, 5);
      expect(normalized[1]).toBeCloseTo(0.8, 5);
      expect(magnitude(normalized)).toBeCloseTo(1.0, 5);
    });

    it("should handle zero vectors safely during normalization without NaN", () => {
      const zeroVec = [0, 0, 0];
      const normalized = normalizeVector(zeroVec);
      expect(normalized).toEqual([0, 0, 0]);
      expect(Number.isNaN(normalized[0])).toBe(false);
    });

    it("should compute correct cosine similarity values across fundamental geometric relations", () => {
      const v1 = [1, 0, 0];
      const v2 = [1, 0, 0]; // Identical direction
      const vOrthogonal = [0, 1, 0]; // Perpendicular (90 deg)
      const vOpposite = [-1, 0, 0]; // 180 deg opposite

      expect(cosineSimilarity(v1, v2)).toBeCloseTo(1.0, 5);
      expect(cosineSimilarity(v1, vOrthogonal)).toBeCloseTo(0.0, 5);
      expect(cosineSimilarity(v1, vOpposite)).toBeCloseTo(-1.0, 5);
    });

    it("should return 0.0 defensively when one vector is a zero vector", () => {
      const vNormal = [1, 2, 3];
      const vZero = [0, 0, 0];
      expect(cosineSimilarity(vNormal, vZero)).toBe(0.0);
      expect(cosineSimilarity(vZero, vZero)).toBe(0.0);
    });

    it("should throw error on dimension mismatch for cosine similarity", () => {
      expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/Dimension mismatch/);
    });
  });

  // =========================================================================
  // 2. Mock Embedding Client
  // =========================================================================
  describe("MockEmbeddingClient", () => {
    const embeddingClient = new MockEmbeddingClient(16);

    it("should produce unit-normalized vectors with expected dimensions", async () => {
      const vec = await embeddingClient.embedText("Laptop battery is swelling and defective.");

      expect(vec.length).toBe(16);
      expect(embeddingClient.getDimensions()).toBe(16);
      expect(magnitude(vec)).toBeCloseTo(1.0, 4);
    });

    it("should produce deterministic, reproducible vectors for identical input", async () => {
      const text = "Okta Verify push notification failed.";
      const run1 = await embeddingClient.embedText(text);
      const run2 = await embeddingClient.embedText(text);

      expect(run1).toEqual(run2);
    });

    it("should embed batches with consistent dimensionality", async () => {
      const batch = [
        "First test document",
        "Second test document",
        "Third test document",
      ];
      const vectors = await embeddingClient.embedBatch(batch);

      expect(vectors.length).toBe(3);
      vectors.forEach((v) => {
        expect(v.length).toBe(16);
        expect(magnitude(v)).toBeCloseTo(1.0, 4);
      });
    });

    it("should yield high similarity between semantically related words", async () => {
      const vecLaptop = await embeddingClient.embedText("laptop computer notebook");
      const vecScreen = await embeddingClient.embedText("machine display screen");
      const vecVpn = await embeddingClient.embedText("vpn network gateway");

      const simHardware = cosineSimilarity(vecLaptop, vecScreen);
      const simCrossDomain = cosineSimilarity(vecLaptop, vecVpn);

      // Laptop and Screen both share the hardware sector (dims 0..3)
      // VPN belongs to network sector (dims 4..7)
      expect(simHardware).toBeGreaterThan(simCrossDomain);
      expect(simHardware).toBeGreaterThan(0.6);
    });
  });

  // =========================================================================
  // 3. Vector Search Service
  // =========================================================================
  describe("VectorSearchService", () => {
    let searchService: VectorSearchService;
    let mockClient: MockEmbeddingClient;

    beforeAll(async () => {
      mockClient = new MockEmbeddingClient(16);
      searchService = new VectorSearchService(mockClient);

      // Chunk all 8 fictional runbooks and index them in the vector service
      const chunks = FICTIONAL_RUNBOOKS.flatMap((doc) =>
        chunkDocument(doc, { maxChunkSize: 350, overlap: 60 })
      );
      await searchService.indexChunks(chunks);
    });

    it("should correctly report total indexed chunk count", () => {
      expect(searchService.getIndexedCount()).toBeGreaterThan(10);
    });

    it("should retrieve relevant runbook (KB-HW-003) despite vocabulary mismatch", async () => {
      // Query uses "portable machine display dark" - NO exact word match with "laptop screen"
      const results = await searchService.search("portable machine display is completely dark", {
        topK: 3,
      });

      expect(results.length).toBeGreaterThan(0);
      const topResult = results[0];

      // Verifies semantic alignment with hardware lifecycle runbook
      expect(topResult.chunk.documentId).toBe("KB-HW-003");
      expect(topResult.chunk.category).toBe("HARDWARE");
      expect(topResult.score).toBeGreaterThan(0.5);
    });

    it("should return empty array for empty or whitespace query", async () => {
      const results = await searchService.search("   ");
      expect(results).toEqual([]);
    });

    it("should strictly respect topK parameter", async () => {
      const results = await searchService.search("connection problem with gateway", {
        topK: 2,
      });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("should filter results by category when filterCategory is provided", async () => {
      const results = await searchService.search("credentials login access", {
        topK: 5,
        filterCategory: "ACCESS_AND_IDENTITY",
      });

      expect(results.length).toBeGreaterThan(0);
      results.forEach((res) => {
        expect(res.chunk.category).toBe("ACCESS_AND_IDENTITY");
      });
    });

    it("should preserve complete document and chunk metadata in search results", async () => {
      const results = await searchService.search("wifi network connection", { topK: 1 });

      expect(results.length).toBe(1);
      const res = results[0];

      expect(res.chunk.chunkId).toBeDefined();
      expect(res.chunk.documentId).toBeDefined();
      expect(res.chunk.documentTitle).toBeDefined();
      expect(res.chunk.source).toBeDefined();
      expect(res.chunk.category).toBeDefined();
      expect(res.chunk.chunkIndex).toBeGreaterThanOrEqual(0);
      expect(res.chunk.totalChunks).toBeGreaterThan(0);
      expect(res.score).toBeGreaterThan(-1.0);
      expect(res.score).toBeLessThanOrEqual(1.0);
    });

    it("should break exact similarity ties deterministically", async () => {
      // Create synthetic chunks with identical content to force exact vector tie
      const identicalChunks: Chunk[] = [
        {
          chunkId: "KB-ZZZ#chunk-0",
          documentId: "KB-ZZZ",
          documentTitle: "Doc Z",
          source: "source-z",
          category: "OTHER",
          content: "Identical semantic content for tie break.",
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
          content: "Identical semantic content for tie break.",
          chunkIndex: 0,
          totalChunks: 1,
          metadata: { source: "source-a", category: "OTHER", tags: [] },
        },
      ];

      const tieService = new VectorSearchService(mockClient);
      await tieService.indexChunks(identicalChunks);

      const results = await tieService.search("Identical semantic content for tie break.", {
        topK: 2,
      });

      expect(results.length).toBe(2);
      expect(results[0].score).toBeCloseTo(results[1].score, 4);

      // Deterministic tie-breaker: KB-AAA sorts before KB-ZZZ
      expect(results[0].chunk.documentId).toBe("KB-AAA");
      expect(results[1].chunk.documentId).toBe("KB-ZZZ");
    });
  });
});
