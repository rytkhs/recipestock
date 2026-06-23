import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findFetchCall,
  getRequestPath,
  jsonResponse,
  mockFetch,
  renderApp,
} from "../test/router-test-utils";

const savedImage = (objectKey: string, url?: string, width = 1200, height = 800) => ({
  objectKey,
  width,
  height,
  ...(url ? { url } : {}),
});

describe("RecipesRoute", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("レシピ一覧を表示して検索できる", async () => {
    const fetchMock = mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20") {
          return jsonResponse({
            items: [
              {
                id: "recipe_123",
                title: "Tomato pasta",
                coverImageUrl: null,
                sourceName: "Example Kitchen",
                createdAt: "2026-05-25T00:00:00.000Z",
                updatedAt: "2026-05-26T00:00:00.000Z",
                locked: false,
              },
            ],
            nextCursor: null,
          });
        }

        if (input === "/api/recipes?limit=20&q=tomato") {
          return jsonResponse({
            items: [
              {
                id: "recipe_123",
                title: "Tomato pasta",
                coverImageUrl: null,
                sourceName: "Example Kitchen",
                createdAt: "2026-05-25T00:00:00.000Z",
                updatedAt: "2026-05-26T00:00:00.000Z",
                locked: false,
              },
            ],
            nextCursor: null,
          });
        }

        if (getRequestPath(input) === "/api/import/jobs/recent") {
          return jsonResponse({ jobs: [] });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );
    await renderApp("/recipes");

    await expect(
      screen.findByRole("heading", { name: "Tomato pasta" }),
    ).resolves.toBeInTheDocument();
    expect(screen.getByText("Example Kitchen")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("検索"), "tomato");
    await userEvent.click(screen.getByRole("button", { name: "検索" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/recipes?limit=20&q=tomato",
        expect.objectContaining({
          credentials: "include",
          method: "GET",
        }),
      );
    });
  });

  it("ロック中Recipeは一覧で詳細リンクにしない", async () => {
    mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20") {
          return jsonResponse({
            items: [
              {
                id: "recipe_locked",
                title: "Locked pasta",
                coverImageUrl: null,
                sourceName: "Example Kitchen",
                createdAt: "2026-05-20T00:00:00.000Z",
                updatedAt: "2026-05-20T00:00:00.000Z",
                locked: true,
              },
            ],
            nextCursor: null,
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes");

    await expect(
      screen.findByRole("heading", { name: "Locked pasta" }),
    ).resolves.toBeInTheDocument();
    expect(screen.getByText("ロック中")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Locked pasta" })).not.toBeInTheDocument();
  });

  it("URL import成功バナーから作成されたレシピを開ける", async () => {
    mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20") {
          return jsonResponse({ items: [], nextCursor: null });
        }

        if (getRequestPath(input) === "/api/import/jobs/recent") {
          return jsonResponse({
            jobs: [
              {
                id: "job_123",
                kind: "url",
                status: "succeeded",
                url: "https://example.com/recipes/tomato",
                recipeId: "recipe_123",
                errorCode: null,
                createdAt: "2026-06-01T00:00:00.000Z",
                startedAt: "2026-06-01T00:00:01.000Z",
                finishedAt: "2026-06-01T00:00:10.000Z",
              },
            ],
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes");

    await expect(screen.findByText("取り込みが完了しました。")).resolves.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "開く" })).toHaveAttribute(
      "href",
      "/recipes/recipe_123",
    );
  });

  it("URL import失敗バナーから同じURLで再試行できる", async () => {
    const fetchMock = mockFetch(
      async (input, init) => {
        if (input === "/api/recipes?limit=20") {
          return jsonResponse({ items: [], nextCursor: null });
        }

        if (getRequestPath(input) === "/api/import/jobs/recent") {
          return jsonResponse({
            jobs: [
              {
                id: "job_failed",
                kind: "url",
                status: "failed",
                url: "https://example.com/recipes/tomato",
                recipeId: null,
                errorCode: "fetch_failed",
                createdAt: "2026-06-01T00:00:00.000Z",
                startedAt: "2026-06-01T00:00:01.000Z",
                finishedAt: "2026-06-01T00:00:10.000Z",
              },
            ],
          });
        }

        if (
          getRequestPath(input) === "/api/import/jobs/job_failed/dismiss" &&
          init?.method === "PATCH"
        ) {
          return jsonResponse({
            job: {
              id: "job_failed",
              kind: "url",
              status: "failed",
              url: "https://example.com/recipes/tomato",
              recipeId: null,
              errorCode: "fetch_failed",
              createdAt: "2026-06-01T00:00:00.000Z",
              startedAt: "2026-06-01T00:00:01.000Z",
              finishedAt: "2026-06-01T00:00:10.000Z",
            },
          });
        }

        if (getRequestPath(input) === "/api/import/url/jobs" && init?.method === "POST") {
          return jsonResponse(
            {
              kind: "created",
              job: {
                id: "job_retry",
                kind: "url",
                status: "queued",
                url: "https://example.com/recipes/tomato",
                recipeId: null,
                errorCode: null,
                createdAt: "2026-06-01T00:01:00.000Z",
                startedAt: null,
                finishedAt: null,
              },
            },
            { status: 202 },
          );
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes");

    await expect(screen.findByRole("alert")).resolves.toHaveTextContent(
      "ページを取得できませんでした。",
    );
    await userEvent.click(screen.getByRole("button", { name: "再試行" }));

    await waitFor(() => {
      expect(findFetchCall(fetchMock, "/api/import/url/jobs")).toEqual([
        "/api/import/url/jobs",
        expect.objectContaining({
          credentials: "include",
          method: "POST",
          body: JSON.stringify({ url: "https://example.com/recipes/tomato" }),
        }),
      ]);
    });
    expect(findFetchCall(fetchMock, "/api/import/jobs/job_failed/dismiss")).toEqual([
      "/api/import/jobs/job_failed/dismiss",
      expect.objectContaining({
        credentials: "include",
        method: "PATCH",
      }),
    ]);
  });

  it("URL import jobの全体期限切れを表示する", async () => {
    mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20") {
          return jsonResponse({ items: [], nextCursor: null });
        }

        if (getRequestPath(input) === "/api/import/jobs/recent") {
          return jsonResponse({
            jobs: [
              {
                id: "job_timed_out",
                kind: "url",
                status: "failed",
                url: "https://example.com/recipes/tomato",
                recipeId: null,
                errorCode: "job_timeout",
                createdAt: "2026-06-01T00:00:00.000Z",
                startedAt: "2026-06-01T00:00:01.000Z",
                finishedAt: "2026-06-01T00:10:00.000Z",
              },
            ],
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes");

    await expect(screen.findByRole("alert")).resolves.toHaveTextContent(
      "取り込み処理が時間内に完了しませんでした。再試行してください。",
    );
  });

  it("次ページの読み込みに失敗した後でももっと見るから再試行できる", async () => {
    let nextPageRequests = 0;
    const fetchMock = mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes?limit=20") {
          return jsonResponse({
            items: [
              {
                id: "recipe_123",
                title: "Tomato pasta",
                coverImageUrl: null,
                sourceName: "Example Kitchen",
                createdAt: "2026-05-25T00:00:00.000Z",
                updatedAt: "2026-05-26T00:00:00.000Z",
                locked: false,
              },
            ],
            nextCursor: "cursor_2",
          });
        }

        if (getRequestPath(input) === "/api/recipes?limit=20&cursor=cursor_2") {
          nextPageRequests += 1;

          if (nextPageRequests === 1) {
            return new Response(null, { status: 500 });
          }

          return jsonResponse({
            items: [
              {
                id: "recipe_456",
                title: "Potato salad",
                coverImageUrl: null,
                sourceName: null,
                createdAt: "2026-05-25T00:00:00.000Z",
                updatedAt: "2026-05-26T00:00:00.000Z",
                locked: false,
              },
            ],
            nextCursor: null,
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );
    await renderApp("/recipes");

    await expect(
      screen.findByRole("heading", { name: "Tomato pasta" }),
    ).resolves.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "もっと見る" }));
    await expect(screen.findByRole("alert")).resolves.toHaveTextContent(
      "レシピ一覧を読み込めませんでした。",
    );

    await userEvent.click(screen.getByRole("button", { name: "もっと見る" }));

    await expect(
      screen.findByRole("heading", { name: "Potato salad" }),
    ).resolves.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/recipes?limit=20&cursor=cursor_2",
      expect.objectContaining({
        credentials: "include",
        method: "GET",
      }),
    );
    expect(nextPageRequests).toBe(2);
  });

  it("新規レシピを保存して詳細画面で閲覧する", async () => {
    const recipeResponse = {
      recipe: {
        id: "recipe_123",
        title: "Tomato pasta",
        content: {
          title: "Tomato pasta",
          servingsText: "2人分",
          coverImage: savedImage(
            "recipes/user_123/recipe_123/cover.webp",
            "https://images.example/cover.webp",
          ),
          ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
          steps: [
            {
              text: "煮詰める",
              images: [
                savedImage(
                  "recipes/user_123/recipe_123/step.webp",
                  "https://images.example/step.webp",
                  800,
                  1200,
                ),
              ],
            },
          ],
          note: "仕上げにオリーブオイル。",
        },
        source: {
          sourceUrl: null,
          normalizedSourceUrl: null,
          sourceName: null,
        },
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z",
        locked: false,
      },
    };
    const fetchMock = mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/recipes" && init?.method === "POST") {
          return jsonResponse(recipeResponse, { status: 201 });
        }

        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse(recipeResponse);
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/new");

    await userEvent.type(await screen.findByLabelText("タイトル"), "Tomato pasta");
    await userEvent.type(screen.getByLabelText("人数"), "2人分");
    await userEvent.type(screen.getByLabelText("材料名"), "トマト缶");
    await userEvent.type(screen.getByLabelText("分量"), "1缶");
    await userEvent.type(screen.getByLabelText("手順"), "煮詰める");
    await userEvent.type(screen.getByLabelText("メモ"), "仕上げにオリーブオイル。");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/recipes",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
        }),
      );
    });
    const createRecipeCall = findFetchCall(fetchMock, "/api/recipes");
    expect(JSON.parse(String(createRecipeCall?.[1]?.body))).toMatchObject({
      content: {
        title: "Tomato pasta",
        servingsText: "2人分",
        ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
        steps: [{ text: "煮詰める", images: [] }],
        note: "仕上げにオリーブオイル。",
      },
      source: {},
    });
    await expect(
      screen.findByRole("heading", { name: "Tomato pasta" }),
    ).resolves.toBeInTheDocument();
    const ingredients = screen.getByRole("heading", { name: "材料" }).parentElement;
    expect(ingredients).not.toBeNull();
    expect(within(ingredients as HTMLElement).getByText("トマト缶")).toBeInTheDocument();
    expect(within(ingredients as HTMLElement).getByText("1缶")).toBeInTheDocument();
    expect(screen.getByText("煮詰める")).toBeInTheDocument();
  });

  it("新規レシピでカバー画像と手順画像をアップロードして保存できる", async () => {
    const recipeResponse = {
      recipe: {
        id: "recipe_123",
        title: "Tomato pasta",
        content: {
          title: "Tomato pasta",
          coverImage: savedImage(
            "recipes/user_123/recipe_123/cover.webp",
            "https://images.example/cover.webp",
          ),
          ingredientGroups: [],
          steps: [
            {
              text: "煮詰める",
              images: [
                savedImage(
                  "recipes/user_123/recipe_123/step.webp",
                  "https://images.example/step.webp",
                  800,
                  1200,
                ),
              ],
            },
          ],
        },
        source: {
          sourceUrl: null,
          normalizedSourceUrl: null,
          sourceName: null,
        },
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z",
        locked: false,
      },
    };
    let uploadUrlRequests = 0;
    const fetchMock = mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/images/upload-url" && init?.method === "POST") {
          uploadUrlRequests += 1;
          return jsonResponse({
            uploadUrl: `https://upload.example/${uploadUrlRequests}`,
            objectKey:
              uploadUrlRequests === 1 ? "tmp/user_123/cover.webp" : "tmp/user_123/step.webp",
            expiresAt: "2026-05-31T00:15:00.000Z",
          });
        }

        if (typeof input === "string" && input.startsWith("https://upload.example/")) {
          return new Response(null, { status: 200 });
        }

        if (getRequestPath(input) === "/api/recipes" && init?.method === "POST") {
          return jsonResponse(recipeResponse, { status: 201 });
        }

        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse(recipeResponse);
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/new");

    await userEvent.type(await screen.findByLabelText("タイトル"), "Tomato pasta");
    await userEvent.upload(
      screen.getByLabelText("カバー画像"),
      new File(["cover"], "cover.webp", { type: "image/webp" }),
    );
    await userEvent.type(screen.getByLabelText("手順"), "煮詰める");
    await userEvent.upload(
      screen.getByLabelText("手順1の画像"),
      new File(["step"], "step.webp", { type: "image/webp" }),
    );
    await screen.findByAltText("カバー画像プレビュー");
    await screen.findByAltText("手順1の画像1プレビュー");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/recipes",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
        }),
      );
    });
    const createRecipeCall = findFetchCall(fetchMock, "/api/recipes");
    expect(JSON.parse(String(createRecipeCall?.[1]?.body))).toMatchObject({
      content: {
        coverImage: { type: "tmpObjectKey", key: "tmp/user_123/cover.webp" },
        steps: [
          {
            text: "煮詰める",
            images: [{ type: "tmpObjectKey", key: "tmp/user_123/step.webp" }],
          },
        ],
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://upload.example/1",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://upload.example/2",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("カバー画像の差し替えアップロードに失敗したら前のプレビューと値を保つ", async () => {
    vi.mocked(URL.createObjectURL)
      .mockReturnValueOnce("blob:first-cover-preview")
      .mockReturnValueOnce("blob:failed-cover-preview");

    const recipeResponse = {
      recipe: {
        id: "recipe_123",
        title: "Tomato pasta",
        content: {
          title: "Tomato pasta",
          coverImage: savedImage(
            "recipes/user_123/recipe_123/cover.webp",
            "https://images.example/cover.webp",
          ),
          ingredientGroups: [],
          steps: [],
          note: null,
        },
        source: {
          sourceUrl: null,
          normalizedSourceUrl: null,
          sourceName: null,
        },
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z",
        locked: false,
      },
    };
    let uploadUrlRequests = 0;
    const fetchMock = mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/images/upload-url" && init?.method === "POST") {
          uploadUrlRequests += 1;
          return jsonResponse({
            uploadUrl: `https://upload.example/${uploadUrlRequests}`,
            objectKey: `tmp/user_123/cover-${uploadUrlRequests}.webp`,
            expiresAt: "2026-05-31T00:15:00.000Z",
          });
        }

        if (input === "https://upload.example/1") {
          return new Response(null, { status: 200 });
        }

        if (input === "https://upload.example/2") {
          return new Response(null, { status: 500 });
        }

        if (getRequestPath(input) === "/api/recipes" && init?.method === "POST") {
          return jsonResponse(recipeResponse, { status: 201 });
        }

        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse(recipeResponse);
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/new");

    await userEvent.type(await screen.findByLabelText("タイトル"), "Tomato pasta");
    await userEvent.upload(
      screen.getByLabelText("カバー画像"),
      new File(["cover"], "cover.webp", { type: "image/webp" }),
    );
    await expect(screen.findByAltText("カバー画像プレビュー")).resolves.toHaveAttribute(
      "src",
      "blob:first-cover-preview",
    );

    await userEvent.upload(
      screen.getByLabelText("カバー画像"),
      new File(["replacement"], "replacement.webp", { type: "image/webp" }),
    );
    await expect(
      screen.findByText("画像をアップロードできませんでした。"),
    ).resolves.toBeInTheDocument();
    expect(screen.getByAltText("カバー画像プレビュー")).toHaveAttribute(
      "src",
      "blob:first-cover-preview",
    );

    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/recipes",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
        }),
      );
    });
    const createRecipeCall = findFetchCall(fetchMock, "/api/recipes");
    expect(JSON.parse(String(createRecipeCall?.[1]?.body))).toMatchObject({
      content: {
        coverImage: { type: "tmpObjectKey", key: "tmp/user_123/cover-1.webp" },
      },
    });
  });

  it("詳細画面でカバー画像と手順画像を表示する", async () => {
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse({
            recipe: {
              id: "recipe_123",
              title: "Tomato pasta",
              content: {
                title: "Tomato pasta",
                coverImage: savedImage(
                  "recipes/user_123/recipe_123/cover.webp",
                  "https://images.example/cover.webp",
                ),
                ingredientGroups: [],
                steps: [
                  {
                    text: "煮詰める",
                    images: [
                      savedImage(
                        "recipes/user_123/recipe_123/step.webp",
                        "https://images.example/step.webp",
                        800,
                        1200,
                      ),
                    ],
                  },
                  {
                    images: [
                      savedImage(
                        "recipes/user_123/recipe_123/step-only.webp",
                        "https://images.example/step-only.webp",
                        900,
                        1200,
                      ),
                    ],
                  },
                ],
              },
              source: {
                sourceUrl: null,
                normalizedSourceUrl: null,
                sourceName: null,
              },
              createdAt: "2026-05-26T00:00:00.000Z",
              updatedAt: "2026-05-26T00:00:00.000Z",
              locked: false,
            },
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/recipe_123");

    const coverImage = await screen.findByAltText("Tomato pasta");
    expect(coverImage).toHaveAttribute("src", "https://images.example/cover.webp");
    expect(coverImage).toHaveAttribute("width", "1200");
    expect(coverImage).toHaveAttribute("height", "800");
    expect(coverImage).toHaveStyle({ aspectRatio: "1200 / 800" });
    const stepImage = screen.getByAltText("手順1の画像1");
    expect(stepImage).toHaveAttribute("src", "https://images.example/step.webp");
    expect(stepImage).toHaveAttribute("width", "800");
    expect(stepImage).toHaveAttribute("height", "1200");
    expect(stepImage).toHaveStyle({ aspectRatio: "800 / 1200" });
    expect(screen.getByAltText("手順2の画像1")).toHaveAttribute(
      "src",
      "https://images.example/step-only.webp",
    );
  });

  it("ロック中Recipe詳細に直接アクセスしても本文と編集リンクを表示しない", async () => {
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes/recipe_locked") {
          return jsonResponse({
            recipe: {
              id: "recipe_locked",
              locked: true,
            },
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/recipe_locked");

    await expect(
      screen.findByRole("heading", { name: "ロック中のレシピ" }),
    ).resolves.toBeInTheDocument();
    expect(screen.getByText("このレシピの詳細は現在表示できません。")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "編集" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "材料" })).not.toBeInTheDocument();
  });

  it("ロック中Recipe編集に直接アクセスしてもフォームを表示しない", async () => {
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes/recipe_locked") {
          return jsonResponse({
            recipe: {
              id: "recipe_locked",
              locked: true,
            },
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/recipe_locked/edit");

    await expect(
      screen.findByRole("heading", { name: "レシピを編集できません" }),
    ).resolves.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更新" })).not.toBeInTheDocument();
  });

  it("詳細画面から編集して本文だけを更新できる", async () => {
    const recipeResponse = {
      recipe: {
        id: "recipe_123",
        title: "Tomato pasta",
        content: {
          title: "Tomato pasta",
          servingsText: "2人分",
          coverImage: savedImage(
            "recipes/user_123/recipe_123/cover.webp",
            "https://images.example/cover.webp",
          ),
          ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
          steps: [
            {
              text: "煮詰める",
              images: [
                savedImage(
                  "recipes/user_123/recipe_123/step.webp",
                  "https://images.example/step.webp",
                  800,
                  1200,
                ),
              ],
            },
          ],
          note: "仕上げにオリーブオイル。",
        },
        source: {
          sourceUrl: "https://example.com/recipes/tomato",
          normalizedSourceUrl: "https://example.com/recipes/tomato",
          sourceName: "Example Kitchen",
        },
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z",
        locked: false,
      },
    };
    const updatedRecipeMutationResponse = {
      recipe: {
        ...recipeResponse.recipe,
        title: "Potato salad",
        content: {
          title: "Potato salad",
          servingsText: "3人分",
          coverImage: savedImage("recipes/user_123/recipe_123/cover.webp"),
          ingredientGroups: recipeResponse.recipe.content.ingredientGroups,
          steps: [
            {
              text: "煮詰める",
              images: [savedImage("recipes/user_123/recipe_123/step.webp", undefined, 800, 1200)],
            },
          ],
          note: "仕上げにオリーブオイル。",
        },
        updatedAt: "2026-05-27T00:00:00.000Z",
      },
    };
    const updatedRecipeDetailResponse = {
      recipe: {
        ...recipeResponse.recipe,
        title: "Potato salad",
        content: {
          ...recipeResponse.recipe.content,
          title: "Potato salad",
          servingsText: "3人分",
        },
        updatedAt: "2026-05-27T00:00:00.000Z",
      },
    };
    let currentRecipeResponse = recipeResponse;
    const fetchMock = mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/recipes/recipe_123" && init?.method === "PUT") {
          currentRecipeResponse = updatedRecipeDetailResponse;
          return jsonResponse(updatedRecipeMutationResponse);
        }

        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse(currentRecipeResponse);
        }

        if (getRequestPath(input) === "/api/recipes?limit=20") {
          return jsonResponse({ items: [], nextCursor: null });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/recipe_123");
    await userEvent.click(await screen.findByRole("link", { name: "編集" }));
    await expect(screen.findByRole("heading", { name: "レシピ編集" })).resolves.toBeInTheDocument();
    expect(screen.getByDisplayValue("Tomato pasta")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2人分")).toBeInTheDocument();
    expect(screen.getByDisplayValue("トマト缶")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1缶")).toBeInTheDocument();
    expect(screen.getByDisplayValue("煮詰める")).toBeInTheDocument();
    expect(screen.getByDisplayValue("仕上げにオリーブオイル。")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("タイトル"));
    await userEvent.type(screen.getByLabelText("タイトル"), "Potato salad");
    await userEvent.clear(screen.getByLabelText("人数"));
    await userEvent.type(screen.getByLabelText("人数"), "3人分");
    await userEvent.click(screen.getByRole("button", { name: "更新" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/recipes/recipe_123",
        expect.objectContaining({
          method: "PUT",
          credentials: "include",
        }),
      );
    });
    const updateRecipeCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        getRequestPath(input) === "/api/recipes/recipe_123" && init?.method === "PUT",
    );
    expect(JSON.parse(String(updateRecipeCall?.[1]?.body))).toMatchObject({
      content: {
        title: "Potato salad",
        servingsText: "3人分",
        coverImage: {
          type: "existingObjectKey",
          key: "recipes/user_123/recipe_123/cover.webp",
        },
        steps: [
          {
            text: "煮詰める",
            images: [
              {
                type: "existingObjectKey",
                key: "recipes/user_123/recipe_123/step.webp",
              },
            ],
          },
        ],
      },
    });
    await expect(
      screen.findByRole("heading", { name: "Potato salad" }),
    ).resolves.toBeInTheDocument();
    await expect(screen.findByAltText("Potato salad")).resolves.toHaveAttribute(
      "src",
      "https://images.example/cover.webp",
    );
    expect(screen.getByAltText("手順1の画像1")).toHaveAttribute(
      "src",
      "https://images.example/step.webp",
    );
  });

  it("編集画面で手順画像を削除しても残った画像のプレビューURLを保つ", async () => {
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse({
            recipe: {
              id: "recipe_123",
              title: "Tomato pasta",
              content: {
                title: "Tomato pasta",
                ingredientGroups: [],
                steps: [
                  {
                    text: "煮詰める",
                    images: [
                      savedImage(
                        "recipes/user_123/recipe_123/step-a.webp",
                        "https://images.example/step-a.webp",
                      ),
                      savedImage(
                        "recipes/user_123/recipe_123/step-b.webp",
                        "https://images.example/step-b.webp",
                      ),
                    ],
                  },
                ],
              },
              source: {
                sourceUrl: null,
                normalizedSourceUrl: null,
                sourceName: null,
              },
              createdAt: "2026-05-26T00:00:00.000Z",
              updatedAt: "2026-05-26T00:00:00.000Z",
              locked: false,
            },
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/recipe_123/edit");

    const firstPreview = await screen.findByAltText("手順1の画像1プレビュー");
    expect(firstPreview).toHaveAttribute("src", "https://images.example/step-a.webp");
    expect(screen.getByAltText("手順1の画像2プレビュー")).toHaveAttribute(
      "src",
      "https://images.example/step-b.webp",
    );

    const firstPreviewCard = firstPreview.closest(".group");
    expect(firstPreviewCard).not.toBeNull();
    await userEvent.click(
      within(firstPreviewCard as HTMLElement).getByRole("button", { name: "削除" }),
    );

    await waitFor(() => {
      expect(screen.getByAltText("手順1の画像1プレビュー")).toHaveAttribute(
        "src",
        "https://images.example/step-b.webp",
      );
    });
    expect(screen.queryByAltText("手順1の画像2プレビュー")).not.toBeInTheDocument();
  });

  it("編集画面で手順画像URLが欠けた場合は誤った保存済み画像プレビューを表示しない", async () => {
    const recipeResponse = {
      recipe: {
        id: "recipe_123",
        title: "Tomato pasta",
        content: {
          title: "Tomato pasta",
          ingredientGroups: [],
          steps: [
            {
              text: "煮詰める",
              images: [
                savedImage("recipes/user_123/recipe_123/step-a.webp"),
                savedImage(
                  "recipes/user_123/recipe_123/step-b.webp",
                  "https://images.example/step-b.webp",
                ),
              ],
            },
          ],
        },
        source: {
          sourceUrl: null,
          normalizedSourceUrl: null,
          sourceName: null,
        },
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z",
        locked: false,
      },
    };
    const fetchMock = mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/recipes/recipe_123" && init?.method === "PUT") {
          return jsonResponse(recipeResponse);
        }

        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse(recipeResponse);
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/recipe_123/edit");

    await waitFor(() => {
      expect(screen.getAllByText("保存済み画像")).toHaveLength(1);
    });
    expect(screen.queryByAltText("手順1の画像1プレビュー")).not.toBeInTheDocument();
    expect(screen.getByAltText("手順1の画像2プレビュー")).toHaveAttribute(
      "src",
      "https://images.example/step-b.webp",
    );

    const firstSavedImageCard = screen.getAllByText("保存済み画像")[0]?.closest(".group");
    expect(firstSavedImageCard).not.toBeNull();
    await userEvent.click(
      within(firstSavedImageCard as HTMLElement).getByRole("button", { name: "削除" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "更新" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/recipes/recipe_123",
        expect.objectContaining({
          method: "PUT",
          credentials: "include",
        }),
      );
    });
    const updateRecipeCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        getRequestPath(input) === "/api/recipes/recipe_123" && init?.method === "PUT",
    );
    expect(JSON.parse(String(updateRecipeCall?.[1]?.body))).toMatchObject({
      content: {
        steps: [
          {
            images: [
              {
                type: "existingObjectKey",
                key: "recipes/user_123/recipe_123/step-b.webp",
              },
            ],
          },
        ],
      },
    });
  });

  it("更新成功後の詳細再取得に失敗しても更新失敗として扱わない", async () => {
    const recipeResponse = {
      recipe: {
        id: "recipe_123",
        title: "Tomato pasta",
        content: {
          title: "Tomato pasta",
          servingsText: "2人分",
          ingredientGroups: [],
          steps: [{ text: "煮詰める", images: [] }],
        },
        source: {
          sourceUrl: null,
          normalizedSourceUrl: null,
          sourceName: null,
        },
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z",
        locked: false,
      },
    };
    let detailRequests = 0;
    const fetchMock = mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/recipes/recipe_123" && init?.method === "PUT") {
          return jsonResponse({
            recipe: {
              ...recipeResponse.recipe,
              title: "Potato salad",
              content: {
                ...recipeResponse.recipe.content,
                title: "Potato salad",
              },
              updatedAt: "2026-05-27T00:00:00.000Z",
            },
          });
        }

        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          detailRequests += 1;

          if (detailRequests === 1) {
            return jsonResponse(recipeResponse);
          }

          return new Response(null, { status: 500 });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/recipe_123/edit");

    await userEvent.clear(await screen.findByLabelText("タイトル"));
    await userEvent.type(screen.getByLabelText("タイトル"), "Potato salad");
    await userEvent.click(screen.getByRole("button", { name: "更新" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/recipes/recipe_123",
        expect.objectContaining({
          method: "PUT",
          credentials: "include",
        }),
      );
    });
    await expect(
      screen.findByRole("heading", { name: "レシピを表示できません" }),
    ).resolves.toBeInTheDocument();
    expect(screen.queryByText("レシピを更新できませんでした。")).not.toBeInTheDocument();
  });

  it("詳細画面から削除すると一覧に戻る", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const recipeResponse = {
      recipe: {
        id: "recipe_123",
        title: "Tomato pasta",
        content: {
          title: "Tomato pasta",
          ingredientGroups: [],
          steps: [],
        },
        source: {
          sourceUrl: null,
          normalizedSourceUrl: null,
          sourceName: null,
        },
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z",
        locked: false,
      },
    };
    const fetchMock = mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/recipes/recipe_123" && init?.method === "DELETE") {
          return jsonResponse({ ok: true });
        }

        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse(recipeResponse);
        }

        if (getRequestPath(input) === "/api/recipes?limit=20") {
          return jsonResponse({ items: [], nextCursor: null });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/recipe_123");
    await userEvent.click(await screen.findByRole("button", { name: "削除" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/recipes/recipe_123",
        expect.objectContaining({
          method: "DELETE",
          credentials: "include",
        }),
      );
    });
    await expect(screen.findByRole("button", { name: "検索" })).resolves.toBeInTheDocument();
  });

  it("レシピ保存上限に達している場合は専用メッセージを表示する", async () => {
    mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/recipes" && init?.method === "POST") {
          return jsonResponse(
            {
              error: {
                code: "recipe_limit_exceeded",
                message: "Recipe limit exceeded.",
              },
            },
            { status: 403 },
          );
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/new");

    await userEvent.type(await screen.findByLabelText("タイトル"), "Tomato pasta");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await expect(screen.findByRole("alert")).resolves.toHaveTextContent(
      "保存できるレシピ数の上限に達しています。",
    );
  });
});
