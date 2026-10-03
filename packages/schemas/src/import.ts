import { z } from "zod";
import { MAX_RECIPE_SOURCE_URL_LENGTH } from "./recipe";

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

/**
 * `canceled`は利用者が取り消したJobで、Recipeを作らない。取り消すと同時に閉じるので、
 * 取り消しの応答のほかには返らない。
 */
export const importJobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
]);

/**
 * 取り込んだURLはそのままRecipeの出典になるので、出典として保存できる長さだけを受け入れる。
 */
export const importableUrlSchema = z
  .url({ protocol: /^https?$/ })
  .max(MAX_RECIPE_SOURCE_URL_LENGTH);

export const importUrlRequestSchema = z.object({
  url: importableUrlSchema,
});

/**
 * `sourceUrl`は、URLから読み取れなかった投稿の本文を貼り直したときに、元のURLを出典として残すためのもの。
 */
export const importTextRequestSchema = z.object({
  text: z.string().trim().min(1).max(IMPORT_TEXT_MAX_LENGTH),
  sourceUrl: importableUrlSchema.optional(),
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

/**
 * 取り込み状況に添えて見せる、成功したJobが作ったRecipe。Recipeが消されていれば`null`になる。
 */
export const importedRecipePreviewSchema = z.object({
  title: z.string().min(1),
  coverImageUrl: z.string().nullable(),
});

export const recentImportJobSchema = importJobSummarySchema.extend({
  recipe: importedRecipePreviewSchema.nullable(),
});

export const recentImportJobsResponseSchema = z.object({
  jobs: z.array(recentImportJobSchema),
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

/**
 * 取り消す前に終わっていたJobは、そのままの状態で返る。
 */
export const cancelImportJobResponseSchema = z.object({
  job: importJobSummarySchema,
});

export type ImportErrorCode = z.infer<typeof importErrorCodeSchema>;
export type ImportJobKind = z.infer<typeof importJobKindSchema>;
export type ImportJobStatus = z.infer<typeof importJobStatusSchema>;
export type ImportUrlRequest = z.infer<typeof importUrlRequestSchema>;
export type ImportTextRequest = z.infer<typeof importTextRequestSchema>;
export type ImportJobSummary = z.infer<typeof importJobSummarySchema>;
export type CreateImportJobResponse = z.infer<typeof createImportJobResponseSchema>;
export type ImportedRecipePreview = z.infer<typeof importedRecipePreviewSchema>;
export type RecentImportJob = z.infer<typeof recentImportJobSchema>;
export type RecentImportJobsResponse = z.infer<typeof recentImportJobsResponseSchema>;
export type GetImportJobResponse = z.infer<typeof getImportJobResponseSchema>;
export type DismissImportJobResponse = z.infer<typeof dismissImportJobResponseSchema>;
export type CancelImportJobResponse = z.infer<typeof cancelImportJobResponseSchema>;
