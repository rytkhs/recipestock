import { describe, expect, it } from "vitest";
import {
  IMPORT_TEXT_MAX_LENGTH,
  importJobSummarySchema,
  importTextRequestSchema,
  importUrlRequestSchema,
} from "./import";

describe("import schemas", () => {
  it("URL取り込みはHTTP(S)かつ4096文字以下だけを受け入れる", () => {
    expect(importUrlRequestSchema.safeParse({ url: "https://example.com/recipe" }).success).toBe(
      true,
    );
    expect(importUrlRequestSchema.safeParse({ url: "ftp://example.com/recipe" }).success).toBe(
      false,
    );
    expect(
      importUrlRequestSchema.safeParse({
        url: `https://example.com/${"a".repeat(4097)}`,
      }).success,
    ).toBe(false);
  });

  it("テキスト取り込みは前後の空白を除いた原文を上限文字数まで受け入れる", () => {
    expect(
      importTextRequestSchema.parse({ text: "\n  鶏むね肉のレモン煮\n鶏むね肉 300g  \n" }),
    ).toEqual({ text: "鶏むね肉のレモン煮\n鶏むね肉 300g" });
    expect(
      importTextRequestSchema.safeParse({ text: ` ${"あ".repeat(IMPORT_TEXT_MAX_LENGTH)} ` })
        .success,
    ).toBe(true);
    expect(
      importTextRequestSchema.safeParse({ text: "あ".repeat(IMPORT_TEXT_MAX_LENGTH + 1) }).success,
    ).toBe(false);
    expect(importTextRequestSchema.safeParse({ text: " \n\t " }).success).toBe(false);
  });

  it("private/login required import error codeを受け入れる", () => {
    expect(
      importJobSummarySchema.parse({
        id: "job_private",
        kind: "url",
        status: "failed",
        url: "https://www.instagram.com/p/DYsxvKyAZMg/",
        textPreview: null,
        recipeId: null,
        errorCode: "private_or_login_required",
        createdAt: "2026-06-01T00:00:00.000Z",
        startedAt: "2026-06-01T00:00:01.000Z",
        finishedAt: "2026-06-01T00:00:10.000Z",
      }),
    ).toMatchObject({
      errorCode: "private_or_login_required",
    });
  });
});
