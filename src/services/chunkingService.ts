import {
  ChunkOptionsSchema,
  ChunkSchema,
  type Chunk,
  type ChunkOptions,
  type Document,
} from "../schemas/documentSchema.js";

/**
 * DETERMINISTIC SLIDING-WINDOW CHUNKING SERVICE
 *
 * ARCHITECTURAL NOTES:
 * 1. Character Count vs. Model Token Count:
 *    This service implements character-based segmentation. Character counts are NOT identical
 *    to LLM subword token counts (e.g. BPE tokens). While ~4 characters roughly equals 1 token
 *    in English prose, code blocks, URLs, whitespace, and multi-byte scripts (Arabic, Japanese)
 *    deviate significantly.
 * 2. Overlap Limitations:
 *    Sliding window overlap creates overlapping text boundaries to reduce abrupt sentence cuts,
 *    but overlap does NOT guarantee semantic completeness if a complex thought, table, or code
 *    block is arbitrarily severed.
 * 3. Lineage & Provenance:
 *    Every chunk maintains an explicit backlink to its parent document (documentId, source,
 *    documentTitle, and category) to enable auditable citations during RAG generation.
 */

/**
 * Splits a Document into deterministic, strongly-typed Chunks using a sliding window.
 *
 * @param doc - Ingested canonical document
 * @param options - Configuration for maxChunkSize and overlap
 * @returns Array of validated Chunks with sequential zero-based indices
 */
export function chunkDocument(
  doc: Document,
  options?: Partial<ChunkOptions>
): Chunk[] {
  // 1. Validate configuration options using Zod schema
  const validatedOptions = ChunkOptionsSchema.parse(options ?? {});
  const { maxChunkSize, overlap } = validatedOptions;

  // 2. Handle empty or whitespace-only documents consistently
  const trimmedContent = doc.content.trim();
  if (trimmedContent.length === 0) {
    return [];
  }

  // 3. Compute raw sliding-window character slices
  const rawSlices: string[] = [];
  const step = maxChunkSize - overlap;
  let start = 0;

  while (start < doc.content.length) {
    const end = Math.min(start + maxChunkSize, doc.content.length);
    const slice = doc.content.slice(start, end);

    // Only emit non-empty slices
    if (slice.trim().length > 0) {
      rawSlices.push(slice);
    }

    if (end >= doc.content.length) {
      break;
    }

    start += step;
  }

  const totalChunks = rawSlices.length;

  // 4. Construct and validate strongly-typed Chunks with deterministic IDs
  return rawSlices.map((content, index) => {
    const chunkData = {
      chunkId: `${doc.id}#chunk-${index}`, // Zero-based stable chunk identifier
      documentId: doc.id,
      documentTitle: doc.title,
      source: doc.metadata.source,
      category: doc.metadata.category,
      content,
      chunkIndex: index,
      totalChunks,
      metadata: doc.metadata,
    };

    // Runtime validation guarantees schema contract
    return ChunkSchema.parse(chunkData);
  });
}
