import { z } from "zod";
import { recipeDraftContentSchema } from "./recipe";

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

export const importUrlRequestSchema = z.object({
  url: z.url(),
});

export const importUrlResponseSchema = z.object({
  recipeDraftContent: recipeDraftContentSchema,
});

export type ImportErrorCode = z.infer<typeof importErrorCodeSchema>;
export type ImportUrlRequest = z.infer<typeof importUrlRequestSchema>;
export type ImportUrlResponse = z.infer<typeof importUrlResponseSchema>;
