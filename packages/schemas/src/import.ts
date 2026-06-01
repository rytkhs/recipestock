import { z } from "zod";
import { recipeDraftContentSchema, recipeSourceDraftSchema } from "./recipe";

export const importErrorCodeSchema = z.enum([
  "invalid_url",
  "fetch_failed",
  "unsupported_page",
  "extraction_failed",
  "ai_usage_limit_exceeded",
  "ai_timeout",
  "ai_schema_invalid",
  "unknown",
]);

const importableUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
});

export const importUrlRequestSchema = z.object({
  url: importableUrlSchema,
});

export const importUrlResponseSchema = z.object({
  recipeDraftContent: recipeDraftContentSchema,
  source: recipeSourceDraftSchema,
  warnings: z.array(z.string()).default([]),
});

export type ImportErrorCode = z.infer<typeof importErrorCodeSchema>;
export type ImportUrlRequest = z.infer<typeof importUrlRequestSchema>;
export type ImportUrlResponse = z.infer<typeof importUrlResponseSchema>;
