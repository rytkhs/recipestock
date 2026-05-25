import { describe, expect, it } from "vitest";
import { recipeContentSchema } from "./recipe";

describe("recipeContentSchema", () => {
  it("最小構成の保存済みレシピ本文を受け入れる", () => {
    const result = recipeContentSchema.safeParse({
      title: "Tomato pasta",
      ingredientGroups: [{ ingredients: [{ text: "200g pasta" }] }],
      steps: [{ text: "Boil pasta." }],
    });

    expect(result.success).toBe(true);
  });
});
