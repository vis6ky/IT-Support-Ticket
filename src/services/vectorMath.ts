/**
 * VECTOR MATHEMATICS UTILITIES
 *
 * Provides pure, deterministic vector operations for dense embeddings:
 * - Dot product
 * - L2 Norm (Euclidean magnitude)
 * - Cosine similarity
 * - Vector normalization
 */

/**
 * Computes the dot product of two real-valued vectors: sum(a_i * b_i).
 */
export function dotProduct(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `[VectorMath] Dimension mismatch: vector A has length ${a.length}, vector B has length ${b.length}.`
    );
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Computes the Euclidean L2 norm (magnitude) of a vector: sqrt(sum(v_i^2)).
 */
export function magnitude(v: number[]): number {
  let sumSquares = 0;
  for (let i = 0; i < v.length; i++) {
    sumSquares += v[i] * v[i];
  }
  return Math.sqrt(sumSquares);
}

/**
 * Normalizes a vector to unit length (L2 norm = 1.0).
 * If the input is a zero vector, returns a zero vector without throwing.
 */
export function normalizeVector(v: number[]): number[] {
  const mag = magnitude(v);
  if (mag === 0) {
    return new Array(v.length).fill(0);
  }
  return v.map((val) => val / mag);
}

/**
 * Computes the cosine similarity between two vectors: (A . B) / (||A|| * ||B||).
 *
 * Properties:
 * - Exactly identical direction: 1.0
 * - Orthogonal (perpendicular): 0.0
 * - Exactly opposite direction: -1.0
 * - Zero vectors return 0.0 defensively to prevent NaN propagation.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `[VectorMath] Dimension mismatch: vector A has length ${a.length}, vector B has length ${b.length}.`
    );
  }

  const magA = magnitude(a);
  const magB = magnitude(b);

  // Guard against division by zero
  if (magA === 0 || magB === 0) {
    return 0.0;
  }

  const dot = dotProduct(a, b);
  const sim = dot / (magA * magB);

  // Clamp floating point rounding anomalies into strictly valid [-1, 1] range
  return Math.max(-1.0, Math.min(1.0, sim));
}
