import { describe, expect, it } from "vitest";
import {
  createRecipeWithPlanLimitInSession,
  type NewRecipeRecord,
  normalizeRecipeSource,
  type RecipeWriteSession,
} from "./recipes";

const createRecipe = (): NewRecipeRecord => ({
  id: "recipe_123",
  userId: "user_123",
  title: "Tomato pasta",
  content: {
    title: "Tomato pasta",
    ingredientGroups: [],
    steps: [],
  },
  sourceType: "web",
  sourcePlatform: null,
  sourceUrl: "https://example.com/recipes/tomato?utm_source=newsletter#steps",
  normalizedSourceUrl: "https://example.com/recipes/tomato",
  sourceName: "Example Kitchen",
  searchText: "tomato pasta",
  createdAt: new Date("2026-05-26T00:00:00.000Z"),
  updatedAt: new Date("2026-05-26T00:00:00.000Z"),
});

const createSession = ({
  plan = "free",
  recipeCount = 0,
}: {
  plan?: "free" | "pro";
  recipeCount?: number;
} = {}) => {
  const calls: string[] = [];
  const session: RecipeWriteSession = {
    async ensureAppUser(userId) {
      calls.push(`ensure:${userId}`);
    },
    async lockAppUser(userId) {
      calls.push(`lock:${userId}`);
      return { userId, plan };
    },
    async countRecipes(userId) {
      calls.push(`count:${userId}`);
      return recipeCount;
    },
    async insertRecipe(recipe) {
      calls.push(`insert:${recipe.id}`);
      return recipe;
    },
  };

  return { calls, session };
};

describe("normalizeRecipeSource", () => {
  it("正規化済み出典URL入力を信用せずsourceUrlから再計算する", () => {
    expect(
      normalizeRecipeSource({
        sourceType: "web",
        sourceUrl: "https://example.com/recipes/tomato?utm_source=newsletter#steps",
        normalizedSourceUrl: "https://attacker.example/wrong",
      } as Parameters<typeof normalizeRecipeSource>[0]),
    ).toEqual({
      sourceType: "web",
      sourcePlatform: null,
      sourceUrl: "https://example.com/recipes/tomato?utm_source=newsletter#steps",
      normalizedSourceUrl: "https://example.com/recipes/tomato",
      sourceName: null,
    });
  });
});

describe("createRecipeWithPlanLimitInSession", () => {
  it("Freeユーザーはapp_user行をロックしてから件数確認と保存を行う", async () => {
    const { calls, session } = createSession({ plan: "free", recipeCount: 4 });
    const recipe = createRecipe();

    await expect(createRecipeWithPlanLimitInSession(session, recipe)).resolves.toEqual({
      status: "created",
      recipe,
    });
    expect(calls).toEqual([
      "ensure:user_123",
      "lock:user_123",
      "count:user_123",
      "insert:recipe_123",
    ]);
  });

  it("Freeユーザーが上限到達済みなら保存しない", async () => {
    const { calls, session } = createSession({ plan: "free", recipeCount: 5 });

    await expect(createRecipeWithPlanLimitInSession(session, createRecipe())).resolves.toEqual({
      status: "limitExceeded",
    });
    expect(calls).toEqual(["ensure:user_123", "lock:user_123", "count:user_123"]);
  });

  it("Proユーザーは件数確認なしで保存する", async () => {
    const { calls, session } = createSession({ plan: "pro", recipeCount: 100 });
    const recipe = createRecipe();

    await expect(createRecipeWithPlanLimitInSession(session, recipe)).resolves.toEqual({
      status: "created",
      recipe,
    });
    expect(calls).toEqual(["ensure:user_123", "lock:user_123", "insert:recipe_123"]);
  });
});
