import dotenv from "dotenv";
import { z } from "zod";

// Load local .env if present
dotenv.config();

const envSchema = z.object({
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required for live LLM operations").optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type AppConfig = z.infer<typeof envSchema>;

/**
 * Loads and validates configuration from environment variables.
 * Fails fast with clear validation errors if required values are missing.
 */
export function loadConfig(overrides?: Partial<AppConfig>): AppConfig {
  const parsed = envSchema.safeParse({
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    ...overrides,
  });

  if (!parsed.success) {
    const errorDetails = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
    throw new Error(`[ConfigError] Invalid environment configuration: ${errorDetails}`);
  }

  return parsed.data;
}
