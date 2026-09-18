import {
  type ApiErrorCode,
  type ImportErrorCode,
  type ImportJobSummary,
} from "@recipestock/schemas";
import { ApiClientError } from "../../lib/api";

const createImportUrlJobErrorMessages: Partial<Record<ApiErrorCode, string>> = {
  invalid_url: "URLを確認してください。",
  fetch_failed: "ページを取得できませんでした。",
  unsupported_page: "このページは取り込みに対応していません。",
  extraction_failed: "レシピ本文を見つけられませんでした。",
  private_or_login_required:
    "この投稿を取得できませんでした。非公開またはログインが必要な投稿です。",
  ai_usage_limit_exceeded: "今月の取り込み回数の上限に達しています。",
  ai_timeout: "タイムアウトしました。",
  ai_schema_invalid: "結果を読み取れませんでした。",
  recipe_limit_exceeded: "保存できるレシピ数の上限に達しています。",
};

const createImportTextJobErrorMessages: Partial<Record<ApiErrorCode, string>> = {
  validation_failed: "テキストを確認してください。",
  ai_usage_limit_exceeded: "今月の取り込み回数の上限に達しています。",
  recipe_limit_exceeded: "保存できるレシピ数の上限に達しています。",
};

const importJobFailureMessages: Partial<Record<ImportErrorCode, string>> = {
  invalid_url: "URLを確認してください。",
  fetch_failed: "ページを取得できませんでした。",
  unsupported_page: "このページは取り込みに対応していません。",
  extraction_failed: "レシピ本文を見つけられませんでした。",
  private_or_login_required: "この投稿を取得できませんでした。",
  ai_usage_limit_exceeded: "今月の取り込み回数の上限に達しています。",
  ai_timeout: "タイムアウトしました。",
  job_timeout: "取り込み処理が時間内に完了しませんでした。再試行してください。",
  ai_schema_invalid: "解析結果を保存できませんでした。",
  recipe_limit_exceeded: "保存できるレシピ数の上限に達しています。",
};

/**
 * テキストの取り込みにはページを取得する段階がないので、本文が見つからなかったとは伝えない。
 */
const textImportJobFailureMessages: Partial<Record<ImportErrorCode, string>> = {
  extraction_failed: "テキストからレシピを読み取れませんでした。",
};

const importJobFallbackMessages: Record<ImportJobSummary["kind"], string> = {
  url: "URLを取り込めませんでした。",
  text: "テキストを取り込めませんでした。",
};

export const getCreateImportUrlJobErrorMessage = (error: unknown): string => {
  if (!(error instanceof ApiClientError)) {
    return "URLを取り込めませんでした。";
  }

  return createImportUrlJobErrorMessages[error.code] ?? "URLを取り込めませんでした。";
};

export const getCreateImportTextJobErrorMessage = (error: unknown): string => {
  if (!(error instanceof ApiClientError)) {
    return importJobFallbackMessages.text;
  }

  return createImportTextJobErrorMessages[error.code] ?? importJobFallbackMessages.text;
};

export const getImportJobFailureMessage = (job: ImportJobSummary): string => {
  const fallback = importJobFallbackMessages[job.kind];

  if (!job.errorCode) {
    return fallback;
  }

  const textMessage = job.kind === "text" ? textImportJobFailureMessages[job.errorCode] : undefined;

  return textMessage ?? importJobFailureMessages[job.errorCode] ?? fallback;
};
