import type { Chunk } from "../schemas/documentSchema.js";
import {
  VectorSearchOptionsSchema,
  VectorSearchResultSchema,
  type VectorSearchOptions,
  type VectorSearchResult,
} from "../schemas/searchSchema.js";
import type { IEmbeddingClient } from "../clients/embeddingClient.js";
import { cosineSimilarity } from "./vectorMath.js";

export interface IndexedChunk {
  chunk: Chunk;
  vector: number[];
}

/**
 * IN-MEMORY DENSE VECTOR RETRIEVAL SERVICE
 *
 * ARCHITECTURAL DESIGN:
 * 1. Semantic Embedding Index:
 *    Indexes chunks by generating dense floating-point vector representations.
 * 2. Cosine Similarity Matching:
 *    Measures directional alignment between the query embedding and chunk embeddings:
 *    sim(u, v) = (u . v) / (||u|| * ||v||).
 * 3. Deterministic Ranking:
 *    Applies strict 4-tier tie-breaking (score desc -> documentId asc -> chunkIndex asc -> chunkId asc)
 *    to prevent non-deterministic order across runs.
 */
export class VectorSearchService {
  private client: IEmbeddingClient;
  private indexedChunks: IndexedChunk[];

  constructor(client: IEmbeddingClient) {
    this.client = client;
    this.indexedChunks = [];
  }

  /**
   * Returns the count of currently indexed chunks.
   */
  public getIndexedCount(): number {
    return this.indexedChunks.length;
  }

  /**
   * Embeds and stores an array of Chunks in the in-memory vector index.
   */
  public async indexChunks(chunks: Chunk[]): Promise<void> {
    if (chunks.length === 0) {
      this.indexedChunks = [];
      return;
    }

    const texts = chunks.map((c) => c.content);
    const vectors = await this.client.embedBatch(texts);

    this.indexedChunks = chunks.map((chunk, idx) => ({
      chunk,
      vector: vectors[idx],
    }));
  }

  /**
   * Performs semantic vector search using cosine similarity.
   *
   * @param query - User ticket text or search prompt
   * @param options - Configurable topK, minSimilarity, and category filter
   * @returns Strongly-typed, ranked VectorSearchResult array
   */
  public async search(
    query: string,
    options?: Partial<VectorSearchOptions>
  ): Promise<VectorSearchResult[]> {
    const validatedOptions = VectorSearchOptionsSchema.parse(options ?? {});
    const { topK, minSimilarity, filterCategory } = validatedOptions;

    // Guard against empty query or empty index
    if (query.trim().length === 0 || this.indexedChunks.length === 0) {
      return [];
    }

    // Embed the query string
    const queryVector = await this.client.embedText(query);

    // Compute similarity for each indexed candidate
    const candidates: Array<{ chunk: Chunk; score: number }> = [];

    for (const item of this.indexedChunks) {
      if (filterCategory && item.chunk.category !== filterCategory) {
        continue;
      }

      const score = cosineSimilarity(queryVector, item.vector);

      if (score >= minSimilarity) {
        candidates.push({
          chunk: item.chunk,
          score,
        });
      }
    }

    // Deterministic tie-breaking sort:
    // 1. Score descending
    // 2. DocumentId ascending (lexicographical)
    // 3. ChunkIndex ascending (numerical)
    // 4. ChunkId ascending (string)
    candidates.sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (Math.abs(scoreDiff) > 1e-9) {
        return scoreDiff;
      }

      const docCompare = a.chunk.documentId.localeCompare(b.chunk.documentId);
      if (docCompare !== 0) {
        return docCompare;
      }

      const idxCompare = a.chunk.chunkIndex - b.chunk.chunkIndex;
      if (idxCompare !== 0) {
        return idxCompare;
      }

      return a.chunk.chunkId.localeCompare(b.chunk.chunkId);
    });

    return candidates.slice(0, topK).map((candidate) =>
      VectorSearchResultSchema.parse({
        chunk: candidate.chunk,
        score: Number(candidate.score.toFixed(6)), // Stable floating-point precision
      })
    );
  }
}
