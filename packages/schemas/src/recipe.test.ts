import { describe, expect, it } from "vitest";
import { recipeContentSchema } from "./recipe";

describe("recipeContentSchema", () => {
  it("accepts a minimal saved recipe content shape", () => {
    const result = recipeContentSchema.safeParse({
      title: "Tomato pasta",
      ingredientGroups: [{ ingredients: [{ text: "200g pasta" }] }],
      steps: [{ text: "Boil pasta." }],
    });

    expect(result.success).toBe(true);
  });
});
