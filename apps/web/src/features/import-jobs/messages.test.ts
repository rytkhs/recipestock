import { type ImportJobSummary } from "@recipestock/schemas";
import { describe, expect, it } from "vitest";
import { ApiClientError } from "../../lib/api";
import { getCreateImportUrlJobErrorMessage, getImportJobFailureMessage } from "./messages";

const createJob = (overrides: Partial<ImportJobSummary> = {}): ImportJobSummary => ({
  id: "job_123",
  kind: "url",
  status: "failed",
  url: "https://example.com/recipes/tomato",
  recipeId: null,
  errorCode: "unknown",
  createdAt: "2026-06-01T00:00:00.000Z",
  startedAt: "2026-06-01T00:00:01.000Z",
  finishedAt: "2026-06-01T00:00:10.000Z",
  ...overrides,
});

describe("getCreateImportUrlJobErrorMessage", () => {
  it("recipe limit exceededを表示用messageにする", () => {
    expect(
      getCreateImportUrlJobErrorMessage(
        new ApiClientError({
          status: 403,
          code: "recipe_limit_exceeded",
          message: "Recipe limit exceeded.",
        }),
      ),
    ).toBe("保存できるレシピ数の上限に達しています。");
  });

  it("private/login requiredを入力画面用messageにする", () => {
    expect(
      getCreateImportUrlJobErrorMessage(
        new ApiClientError({
          status: 422,
          code: "private_or_login_required",
          message: "Private or login required.",
        }),
      ),
    ).toBe("この投稿を取得できませんでした。非公開またはログインが必要な投稿です。");
  });

  it("未知のerrorはfallback messageにする", () => {
    expect(getCreateImportUrlJobErrorMessage(new Error("network error"))).toBe(
      "URLを取り込めませんでした。",
    );
  });
});

describe("getImportJobFailureMessage", () => {
  it("fetch failedを表示用messageにする", () => {
    expect(getImportJobFailureMessage(createJob({ errorCode: "fetch_failed" }))).toBe(
      "ページを取得できませんでした。",
    );
  });

  it("job timeoutを表示用messageにする", () => {
    expect(getImportJobFailureMessage(createJob({ errorCode: "job_timeout" }))).toBe(
      "取り込み処理が時間内に完了しませんでした。再試行してください。",
    );
  });

  it("未知のerror codeはfallback messageにする", () => {
    expect(getImportJobFailureMessage(createJob({ errorCode: "unknown" }))).toBe(
      "URLを取り込めませんでした。",
    );
  });
});
