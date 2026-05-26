import { describe, expect, it } from "vitest";
import {
  createRecipeRequestSchema,
  recipeContentSchema,
  recipeDraftContentSchema,
  recipeSourceDraftSchema,
} from "./recipe";

describe("recipeContentSchema", () => {
  it("タイトルだけの保存済みレシピ本文を受け入れる", () => {
    const result = recipeContentSchema.safeParse({
      title: "Tomato pasta",
    });

    expect(result.success).toBe(true);
  });
});

describe("recipeDraftContentSchema", () => {
  it("保存前入力で任意項目と出典を受け入れる", () => {
    const result = createRecipeRequestSchema.safeParse({
      content: {
        title: "Tomato pasta",
        servingsText: "2人分",
        ingredientGroups: [
          {
            label: "ソース",
            ingredients: [{ name: "トマト缶", amount: "1缶" }],
          },
        ],
        steps: [{ text: "煮詰める" }],
        note: "仕上げにオリーブオイル。",
      },
      source: {
        sourceType: "web",
        sourceName: "Example Kitchen",
        sourceUrl: "https://example.com/recipes/tomato?utm_source=newsletter",
        normalizedSourceUrl: "https://example.com/recipes/tomato",
      },
    });

    expect(result.success).toBe(true);
  });

  it("RecipeDraftContentの画像参照を受け入れる", () => {
    const result = recipeDraftContentSchema.safeParse({
      title: "Tomato pasta",
      coverImage: { type: "tmpObjectKey", key: "tmp/user/image.webp" },
      steps: [
        {
          text: "盛り付ける",
          image: { type: "externalImageUrl", url: "https://example.com/image.jpg" },
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});

describe("recipeSourceDraftSchema", () => {
  it("出典URLはhttp/httpsだけを受け入れる", () => {
    expect(
      recipeSourceDraftSchema.safeParse({
        sourceType: "web",
        sourceUrl: "https://example.com/recipes/tomato",
        normalizedSourceUrl: "http://example.com/recipes/tomato",
      }).success,
    ).toBe(true);

    for (const sourceUrl of [
      "javascript:alert(1)",
      "data:text/html,<svg onload=alert(1)>",
      "ftp://example.com/recipes/tomato",
      "mailto:recipe@example.com",
    ]) {
      expect(
        recipeSourceDraftSchema.safeParse({
          sourceType: "web",
          sourceUrl,
        }).success,
      ).toBe(false);
    }
  });

  it("正規化済み出典URLもhttp/httpsだけを受け入れる", () => {
    const result = recipeSourceDraftSchema.safeParse({
      sourceType: "web",
      normalizedSourceUrl: "javascript:alert(1)",
    });

    expect(result.success).toBe(false);
  });
});
