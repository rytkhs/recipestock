import { describe, expect, it, vi } from "vitest";
import {
  createRecipeRepository,
  InvalidRecipeListCursorError,
  isRecipeLockedForPlan,
  type NewRecipeRecord,
  normalizeRecipeSource,
} from "./recipes";

const createRecipe = (): NewRecipeRecord => ({
  id: "recipe_123",
  userId: "user_123",
  title: "Tomato pasta",
  content: {
    title: "Tomato pasta",
    referenceImages: [],
    ingredientGroups: [],
    steps: [],
  },
  originType: "manual",
  sourceUrl: "https://example.com/recipes/tomato?utm_source=newsletter#steps",
  normalizedSourceUrl: "https://example.com/recipes/tomato",
  sourceName: "Example Kitchen",
  searchText: "tomato pasta",
  createdAt: new Date("2026-05-26T00:00:00.000Z"),
  updatedAt: new Date("2026-05-26T00:00:00.000Z"),
});

describe("normalizeRecipeSource", () => {
  it("正規化済み出典URL入力を信用せずsourceUrlから再計算する", () => {
    expect(
      normalizeRecipeSource({
        sourceUrl: "https://example.com/recipes/tomato?utm_source=newsletter#steps",
        normalizedSourceUrl: "https://attacker.example/wrong",
      } as Parameters<typeof normalizeRecipeSource>[0]),
    ).toEqual({
      sourceUrl: "https://example.com/recipes/tomato?utm_source=newsletter#steps",
      normalizedSourceUrl: "https://example.com/recipes/tomato",
      sourceName: null,
    });
  });
});

describe("isRecipeLockedForPlan", () => {
  it("Freeユーザーは最新5件に含まれないRecipeをロックする", () => {
    expect(
      isRecipeLockedForPlan({
        plan: "free",
        recipeId: "recipe_6",
        unlockedRecipeIds: new Set(["recipe_1", "recipe_2", "recipe_3", "recipe_4", "recipe_5"]),
      }),
    ).toBe(true);
  });

  it("Proユーザーは保存件数にかかわらずRecipeをロックしない", () => {
    expect(
      isRecipeLockedForPlan({
        plan: "pro",
        recipeId: "recipe_6",
        unlockedRecipeIds: new Set(),
      }),
    ).toBe(false);
  });
});

describe("createRecipeRepository", () => {
  const planSyncOptions = {
    proPriceId: "price_pro",
    syncAppUserPlan: async () => "free" as const,
  };

  it("不正な一覧cursorはDBに問い合わせる前に入力エラーとして扱う", async () => {
    const repository = createRecipeRepository({} as never, planSyncOptions);

    await expect(
      repository.listRecipes({
        userId: "user_123",
        searchTerms: [],
        limit: 20,
        cursor: "not-base64",
      }),
    ).rejects.toThrow(InvalidRecipeListCursorError);
  });

  it("単一SQLで保存できた行をcreatedとして返す", async () => {
    const recipe = createRecipe();
    const execute = vi.fn(async () => ({
      rows: [
        {
          ...recipe,
          content: recipe.content,
          createdAt: recipe.createdAt.toISOString(),
          updatedAt: recipe.updatedAt.toISOString(),
        },
      ],
    }));
    const repository = createRecipeRepository({ execute } as never, planSyncOptions);

    await expect(repository.createRecipeEnforcingPlanLimit(recipe)).resolves.toEqual({
      status: "created",
      recipe,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("単一SQLが行を返さなければlimitExceededとして返す", async () => {
    const execute = vi.fn(async () => ({ rows: [] }));
    const repository = createRecipeRepository({ execute } as never, planSyncOptions);

    await expect(repository.createRecipeEnforcingPlanLimit(createRecipe())).resolves.toEqual({
      status: "limitExceeded",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("Recipe削除と保存件数更新を単一SQLで実行する", async () => {
    const execute = vi.fn(async () => ({ rows: [{ id: "recipe_123" }] }));
    const repository = createRecipeRepository({ execute } as never, planSyncOptions);

    await expect(repository.deleteRecipe("user_123", "recipe_123")).resolves.toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
