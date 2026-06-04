import { z } from "zod";

export const importErrorCodeSchema = z.enum([
  "invalid_url",
  "fetch_failed",
  "unsupported_page",
  "extraction_failed",
  "ai_usage_limit_exceeded",
  "ai_timeout",
  "ai_schema_invalid",
  "recipe_limit_exceeded",
  "unknown",
]);

export const importJobKindSchema = z.enum(["url"]);

export const importJobStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);

const importableUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
});

export const importUrlRequestSchema = z.object({
  url: importableUrlSchema,
});

export const importJobSummarySchema = z.object({
  id: z.string().min(1),
  kind: importJobKindSchema,
  status: importJobStatusSchema,
  url: z.string().nullable(),
  recipeId: z.string().nullable(),
  errorCode: importErrorCodeSchema.nullable(),
  createdAt: z.string().min(1),
  startedAt: z.string().min(1).nullable(),
  finishedAt: z.string().min(1).nullable(),
});

export const createImportUrlJobResponseSchema = z.object({
  kind: z.enum(["created", "existing_active_job"]),
  job: importJobSummarySchema,
});

export const recentImportJobsResponseSchema = z.object({
  jobs: z.array(importJobSummarySchema),
});

export const getImportJobResponseSchema = z.object({
  job: importJobSummarySchema,
});

export const dismissImportJobResponseSchema = z.object({
  job: importJobSummarySchema,
});

export type ImportErrorCode = z.infer<typeof importErrorCodeSchema>;
export type ImportJobKind = z.infer<typeof importJobKindSchema>;
export type ImportJobStatus = z.infer<typeof importJobStatusSchema>;
export type ImportUrlRequest = z.infer<typeof importUrlRequestSchema>;
export type ImportJobSummary = z.infer<typeof importJobSummarySchema>;
export type CreateImportUrlJobResponse = z.infer<typeof createImportUrlJobResponseSchema>;
export type RecentImportJobsResponse = z.infer<typeof recentImportJobsResponseSchema>;
export type GetImportJobResponse = z.infer<typeof getImportJobResponseSchema>;
export type DismissImportJobResponse = z.infer<typeof dismissImportJobResponseSchema>;
