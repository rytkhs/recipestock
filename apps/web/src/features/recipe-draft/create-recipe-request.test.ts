import { describe, expect, it } from "vitest";
import { formValuesToCreateRecipeRequest } from "./create-recipe-request";
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
          sourceName: "  Example Kitchen  ",
          sourceUrl: "  https://example.com/recipes/tomato  ",
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
        sourceName: "Example Kitchen",
        sourceUrl: "https://example.com/recipes/tomato",
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

  it("出典名と元URLがあってもsourceTypeはmanualにする", () => {
    expect(
      formValuesToCreateRecipeRequest(
        createValues({
          sourceName: "Example Kitchen",
          sourceUrl: "https://example.com/recipes/tomato",
        }),
      ).source,
    ).toEqual({
      sourceType: "manual",
      sourceName: "Example Kitchen",
      sourceUrl: "https://example.com/recipes/tomato",
    });
  });

  it("出典入力なしでもsourceTypeはmanualにする", () => {
    expect(formValuesToCreateRecipeRequest(createValues()).source).toEqual({
      sourceType: "manual",
      sourceName: undefined,
      sourceUrl: undefined,
    });
  });

  it("不正なURLはcreateRecipeRequestSchemaで失敗する", () => {
    expect(() =>
      formValuesToCreateRecipeRequest(
        createValues({
          sourceUrl: "not-a-url",
        }),
      ),
    ).toThrow();
  });
});
