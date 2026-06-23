import { describe, expect, it } from "vitest";
import {
  createRecipeRequestSchema,
  createRecipeResponseSchema,
  getRecipeResponseSchema,
  listRecipesQuerySchema,
  listRecipesResponseSchema,
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

  it("保存画像の正の整数寸法を検証する", () => {
    expect(
      recipeContentSchema.safeParse({
        title: "Tomato pasta",
        coverImage: {
          objectKey: "recipes/user/recipe/cover.webp",
          width: 1200,
          height: 800,
        },
      }).success,
    ).toBe(true);

    expect(
      recipeContentSchema.safeParse({
        title: "Tomato pasta",
        coverImage: {
          objectKey: "recipes/user/recipe/cover.webp",
          width: 0,
          height: 800,
        },
      }).success,
    ).toBe(false);
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
        sourceName: "Example Kitchen",
        sourceUrl: "https://example.com/recipes/tomato?utm_source=newsletter",
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
          images: [{ type: "externalImageUrl", url: "https://example.com/image.jpg" }],
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("外部画像URLはhttp/httpsだけを受け入れる", () => {
    expect(
      recipeDraftContentSchema.safeParse({
        title: "Tomato pasta",
        coverImage: { type: "externalImageUrl", url: "https://example.com/image.jpg" },
      }).success,
    ).toBe(true);

    for (const url of [
      "javascript:alert(1)",
      "data:image/svg+xml,<svg></svg>",
      "ftp://example.com/image.jpg",
      "mailto:recipe@example.com",
    ]) {
      expect(
        recipeDraftContentSchema.safeParse({
          title: "Tomato pasta",
          coverImage: { type: "externalImageUrl", url },
        }).success,
      ).toBe(false);
    }
  });

  it("画像だけの手順を受け入れる", () => {
    const result = recipeDraftContentSchema.safeParse({
      title: "Tomato pasta",
      steps: [
        {
          images: [{ type: "tmpObjectKey", key: "tmp/user/step.webp" }],
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
        sourceUrl: "https://example.com/recipes/tomato",
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
          sourceUrl,
        }).success,
      ).toBe(false);
    }
  });

  it("保存リクエストの正規化済み出典URLは入力として採用しない", () => {
    const result = recipeSourceDraftSchema.safeParse({
      normalizedSourceUrl: "javascript:alert(1)",
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({});
  });
});

describe("createRecipeResponseSchema", () => {
  it("保存済みレシピの正規化済み出典URLを返せる", () => {
    const result = createRecipeResponseSchema.safeParse({
      recipe: {
        id: "recipe_123",
        title: "Tomato pasta",
        content: {
          title: "Tomato pasta",
          ingredientGroups: [],
          steps: [],
        },
        source: {
          sourceUrl: "https://example.com/recipes/tomato?utm_source=newsletter",
          normalizedSourceUrl: "https://example.com/recipes/tomato",
          sourceName: "Example Kitchen",
        },
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z",
        locked: false,
      },
    });

    expect(result.success).toBe(true);
  });
});

describe("getRecipeResponseSchema", () => {
  it("ロック中Recipe詳細はidとlockedだけを返せる", () => {
    const result = getRecipeResponseSchema.safeParse({
      recipe: {
        id: "recipe_123",
        locked: true,
      },
    });

    expect(result.success).toBe(true);
  });
});

describe("listRecipesSchema", () => {
  it("一覧クエリとcursorページレスポンスを受け入れる", () => {
    expect(
      listRecipesQuerySchema.parse({
        q: "tomato kitchen",
        limit: "10",
        cursor: "cursor_123",
      }),
    ).toEqual({
      q: "tomato kitchen",
      limit: 10,
      cursor: "cursor_123",
    });

    expect(
      listRecipesResponseSchema.safeParse({
        items: [
          {
            id: "recipe_123",
            title: "Tomato pasta",
            coverImageUrl: null,
            sourceName: "Example Kitchen",
            createdAt: "2026-05-25T00:00:00.000Z",
            updatedAt: "2026-05-26T00:00:00.000Z",
            locked: false,
          },
        ],
        nextCursor: null,
      }).success,
    ).toBe(true);
  });
});
