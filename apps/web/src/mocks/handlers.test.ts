import {
  createImportJobResponseSchema,
  createRecipeResponseSchema,
  getImportJobResponseSchema,
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

const setup = (scenarioId = "default") =>
  createHandlers(findScenario(scenarioId).build(), { delayMs: 0 });

const errorCodeOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

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

  it("保存上限に達していると作成とURL取り込みはrecipe_limit_exceededになる", async () => {
    const handlers = setup("limit-reached");

    const created = await send(handlers, "POST", "/api/recipes", {
      content: { title: "上限を超えるレシピ" },
      source: {},
    });
    expect(created.status).toBe(403);
    expect(await errorCodeOf(created)).toBe("recipe_limit_exceeded");

    const imported = await send(handlers, "POST", "/api/import/url/jobs", {
      url: "https://example.com/recipe",
    });
    expect(imported.status).toBe(403);
    expect(await errorCodeOf(imported)).toBe("recipe_limit_exceeded");
  });

  it("取り込めないURLはinvalid_urlになる", async () => {
    const handlers = setup();

    const response = await send(handlers, "POST", "/api/import/url/jobs", {
      url: "ftp://example.com/recipe",
    });

    expect(response.status).toBe(400);
    expect(await errorCodeOf(response)).toBe("invalid_url");
  });

  it("未ログインでもOTP検証が通ればログイン状態になる", async () => {
    const handlers = setup("signed-out");

    expect(await (await send(handlers, "GET", "/api/auth/get-session")).json()).toBeNull();

    await send(handlers, "POST", "/api/auth/email-otp/verify-email", {
      email: "user@example.com",
      otp: "123456",
    });

    expect(await (await send(handlers, "GET", "/api/auth/get-session")).json()).not.toBeNull();
  });

  it("Googleログインの戻り先ではログイン済みのdefaultシナリオを選ぶ", async () => {
    const handlers = setup("signed-out");

    const response = await send(handlers, "POST", "/api/auth/sign-in/social", {
      provider: "google",
      callbackURL: "/recipes/recipe_001",
    });

    expect(await response.json()).toMatchObject({
      url: "/recipes/recipe_001?scenario=default",
    });
  });

  it("ハンドラのないAPIは実APIに流さず501で止める", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const handlers = setup();

    const response = await send(handlers, "GET", "/api/not-mocked");

    expect(response.status).toBe(501);
    expect(console.error).toHaveBeenCalledWith("[mock] No handler for GET /api/not-mocked");
  });

  it("テキストの取り込みは原文の最初の行を持つjobを作り、詳細で原文を返す", async () => {
    const handlers = setup();

    const response = await send(handlers, "POST", "/api/import/text/jobs", {
      text: "  鶏むね肉のレモン煮\n鶏むね肉 300g  ",
    });

    expect(response.status).toBe(202);
    const { job } = createImportJobResponseSchema.parse(await response.json());
    expect(job).toMatchObject({ kind: "text", url: null, textPreview: "鶏むね肉のレモン煮" });

    const detail = getImportJobResponseSchema.parse(
      await (await send(handlers, "GET", `/api/import/jobs/${job.id}`)).json(),
    );
    expect(detail.sourceText).toBe("鶏むね肉のレモン煮\n鶏むね肉 300g");
  });

  it("保存上限に達しているとテキストの取り込みもrecipe_limit_exceededになる", async () => {
    const handlers = setup("limit-reached");

    const response = await send(handlers, "POST", "/api/import/text/jobs", {
      text: "鶏むね肉のレモン煮",
    });

    expect(response.status).toBe(403);
    expect(await errorCodeOf(response)).toBe("recipe_limit_exceeded");
  });

  it("テキストの取り込み失敗シナリオは送り直し用の原文を返し、閉じると見つからなくなる", async () => {
    const handlers = setup("text-import-failed");

    const detail = getImportJobResponseSchema.parse(
      await (await send(handlers, "GET", "/api/import/jobs/job_text_failed")).json(),
    );
    expect(detail).toMatchObject({ job: { kind: "text", status: "failed" } });
    expect(detail.sourceText).toContain("今日の夕飯");

    await send(handlers, "PATCH", "/api/import/jobs/job_text_failed/dismiss");

    const dismissed = await send(handlers, "GET", "/api/import/jobs/job_text_failed");
    expect(dismissed.status).toBe(404);
  });

  it("成功したテキストのjobも保持している原文を詳細で返す", async () => {
    const state = findScenario("text-import-failed").build();
    const [failedJob] = state.importJobs;
    state.importJobs = [
      {
        ...failedJob,
        status: "succeeded",
        recipeId: "recipe_123",
        errorCode: null,
      },
    ];
    const handlers = createHandlers(state, { delayMs: 0 });

    const detail = getImportJobResponseSchema.parse(
      await (await send(handlers, "GET", "/api/import/jobs/job_text_failed")).json(),
    );

    expect(detail).toMatchObject({
      job: { status: "succeeded", textPreview: "今日の夕飯" },
      sourceText: "今日の夕飯\n鶏むね肉を焼いただけ。おいしかった。",
    });
  });
});
