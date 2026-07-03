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
  ai_usage_limit_exceeded: "今月のAI利用回数の上限に達しています。",
  ai_timeout: "タイムアウトしました。",
  ai_schema_invalid: "結果を読み取れませんでした。",
  recipe_limit_exceeded: "保存できるレシピ数の上限に達しています。",
};

const importJobFailureMessages: Partial<Record<ImportErrorCode, string>> = {
  invalid_url: "URLを確認してください。",
  fetch_failed: "ページを取得できませんでした。",
  unsupported_page: "このページは取り込みに対応していません。",
  extraction_failed: "レシピ本文を見つけられませんでした。",
  private_or_login_required: "この投稿を取得できませんでした。",
  ai_usage_limit_exceeded: "今月のAI利用回数の上限に達しています。",
  ai_timeout: "タイムアウトしました。",
  job_timeout: "取り込み処理が時間内に完了しませんでした。再試行してください。",
  ai_schema_invalid: "解析結果を保存できませんでした。",
  recipe_limit_exceeded: "保存できるレシピ数の上限に達しています。",
};

export const getCreateImportUrlJobErrorMessage = (error: unknown): string => {
  if (!(error instanceof ApiClientError)) {
    return "URLを取り込めませんでした。";
  }

  return createImportUrlJobErrorMessages[error.code] ?? "URLを取り込めませんでした。";
};

export const getImportJobFailureMessage = (job: ImportJobSummary): string =>
  job.errorCode
    ? (importJobFailureMessages[job.errorCode] ?? "URLを取り込めませんでした。")
    : "URLを取り込めませんでした。";
