import { describe, expect, it } from "vitest";
import {
  getImportJobExpiresBefore,
  type ImportJobRecord,
  resolveImportJobTimeoutMs,
  toImportJobSummary,
} from "./jobs";

const createJob = (overrides: Partial<ImportJobRecord> = {}): ImportJobRecord => ({
  id: "job_123",
  userId: "user_123",
  kind: "url",
  status: "running",
  url: "https://example.com/recipe",
  normalizedUrl: "https://example.com/recipe",
  sourceText: null,
  recipeId: "recipe_123",
  errorCode: null,
  errorMessage: null,
  dismissedAt: null,
  completionNotificationRequested: false,
  completionNotificationSentAt: null,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  startedAt: new Date("2026-06-01T00:00:00.000Z"),
  finishedAt: null,
  updatedAt: new Date("2026-06-01T00:00:00.000Z"),
  ...overrides,
});

describe("Import JobのSource Text preview", () => {
  const sourceText = "鶏むね肉のレモン煮\n鶏むね肉 300g";

  it("閉じたテキストjobも原文の最初の行をpreviewとして返す", () => {
    const job = createJob({
      kind: "text",
      status: "failed",
      sourceText,
      dismissedAt: new Date("2026-06-01T00:01:00.000Z"),
    });
    expect(toImportJobSummary(job).textPreview).toBe("鶏むね肉のレモン煮");
  });
});

describe("Import job timeout", () => {
  it("デフォルト期限を10分として計算する", () => {
    expect(resolveImportJobTimeoutMs({})).toBe(600_000);
    expect(getImportJobExpiresBefore(new Date("2026-06-01T00:10:00.000Z"), 600_000)).toEqual(
      new Date("2026-06-01T00:00:00.000Z"),
    );
  });

  it("正の整数だけを環境変数から採用する", () => {
    expect(resolveImportJobTimeoutMs({ IMPORT_JOB_TIMEOUT_MS: "300000" })).toBe(300_000);
    expect(resolveImportJobTimeoutMs({ IMPORT_JOB_TIMEOUT_MS: "invalid" })).toBe(600_000);
    expect(resolveImportJobTimeoutMs({ IMPORT_JOB_TIMEOUT_MS: "0" })).toBe(600_000);
  });
});
