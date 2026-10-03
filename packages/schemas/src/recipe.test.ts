import { describe, expect, it } from "vitest";
import {
  createRecipeRequestSchema,
  listRecipesQuerySchema,
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
  it("外部画像URLはhttp/httpsだけを受け入れる", () => {
    expect(
      recipeDraftContentSchema.safeParse({
        title: "Tomato pasta",
        coverImage: { type: "externalImageUrl", url: "https://example.com/image.jpg" },
      }).success,
    ).toBe(true);

    expect(
      recipeDraftContentSchema.safeParse({
        title: "Tomato pasta",
        coverImage: { type: "externalImageUrl", url: "javascript:alert(1)" },
      }).success,
    ).toBe(false);
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

    expect(
      recipeSourceDraftSchema.safeParse({
        sourceUrl: "javascript:alert(1)",
      }).success,
    ).toBe(false);
  });
});

describe("listRecipesSchema", () => {
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
