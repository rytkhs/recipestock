import {
  MAX_INGREDIENT_AMOUNT_LENGTH,
  MAX_INGREDIENT_GROUP_INGREDIENTS,
  MAX_INGREDIENT_NAME_LENGTH,
  MAX_RECIPE_INGREDIENT_GROUPS,
  MAX_RECIPE_NOTE_LENGTH,
  MAX_RECIPE_REFERENCE_IMAGES,
  MAX_RECIPE_STEP_IMAGES,
  MAX_RECIPE_STEP_TEXT_LENGTH,
  MAX_RECIPE_STEPS,
  MAX_RECIPE_TITLE_LENGTH,
  MAX_RECIPE_TOTAL_IMAGES,
  type RecipeDraftContent,
} from "@recipestock/schemas";
import { describe, expect, it } from "vitest";
import { trimRecipeDraftContent } from "./draft-limits";

const externalImages = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, index) => ({
    type: "externalImageUrl" as const,
    url: `https://example.com/${prefix}-${index}.jpg`,
  }));

const draft = (content: Partial<RecipeDraftContent> = {}): RecipeDraftContent => ({
  title: "Tomato pasta",
  referenceImages: [],
  ingredientGroups: [],
  steps: [],
  ...content,
});

describe("trimRecipeDraftContent", () => {
  it("長すぎる本文を末尾から切り詰めて保存できる形にする", () => {
    const trimmed = trimRecipeDraftContent(
      draft({
        title: "あ".repeat(MAX_RECIPE_TITLE_LENGTH + 10),
        note: "い".repeat(MAX_RECIPE_NOTE_LENGTH + 10),
        ingredientGroups: [
          {
            ingredients: [
              {
                name: "う".repeat(MAX_INGREDIENT_NAME_LENGTH + 10),
                amount: "え".repeat(MAX_INGREDIENT_AMOUNT_LENGTH + 10),
              },
            ],
          },
        ],
        steps: [{ text: "お".repeat(MAX_RECIPE_STEP_TEXT_LENGTH + 10), images: [] }],
      }),
    );

    expect(trimmed.title).toHaveLength(MAX_RECIPE_TITLE_LENGTH);
    expect(trimmed.note).toHaveLength(MAX_RECIPE_NOTE_LENGTH);
    expect(trimmed.ingredientGroups[0]?.ingredients[0]?.name).toHaveLength(
      MAX_INGREDIENT_NAME_LENGTH,
    );
    expect(trimmed.ingredientGroups[0]?.ingredients[0]?.amount).toHaveLength(
      MAX_INGREDIENT_AMOUNT_LENGTH,
    );
    expect(trimmed.steps[0]?.text).toHaveLength(MAX_RECIPE_STEP_TEXT_LENGTH);
  });

  it("多すぎる材料と手順を上限の数まで残す", () => {
    const trimmed = trimRecipeDraftContent(
      draft({
        ingredientGroups: Array.from({ length: MAX_RECIPE_INGREDIENT_GROUPS + 3 }, () => ({
          ingredients: Array.from({ length: MAX_INGREDIENT_GROUP_INGREDIENTS + 3 }, (_, index) => ({
            name: `材料${index}`,
            amount: "1",
          })),
        })),
        steps: Array.from({ length: MAX_RECIPE_STEPS + 3 }, (_, index) => ({
          text: `手順${index}`,
          images: [],
        })),
      }),
    );

    expect(trimmed.ingredientGroups).toHaveLength(MAX_RECIPE_INGREDIENT_GROUPS);
    expect(
      trimmed.ingredientGroups.every(
        (group) => group.ingredients.length === MAX_INGREDIENT_GROUP_INGREDIENTS,
      ),
    ).toBe(true);
    expect(trimmed.steps).toHaveLength(MAX_RECIPE_STEPS);
    expect(trimmed.steps.at(-1)?.text).toBe(`手順${MAX_RECIPE_STEPS - 1}`);
  });

  it("画像は種類ごとの上限と合計の上限の小さいほうまで残す", () => {
    const trimmed = trimRecipeDraftContent(
      draft({
        referenceImages: externalImages(MAX_RECIPE_REFERENCE_IMAGES + 5, "source"),
        steps: Array.from({ length: 12 }, (_, index) => ({
          text: `手順${index}`,
          images: externalImages(MAX_RECIPE_STEP_IMAGES + 2, `step-${index}`),
        })),
      }),
    );

    expect(trimmed.referenceImages).toHaveLength(MAX_RECIPE_REFERENCE_IMAGES);
    expect(trimmed.steps.every((step) => step.images.length <= MAX_RECIPE_STEP_IMAGES)).toBe(true);
    expect(
      trimmed.referenceImages.length +
        trimmed.steps.reduce((count, step) => count + step.images.length, 0),
    ).toBe(MAX_RECIPE_TOTAL_IMAGES);
  });

  it("切り詰めた結果、本文も画像もなくなった手順は落とす", () => {
    const trimmed = trimRecipeDraftContent(
      draft({
        referenceImages: externalImages(MAX_RECIPE_TOTAL_IMAGES - 80, "source"),
        steps: [
          { text: "煮る", images: [] },
          { images: externalImages(MAX_RECIPE_STEP_IMAGES, "step-1") },
        ],
      }),
    );

    expect(trimmed.steps).toHaveLength(2);

    const withoutBudget = trimRecipeDraftContent(
      draft({
        referenceImages: externalImages(MAX_RECIPE_REFERENCE_IMAGES, "source"),
        steps: [
          ...Array.from({ length: 8 }, (_, index) => ({
            text: `手順${index}`,
            images: externalImages(MAX_RECIPE_STEP_IMAGES, `step-${index}`),
          })),
          { images: externalImages(MAX_RECIPE_STEP_IMAGES, "last") },
        ],
      }),
    );

    // 合計100枚を使い切った後の、画像しかない手順は残らない。
    expect(withoutBudget.steps).toHaveLength(8);
  });
});
