import type { Chunk } from "../schemas/documentSchema.js";
import {
  SearchOptionsSchema,
  SearchResultSchema,
  type SearchOptions,
  type SearchResult,
} from "../schemas/searchSchema.js";

/**
 * Configuration options for BM25 parameter tuning.
 */
export interface BM25Config {
  /** Term frequency saturation parameter (default: 1.5). Controls scaling rate of repeated terms. */
  k1?: number;
  /** Length normalization parameter (default: 0.75). Controls document length penalty. */
  b?: number;
}

/**
 * OKAPI BM25 LEXICAL RETRIEVAL ENGINE
 *
 * ARCHITECTURAL DESIGN & ALGORITHM OVERVIEW:
 * 1. Scoring Formula:
 *    Score(D, Q) = sum_{t in Q} [ IDF(t) * (f(t, D) * (k1 + 1)) / (f(t, D) + k1 * (1 - b + b * (|D| / avgdl))) ]
 * 2. Smoothed IDF:
 *    IDF(t) = ln(1 + (N - n(t) + 0.5) / (n(t) + 0.5))
 *    The addition of 1 inside the log ensures that IDF is strictly non-negative (>= 0),
 *    preventing common terms present in over half the corpus from negatively penalizing chunks.
 * 3. Lexical Limitation:
 *    BM25 matches literal tokens and technical stems. It does NOT understand semantic synonyms
 *    or conceptual similarity.
 */
export class BM25SearchService {
  private chunks: Chunk[];
  private k1: number;
  private b: number;
  private avgdl: number;
  private docLengths: number[];
  private docFreqs: Map<string, number>; // Term -> number of chunks containing it
  private invertedIndex: Map<string, Map<number, number>>; // Term -> (chunkIndex -> termFrequency)

  constructor(chunks: Chunk[], config?: BM25Config) {
    this.chunks = chunks;
    this.k1 = config?.k1 ?? 1.5;
    this.b = config?.b ?? 0.75;
    this.docLengths = [];
    this.docFreqs = new Map();
    this.invertedIndex = new Map();

    this.buildIndex();
    this.avgdl =
      this.docLengths.length > 0
        ? this.docLengths.reduce((sum, len) => sum + len, 0) / this.docLengths.length
        : 0;
  }

  /**
   * Tokenizes text while preserving technical identifiers, hostnames, and error codes
   * (e.g. '802.1x', 'gw-useast.corp.internal', 'kb-vpn-001', 'pool.ntp.org').
   */
  public tokenize(text: string): string[] {
    const normalized = text.toLowerCase();
    // Matches sequences of alphanumeric characters optionally joined by dots or hyphens
    const tokens = normalized.match(/[a-z0-9]+(?:[.-][a-z0-9]+)*/g);
    return tokens ?? [];
  }

  /**
   * Precomputes document lengths, document frequencies, and inverted index mappings.
   */
  private buildIndex(): void {
    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i];
      const tokens = this.tokenize(chunk.content);
      this.docLengths.push(tokens.length);

      const termCounts = new Map<string, number>();
      for (const token of tokens) {
        termCounts.set(token, (termCounts.get(token) ?? 0) + 1);
      }

      for (const [term, count] of termCounts.entries()) {
        this.docFreqs.set(term, (this.docFreqs.get(term) ?? 0) + 1);

        let postings = this.invertedIndex.get(term);
        if (!postings) {
          postings = new Map();
          this.invertedIndex.set(term, postings);
        }
        postings.set(i, count);
      }
    }
  }

  /**
   * Executes a lexical search against indexed chunks using BM25 scoring with deterministic tie-breaking.
   *
   * @param query - Raw query text from user ticket or operator
   * @param options - Configurable topK, minScore, and category filter
   * @returns Strongly-typed, ranked SearchResult array
   */
  public search(query: string, options?: Partial<SearchOptions>): SearchResult[] {
    const validatedOptions = SearchOptionsSchema.parse(options ?? {});
    const { topK, minScore, filterCategory } = validatedOptions;

    // Handle empty or whitespace-only queries
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0 || this.chunks.length === 0) {
      return [];
    }

    // Identify unique query terms
    const uniqueQueryTerms = Array.from(new Set(queryTokens));
    const N = this.chunks.length;

    // Accumulators for matching chunks
    const chunkScores = new Map<number, number>();
    const chunkMatchedTerms = new Map<number, Set<string>>();

    for (const term of uniqueQueryTerms) {
      const postings = this.invertedIndex.get(term);
      if (!postings) {
        continue;
      }

      const n = this.docFreqs.get(term) ?? 0;
      // Smoothed positive IDF
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));

      for (const [chunkIdx, tf] of postings.entries()) {
        const docLen = this.docLengths[chunkIdx];
        const tfComponent =
          (tf * (this.k1 + 1)) /
          (tf + this.k1 * (1 - this.b + this.b * (docLen / this.avgdl)));

        const termScore = idf * tfComponent;
        chunkScores.set(chunkIdx, (chunkScores.get(chunkIdx) ?? 0) + termScore);

        let matched = chunkMatchedTerms.get(chunkIdx);
        if (!matched) {
          matched = new Set();
          chunkMatchedTerms.set(chunkIdx, matched);
        }
        matched.add(term);
      }
    }

    // Convert accumulated scores into candidates
    const candidates: Array<{ chunk: Chunk; score: number; matchedTerms: string[] }> = [];

    for (const [chunkIdx, score] of chunkScores.entries()) {
      if (score < minScore) {
        continue;
      }

      const chunk = this.chunks[chunkIdx];
      if (filterCategory && chunk.category !== filterCategory) {
        continue;
      }

      candidates.push({
        chunk,
        score,
        matchedTerms: Array.from(chunkMatchedTerms.get(chunkIdx) ?? []),
      });
    }

    // Deterministic tie-breaking sorting:
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

    // Return sliced top-K candidates validated against SearchResultSchema
    return candidates.slice(0, topK).map((candidate) =>
      SearchResultSchema.parse({
        chunk: candidate.chunk,
        score: Number(candidate.score.toFixed(6)), // Stable floating-point precision
        matchedTerms: candidate.matchedTerms,
      })
    );
  }
}
