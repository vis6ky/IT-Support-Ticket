import { z } from "zod";
import { ChunkSchema } from "./documentSchema.js";

/**
 * Options for configuring lexical search execution.
 */
export const SearchOptionsSchema = z.object({
  topK: z
    .number()
    .int("topK must be an integer")
    .positive("topK must be strictly positive (> 0)")
    .default(3),
  minScore: z
    .number()
    .nonnegative("minScore must be non-negative (>= 0)")
    .default(0.0),
  filterCategory: z.string().optional(),
});

export type SearchOptions = z.infer<typeof SearchOptionsSchema>;

/**
 * Single ranked lexical search result containing the matched chunk,
 * BM25 relevance score, and the specific terms that produced the match.
 */
export const SearchResultSchema = z.object({
  chunk: ChunkSchema,
  score: z.number().nonnegative("BM25 score must be non-negative"),
  matchedTerms: z.array(z.string()).min(1, "Matched terms must contain at least one term"),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;

/**
 * Options for configuring dense vector semantic search execution.
 */
export const VectorSearchOptionsSchema = z.object({
  topK: z
    .number()
    .int("topK must be an integer")
    .positive("topK must be strictly positive (> 0)")
    .default(3),
  minSimilarity: z
    .number()
    .min(-1.0, "Cosine similarity cannot be less than -1.0")
    .max(1.0, "Cosine similarity cannot exceed 1.0")
    .default(0.0),
  filterCategory: z.string().optional(),
});

export type VectorSearchOptions = z.infer<typeof VectorSearchOptionsSchema>;

/**
 * Single ranked semantic vector search result containing the matched chunk
 * and its cosine similarity score.
 */
export const VectorSearchResultSchema = z.object({
  chunk: ChunkSchema,
  score: z
    .number()
    .min(-1.0, "Cosine similarity must be >= -1.0")
    .max(1.0, "Cosine similarity must be <= 1.0"),
});

export type VectorSearchResult = z.infer<typeof VectorSearchResultSchema>;

/**
 * Options for configuring hybrid retrieval combining lexical BM25 and dense vector search.
 */
export const HybridSearchOptionsSchema = z.object({
  topK: z
    .number()
    .int("topK must be an integer")
    .positive("topK must be strictly positive (> 0)")
    .default(3),
  rrfK: z
    .number()
    .int("rrfK must be an integer")
    .positive("rrfK must be strictly positive (> 0)")
    .default(60), // Standard Cormack et al. smoothing constant
  filterCategory: z.string().optional(),
  lexicalWeight: z
    .number()
    .positive("lexicalWeight must be strictly positive")
    .default(1.0),
  vectorWeight: z
    .number()
    .positive("vectorWeight must be strictly positive")
    .default(1.0),
  minScore: z
    .number()
    .nonnegative("minScore must be non-negative")
    .default(0.0),
});

export type HybridSearchOptions = z.infer<typeof HybridSearchOptionsSchema>;

/**
 * Single ranked hybrid search result fused via Reciprocal Rank Fusion (RRF).
 * Provides full explainability by tracking original ranks and scores from both engines.
 */
export const HybridSearchResultSchema = z.object({
  chunk: ChunkSchema,
  score: z.number().positive("RRF fusion score must be strictly positive"),
  lexicalRank: z.number().int().positive().nullable(),
  vectorRank: z.number().int().positive().nullable(),
  lexicalScore: z.number().nonnegative().nullable(),
  vectorScore: z.number().min(-1.0).max(1.0).nullable(),
  matchedTerms: z.array(z.string()).default([]),
});

export type HybridSearchResult = z.infer<typeof HybridSearchResultSchema>;
