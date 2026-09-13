import { z } from "zod";

/**
 * AIは原文の言い回しをほぼそのまま写すので、出力は入力とほぼ同じ長さになる。
 * 上限は入力のコンテキスト長ではなく、AIの出力トークン予算から決めている。
 */
export const IMPORT_TEXT_MAX_LENGTH = 5000;

export const importErrorCodeSchema = z.enum([
  "invalid_url",
  "fetch_failed",
  "unsupported_page",
  "extraction_failed",
  "private_or_login_required",
  "ai_usage_limit_exceeded",
  "ai_timeout",
  "job_timeout",
  "ai_schema_invalid",
  "recipe_limit_exceeded",
  "unknown",
]);

export const importJobKindSchema = z.enum(["url", "text"]);

export const importJobStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);

export const importableUrlSchema = z.url({ protocol: /^https?$/ }).max(4096);

export const importUrlRequestSchema = z.object({
  url: importableUrlSchema,
});

export const importTextRequestSchema = z.object({
  text: z.string().trim().min(1).max(IMPORT_TEXT_MAX_LENGTH),
});

export const importJobSummarySchema = z.object({
  id: z.string().min(1),
  kind: importJobKindSchema,
  status: importJobStatusSchema,
  url: z.string().nullable(),
  textPreview: z.string().nullable(),
  recipeId: z.string().nullable(),
  errorCode: importErrorCodeSchema.nullable(),
  createdAt: z.string().min(1),
  startedAt: z.string().min(1).nullable(),
  finishedAt: z.string().min(1).nullable(),
});

export const createImportJobResponseSchema = z.object({
  kind: z.enum(["created", "existing_active_job"]),
  job: importJobSummarySchema,
});

export const recentImportJobsResponseSchema = z.object({
  jobs: z.array(importJobSummarySchema),
});

/**
 * `sourceText`は、テキストのImport Jobに保存された原文を本人へ返す。
 * URLのJobは原文を持たないので`null`になる。
 */
export const getImportJobResponseSchema = z.object({
  job: importJobSummarySchema,
  sourceText: z.string().nullable(),
});

export const dismissImportJobResponseSchema = z.object({
  job: importJobSummarySchema,
});

export type ImportErrorCode = z.infer<typeof importErrorCodeSchema>;
export type ImportJobKind = z.infer<typeof importJobKindSchema>;
export type ImportJobStatus = z.infer<typeof importJobStatusSchema>;
export type ImportUrlRequest = z.infer<typeof importUrlRequestSchema>;
export type ImportTextRequest = z.infer<typeof importTextRequestSchema>;
export type ImportJobSummary = z.infer<typeof importJobSummarySchema>;
export type CreateImportJobResponse = z.infer<typeof createImportJobResponseSchema>;
export type RecentImportJobsResponse = z.infer<typeof recentImportJobsResponseSchema>;
export type GetImportJobResponse = z.infer<typeof getImportJobResponseSchema>;
export type DismissImportJobResponse = z.infer<typeof dismissImportJobResponseSchema>;
