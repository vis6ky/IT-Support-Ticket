import { z } from "zod";

/**
 * Metadata associated with an ingested IT support document.
 */
export const DocumentMetadataSchema = z.object({
  source: z.string().min(1, "Source identifier is required"),
  category: z.string().min(1, "Category is required"),
  lastUpdated: z.string().datetime().optional(),
  author: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;

/**
 * Canonical Document Model.
 * Represents an entire ingested IT runbook or knowledge base article.
 */
export const DocumentSchema = z.object({
  id: z.string().min(1, "Document ID is required"),
  title: z.string().min(1, "Title is required"),
  content: z.string(),
  metadata: DocumentMetadataSchema,
});

export type Document = z.infer<typeof DocumentSchema>;

/**
 * Chunking Configuration Schema.
 * Validates that chunk size is a positive integer and overlap is non-negative
 * and strictly less than chunk size.
 */
export const ChunkOptionsSchema = z
  .object({
    maxChunkSize: z
      .number()
      .int("maxChunkSize must be an integer")
      .positive("maxChunkSize must be strictly positive (> 0)")
      .default(400),
    overlap: z
      .number()
      .int("overlap must be an integer")
      .nonnegative("overlap must be non-negative (>= 0)")
      .default(80),
  })
  .refine((data) => data.overlap < data.maxChunkSize, {
    message: "Overlap must be strictly smaller than maxChunkSize",
    path: ["overlap"],
  });

export type ChunkOptions = z.infer<typeof ChunkOptionsSchema>;

/**
 * Canonical Chunk Model.
 * Represents an immutable, deterministic segment of a parent document
 * with strict provenance and lineage metadata.
 */
export const ChunkSchema = z.object({
  chunkId: z.string().min(1, "Chunk ID is required"),
  documentId: z.string().min(1, "Document ID is required"),
  documentTitle: z.string().min(1, "Document title is required"),
  source: z.string().min(1, "Source identifier is required"),
  category: z.string().min(1, "Category is required"),
  content: z.string().min(1, "Chunk content must be non-empty"),
  chunkIndex: z.number().int().nonnegative("chunkIndex must be zero-based and non-negative"),
  totalChunks: z.number().int().positive("totalChunks must be strictly positive"),
  metadata: DocumentMetadataSchema,
});

export type Chunk = z.infer<typeof ChunkSchema>;
