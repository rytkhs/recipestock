import { describe, expect, it } from "vitest";
import { formValuesToCreateRecipeRequest, recipeDetailToFormValues } from "./create-recipe-request";
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
          servingsText: "  2人分  ",
          note: "  仕上げにオリーブオイル。  ",
          ingredientGroups: [
            {
              label: "  ソース  ",
              ingredients: [{ name: "  トマト缶  ", amount: "  1缶  " }],
            },
          ],
          steps: [{ text: "  煮詰める  " }],
        }),
      ),
    ).toMatchObject({
      content: {
        title: "Tomato pasta",
        servingsText: "2人分",
        note: "仕上げにオリーブオイル。",
        ingredientGroups: [
          {
            label: "ソース",
            ingredients: [{ name: "トマト缶", amount: "1缶" }],
          },
        ],
        steps: [{ text: "煮詰める" }],
      },
      source: {
        sourceType: "manual",
      },
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
          steps: [{ text: "  " }, { text: "煮詰める" }],
        }),
      ),
    ).toMatchObject({
      content: {
        ingredientGroups: [{ ingredients: [{ name: "バジル", amount: "" }] }],
        steps: [{ text: "煮詰める" }],
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
              image: { type: "tmpObjectKey", key: "tmp/user_123/step.webp" },
            },
          ],
        }),
      ),
    ).toMatchObject({
      content: {
        steps: [
          {
            image: { type: "tmpObjectKey", key: "tmp/user_123/step.webp" },
          },
        ],
      },
    });
  });

  it("手動作成ではsourceTypeだけをmanualにする", () => {
    expect(formValuesToCreateRecipeRequest(createValues()).source).toEqual({
      sourceType: "manual",
    });
  });

  it("保存済みレシピ本文をフォーム値に戻す", () => {
    expect(
      recipeDetailToFormValues({
        id: "recipe_123",
        title: "Tomato pasta",
        content: {
          title: "Tomato pasta",
          servingsText: "2人分",
          ingredientGroups: [
            { label: "ソース", ingredients: [{ name: "トマト缶", amount: "1缶" }] },
          ],
          steps: [{ text: "煮詰める" }],
          note: "仕上げにオリーブオイル。",
        },
        source: {
          sourceType: "web",
          sourcePlatform: null,
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
      servingsText: "2人分",
      note: "仕上げにオリーブオイル。",
      ingredientGroups: [{ label: "ソース", ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
      steps: [{ text: "煮詰める" }],
    });
  });
});
