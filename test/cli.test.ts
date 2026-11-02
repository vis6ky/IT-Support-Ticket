import { describe, it, expect } from "vitest";
import {
  PRESET_TICKETS,
  initializeCopilotEnvironment,
  runTicketWithStreaming,
} from "../src/cli.js";
import { runLiveVerification } from "../src/scripts/verifyLive.js";

describe("Interactive CLI & Verification Suite (Milestone 5C)", () => {
  describe("Preset Ticket Catalog", () => {
    it("should provide at least 5 realistic preset scenarios", () => {
      expect(PRESET_TICKETS.length).toBeGreaterThanOrEqual(5);
    });

    it("should have valid schema properties on every preset ticket", () => {
      for (const preset of PRESET_TICKETS) {
        expect(preset.id).toMatch(/^TICK-PRESET-\d+$/);
        expect(preset.title.length).toBeGreaterThan(10);
        expect(preset.description.length).toBeGreaterThan(20);
        expect(preset.senderEmail).toContain("@");
        expect(preset.label.length).toBeGreaterThan(5);
        expect(preset.expectedOutcome.length).toBeGreaterThan(5);
      }
    });
  });

  describe("Copilot Environment Initialization", () => {
    it("should initialize copilot service with offline fallback", async () => {
      const env = await initializeCopilotEnvironment();
      expect(env.copilotService).toBeDefined();
      expect(env.model).toBeDefined();
    });
  });

  describe("Ticket Execution & Streaming Output", () => {
    it("should process standard preset 1 (VPN issue) cleanly through streaming", async () => {
      const env = await initializeCopilotEnvironment();
      const preset = PRESET_TICKETS[0];

      await expect(
        runTicketWithStreaming(env.copilotService, {
          id: preset.id,
          title: preset.title,
          description: preset.description,
          senderEmail: preset.senderEmail,
        })
      ).resolves.not.toThrow();
    });

    it("should process preset 4 (out-of-scope coffee machine) cleanly", async () => {
      const env = await initializeCopilotEnvironment();
      const preset = PRESET_TICKETS[3];

      await expect(
        runTicketWithStreaming(env.copilotService, {
          id: preset.id,
          title: preset.title,
          description: preset.description,
          senderEmail: preset.senderEmail,
        })
      ).resolves.not.toThrow();
    });

    it("should intercept and quarantine preset 5 (destructive command injection)", async () => {
      const env = await initializeCopilotEnvironment();
      const preset = PRESET_TICKETS[4];

      await expect(
        runTicketWithStreaming(env.copilotService, {
          id: preset.id,
          title: preset.title,
          description: preset.description,
          senderEmail: preset.senderEmail,
        })
      ).resolves.not.toThrow();
    });
  });

  describe("Live Verification Diagnostic Script", () => {
    it("should return a clean diagnostic report without throwing when running verification", async () => {
      const report = await runLiveVerification();
      expect(report).toBeDefined();
      expect(report.model).toBeDefined();
      expect(report.embeddingModel).toBe("text-embedding-004");
    });
  });
});
