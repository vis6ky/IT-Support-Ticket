import { GoogleGenAI } from "@google/genai";
import { normalizeVector } from "../services/vectorMath.js";

/**
 * Interface representing the Embedding Client contract.
 * Decouples dense retrieval logic from specific provider SDKs.
 */
export interface IEmbeddingClient {
  /** Generates an embedding vector for a single text string */
  embedText(text: string): Promise<number[]>;
  /** Generates embedding vectors for a batch of text strings */
  embedBatch(texts: string[]): Promise<number[][]>;
  /** Returns the dimensional size of vectors produced by this client */
  getDimensions(): number;
}

/**
 * Production Gemini Embedding Client using the official @google/genai SDK.
 * Defaults to text-embedding-004.
 */
export class GeminiEmbeddingClient implements IEmbeddingClient {
  private ai: GoogleGenAI;
  private model: string;
  private dimensions: number;

  constructor(
    apiKey: string,
    model: string = "text-embedding-004",
    dimensions: number = 768
  ) {
    if (!apiKey) {
      throw new Error("[GeminiEmbeddingClient] An API key is required to initialize GeminiEmbeddingClient.");
    }
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
    this.dimensions = dimensions;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  async embedText(text: string): Promise<number[]> {
    const response = await this.ai.models.embedContent({
      model: this.model,
      contents: text,
      config: {
        outputDimensionality: this.dimensions,
      },
    });

    const values = response.embeddings?.[0]?.values;
    if (!values || values.length === 0) {
      throw new Error("[GeminiEmbeddingClient] Model returned empty embedding values.");
    }

    return normalizeVector(values);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      const vec = await this.embedText(text);
      results.push(vec);
    }
    return results;
  }
}

/**
 * Deterministic Mock Embedding Client.
 *
 * ARCHITECTURAL PURPOSE:
 * Enables 100% offline, zero-cost unit and integration tests.
 * It simulates semantic dense vectors by projecting conceptual keywords
 * (hardware, networking, identity, software) into distinct subspace coordinates,
 * while using a deterministic rolling hash for general vocabulary.
 * Every output vector is L2 unit-normalized.
 */
export class MockEmbeddingClient implements IEmbeddingClient {
  private readonly dimensions: number;

  // Semantic concept anchors mapped to dimensional sectors (16 dimensions: 4 sectors of 4 dims)
  private static readonly CONCEPT_SECTORS: Record<string, number[]> = {
    // Sector 0 (dims 0..3): Physical Hardware & Devices
    hardware: [0, 1, 2, 3],
    laptop: [0, 1, 2, 3],
    computer: [0, 1, 2, 3],
    machine: [0, 1, 2, 3],
    notebook: [0, 1, 2, 3],
    screen: [0, 1, 2, 3],
    display: [0, 1, 2, 3],
    battery: [0, 1, 2, 3],
    charger: [0, 1, 2, 3],
    thinkpad: [0, 1, 2, 3],
    dell: [0, 1, 2, 3],

    // Sector 1 (dims 4..7): Networking & Connectivity
    network: [4, 5, 6, 7],
    vpn: [4, 5, 6, 7],
    wifi: [4, 5, 6, 7],
    internet: [4, 5, 6, 7],
    gateway: [4, 5, 6, 7],
    connection: [4, 5, 6, 7],
    corpsecure: [4, 5, 6, 7],
    disconnect: [4, 5, 6, 7],

    // Sector 2 (dims 8..11): Identity, Authentication & Security
    okta: [8, 9, 10, 11],
    mfa: [8, 9, 10, 11],
    sso: [8, 9, 10, 11],
    login: [8, 9, 10, 11],
    password: [8, 9, 10, 11],
    token: [8, 9, 10, 11],
    credential: [8, 9, 10, 11],
    phishing: [8, 9, 10, 11],
    security: [8, 9, 10, 11],

    // Sector 3 (dims 12..15): Software & Collaboration Tools
    slack: [12, 13, 14, 15],
    workspace: [12, 13, 14, 15],
    channel: [12, 13, 14, 15],
    storage: [12, 13, 14, 15],
    quota: [12, 13, 14, 15],
    drive: [12, 13, 14, 15],
    print: [12, 13, 14, 15],
    printer: [12, 13, 14, 15],
  };

  constructor(dimensions: number = 16) {
    if (dimensions < 4) {
      throw new Error("[MockEmbeddingClient] Dimensions must be at least 4.");
    }
    this.dimensions = dimensions;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  async embedText(text: string): Promise<number[]> {
    const vector = new Array(this.dimensions).fill(0.01); // Baseline uniform background noise
    const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

    for (const token of tokens) {
      // 1. Semantic sector activation
      const sectorIndices = MockEmbeddingClient.CONCEPT_SECTORS[token];
      if (sectorIndices) {
        for (const idx of sectorIndices) {
          if (idx < this.dimensions) {
            vector[idx] += 1.0;
          }
        }
      }

      // 2. Deterministic polynomial hash distribution for general words
      let hash = 0;
      for (let i = 0; i < token.length; i++) {
        hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
      }
      const targetDim = hash % this.dimensions;
      vector[targetDim] += 0.2;
    }

    // Always normalize to unit length so dot product == cosine similarity
    return normalizeVector(vector);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      const vec = await this.embedText(text);
      results.push(vec);
    }
    return results;
  }
}
