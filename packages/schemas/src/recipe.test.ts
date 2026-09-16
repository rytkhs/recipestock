import { describe, expect, it } from "vitest";
import {
  createRecipeRequestSchema,
  createRecipeResponseSchema,
  getRecipeResponseSchema,
  listRecipesQuerySchema,
  listRecipesResponseSchema,
  MAX_INGREDIENT_AMOUNT_LENGTH,
  MAX_INGREDIENT_GROUP_INGREDIENTS,
  MAX_INGREDIENT_NAME_LENGTH,
  MAX_RECIPE_INGREDIENT_GROUPS,
  MAX_RECIPE_NOTE_LENGTH,
  MAX_RECIPE_REFERENCE_IMAGES,
  MAX_RECIPE_SEARCH_QUERY_LENGTH,
  MAX_RECIPE_SOURCE_NAME_LENGTH,
  MAX_RECIPE_SOURCE_URL_LENGTH,
  MAX_RECIPE_STEP_IMAGES,
  MAX_RECIPE_STEP_TEXT_LENGTH,
  MAX_RECIPE_STEPS,
  MAX_RECIPE_TITLE_LENGTH,
  MAX_RECIPE_TOTAL_IMAGES,
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
    expect(result.data?.referenceImages).toEqual([]);
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

  it("レシピ画像を保存済みレシピ本文に持てる", () => {
    expect(
      recipeContentSchema.safeParse({
        title: "Tomato pasta",
        referenceImages: [
          {
            objectKey: "recipes/user/recipe/source.webp",
            width: 1200,
            height: 800,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("保存済みレシピ本文のレシピ画像枚数を制限する", () => {
    expect(
      recipeContentSchema.safeParse({
        title: "Tomato pasta",
        referenceImages: createSavedImages(MAX_RECIPE_REFERENCE_IMAGES),
      }).success,
    ).toBe(true);

    expect(
      recipeContentSchema.safeParse({
        title: "Tomato pasta",
        referenceImages: createSavedImages(MAX_RECIPE_REFERENCE_IMAGES + 1),
      }).success,
    ).toBe(false);
  });

  it("保存済みレシピ本文の1手順あたりの画像枚数を制限する", () => {
    expect(
      recipeContentSchema.safeParse({
        title: "Tomato pasta",
        steps: [{ images: createSavedImages(MAX_RECIPE_STEP_IMAGES) }],
      }).success,
    ).toBe(true);

    expect(
      recipeContentSchema.safeParse({
        title: "Tomato pasta",
        steps: [{ images: createSavedImages(MAX_RECIPE_STEP_IMAGES + 1) }],
      }).success,
    ).toBe(false);
  });

  it("保存済みレシピ本文の全体画像枚数を制限する", () => {
    expect(
      recipeContentSchema.safeParse({
        title: "Tomato pasta",
        coverImage: createSavedImage("cover"),
        referenceImages: createSavedImages(MAX_RECIPE_REFERENCE_IMAGES),
        steps: createSavedStepsWithImages(MAX_RECIPE_TOTAL_IMAGES - MAX_RECIPE_REFERENCE_IMAGES),
      }).success,
    ).toBe(true);

    expect(
      recipeContentSchema.safeParse({
        title: "Tomato pasta",
        referenceImages: createSavedImages(MAX_RECIPE_REFERENCE_IMAGES),
        steps: createSavedStepsWithImages(
          MAX_RECIPE_TOTAL_IMAGES - MAX_RECIPE_REFERENCE_IMAGES + 1,
        ),
      }).success,
    ).toBe(false);
  });
});

describe("recipeDraftContentSchema", () => {
  it("保存前入力で任意項目と出典を受け入れる", () => {
    const result = createRecipeRequestSchema.safeParse({
      content: {
        title: "Tomato pasta",
        yieldText: "2人分",
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
      referenceImages: [{ type: "externalImageUrl", url: "https://example.com/source.jpg" }],
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

  it("保存前入力のレシピ画像枚数を制限する", () => {
    expect(
      recipeDraftContentSchema.safeParse({
        title: "Tomato pasta",
        referenceImages: createDraftImages(MAX_RECIPE_REFERENCE_IMAGES),
      }).success,
    ).toBe(true);

    expect(
      recipeDraftContentSchema.safeParse({
        title: "Tomato pasta",
        referenceImages: createDraftImages(MAX_RECIPE_REFERENCE_IMAGES + 1),
      }).success,
    ).toBe(false);
  });

  it("保存前入力の1手順あたりの画像枚数を制限する", () => {
    expect(
      recipeDraftContentSchema.safeParse({
        title: "Tomato pasta",
        steps: [{ images: createDraftImages(MAX_RECIPE_STEP_IMAGES) }],
      }).success,
    ).toBe(true);

    expect(
      recipeDraftContentSchema.safeParse({
        title: "Tomato pasta",
        steps: [{ images: createDraftImages(MAX_RECIPE_STEP_IMAGES + 1) }],
      }).success,
    ).toBe(false);
  });

  it("保存前入力の全体画像枚数を制限する", () => {
    expect(
      recipeDraftContentSchema.safeParse({
        title: "Tomato pasta",
        coverImage: createDraftImage("cover"),
        referenceImages: createDraftImages(MAX_RECIPE_REFERENCE_IMAGES),
        steps: createDraftStepsWithImages(MAX_RECIPE_TOTAL_IMAGES - MAX_RECIPE_REFERENCE_IMAGES),
      }).success,
    ).toBe(true);

    expect(
      recipeDraftContentSchema.safeParse({
        title: "Tomato pasta",
        referenceImages: createDraftImages(MAX_RECIPE_REFERENCE_IMAGES),
        steps: createDraftStepsWithImages(
          MAX_RECIPE_TOTAL_IMAGES - MAX_RECIPE_REFERENCE_IMAGES + 1,
        ),
      }).success,
    ).toBe(false);
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
        tags: [{ id: "tag_123", name: "パスタ" }],
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
        sort: "oldest",
        limit: "10",
        cursor: "cursor_123",
      }),
    ).toEqual({
      q: "tomato kitchen",
      sort: "oldest",
      limit: 10,
      cursor: "cursor_123",
      tagId: [],
      untagged: false,
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
            locked: false,
          },
        ],
        nextCursor: null,
      }).success,
    ).toBe(true);
  });

  it("並び順は省略すると新しい順になり、追加日の2つ以外は受け入れない", () => {
    expect(listRecipesQuerySchema.parse({})).toEqual({
      sort: "newest",
      limit: 20,
      tagId: [],
      untagged: false,
    });
    expect(listRecipesQuerySchema.safeParse({ sort: "updated" }).success).toBe(false);
  });

  it("タグの指定は重複を除いて受け入れ、タグなしとは同時に使えない", () => {
    expect(listRecipesQuerySchema.parse({ tagId: ["tag_1", "tag_2", "tag_1"] }).tagId).toEqual([
      "tag_1",
      "tag_2",
    ]);
    expect(listRecipesQuerySchema.parse({ untagged: "true" }).untagged).toBe(true);
    expect(listRecipesQuerySchema.safeParse({ tagId: ["tag_1"], untagged: "true" }).success).toBe(
      false,
    );
    expect(
      listRecipesQuerySchema.safeParse({
        tagId: Array.from({ length: 11 }, (_, index) => `tag_${index}`),
      }).success,
    ).toBe(false);
  });
});

describe("本文の長さと件数の上限", () => {
  const draftWith = (content: Record<string, unknown>) =>
    recipeDraftContentSchema.safeParse({ title: "Tomato pasta", ...content }).success;

  it("上限ちょうどの本文は受け入れ、超えた本文は拒む", () => {
    expect(draftWith({ title: "あ".repeat(MAX_RECIPE_TITLE_LENGTH) })).toBe(true);
    expect(draftWith({ title: "あ".repeat(MAX_RECIPE_TITLE_LENGTH + 1) })).toBe(false);

    expect(draftWith({ note: "い".repeat(MAX_RECIPE_NOTE_LENGTH) })).toBe(true);
    expect(draftWith({ note: "い".repeat(MAX_RECIPE_NOTE_LENGTH + 1) })).toBe(false);

    expect(draftWith({ steps: [{ text: "う".repeat(MAX_RECIPE_STEP_TEXT_LENGTH) }] })).toBe(true);
    expect(draftWith({ steps: [{ text: "う".repeat(MAX_RECIPE_STEP_TEXT_LENGTH + 1) }] })).toBe(
      false,
    );

    const ingredient = (name: string, amount: string) => ({
      ingredientGroups: [{ ingredients: [{ name, amount }] }],
    });
    expect(draftWith(ingredient("え".repeat(MAX_INGREDIENT_NAME_LENGTH), "1"))).toBe(true);
    expect(draftWith(ingredient("え".repeat(MAX_INGREDIENT_NAME_LENGTH + 1), "1"))).toBe(false);
    expect(draftWith(ingredient("塩", "お".repeat(MAX_INGREDIENT_AMOUNT_LENGTH)))).toBe(true);
    expect(draftWith(ingredient("塩", "お".repeat(MAX_INGREDIENT_AMOUNT_LENGTH + 1)))).toBe(false);
  });

  it("上限ちょうどの件数は受け入れ、超えた件数は拒む", () => {
    const steps = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ text: `手順${index}` }));
    expect(draftWith({ steps: steps(MAX_RECIPE_STEPS) })).toBe(true);
    expect(draftWith({ steps: steps(MAX_RECIPE_STEPS + 1) })).toBe(false);

    const groups = (count: number) => Array.from({ length: count }, () => ({ ingredients: [] }));
    expect(draftWith({ ingredientGroups: groups(MAX_RECIPE_INGREDIENT_GROUPS) })).toBe(true);
    expect(draftWith({ ingredientGroups: groups(MAX_RECIPE_INGREDIENT_GROUPS + 1) })).toBe(false);

    const ingredients = (count: number) => [
      {
        ingredients: Array.from({ length: count }, (_, index) => ({
          name: `材料${index}`,
          amount: "1",
        })),
      },
    ];
    expect(draftWith({ ingredientGroups: ingredients(MAX_INGREDIENT_GROUP_INGREDIENTS) })).toBe(
      true,
    );
    expect(draftWith({ ingredientGroups: ingredients(MAX_INGREDIENT_GROUP_INGREDIENTS + 1) })).toBe(
      false,
    );
  });

  // 保存済みの本文は読み取りのたびに検証する。上限を後から足しても既存のRecipeを読めるままにする。
  it("保存済みのレシピ本文には長さと件数の上限を持たせない", () => {
    expect(
      recipeContentSchema.safeParse({
        title: "あ".repeat(MAX_RECIPE_TITLE_LENGTH + 100),
        note: "い".repeat(MAX_RECIPE_NOTE_LENGTH + 100),
        ingredientGroups: [
          { ingredients: [{ name: "え".repeat(MAX_INGREDIENT_NAME_LENGTH + 100), amount: "1" }] },
        ],
        steps: [{ text: "う".repeat(MAX_RECIPE_STEP_TEXT_LENGTH + 100) }],
      }).success,
    ).toBe(true);
  });

  it("保存要求の出典は長さの上限を持ち、保存済みの出典は持たない", () => {
    const requestWith = (source: Record<string, unknown>) =>
      createRecipeRequestSchema.safeParse({ content: { title: "Tomato pasta" }, source }).success;

    expect(requestWith({ sourceName: "あ".repeat(MAX_RECIPE_SOURCE_NAME_LENGTH) })).toBe(true);
    expect(requestWith({ sourceName: "あ".repeat(MAX_RECIPE_SOURCE_NAME_LENGTH + 1) })).toBe(false);
    expect(
      requestWith({
        sourceUrl: `https://example.com/${"a".repeat(MAX_RECIPE_SOURCE_URL_LENGTH)}`,
      }),
    ).toBe(false);
    expect(
      recipeSourceDraftSchema.safeParse({
        sourceName: "あ".repeat(MAX_RECIPE_SOURCE_NAME_LENGTH + 1),
      }).success,
    ).toBe(true);
  });

  it("検索クエリの長さを上限で止める", () => {
    expect(
      listRecipesQuerySchema.safeParse({ q: "あ".repeat(MAX_RECIPE_SEARCH_QUERY_LENGTH) }).success,
    ).toBe(true);
    expect(
      listRecipesQuerySchema.safeParse({ q: "あ".repeat(MAX_RECIPE_SEARCH_QUERY_LENGTH + 1) })
        .success,
    ).toBe(false);
  });
});

const createSavedImage = (id: string) => ({
  objectKey: `recipes/user/recipe/${id}.webp`,
  width: 1200,
  height: 800,
});

const createSavedImages = (count: number) =>
  Array.from({ length: count }, (_, index) => createSavedImage(`image-${index}`));

const createSavedStepsWithImages = (imageCount: number) =>
  Array.from({ length: Math.ceil(imageCount / MAX_RECIPE_STEP_IMAGES) }, (_, stepIndex) => ({
    images: createSavedImages(
      Math.min(MAX_RECIPE_STEP_IMAGES, imageCount - stepIndex * MAX_RECIPE_STEP_IMAGES),
    ),
  }));

const createDraftImage = (id: string) => ({
  type: "tmpObjectKey" as const,
  key: `tmp/user/${id}.webp`,
});

const createDraftImages = (count: number) =>
  Array.from({ length: count }, (_, index) => createDraftImage(`image-${index}`));

const createDraftStepsWithImages = (imageCount: number) =>
  Array.from({ length: Math.ceil(imageCount / MAX_RECIPE_STEP_IMAGES) }, (_, stepIndex) => ({
    images: createDraftImages(
      Math.min(MAX_RECIPE_STEP_IMAGES, imageCount - stepIndex * MAX_RECIPE_STEP_IMAGES),
    ),
  }));
