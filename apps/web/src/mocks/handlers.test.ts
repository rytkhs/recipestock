import {
  createImportJobResponseSchema,
  createRecipeResponseSchema,
  getImportJobResponseSchema,
  getRecipeResponseSchema,
  listRecipesResponseSchema,
  listTagsResponseSchema,
  type RecipeDetail,
  replaceRecipeTagsResponseSchema,
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

const listTags = async (handlers: Handlers) =>
  listTagsResponseSchema.parse(await (await send(handlers, "GET", "/api/tags")).json()).tags;

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

  it("更新したRecipeは既存画像を保ったまま詳細と一覧に反映され、一覧での位置は変わらない", async () => {
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

    const { items } = await listFirstPage(handlers);
    expect(items.map((item) => item.id).slice(0, 3)).toEqual([
      "recipe_001",
      "recipe_002",
      "recipe_003",
    ]);
    expect(items[2]).toMatchObject({ title: "編集したタイトル" });
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

  it.each([
    ["viewer-error", "GET", "/api/me", 503, "temporarily_unavailable"],
    ["tags-error", "GET", "/api/tags", 503, "temporarily_unavailable"],
    ["billing-status-error", "GET", "/api/billing/status", 503, "temporarily_unavailable"],
    ["pro-price-error", "GET", "/api/billing/pro-price", 503, "temporarily_unavailable"],
    ["checkout-error", "POST", "/api/billing/checkout", 500, "unknown"],
    ["billing-portal-error", "POST", "/api/billing/portal", 500, "unknown"],
    [
      "shortcut-credentials-error",
      "GET",
      "/api/shortcut-credentials",
      503,
      "temporarily_unavailable",
    ],
    ["push-subscriptions-error", "GET", "/api/push-subscriptions", 503, "temporarily_unavailable"],
    ["shortcut-issue-error", "POST", "/api/shortcut-credentials", 500, "unknown"],
    [
      "shortcut-revoke-error",
      "DELETE",
      "/api/shortcut-credentials/credential_0001",
      500,
      "unknown",
    ],
  ] as const)("%sでは%s %sが失敗する", async (scenarioId, method, path, expectedStatus, expectedCode) => {
    const response = await send(setup(scenarioId), method, path, method === "GET" ? undefined : {});

    expect(response.status).toBe(expectedStatus);
    expect(await errorCodeOf(response)).toBe(expectedCode);
  });

  it("ログイン方法の取得失敗はBetter Authのエラー形式を返す", async () => {
    const response = await send(setup("login-methods-error"), "GET", "/api/auth/list-accounts");

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "UNKNOWN_ERROR" });
  });

  it("アカウント変更失敗はメールとパスワードの両方で再現する", async () => {
    const handlers = setup("account-write-error");
    const email = await send(handlers, "POST", "/api/auth/change-email", {});
    const password = await send(handlers, "POST", "/api/auth/change-password", {});

    expect(email.status).toBe(500);
    expect(await email.json()).toMatchObject({ code: "UNKNOWN_ERROR" });
    expect(password.status).toBe(500);
    expect(await password.json()).toMatchObject({ code: "UNKNOWN_ERROR" });
  });

  it("現在のパスワード不一致はINVALID_PASSWORDを返す", async () => {
    const response = await send(
      setup("invalid-current-password"),
      "POST",
      "/api/auth/change-password",
      {},
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_PASSWORD" });
  });

  it("ログアウト失敗ではsessionを残す", async () => {
    const handlers = setup("sign-out-error");
    const response = await send(handlers, "POST", "/api/auth/sign-out");

    expect(response.status).toBe(500);
    expect(await (await send(handlers, "GET", "/api/auth/get-session")).json()).not.toBeNull();
  });

  it("連携キーの発行失敗では端末を追加しない", async () => {
    const handlers = setup("shortcut-issue-error");

    await send(handlers, "POST", "/api/shortcut-credentials", { name: "iPhone" });

    expect(await (await send(handlers, "GET", "/api/shortcut-credentials")).json()).toEqual({
      credentials: [],
    });
  });

  it("端末の連携解除失敗では一覧から削除しない", async () => {
    const handlers = setup("shortcut-revoke-error");

    await send(handlers, "DELETE", "/api/shortcut-credentials/credential_0001");

    const body = (await (await send(handlers, "GET", "/api/shortcut-credentials")).json()) as {
      credentials: unknown[];
    };
    expect(body.credentials).toHaveLength(2);
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

  it("タグは揃えた名前で既存のタグを使い、付けた順を保って詳細と語彙に反映される", async () => {
    const handlers = setup("no-tags");

    const first = await send(handlers, "PUT", "/api/recipes/recipe_001/tags", {
      names: ["#作り置き", "ＢＢＱ"],
    });
    expect(first.status).toBe(200);
    const { tags: attached } = replaceRecipeTagsResponseSchema.parse(await first.json());
    expect(attached.map((tag) => tag.name)).toEqual(["作り置き", "BBQ"]);

    await send(handlers, "PUT", "/api/recipes/recipe_002/tags", { names: ["bbq"] });
    expect((await getRecipe(handlers, "recipe_002")).tags).toEqual([attached[1]]);
    expect(await listTags(handlers)).toEqual([
      { ...attached[1], recipeCount: 2 },
      { ...attached[0], recipeCount: 1 },
    ]);
  });

  it("一覧はタグをANDで絞り込み、タグなしと検索語のタグ名一致にも対応する", async () => {
    const handlers = setup("no-tags");
    await send(handlers, "PUT", "/api/recipes/recipe_001/tags", { names: ["鶏肉", "作り置き"] });
    await send(handlers, "PUT", "/api/recipes/recipe_002/tags", { names: ["鶏肉"] });
    const tags = await listTags(handlers);
    const idOf = (name: string) => tags.find((tag) => tag.name === name)?.id ?? "";
    const listIds = async (query: string) =>
      listRecipesResponseSchema
        .parse(await (await send(handlers, "GET", `/api/recipes?${query}`)).json())
        .items.map((item) => item.id);

    await expect(listIds(`tagId=${idOf("鶏肉")}&tagId=${idOf("作り置き")}`)).resolves.toEqual([
      "recipe_001",
    ]);
    const untaggedIds = await listIds("untagged=true&limit=50");
    expect(untaggedIds).not.toContain("recipe_001");
    expect(untaggedIds).not.toContain("recipe_002");
    await expect(listIds("q=作り置き")).resolves.toEqual(["recipe_001"]);
  });

  it("既存のタグと同じ名前への変更は409で相手を返し、統合すると付与を移す", async () => {
    const handlers = setup("no-tags");
    await send(handlers, "PUT", "/api/recipes/recipe_001/tags", { names: ["とり肉", "鶏肉"] });
    await send(handlers, "PUT", "/api/recipes/recipe_002/tags", { names: ["とり肉"] });
    const tags = await listTags(handlers);
    const source = tags.find((tag) => tag.name === "とり肉");
    const target = tags.find((tag) => tag.name === "鶏肉");

    if (!source || !target) {
      throw new Error("Tags were not created.");
    }

    const renamed = await send(handlers, "PATCH", `/api/tags/${source.id}`, { name: "鶏肉" });
    expect(renamed.status).toBe(409);
    expect(await renamed.json()).toMatchObject({
      error: { code: "tag_name_conflict", details: { tag: { id: target.id, name: "鶏肉" } } },
    });

    const merged = await send(handlers, "POST", `/api/tags/${source.id}/merge`, {
      intoTagId: target.id,
    });
    expect(merged.status).toBe(200);
    expect((await getRecipe(handlers, "recipe_001")).tags).toEqual([
      { id: target.id, name: "鶏肉" },
    ]);
    expect((await getRecipe(handlers, "recipe_002")).tags).toEqual([
      { id: target.id, name: "鶏肉" },
    ]);

    expect((await send(handlers, "DELETE", `/api/tags/${target.id}`)).status).toBe(200);
    expect((await getRecipe(handlers, "recipe_001")).tags).toEqual([]);
    expect(await listTags(handlers)).toEqual([]);
  });
});
