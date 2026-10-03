import { describe, expect, it } from "vitest";
import { IMPORT_TEXT_MAX_LENGTH, importTextRequestSchema, importUrlRequestSchema } from "./import";
import { MAX_RECIPE_SOURCE_URL_LENGTH } from "./recipe";

describe("import schemas", () => {
  it("URL取り込みはHTTP(S)かつ出典として保存できる長さだけを受け入れる", () => {
    expect(importUrlRequestSchema.safeParse({ url: "https://example.com/recipe" }).success).toBe(
      true,
    );
    expect(importUrlRequestSchema.safeParse({ url: "ftp://example.com/recipe" }).success).toBe(
      false,
    );
    expect(
      importUrlRequestSchema.safeParse({
        url: createUrlOfLength(MAX_RECIPE_SOURCE_URL_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      importUrlRequestSchema.safeParse({
        url: createUrlOfLength(MAX_RECIPE_SOURCE_URL_LENGTH + 1),
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
});

const createUrlOfLength = (length: number) => {
  const prefix = "https://example.com/";
  return `${prefix}${"a".repeat(length - prefix.length)}`;
};
