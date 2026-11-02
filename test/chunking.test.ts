import { describe, it, expect } from "vitest";
import {
  DocumentSchema,
  ChunkOptionsSchema,
  type Document,
} from "../src/schemas/documentSchema.js";
import { chunkDocument } from "../src/services/chunkingService.js";
import { FICTIONAL_RUNBOOKS } from "../src/data/knowledgeBase.js";

describe("Document Ingestion & Chunking Service", () => {
  const baseDocument: Document = {
    id: "KB-TEST-001",
    title: "Test Troubleshooting Guide",
    content: "Standard operational runbook content for unit testing.",
    metadata: {
      source: "wiki.corp.internal/test/runbook",
      category: "SOFTWARE",
      lastUpdated: "2026-10-01T00:00:00.000Z",
      author: "Test Engineer",
      tags: ["test", "troubleshooting"],
    },
  };

  // =========================================================================
  // 1. Empty & Whitespace-Only Documents
  // =========================================================================
  describe("Empty and Whitespace-Only Handling", () => {
    it("should return an empty array for documents with empty content string", () => {
      const emptyDoc: Document = { ...baseDocument, content: "" };
      const chunks = chunkDocument(emptyDoc);
      expect(chunks).toEqual([]);
      expect(chunks.length).toBe(0);
    });

    it("should return an empty array for documents with whitespace-only content", () => {
      const whitespaceDoc: Document = { ...baseDocument, content: "   \n\t  \r\n   " };
      const chunks = chunkDocument(whitespaceDoc);
      expect(chunks).toEqual([]);
      expect(chunks.length).toBe(0);
    });
  });

  // =========================================================================
  // 2. Short Documents (content.length <= maxChunkSize)
  // =========================================================================
  describe("Short Documents", () => {
    it("should produce exactly 1 chunk when content fits within maxChunkSize", () => {
      const shortText = "Short procedure that fits comfortably in one chunk.";
      const shortDoc: Document = { ...baseDocument, content: shortText };

      const chunks = chunkDocument(shortDoc, { maxChunkSize: 200, overlap: 50 });

      expect(chunks.length).toBe(1);
      expect(chunks[0].chunkId).toBe("KB-TEST-001#chunk-0");
      expect(chunks[0].chunkIndex).toBe(0);
      expect(chunks[0].totalChunks).toBe(1);
      expect(chunks[0].content).toBe(shortText);
    });
  });

  // =========================================================================
  // 3. Long Documents (Multi-chunk splitting)
  // =========================================================================
  describe("Long Documents", () => {
    it("should split long content into multiple chunks with correct totalChunks on all chunks", () => {
      // 500 characters of text
      const paragraph = "Step 1: Check network cable. Step 2: Verify IP address allocation via DHCP server. ";
      const longContent = paragraph.repeat(6); // ~504 characters
      const longDoc: Document = { ...baseDocument, content: longContent };

      const chunks = chunkDocument(longDoc, { maxChunkSize: 150, overlap: 30 });

      expect(chunks.length).toBeGreaterThan(1);
      const expectedTotal = chunks.length;

      // Every chunk must report the identical, correct totalChunks and sequential index
      chunks.forEach((chunk, idx) => {
        expect(chunk.chunkIndex).toBe(idx);
        expect(chunk.totalChunks).toBe(expectedTotal);
        expect(chunk.content.length).toBeGreaterThan(0);
        expect(chunk.content.length).toBeLessThanOrEqual(150);
      });
    });
  });

  // =========================================================================
  // 4. Overlap Preservation
  // =========================================================================
  describe("Overlap Preservation", () => {
    it("should preserve overlapping text between adjacent chunks", () => {
      // Distinct sentence structure to track overlap boundaries
      const text =
        "AAAA_FIRST_SECTION_TEXT_AAAA " +
        "BBBB_SECOND_SECTION_TEXT_BBBB " +
        "CCCC_THIRD_SECTION_TEXT_CCCC " +
        "DDDD_FOURTH_SECTION_TEXT_DDDD";

      const doc: Document = { ...baseDocument, content: text };
      const maxChunkSize = 40;
      const overlap = 15;

      const chunks = chunkDocument(doc, { maxChunkSize, overlap });
      expect(chunks.length).toBeGreaterThan(1);

      // Verify that the end of chunk i matches the start of chunk i + 1
      for (let i = 0; i < chunks.length - 1; i++) {
        const currentChunk = chunks[i].content;
        const nextChunk = chunks[i + 1].content;

        const currentTail = currentChunk.slice(-overlap);
        const nextHead = nextChunk.slice(0, overlap);

        expect(currentTail).toBe(nextHead);
      }
    });
  });

  // =========================================================================
  // 5. Metadata Lineage & Provenance
  // =========================================================================
  describe("Metadata Lineage", () => {
    it("should preserve all parent document provenance metadata on every child chunk", () => {
      const doc: Document = {
        id: "KB-SEC-999",
        title: "Firewall Access Review",
        content: "Rule 1: Never expose SSH to public internet. Rule 2: Require MFA for bastion hosts. ".repeat(4),
        metadata: {
          source: "wiki.corp.internal/infosec/bastion",
          category: "ACCESS_AND_IDENTITY",
          lastUpdated: "2026-10-15T12:00:00.000Z",
          author: "Security Operations",
          tags: ["security", "firewall", "bastion"],
        },
      };

      const chunks = chunkDocument(doc, { maxChunkSize: 100, overlap: 20 });
      expect(chunks.length).toBeGreaterThan(1);

      for (const chunk of chunks) {
        expect(chunk.documentId).toBe("KB-SEC-999");
        expect(chunk.documentTitle).toBe("Firewall Access Review");
        expect(chunk.source).toBe("wiki.corp.internal/infosec/bastion");
        expect(chunk.category).toBe("ACCESS_AND_IDENTITY");
        expect(chunk.metadata.author).toBe("Security Operations");
        expect(chunk.metadata.tags).toContain("bastion");
      }
    });
  });

  // =========================================================================
  // 6. Deterministic Chunk Identifiers
  // =========================================================================
  describe("Deterministic IDs & Stability", () => {
    it("should generate stable, reproducible chunk IDs using documentId#chunk-index format", () => {
      const doc: Document = {
        id: "KB-VPN-001",
        title: "VPN Guide",
        content: "Line 1 instructions. Line 2 instructions. Line 3 instructions. Line 4 instructions.",
        metadata: {
          source: "wiki.corp.internal/vpn",
          category: "NETWORK",
          tags: [],
        },
      };

      const run1 = chunkDocument(doc, { maxChunkSize: 30, overlap: 10 });
      const run2 = chunkDocument(doc, { maxChunkSize: 30, overlap: 10 });

      expect(run1.length).toBe(run2.length);

      run1.forEach((chunk, idx) => {
        expect(chunk.chunkId).toBe(`KB-VPN-001#chunk-${idx}`);
        expect(chunk.chunkId).toBe(run2[idx].chunkId);
        expect(chunk.content).toBe(run2[idx].content);
      });
    });
  });

  // =========================================================================
  // 7. Invalid Chunk Configuration Validation
  // =========================================================================
  describe("Configuration Validation", () => {
    it("should reject non-positive chunk sizes (<= 0)", () => {
      expect(() =>
        chunkDocument(baseDocument, { maxChunkSize: 0, overlap: 0 })
      ).toThrow(/maxChunkSize must be strictly positive/);

      expect(() =>
        chunkDocument(baseDocument, { maxChunkSize: -50, overlap: 10 })
      ).toThrow(/maxChunkSize must be strictly positive/);
    });

    it("should reject negative overlap (< 0)", () => {
      expect(() =>
        chunkDocument(baseDocument, { maxChunkSize: 200, overlap: -10 })
      ).toThrow(/overlap must be non-negative/);
    });

    it("should reject overlap equal to or greater than maxChunkSize", () => {
      expect(() =>
        chunkDocument(baseDocument, { maxChunkSize: 100, overlap: 100 })
      ).toThrow(/Overlap must be strictly smaller than maxChunkSize/);

      expect(() =>
        chunkDocument(baseDocument, { maxChunkSize: 100, overlap: 120 })
      ).toThrow(/Overlap must be strictly smaller than maxChunkSize/);
    });
  });

  // =========================================================================
  // 8. Fictional Knowledge Base Validation (All 8 Documents)
  // =========================================================================
  describe("Fictional Knowledge Base Validation", () => {
    it("should contain exactly 8 fictional runbooks", () => {
      expect(FICTIONAL_RUNBOOKS.length).toBe(8);
    });

    it("should validate all 8 runbooks against DocumentSchema and chunk them successfully", () => {
      for (const runbook of FICTIONAL_RUNBOOKS) {
        // Validate Document contract
        const parsedDoc = DocumentSchema.parse(runbook);
        expect(parsedDoc.id).toMatch(/^KB-[A-Z]+-\d{3}$/);
        expect(parsedDoc.content.length).toBeGreaterThan(100);

        // Chunk with standard configuration
        const chunks = chunkDocument(parsedDoc, { maxChunkSize: 300, overlap: 60 });

        expect(chunks.length).toBeGreaterThan(0);
        for (const chunk of chunks) {
          expect(chunk.documentId).toBe(parsedDoc.id);
          expect(chunk.documentTitle).toBe(parsedDoc.title);
          expect(chunk.category).toBe(parsedDoc.metadata.category);
          expect(chunk.content.length).toBeGreaterThan(0);
          expect(chunk.content.length).toBeLessThanOrEqual(300);
        }
      }
    });
  });
});
