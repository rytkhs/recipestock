import { describe, expect, it } from "vitest";
import {
  formValuesToCreateRecipeRequest,
  recipeDetailToFormValues,
  recipeDraftContentToFormValues,
} from "./create-recipe-request";
import {
  createEmptyRecipeDraftFormValues,
  type RecipeDraftFormValues,
} from "./recipe-draft-form-values";

const createValues = (overrides: Partial<RecipeDraftFormValues> = {}): RecipeDraftFormValues => ({
  ...createEmptyRecipeDraftFormValues(),
  title: "Tomato pasta",
  ingredientGroups: [],
  steps: [],
  ...overrides,
});

describe("formValuesToCreateRecipeRequest", () => {
  it("空白をtrimする", () => {
    expect(
      formValuesToCreateRecipeRequest(
        createValues({
          title: "  Tomato pasta  ",
          yieldText: "  2人分  ",
          note: "  仕上げにオリーブオイル。  ",
          ingredientGroups: [
            {
              label: "  ソース  ",
              ingredients: [{ name: "  トマト缶  ", amount: "  1缶  " }],
            },
          ],
          steps: [{ text: "  煮詰める  ", images: [] }],
        }),
      ),
    ).toMatchObject({
      content: {
        title: "Tomato pasta",
        yieldText: "2人分",
        note: "仕上げにオリーブオイル。",
        ingredientGroups: [
          {
            label: "ソース",
            ingredients: [{ name: "トマト缶", amount: "1缶" }],
          },
        ],
        steps: [{ text: "煮詰める", images: [] }],
      },
      source: {},
    });
  });

  it("空の材料行と空の手順を除去する", () => {
    expect(
      formValuesToCreateRecipeRequest(
        createValues({
          ingredientGroups: [
            {
              label: "",
              ingredients: [
                { name: "  ", amount: "1缶" },
                { name: "バジル", amount: "" },
              ],
            },
            {
              label: "  ",
              ingredients: [{ name: "", amount: "" }],
            },
          ],
          steps: [
            { text: "  ", images: [] },
            { text: "煮詰める", images: [] },
          ],
        }),
      ),
    ).toMatchObject({
      content: {
        ingredientGroups: [{ ingredients: [{ name: "バジル", amount: "" }] }],
        steps: [{ text: "煮詰める", images: [] }],
      },
    });
  });

  it("画像だけの手順を保存対象にする", () => {
    expect(
      formValuesToCreateRecipeRequest(
        createValues({
          steps: [
            {
              text: "  ",
              images: [{ type: "tmpObjectKey", key: "tmp/user_123/step.webp" }],
            },
          ],
        }),
      ),
    ).toMatchObject({
      content: {
        steps: [
          {
            images: [{ type: "tmpObjectKey", key: "tmp/user_123/step.webp" }],
          },
        ],
      },
    });
  });

  it("手動作成では出典metadataを空にする", () => {
    expect(formValuesToCreateRecipeRequest(createValues()).source).toEqual({});
  });

  it("URL取り込みのsource metadataを保存リクエストに使える", () => {
    expect(
      formValuesToCreateRecipeRequest(createValues(), {
        sourceUrl: "https://cookpad.com/recipe/123",
        sourceName: "Cookpad",
      }).source,
    ).toEqual({
      sourceUrl: "https://cookpad.com/recipe/123",
      sourceName: "Cookpad",
    });
  });

  it("保存済みレシピ本文をフォーム値に戻す", () => {
    expect(
      recipeDetailToFormValues({
        id: "recipe_123",
        title: "Tomato pasta",
        content: {
          title: "Tomato pasta",
          yieldText: "2人分",
          sourceMedia: [],
          ingredientGroups: [
            { label: "ソース", ingredients: [{ name: "トマト缶", amount: "1缶" }] },
          ],
          steps: [{ text: "煮詰める", images: [] }],
          note: "仕上げにオリーブオイル。",
        },
        source: {
          sourceUrl: "https://example.com/recipes/tomato",
          normalizedSourceUrl: "https://example.com/recipes/tomato",
          sourceName: "Example Kitchen",
        },
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z",
        locked: false,
      }),
    ).toEqual({
      title: "Tomato pasta",
      yieldText: "2人分",
      sourceMedia: [],
      note: "仕上げにオリーブオイル。",
      ingredientGroups: [{ label: "ソース", ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
      steps: [{ text: "煮詰める", images: [] }],
    });
  });

  it("取り込みdraftをフォーム値に戻す", () => {
    expect(
      recipeDraftContentToFormValues({
        title: "Tomato pasta",
        yieldText: "2人分",
        coverImage: { type: "externalImageUrl", url: "https://example.com/cover.jpg" },
        sourceMedia: [{ type: "externalImageUrl", url: "https://example.com/source-media.jpg" }],
        ingredientGroups: [{ label: "ソース", ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
        steps: [
          {
            text: "煮詰める",
            images: [{ type: "externalImageUrl", url: "https://example.com/step.jpg" }],
          },
        ],
        note: "仕上げにオリーブオイル。",
      }),
    ).toEqual({
      title: "Tomato pasta",
      yieldText: "2人分",
      coverImage: { type: "externalImageUrl", url: "https://example.com/cover.jpg" },
      sourceMedia: [{ type: "externalImageUrl", url: "https://example.com/source-media.jpg" }],
      note: "仕上げにオリーブオイル。",
      ingredientGroups: [{ label: "ソース", ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
      steps: [
        {
          text: "煮詰める",
          images: [{ type: "externalImageUrl", url: "https://example.com/step.jpg" }],
        },
      ],
    });
  });
});
