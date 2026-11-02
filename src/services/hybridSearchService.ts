import { BM25SearchService } from "./bm25SearchService.js";
import { VectorSearchService } from "./vectorSearchService.js";
import {
  HybridSearchOptionsSchema,
  HybridSearchResultSchema,
  type HybridSearchOptions,
  type HybridSearchResult,
} from "../schemas/searchSchema.js";
import type { Chunk } from "../schemas/documentSchema.js";

interface InternalCandidate {
  chunk: Chunk;
  rrfScore: number;
  lexicalRank: number | null;
  vectorRank: number | null;
  lexicalScore: number | null;
  vectorScore: number | null;
  matchedTerms: string[];
}

/**
 * HYBRID SEARCH SERVICE (RECIPROCAL RANK FUSION)
 *
 * ARCHITECTURAL DESIGN & ALGORITHM OVERVIEW:
 * 1. The Challenge of Score Mismatches:
 *    - BM25 scores are unbounded positive numbers [0, infinity) dependent on term frequency and document length.
 *    - Vector similarity scores are bounded [-1.0, 1.0] cosine angles.
 *    - Linearly adding or multiplying these raw scores is mathematically incompatible and requires brittle normalization constants.
 * 2. Reciprocal Rank Fusion (RRF):
 *    - Standardized by Cormack et al. (SIGIR 2009).
 *    - RRF relies strictly on item RANK positions across rankers rather than fragile raw score scales:
 *      RRF_Score(d) = sum_{m in M} [ w_m / (k + r_m(d)) ]
 *    - Here, k = 60 is the smoothing constant that balances consensus promotion with single-engine confidence.
 *    - w_m allows configurable weighting (default: 1.0 for both).
 * 3. Explainability & Lineage:
 *    - Retains original ranks and scores from both lexical and vector engines for full auditability.
 */
export class HybridSearchService {
  constructor(
    private bm25Service: BM25SearchService,
    private vectorService: VectorSearchService
  ) {}

  /**
   * Performs hybrid search combining BM25 lexical search and dense vector retrieval via RRF.
   *
   * @param query - Raw search query from user ticket or operator
   * @param options - Configurable topK, rrfK, category filter, and relative weights
   * @returns Strongly-typed, ranked HybridSearchResult array
   */
  public async search(
    query: string,
    options?: Partial<HybridSearchOptions>
  ): Promise<HybridSearchResult[]> {
    const validatedOptions = HybridSearchOptionsSchema.parse(options ?? {});
    const { topK, rrfK, filterCategory, lexicalWeight, vectorWeight, minScore } =
      validatedOptions;

    // Fast-path guard against empty or whitespace query
    if (query.trim().length === 0) {
      return [];
    }

    // Retrieve an expanded candidate pool from each underlying engine to ensure robust fusion
    const candidatePoolSize = Math.max(topK * 3, 20);

    const [lexicalResults, vectorResults] = await Promise.all([
      this.bm25Service.search(query, {
        topK: candidatePoolSize,
        filterCategory,
      }),
      this.vectorService.search(query, {
        topK: candidatePoolSize,
        filterCategory,
      }),
    ]);

    // If both engines produce 0 results, return empty
    if (lexicalResults.length === 0 && vectorResults.length === 0) {
      return [];
    }

    const candidateMap = new Map<string, InternalCandidate>();

    // 1. Accumulate Lexical (BM25) RRF contributions
    lexicalResults.forEach((item, index) => {
      const rank = index + 1; // 1-based rank
      const rrfContribution = lexicalWeight / (rrfK + rank);
      const chunkId = item.chunk.chunkId;

      candidateMap.set(chunkId, {
        chunk: item.chunk,
        rrfScore: rrfContribution,
        lexicalRank: rank,
        vectorRank: null,
        lexicalScore: item.score,
        vectorScore: null,
        matchedTerms: item.matchedTerms,
      });
    });

    // 2. Accumulate Dense Vector RRF contributions
    vectorResults.forEach((item, index) => {
      const rank = index + 1; // 1-based rank
      const rrfContribution = vectorWeight / (rrfK + rank);
      const chunkId = item.chunk.chunkId;

      const existing = candidateMap.get(chunkId);
      if (existing) {
        existing.rrfScore += rrfContribution;
        existing.vectorRank = rank;
        existing.vectorScore = item.score;
      } else {
        candidateMap.set(chunkId, {
          chunk: item.chunk,
          rrfScore: rrfContribution,
          lexicalRank: null,
          vectorRank: rank,
          lexicalScore: null,
          vectorScore: item.score,
          matchedTerms: [],
        });
      }
    });

    // 3. Filter by minScore and convert to candidate array
    const candidates = Array.from(candidateMap.values()).filter(
      (c) => c.rrfScore >= minScore
    );

    // 4. Deterministic tie-breaking sort:
    //    1. Score descending
    //    2. DocumentId ascending (lexicographical)
    //    3. ChunkIndex ascending (numerical)
    //    4. ChunkId ascending (string)
    candidates.sort((a, b) => {
      const scoreDiff = b.rrfScore - a.rrfScore;
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

    // 5. Slice to requested topK and validate contract
    return candidates.slice(0, topK).map((candidate) =>
      HybridSearchResultSchema.parse({
        chunk: candidate.chunk,
        score: Number(candidate.rrfScore.toFixed(8)), // Stable high-precision floating point
        lexicalRank: candidate.lexicalRank,
        vectorRank: candidate.vectorRank,
        lexicalScore: candidate.lexicalScore,
        vectorScore: candidate.vectorScore,
        matchedTerms: candidate.matchedTerms,
      })
    );
  }
}
