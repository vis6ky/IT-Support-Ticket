import { describe, it, expect } from "vitest";
import {
  ClassifierService,
  MockGeminiClient,
  ticketInputSchema,
  classificationResultSchema,
} from "../src/index.js";

describe("Scaffolding Smoke Test", () => {
  it("should export all architectural boundary components", () => {
    expect(ClassifierService).toBeDefined();
    expect(MockGeminiClient).toBeDefined();
    expect(ticketInputSchema).toBeDefined();
    expect(classificationResultSchema).toBeDefined();
  });
});
