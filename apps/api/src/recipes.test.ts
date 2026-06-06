import { describe, expect, it, vi } from "vitest";
import {
  createRecipeRepository,
  createRecipeWithPlanLimitInSession,
  InvalidRecipeListCursorError,
  isRecipeLockedForPlan,
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
});
