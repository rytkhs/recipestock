import {
  createRecipeResponseSchema,
  getRecipeResponseSchema,
  listRecipesResponseSchema,
  type RecipeDetail,
  updateRecipeResponseSchema,
} from "@recipestock/schemas";
import { getResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHandlers } from "./handlers";
import { findScenario } from "./scenarios";

type Handlers = ReturnType<typeof createHandlers>;

const send = async (handlers: Handlers, method: string, path: string, body?: unknown) => {
  const request = new Request(new URL(path, window.location.origin), {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await getResponse(handlers, request);

  if (!response) {
    throw new Error(`No mock response for ${method} ${path}`);
  }

  return response;
};

const setup = () => createHandlers(findScenario("default").build(), { delayMs: 0 });

const listFirstPage = async (handlers: Handlers) =>
  listRecipesResponseSchema.parse(await (await send(handlers, "GET", "/api/recipes")).json());

const getRecipe = async (handlers: Handlers, recipeId: string) =>
  getRecipeResponseSchema.parse(
    await (await send(handlers, "GET", `/api/recipes/${recipeId}`)).json(),
  ).recipe as RecipeDetail;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mock handlers", () => {
  it("作成したRecipeは送った内容で詳細と一覧に反映される", async () => {
    const handlers = setup();

    const response = await send(handlers, "POST", "/api/recipes", {
      content: {
        title: "入力したタイトル",
        coverImage: { type: "tmpObjectKey", key: "tmp/user_123/upload_1.webp" },
        ingredientGroups: [{ ingredients: [{ name: "卵", amount: "2個" }] }],
        steps: [{ text: "焼く。" }],
      },
      source: { sourceName: "手入力" },
    });

    expect(response.status).toBe(201);
    const { recipe: created } = createRecipeResponseSchema.parse(await response.json());
    expect(created.title).toBe("入力したタイトル");
    expect(created.content.coverImage?.objectKey).toMatch(
      new RegExp(`^recipes/user_123/${created.id}/`),
    );

    const detail = await getRecipe(handlers, created.id);
    expect(detail.title).toBe("入力したタイトル");
    expect(detail.content.ingredientGroups).toEqual([
      { ingredients: [{ name: "卵", amount: "2個" }] },
    ]);
    expect(detail.source.sourceName).toBe("手入力");

    const [first] = (await listFirstPage(handlers)).items;
    expect(first).toMatchObject({
      id: created.id,
      title: "入力したタイトル",
      sourceName: "手入力",
    });
  });

  it("更新したRecipeは既存画像を保ったまま詳細と一覧に反映され、一覧の先頭に来る", async () => {
    const handlers = setup();
    const before = await getRecipe(handlers, "recipe_003");
    const coverKey = before.content.coverImage?.objectKey;

    expect(coverKey).toBeDefined();

    const response = await send(handlers, "PUT", "/api/recipes/recipe_003", {
      content: {
        title: "編集したタイトル",
        coverImage: { type: "existingObjectKey", key: coverKey },
        steps: [{ text: "混ぜる。" }],
      },
    });

    expect(response.status).toBe(200);
    expect(updateRecipeResponseSchema.parse(await response.json()).recipe.title).toBe(
      "編集したタイトル",
    );

    const after = await getRecipe(handlers, "recipe_003");
    expect(after.title).toBe("編集したタイトル");
    expect(after.content.coverImage?.objectKey).toBe(coverKey);
    expect(after.content.steps).toEqual([{ text: "混ぜる。", images: [] }]);
    expect(after.createdAt).toBe(before.createdAt);

    const [first] = (await listFirstPage(handlers)).items;
    expect(first).toMatchObject({ id: "recipe_003", title: "編集したタイトル" });
  });

  it("保存済みにない既存画像キーでの更新は422になる", async () => {
    const handlers = setup();

    const response = await send(handlers, "PUT", "/api/recipes/recipe_001", {
      content: {
        title: "編集したタイトル",
        coverImage: { type: "existingObjectKey", key: "recipes/user_123/other/cover.webp" },
      },
    });

    expect(response.status).toBe(422);
    expect((await getRecipe(handlers, "recipe_001")).title).not.toBe("編集したタイトル");
  });

  it("ハンドラのないAPIは実APIに流さず501で止める", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const handlers = setup();

    const response = await send(handlers, "GET", "/api/not-mocked");

    expect(response.status).toBe(501);
    expect(console.error).toHaveBeenCalledWith("[mock] No handler for GET /api/not-mocked");
  });
});
