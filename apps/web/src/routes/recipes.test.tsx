import {
  MAX_RECIPE_REFERENCE_IMAGES,
  MAX_RECIPE_STEP_IMAGES,
  MAX_RECIPE_STEP_TEXT_LENGTH,
  MAX_RECIPE_TOTAL_IMAGES,
} from "@recipestock/schemas";
import { FREE_RECIPE_LIMIT } from "@recipestock/shared";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findFetchCall,
  getRequestPath,
  jsonResponse,
  mockFetch,
  renderApp,
  viewerResponse,
} from "../test/router-test-utils";

const savedImage = (objectKey: string, url?: string, width = 1200, height = 800) => ({
  objectKey,
  width,
  height,
  ...(url ? { url } : {}),
});

const savedImages = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, index) =>
    savedImage(
      `recipes/user_123/recipe_123/${prefix}-${index}.webp`,
      `https://images.example/${prefix}-${index}.webp`,
    ),
  );

const savedStepsWithImages = (imageCount: number, prefix: string) =>
  Array.from({ length: Math.ceil(imageCount / MAX_RECIPE_STEP_IMAGES) }, (_, stepIndex) => ({
    text: `手順${stepIndex + 1}`,
    images: savedImages(
      Math.min(MAX_RECIPE_STEP_IMAGES, imageCount - stepIndex * MAX_RECIPE_STEP_IMAGES),
      `${prefix}-${stepIndex}`,
    ),
  }));

const lightboxRecipeResponse = {
  recipe: {
    id: "recipe_123",
    title: "Tomato pasta",
    content: {
      title: "Tomato pasta",
      coverImage: savedImage(
        "recipes/user_123/recipe_123/cover.webp",
        "https://images.example/cover.webp",
      ),
      referenceImages: [
        savedImage(
          "recipes/user_123/recipe_123/source-1.webp",
          "https://images.example/source-1.webp",
          1080,
          1080,
        ),
      ],
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
    tags: [],
    locked: false,
  },
};

const tomatoPastaListItem = {
  id: "recipe_123",
  title: "Tomato pasta",
  coverImageUrl: null,
  sourceName: null,
  createdAt: "2026-05-25T00:00:00.000Z",
  locked: false,
};

const tomatoPastaDetailResponse = {
  recipe: {
    id: "recipe_123",
    title: "Tomato pasta",
    content: { title: "Tomato pasta", ingredientGroups: [], steps: [] },
    source: { sourceUrl: null, normalizedSourceUrl: null, sourceName: null },
    createdAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z",
    tags: [],
    locked: false,
  },
};

const mockLightboxRecipeFetch = () =>
  mockFetch(
    async (input) => {
      if (getRequestPath(input) === "/api/recipes/recipe_123") {
        return jsonResponse(lightboxRecipeResponse);
      }

      return new Response(null, { status: 404 });
    },
    { authenticated: true },
  );

// SNSの画像だけの投稿から取り込んだRecipe。取り込みと同じく、表紙は投稿の1枚目で、レシピ画像にも1枚目から入る。
const mockImageOnlyRecipeFetch = (imageCount: number) => {
  const postImages = Array.from({ length: imageCount }, (_, index) =>
    savedImage(
      `recipes/user_123/recipe_123/post-${index + 1}.webp`,
      `https://images.example/post-${index + 1}.webp`,
      1080,
      1350,
    ),
  );

  return mockFetch(
    async (input) => {
      if (getRequestPath(input) === "/api/recipes/recipe_123") {
        return jsonResponse({
          recipe: {
            ...tomatoPastaDetailResponse.recipe,
            content: {
              title: "Tomato pasta",
              coverImage: postImages[0],
              referenceImages: postImages,
              ingredientGroups: [],
              steps: [],
            },
          },
        });
      }

      return new Response(null, { status: 404 });
    },
    { authenticated: true },
  );
};

const getReferenceImageInput = () => {
  const input = screen
    .getAllByLabelText("レシピ画像を追加")
    .find((element) => element.tagName === "INPUT");

  if (!input) {
    throw new Error("Reference image input not found");
  }

  return input;
};

describe("RecipesRoute", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("レシピ一覧の初回読み込みではカードskeletonを表示する", async () => {
    mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20") {
          return new Promise<Response>(() => {});
        }

        if (getRequestPath(input) === "/api/import/jobs/recent") {
          return jsonResponse({ jobs: [] });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes");

    // layoutのskeletonも同じlabelを持つので、routeがmountされてから
    // route自身の初回ローディングを見る。
    await screen.findByRole("button", { name: "検索" });
    expect(screen.getByText("レシピ一覧を読み込み中")).toBeInTheDocument();
    expect(screen.getAllByTestId("recipe-card-skeleton")).toHaveLength(8);
  });

  it("既存のレシピ一覧がある再取得中はカードを消さない", async () => {
    mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20") {
          return new Promise<Response>(() => {});
        }

        if (getRequestPath(input) === "/api/import/jobs/recent") {
          return jsonResponse({ jobs: [] });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes", (queryClient) => {
      queryClient.setQueryData(
        ["recipes", { query: "", sort: "newest", tagIds: [], untagged: false }],
        {
          pages: [
            {
              items: [
                {
                  id: "recipe_123",
                  title: "Tomato pasta",
                  coverImageUrl: null,
                  sourceName: "Example Kitchen",
                  createdAt: "2026-05-25T00:00:00.000Z",
                  locked: false,
                },
              ],
              nextCursor: null,
            },
          ],
          pageParams: [null],
        },
      );
    });

    await expect(
      screen.findByRole("heading", { name: "Tomato pasta" }),
    ).resolves.toBeInTheDocument();
    expect(screen.queryByTestId("recipe-card-skeleton")).not.toBeInTheDocument();
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

  it("追加した時期で見出しを分けて並べる", async () => {
    mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20") {
          return jsonResponse({
            items: [
              {
                id: "recipe_123",
                title: "Tomato pasta",
                coverImageUrl: null,
                sourceName: "Example Kitchen",
                createdAt: new Date().toISOString(),
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

    const thisWeek = await screen.findByRole("region", { name: "今週" });

    expect(within(thisWeek).getByRole("heading", { name: "Tomato pasta" })).toBeInTheDocument();
    expect(screen.getByText("1件")).toBeInTheDocument();
  });

  it("読み込みが終わるまで件数を出さない", async () => {
    let releaseRecipes = () => {};
    const recipesGate = new Promise<void>((resolve) => {
      releaseRecipes = resolve;
    });

    mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20") {
          await recipesGate;

          return jsonResponse({
            items: [
              {
                id: "recipe_123",
                title: "Tomato pasta",
                coverImageUrl: null,
                sourceName: "Example Kitchen",
                createdAt: new Date().toISOString(),
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

    expect(screen.getByRole("status", { name: "レシピ一覧を読み込み中" })).toBeInTheDocument();
    expect(screen.queryByText("0件")).not.toBeInTheDocument();

    releaseRecipes();

    await expect(screen.findByText("1件")).resolves.toBeInTheDocument();
  });

  it("検索が0件のときは検索を消して一覧に戻れる", async () => {
    mockFetch(
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
                locked: false,
              },
            ],
            nextCursor: null,
          });
        }

        if (input === "/api/recipes?limit=20&q=zzz") {
          return jsonResponse({ items: [], nextCursor: null });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes");
    await screen.findByRole("heading", { name: "Tomato pasta" });

    await userEvent.type(screen.getByLabelText("検索"), "zzz");
    await userEvent.click(screen.getByRole("button", { name: "検索" }));

    await expect(
      screen.findByText("「zzz」に一致するレシピはありません"),
    ).resolves.toBeInTheDocument();
    expect(screen.queryByText("レシピはまだありません")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "すべてのレシピを表示" }));

    await expect(
      screen.findByRole("heading", { name: "Tomato pasta" }),
    ).resolves.toBeInTheDocument();
    expect(screen.getByLabelText("検索")).toHaveValue("");
  });

  it("最初のロック中Recipeの前にプラン導線を1つだけ出す", async () => {
    mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20") {
          return jsonResponse({
            items: [
              {
                id: "recipe_open",
                title: "Tomato pasta",
                coverImageUrl: null,
                sourceName: null,
                createdAt: "2026-05-25T00:00:00.000Z",
                locked: false,
              },
              {
                id: "recipe_locked_1",
                title: "Locked pasta",
                coverImageUrl: null,
                sourceName: null,
                createdAt: "2026-05-20T00:00:00.000Z",
                locked: true,
              },
              {
                id: "recipe_locked_2",
                title: "Locked salad",
                coverImageUrl: null,
                sourceName: null,
                createdAt: "2026-05-19T00:00:00.000Z",
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

    await expect(screen.findByText("ロック中のレシピ")).resolves.toBeInTheDocument();
    expect(screen.getAllByText("ロック中のレシピ")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "プランを見る" })).toHaveAttribute(
      "href",
      "/settings/billing",
    );
  });

  it("表示メニューで古い順を選ぶと古い順で読み込み、URLに残す", async () => {
    mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20") {
          return jsonResponse({
            items: [
              {
                id: "recipe_new",
                title: "Tomato pasta",
                coverImageUrl: null,
                sourceName: null,
                createdAt: "2026-05-25T00:00:00.000Z",
                locked: false,
              },
            ],
            nextCursor: null,
          });
        }

        if (input === "/api/recipes?limit=20&sort=oldest") {
          return jsonResponse({
            items: [
              {
                id: "recipe_old",
                title: "Potato salad",
                coverImageUrl: null,
                sourceName: null,
                createdAt: "2026-03-10T00:00:00.000Z",
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

    const { appRouter } = await renderApp("/recipes");
    await screen.findByRole("heading", { name: "Tomato pasta" });

    await userEvent.click(screen.getByRole("button", { name: "表示の設定" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "古い順" }));
    await userEvent.keyboard("{Escape}");

    await expect(
      screen.findByRole("heading", { name: "Potato salad" }),
    ).resolves.toBeInTheDocument();
    expect(appRouter.state.location.searchStr).toBe("?sort=oldest");
    expect(screen.getByRole("button", { name: "表示の設定（古い順）" })).toBeInTheDocument();
  });

  it("URLで古い順を指定して開くと古い順で読み込む", async () => {
    mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20&sort=oldest") {
          return jsonResponse({
            items: [
              {
                id: "recipe_old",
                title: "Potato salad",
                coverImageUrl: null,
                sourceName: null,
                createdAt: "2026-03-10T00:00:00.000Z",
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

    await renderApp("/recipes?sort=oldest");

    await expect(
      screen.findByRole("heading", { name: "Potato salad" }),
    ).resolves.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "表示の設定（古い順）" })).toBeInTheDocument();
  });

  it("古い順の一覧から詳細を開き、一覧へ戻るボタンで戻っても古い順のまま", async () => {
    mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20&sort=oldest") {
          return jsonResponse({
            items: [
              {
                id: "recipe_old",
                title: "Potato salad",
                coverImageUrl: null,
                sourceName: null,
                createdAt: "2026-03-10T00:00:00.000Z",
                locked: false,
              },
            ],
            nextCursor: null,
          });
        }

        if (getRequestPath(input) === "/api/recipes/recipe_old") {
          return jsonResponse({
            recipe: {
              id: "recipe_old",
              title: "Potato salad",
              content: { title: "Potato salad", ingredientGroups: [], steps: [] },
              source: { sourceUrl: null, normalizedSourceUrl: null, sourceName: null },
              createdAt: "2026-03-10T00:00:00.000Z",
              updatedAt: "2026-03-10T00:00:00.000Z",
              tags: [],
              locked: false,
            },
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    const { appRouter } = await renderApp("/recipes?sort=oldest");

    await userEvent.click(await screen.findByRole("link", { name: /Potato salad/ }));
    await screen.findByRole("button", { name: "操作メニュー" });
    await userEvent.click(screen.getByRole("button", { name: "レシピ一覧へ戻る" }));

    await expect(
      screen.findByRole("button", { name: "表示の設定（古い順）" }),
    ).resolves.toBeInTheDocument();
    expect(appRouter.state.location.searchStr).toBe("?sort=oldest");
    // 一覧を積み直さず、履歴を戻っている。
    expect(appRouter.history.canGoBack()).toBe(false);
  });

  it("一覧から開いた詳細でも、編集から戻ってきた詳細の戻るは編集画面ではなく一覧を開く", async () => {
    mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20") {
          return jsonResponse({ items: [tomatoPastaListItem], nextCursor: null });
        }

        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse(tomatoPastaDetailResponse);
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    const { appRouter } = await renderApp("/recipes");

    await userEvent.click(await screen.findByRole("link", { name: /Tomato pasta/ }));
    await userEvent.click(await screen.findByRole("link", { name: "編集" }));
    await userEvent.click(await screen.findByRole("button", { name: "閉じる" }));
    await userEvent.click(await screen.findByRole("button", { name: "レシピ一覧へ戻る" }));

    await waitFor(() => {
      expect(appRouter.state.location.pathname).toBe("/recipes");
    });
  });

  it("古い順から新しい順に戻すと、詳細から一覧へ戻っても新しい順のまま", async () => {
    mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20&sort=oldest") {
          return jsonResponse({
            items: [
              {
                id: "recipe_old",
                title: "Potato salad",
                coverImageUrl: null,
                sourceName: null,
                createdAt: "2026-03-10T00:00:00.000Z",
                locked: false,
              },
            ],
            nextCursor: null,
          });
        }

        if (input === "/api/recipes?limit=20") {
          return jsonResponse({
            items: [
              {
                id: "recipe_new",
                title: "Tomato pasta",
                coverImageUrl: null,
                sourceName: null,
                createdAt: "2026-05-25T00:00:00.000Z",
                locked: false,
              },
            ],
            nextCursor: null,
          });
        }

        if (getRequestPath(input) === "/api/recipes/recipe_new") {
          return jsonResponse({
            recipe: {
              id: "recipe_new",
              title: "Tomato pasta",
              content: { title: "Tomato pasta", ingredientGroups: [], steps: [] },
              source: { sourceUrl: null, normalizedSourceUrl: null, sourceName: null },
              createdAt: "2026-05-25T00:00:00.000Z",
              updatedAt: "2026-05-25T00:00:00.000Z",
              tags: [],
              locked: false,
            },
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    const { appRouter } = await renderApp("/recipes?sort=oldest");
    await screen.findByRole("heading", { name: "Potato salad" });

    await userEvent.click(screen.getByRole("button", { name: "表示の設定（古い順）" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "新しい順" }));
    await userEvent.keyboard("{Escape}");

    await userEvent.click(await screen.findByRole("link", { name: /Tomato pasta/ }));
    await screen.findByRole("button", { name: "操作メニュー" });
    await userEvent.click(screen.getByRole("button", { name: "レシピ一覧へ戻る" }));

    await expect(screen.findByRole("button", { name: "表示の設定" })).resolves.toBeInTheDocument();
    expect(appRouter.state.location.searchStr).toBe("");
  });

  it("読めない並び順のURLは新しい順で開く", async () => {
    mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20") {
          return jsonResponse({
            items: [
              {
                id: "recipe_new",
                title: "Tomato pasta",
                coverImageUrl: null,
                sourceName: null,
                createdAt: "2026-05-25T00:00:00.000Z",
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

    await renderApp("/recipes?sort=updated");

    await expect(
      screen.findByRole("heading", { name: "Tomato pasta" }),
    ).resolves.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "表示の設定" })).toBeInTheDocument();
  });

  it("古い順を選んだ後でも、読めない並び順への遷移は新しい順に戻す", async () => {
    mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20") {
          return jsonResponse({
            items: [
              {
                id: "recipe_new",
                title: "Tomato pasta",
                coverImageUrl: null,
                sourceName: null,
                createdAt: "2026-05-25T00:00:00.000Z",
                locked: false,
              },
            ],
            nextCursor: null,
          });
        }

        if (input === "/api/recipes?limit=20&sort=oldest") {
          return jsonResponse({
            items: [
              {
                id: "recipe_old",
                title: "Potato salad",
                coverImageUrl: null,
                sourceName: null,
                createdAt: "2026-03-10T00:00:00.000Z",
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

    const { appRouter } = await renderApp("/recipes");
    await screen.findByRole("heading", { name: "Tomato pasta" });

    await userEvent.click(screen.getByRole("button", { name: "表示の設定" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "古い順" }));
    await userEvent.keyboard("{Escape}");
    await screen.findByRole("heading", { name: "Potato salad" });

    await act(async () => {
      await appRouter.navigate({ href: "/recipes?sort=invalid" });
    });

    await expect(
      screen.findByRole("heading", { name: "Tomato pasta" }),
    ).resolves.toBeInTheDocument();
    expect(appRouter.state.location.searchStr).toBe("");
  });

  it("検索するとURLに検索語を残し、検索を消すとURLから外す", async () => {
    mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20" || input === "/api/recipes?limit=20&q=tomato") {
          return jsonResponse({ items: [tomatoPastaListItem], nextCursor: null });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    const { appRouter } = await renderApp("/recipes");
    await screen.findByRole("heading", { name: "Tomato pasta" });

    await userEvent.type(screen.getByLabelText("検索"), "tomato");
    await userEvent.click(screen.getByRole("button", { name: "検索" }));

    await waitFor(() => {
      expect(appRouter.state.location.searchStr).toBe("?q=tomato");
    });

    await userEvent.click(screen.getByRole("button", { name: "検索を消す" }));

    await waitFor(() => {
      expect(appRouter.state.location.searchStr).toBe("");
    });
    expect(screen.getByLabelText("検索")).toHaveValue("");
  });

  it("URLで検索語を指定して開くと検索結果を読み込む", async () => {
    const fetchMock = mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20&q=tomato") {
          return jsonResponse({ items: [tomatoPastaListItem], nextCursor: null });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes?q=tomato");

    await expect(
      screen.findByRole("heading", { name: "Tomato pasta" }),
    ).resolves.toBeInTheDocument();
    expect(screen.getByLabelText("検索")).toHaveValue("tomato");
    expect(findFetchCall(fetchMock, "/api/recipes?limit=20")).toBeUndefined();
  });

  it("数字だけの検索語もURLから文字列として読み込む", async () => {
    const fetchMock = mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20&q=123") {
          return jsonResponse({ items: [tomatoPastaListItem], nextCursor: null });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes?q=123");

    await expect(
      screen.findByRole("heading", { name: "Tomato pasta" }),
    ).resolves.toBeInTheDocument();
    expect(screen.getByLabelText("検索")).toHaveValue("123");
    expect(findFetchCall(fetchMock, "/api/recipes?limit=20&q=123")).toBeDefined();
  });

  it("検索した一覧から詳細を開き、一覧へ戻るボタンで戻っても検索語を保つ", async () => {
    mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20&q=tomato") {
          return jsonResponse({ items: [tomatoPastaListItem], nextCursor: null });
        }

        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse(tomatoPastaDetailResponse);
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    const { appRouter } = await renderApp("/recipes?q=tomato");

    await userEvent.click(await screen.findByRole("link", { name: /Tomato pasta/ }));
    await screen.findByRole("button", { name: "操作メニュー" });
    await userEvent.click(screen.getByRole("button", { name: "レシピ一覧へ戻る" }));

    await expect(
      screen.findByRole("heading", { name: "Tomato pasta" }),
    ).resolves.toBeInTheDocument();
    expect(appRouter.state.location.searchStr).toBe("?q=tomato");
    expect(screen.getByLabelText("検索")).toHaveValue("tomato");
  });

  it("検索した一覧から開いた詳細で削除すると、検索語を保って一覧に戻る", async () => {
    mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/recipes/recipe_123" && init?.method === "DELETE") {
          return jsonResponse({ ok: true });
        }

        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse(tomatoPastaDetailResponse);
        }

        if (input === "/api/recipes?limit=20&q=tomato") {
          return jsonResponse({ items: [tomatoPastaListItem], nextCursor: null });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    const { appRouter } = await renderApp("/recipes?q=tomato");

    await userEvent.click(await screen.findByRole("link", { name: /Tomato pasta/ }));
    await userEvent.click(await screen.findByRole("button", { name: "操作メニュー" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /削除/ }));
    const deleteDialog = await screen.findByRole("alertdialog", {
      name: "レシピを削除しますか？",
    });
    await userEvent.click(within(deleteDialog).getByRole("button", { name: "削除" }));

    await waitFor(() => {
      expect(appRouter.state.location.pathname).toBe("/recipes");
    });
    expect(appRouter.state.location.searchStr).toBe("?q=tomato");
  });

  it("ヘッダーの一覧リンクで開き直すと検索語を外し、並び順は保つ", async () => {
    const fetchMock = mockFetch(
      async (input) => {
        if (
          input === "/api/recipes?limit=20&q=tomato&sort=oldest" ||
          input === "/api/recipes?limit=20&sort=oldest"
        ) {
          return jsonResponse({ items: [tomatoPastaListItem], nextCursor: null });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    const { appRouter } = await renderApp("/recipes?sort=oldest&q=tomato");
    await screen.findByRole("heading", { name: "Tomato pasta" });

    await userEvent.click(screen.getByRole("link", { name: "レシピ一覧" }));

    await waitFor(() => {
      expect(appRouter.state.location.searchStr).toBe("?sort=oldest");
    });
    expect(screen.getByLabelText("検索")).toHaveValue("");
    await waitFor(() => {
      expect(findFetchCall(fetchMock, "/api/recipes?limit=20&sort=oldest")).toBeDefined();
    });
  });

  it("並び順を変えても検索語を保つ", async () => {
    const fetchMock = mockFetch(
      async (input) => {
        if (
          input === "/api/recipes?limit=20&q=tomato" ||
          input === "/api/recipes?limit=20&q=tomato&sort=oldest"
        ) {
          return jsonResponse({ items: [tomatoPastaListItem], nextCursor: null });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    const { appRouter } = await renderApp("/recipes?q=tomato");
    await screen.findByRole("heading", { name: "Tomato pasta" });

    await userEvent.click(screen.getByRole("button", { name: "表示の設定" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "古い順" }));
    await userEvent.keyboard("{Escape}");

    await waitFor(() => {
      expect(appRouter.state.location.search).toEqual({ q: "tomato", sort: "oldest" });
    });
    await waitFor(() => {
      expect(findFetchCall(fetchMock, "/api/recipes?limit=20&q=tomato&sort=oldest")).toBeDefined();
    });
  });

  it("表示メニューからリスト表示に切り替えられる", async () => {
    mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20") {
          return jsonResponse({
            items: [
              {
                id: "recipe_new",
                title: "Tomato pasta",
                coverImageUrl: null,
                sourceName: null,
                createdAt: "2026-05-25T00:00:00.000Z",
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

    try {
      await renderApp("/recipes");
      await screen.findByRole("heading", { name: "Tomato pasta" });

      await userEvent.click(screen.getByRole("button", { name: "表示の設定" }));
      await userEvent.click(await screen.findByRole("menuitemradio", { name: "リスト" }));

      expect(screen.getByRole("menuitemradio", { name: "リスト" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(localStorage.getItem("recipeViewMode")).toBe("list");
    } finally {
      localStorage.removeItem("recipeViewMode");
    }
  });

  it("一覧の末尾が見えたら次ページを自動で読み込む", async () => {
    const observerCallbacks: IntersectionObserverCallback[] = [];

    vi.stubGlobal(
      "IntersectionObserver",
      class IntersectionObserverStub {
        constructor(callback: IntersectionObserverCallback) {
          observerCallbacks.push(callback);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      },
    );
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes?limit=20") {
          return jsonResponse({
            items: [
              {
                id: "recipe_123",
                title: "Tomato pasta",
                coverImageUrl: null,
                sourceName: null,
                createdAt: "2026-05-25T00:00:00.000Z",
                locked: false,
              },
            ],
            nextCursor: "cursor_2",
          });
        }

        if (getRequestPath(input) === "/api/recipes?limit=20&cursor=cursor_2") {
          return jsonResponse({
            items: [
              {
                id: "recipe_456",
                title: "Potato salad",
                coverImageUrl: null,
                sourceName: null,
                createdAt: "2026-05-24T00:00:00.000Z",
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
    await screen.findByRole("heading", { name: "Tomato pasta" });

    const notifyIntersection = observerCallbacks.at(-1);

    if (!notifyIntersection) {
      throw new Error("Sentinel observer was not created");
    }

    act(() => {
      notifyIntersection(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    await expect(
      screen.findByRole("heading", { name: "Potato salad" }),
    ).resolves.toBeInTheDocument();
  });

  it("複数のactive import jobを集約して個別表示する", async () => {
    mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20") {
          return jsonResponse({ items: [], nextCursor: null });
        }

        if (getRequestPath(input) === "/api/import/jobs/recent") {
          return jsonResponse({
            jobs: [
              {
                id: "job_running",
                kind: "url",
                status: "running",
                url: "https://example.com/recipes/running",
                recipeId: null,
                errorCode: null,
                createdAt: "2026-06-01T00:00:00.000Z",
                startedAt: "2026-06-01T00:00:01.000Z",
                finishedAt: null,
              },
              {
                id: "job_queued",
                kind: "url",
                status: "queued",
                url: "https://example.com/recipes/queued",
                recipeId: null,
                errorCode: null,
                createdAt: "2026-06-01T00:00:02.000Z",
                startedAt: null,
                finishedAt: null,
              },
            ],
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes");

    await userEvent.click(await screen.findByRole("button", { name: "2件を取り込み中" }));
    expect(screen.getByText("https://example.com/recipes/running")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/recipes/queued")).toBeInTheDocument();
    expect(screen.getByText("取り込み待ち")).toBeInTheDocument();
    expect(screen.getByText("取り込み中")).toBeInTheDocument();
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

    await userEvent.click(await screen.findByRole("button", { name: "1件保存しました" }));
    expect(screen.getByText("保存しました")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "開く" })).toHaveAttribute(
      "href",
      "/recipes/recipe_123",
    );
  });

  it("active jobを表示中でも成功jobを自動dismissする", async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20") {
          return jsonResponse({ items: [], nextCursor: null });
        }

        if (getRequestPath(input) === "/api/import/jobs/recent") {
          return jsonResponse({
            jobs: [
              {
                id: "job_running",
                kind: "url",
                status: "running",
                url: "https://example.com/recipes/current",
                recipeId: null,
                errorCode: null,
                createdAt: "2026-06-01T00:00:20.000Z",
                startedAt: "2026-06-01T00:00:21.000Z",
                finishedAt: null,
              },
              {
                id: "job_done",
                kind: "url",
                status: "succeeded",
                url: "https://example.com/recipes/done",
                recipeId: "recipe_done",
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

    await vi.waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("取り込み中");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    expect(findFetchCall(fetchMock, "/api/import/jobs/job_done/dismiss")).toEqual([
      "/api/import/jobs/job_done/dismiss",
      expect.objectContaining({ method: "PATCH" }),
    ]);
    expect(screen.getByRole("status")).toHaveTextContent("1件を取り込み中");
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

    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("1件取り込めませんでした");
    });
    await userEvent.click(screen.getByRole("button", { name: "1件取り込めませんでした" }));
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

  const renderLimitFailedJob = async (recipeCount: number) => {
    mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20") {
          return jsonResponse({ items: [], nextCursor: null });
        }

        if (getRequestPath(input) === "/api/import/jobs/recent") {
          return jsonResponse({
            jobs: [
              {
                id: "job_limit",
                kind: "url",
                status: "failed",
                url: "https://example.com/recipes/tomato",
                recipeId: null,
                errorCode: "recipe_limit_exceeded",
                createdAt: "2026-06-01T00:00:00.000Z",
                startedAt: "2026-06-01T00:00:01.000Z",
                finishedAt: "2026-06-01T00:00:10.000Z",
              },
            ],
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true, viewer: { ...viewerResponse, recipeCount } },
    );

    await renderApp("/recipes");

    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("1件取り込めませんでした");
    });
    await userEvent.click(screen.getByRole("button", { name: "1件取り込めませんでした" }));

    expect(screen.getByText("保存できるレシピ数の上限に達しています。")).toBeInTheDocument();
  };

  it("保存の上限で止まった取り込みには、今も上限にいれば再試行の代わりにプランのページへの入口を出す", async () => {
    await renderLimitFailedJob(FREE_RECIPE_LIMIT);

    await vi.waitFor(() => {
      expect(screen.getByRole("link", { name: "プランを見る" })).toHaveAttribute(
        "href",
        "/settings/billing",
      );
    });
    expect(screen.queryByRole("button", { name: "再試行" })).not.toBeInTheDocument();
  });

  it("保存の上限で止まった取り込みでも、あとで枠が空いていれば再試行を出す", async () => {
    await renderLimitFailedJob(FREE_RECIPE_LIMIT - 1);

    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "プランを見る" })).not.toBeInTheDocument();
  });

  it("URL import失敗は時間経過で自動dismissしない", async () => {
    vi.useFakeTimers();
    let dismissed = false;
    const fetchMock = mockFetch(
      async (input, init) => {
        if (input === "/api/recipes?limit=20") {
          return jsonResponse({ items: [], nextCursor: null });
        }

        if (getRequestPath(input) === "/api/import/jobs/recent") {
          return jsonResponse({
            jobs: dismissed
              ? []
              : [
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
          dismissed = true;
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

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes");

    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("1件取り込めませんでした");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(findFetchCall(fetchMock, "/api/import/jobs/job_failed/dismiss")).toBeUndefined();
    expect(screen.getByRole("alert")).toHaveTextContent("1件取り込めませんでした");
  });

  it("テキスト取り込みは原文の最初の行を表示し、失敗したら原文を直す画面から再試行する", async () => {
    mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20") {
          return jsonResponse({ items: [], nextCursor: null });
        }

        if (getRequestPath(input) === "/api/import/jobs/recent") {
          return jsonResponse({
            jobs: [
              {
                id: "job_running",
                kind: "text",
                status: "running",
                url: null,
                textPreview: "豚の生姜焼き",
                recipeId: null,
                errorCode: null,
                createdAt: "2026-06-01T00:00:20.000Z",
                startedAt: "2026-06-01T00:00:21.000Z",
                finishedAt: null,
              },
              {
                id: "job_failed",
                kind: "text",
                status: "failed",
                url: null,
                textPreview: "今日の夕飯",
                recipeId: null,
                errorCode: "extraction_failed",
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

    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("1件取り込めませんでした");
    });
    await userEvent.click(screen.getByRole("button", { name: /1件取り込めませんでした/ }));

    expect(screen.getByText("豚の生姜焼き")).toBeInTheDocument();
    expect(screen.getByText("テキストからレシピを読み取れませんでした。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "再試行" })).toHaveAttribute(
      "href",
      "/import/text?fromJob=job_failed",
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

  it("次ページ読み込み後に以前のページのRecipeを削除すると一覧から消える", async () => {
    let deleted = false;
    let firstPageRequests = 0;
    mockFetch(
      async (input, init) => {
        const path = getRequestPath(input);

        if (path === "/api/recipes?limit=20") {
          firstPageRequests += 1;
          return jsonResponse({
            items: deleted
              ? [
                  {
                    id: "recipe_456",
                    title: "Potato salad",
                    coverImageUrl: null,
                    sourceName: null,
                    createdAt: "2026-05-25T00:00:00.000Z",
                    locked: false,
                  },
                ]
              : [
                  {
                    id: "recipe_123",
                    title: "Tomato pasta",
                    coverImageUrl: null,
                    sourceName: null,
                    createdAt: "2026-05-25T00:00:00.000Z",
                    locked: false,
                  },
                ],
            nextCursor: deleted ? null : "cursor_2",
          });
        }

        if (path === "/api/recipes?limit=20&cursor=cursor_2") {
          return jsonResponse({
            items: [
              {
                id: "recipe_456",
                title: "Potato salad",
                coverImageUrl: null,
                sourceName: null,
                createdAt: "2026-05-25T00:00:00.000Z",
                locked: false,
              },
            ],
            nextCursor: null,
          });
        }

        if (path === "/api/recipes/recipe_123" && init?.method === "DELETE") {
          deleted = true;
          return jsonResponse({ ok: true });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes");
    await screen.findByRole("heading", { name: "Tomato pasta" });
    await userEvent.click(screen.getByRole("button", { name: "もっと見る" }));
    await screen.findByRole("heading", { name: "Potato salad" });

    await userEvent.click(screen.getByRole("button", { name: "Tomato pastaの操作メニュー" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "削除" }));
    const deleteDialog = await screen.findByRole("alertdialog", {
      name: "レシピを削除しますか？",
    });
    await userEvent.click(within(deleteDialog).getByRole("button", { name: "削除" }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Tomato pasta" })).not.toBeInTheDocument();
      expect(screen.getAllByRole("heading", { name: "Potato salad" })).toHaveLength(1);
      expect(firstPageRequests).toBe(2);
    });
  });

  it("一覧からのRecipe削除に失敗するとRecipeを残してエラーを表示する", async () => {
    mockFetch(
      async (input, init) => {
        const path = getRequestPath(input);

        if (path === "/api/recipes?limit=20") {
          return jsonResponse({
            items: [
              {
                id: "recipe_123",
                title: "Tomato pasta",
                coverImageUrl: null,
                sourceName: null,
                createdAt: "2026-05-25T00:00:00.000Z",
                locked: false,
              },
            ],
            nextCursor: null,
          });
        }

        if (path === "/api/recipes/recipe_123" && init?.method === "DELETE") {
          return new Response(null, { status: 500 });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes");
    await screen.findByRole("heading", { name: "Tomato pasta" });
    await userEvent.click(screen.getByRole("button", { name: "Tomato pastaの操作メニュー" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "削除" }));
    const deleteDialog = await screen.findByRole("alertdialog", {
      name: "レシピを削除しますか？",
    });
    await userEvent.click(within(deleteDialog).getByRole("button", { name: "削除" }));

    await expect(screen.findByRole("alert")).resolves.toHaveTextContent(
      "レシピを削除できませんでした。",
    );
    expect(screen.getByRole("heading", { name: "Tomato pasta" })).toBeInTheDocument();
  });

  it("新規レシピを保存して詳細画面で閲覧する", async () => {
    const recipeResponse = {
      recipe: {
        id: "recipe_123",
        title: "Tomato pasta",
        content: {
          title: "Tomato pasta",
          yieldText: "2人分",
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
        tags: [],
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

    // 詳細と同じ並び: 表紙とレシピ名、材料、手順、メモ、レシピ画像。
    const orderedFields = [
      await screen.findByLabelText("表紙の写真"),
      screen.getByLabelText("レシピ名"),
      screen.getByLabelText("できあがり量"),
      screen.getByLabelText("材料名"),
      screen.getByLabelText("手順1"),
      screen.getByRole("textbox", { name: "メモ" }),
      getReferenceImageInput(),
    ];
    for (const [index, field] of orderedFields.entries()) {
      const previousField = orderedFields[index - 1];

      if (previousField) {
        expect(
          previousField.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
    }
    expect(screen.getByLabelText("できあがり量")).toHaveAttribute("placeholder", "例）2人分");

    await userEvent.type(await screen.findByLabelText("レシピ名"), "Tomato pasta");
    await userEvent.type(screen.getByLabelText("できあがり量"), "2人分");
    await userEvent.type(screen.getByLabelText("材料名"), "トマト缶");
    await userEvent.type(screen.getByLabelText("分量"), "1缶");
    await userEvent.type(screen.getByLabelText("手順1"), "煮詰める");
    await userEvent.type(screen.getByRole("textbox", { name: "メモ" }), "仕上げにオリーブオイル。");
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
        yieldText: "2人分",
        ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
        steps: [{ text: "煮詰める", images: [] }],
        note: "仕上げにオリーブオイル。",
      },
      source: {},
    });
    await expect(
      screen.findByRole("heading", { name: "Tomato pasta" }),
    ).resolves.toBeInTheDocument();
    const ingredients = screen.getByRole("heading", { name: "材料" }).closest("section");
    expect(ingredients).not.toBeNull();
    expect(within(ingredients as HTMLElement).getByText("トマト缶")).toBeInTheDocument();
    expect(within(ingredients as HTMLElement).getByText("1缶")).toBeInTheDocument();
    expect(screen.getByText("煮詰める")).toBeInTheDocument();
  });

  it("新規レシピでカバー画像、レシピ画像、手順画像をアップロードして保存できる", async () => {
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
          referenceImages: [
            savedImage(
              "recipes/user_123/recipe_123/reference.webp",
              "https://images.example/reference.webp",
            ),
          ],
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
        tags: [],
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
            objectKey: [
              "tmp/user_123/cover.webp",
              "tmp/user_123/reference.webp",
              "tmp/user_123/step.webp",
            ][uploadUrlRequests - 1],
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

    await userEvent.type(await screen.findByLabelText("レシピ名"), "Tomato pasta");
    await userEvent.upload(
      screen.getByLabelText("表紙の写真"),
      new File(["cover"], "cover.webp", { type: "image/webp" }),
    );
    await userEvent.upload(
      getReferenceImageInput() as HTMLElement,
      new File(["reference"], "reference.webp", { type: "image/webp" }),
    );
    await userEvent.type(screen.getByLabelText("手順1"), "煮詰める");
    await userEvent.upload(
      screen.getByLabelText("手順1の画像"),
      new File(["step"], "step.webp", { type: "image/webp" }),
    );
    await screen.findByAltText("表紙の写真プレビュー");
    await screen.findByAltText("レシピ画像1プレビュー");
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
        referenceImages: [{ type: "tmpObjectKey", key: "tmp/user_123/reference.webp" }],
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
    expect(fetchMock).toHaveBeenCalledWith(
      "https://upload.example/3",
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
        tags: [],
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

    await userEvent.type(await screen.findByLabelText("レシピ名"), "Tomato pasta");
    await userEvent.upload(
      screen.getByLabelText("表紙の写真"),
      new File(["cover"], "cover.webp", { type: "image/webp" }),
    );
    await expect(screen.findByAltText("表紙の写真プレビュー")).resolves.toHaveAttribute(
      "src",
      "blob:first-cover-preview",
    );

    await userEvent.upload(
      screen.getByLabelText("表紙の写真"),
      new File(["replacement"], "replacement.webp", { type: "image/webp" }),
    );
    await expect(
      screen.findByText("画像をアップロードできませんでした。"),
    ).resolves.toBeInTheDocument();
    expect(screen.getByAltText("表紙の写真プレビュー")).toHaveAttribute(
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

  it("詳細画面の初回読み込みでは詳細skeletonを表示する", async () => {
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return new Promise<Response>(() => {});
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/recipe_123");

    expect(screen.getByText("レシピ詳細を読み込み中")).toBeInTheDocument();
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
                referenceImages: [
                  savedImage(
                    "recipes/user_123/recipe_123/source-1.webp",
                    "https://images.example/source-1.webp",
                    1080,
                    1080,
                  ),
                  savedImage(
                    "recipes/user_123/recipe_123/source-2.webp",
                    "https://images.example/source-2.webp",
                    1080,
                    1080,
                  ),
                ],
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
              tags: [],
              locked: false,
            },
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/recipe_123");

    const title = await screen.findByRole("heading", { name: "Tomato pasta" });
    const coverImage = await screen.findByAltText("Tomato pasta");
    // 表紙を先に大きく見せ、その下にタイトルを組む。
    expect(
      coverImage.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(coverImage).toHaveAttribute("src", "https://images.example/cover.webp");
    expect(coverImage).toHaveAttribute("width", "1200");
    expect(coverImage).toHaveAttribute("height", "800");
    expect(coverImage).toHaveAttribute("decoding", "async");
    expect(coverImage).toHaveAttribute("fetchpriority", "high");
    expect(screen.getByRole("button", { name: "Tomato pastaを拡大" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "レシピ画像" })).toBeInTheDocument();
    const firstReferenceImage = screen.getByAltText("レシピ画像1");
    expect(firstReferenceImage).toHaveAttribute("src", "https://images.example/source-1.webp");
    expect(firstReferenceImage).toHaveAttribute("loading", "lazy");
    expect(firstReferenceImage).toHaveAttribute("decoding", "async");
    expect(screen.getByAltText("レシピ画像2")).toHaveAttribute(
      "src",
      "https://images.example/source-2.webp",
    );
    const stepImage = screen.getByAltText("手順1の画像1");
    expect(stepImage).toHaveAttribute("src", "https://images.example/step.webp");
    expect(stepImage).toHaveAttribute("width", "800");
    expect(stepImage).toHaveAttribute("height", "1200");
    expect(stepImage).toHaveAttribute("loading", "lazy");
    expect(stepImage).toHaveAttribute("decoding", "async");
    expect(stepImage).toHaveStyle({ aspectRatio: "800 / 1200" });
    expect(screen.queryByAltText("手順2の画像1")).not.toBeInTheDocument();
  });

  it("詳細画面の画像を拡大するとライトボックスを開いて前後の画像に移動できる", async () => {
    mockLightboxRecipeFetch();

    await renderApp("/recipes/recipe_123");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Tomato pastaを拡大" }));

    const lightbox = await screen.findByRole("dialog", { name: "画像プレビュー" });
    expect(within(lightbox).getByText("1 / 3")).toBeInTheDocument();
    expect(within(lightbox).getByRole("button", { name: "前の画像" })).toBeDisabled();
    expect(within(lightbox).getByRole("button", { name: "拡大" })).toBeInTheDocument();
    expect(within(lightbox).getByRole("button", { name: "縮小" })).toBeInTheDocument();
    expect(within(lightbox).getByAltText("Tomato pasta")).toHaveAttribute(
      "src",
      "https://images.example/cover.webp",
    );

    await user.click(within(lightbox).getByRole("button", { name: "次の画像" }));

    expect(await within(lightbox).findByText("2 / 3")).toBeInTheDocument();
    expect(within(lightbox).getByAltText("レシピ画像1")).toHaveAttribute(
      "src",
      "https://images.example/source-1.webp",
    );

    await user.click(within(lightbox).getByRole("button", { name: "次の画像" }));

    expect(await within(lightbox).findByText("3 / 3")).toBeInTheDocument();
    expect(within(lightbox).getByRole("button", { name: "次の画像" })).toBeDisabled();

    await user.click(within(lightbox).getByRole("button", { name: "前の画像" }));

    expect(await within(lightbox).findByText("2 / 3")).toBeInTheDocument();
  });

  it("ライトボックスを閉じると拡大ボタンにフォーカスが戻る", async () => {
    mockLightboxRecipeFetch();

    await renderApp("/recipes/recipe_123");

    const user = userEvent.setup();
    const zoomButton = await screen.findByRole("button", { name: "手順1の画像1を拡大" });
    await user.click(zoomButton);

    const lightbox = await screen.findByRole("dialog", { name: "画像プレビュー" });
    expect(within(lightbox).getByText("3 / 3")).toBeInTheDocument();

    await user.click(within(lightbox).getByRole("button", { name: "閉じる" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "画像プレビュー" })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(zoomButton).toHaveFocus();
    });
  });

  it("表紙がレシピ画像の1枚目と同じなら、段には並べたままライトボックスでは1回だけ出す", async () => {
    mockImageOnlyRecipeFetch(3);

    await renderApp("/recipes/recipe_123");

    const user = userEvent.setup();
    const referenceImages = await screen.findByRole("region", { name: "レシピ画像" });
    expect(within(referenceImages).getByText("3枚")).toBeInTheDocument();
    expect(within(referenceImages).getByAltText("レシピ画像1")).toHaveAttribute(
      "src",
      "https://images.example/post-1.webp",
    );

    await user.click(screen.getByRole("button", { name: "Tomato pastaを拡大" }));

    const lightbox = await screen.findByRole("dialog", { name: "画像プレビュー" });
    expect(within(lightbox).getByText("1 / 3")).toBeInTheDocument();

    await user.click(within(lightbox).getByRole("button", { name: "次の画像" }));

    expect(await within(lightbox).findByText("2 / 3")).toBeInTheDocument();
    expect(within(lightbox).getByAltText("レシピ画像2")).toHaveAttribute(
      "src",
      "https://images.example/post-2.webp",
    );
  });

  it("レシピ画像が表紙と同じ1枚だけなら、レシピ画像の段を出さない", async () => {
    mockImageOnlyRecipeFetch(1);

    await renderApp("/recipes/recipe_123");

    await expect(
      screen.findByRole("button", { name: "Tomato pastaを拡大" }),
    ).resolves.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "レシピ画像" })).not.toBeInTheDocument();
    expect(screen.queryByAltText("レシピ画像1")).not.toBeInTheDocument();
  });

  it("材料も手順もないレシピでは、レシピ画像の見出しに画面を消さないを出す", async () => {
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request: vi.fn() },
    });

    try {
      mockImageOnlyRecipeFetch(2);

      await renderApp("/recipes/recipe_123");

      const referenceImages = await screen.findByRole("region", { name: "レシピ画像" });
      expect(
        within(referenceImages).getByRole("button", { name: "画面を消さない" }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "画面を消さない" })).toHaveLength(1);
    } finally {
      Reflect.deleteProperty(navigator, "wakeLock");
    }
  });

  it("詳細画面ではタイトルを見出しとして一度だけ出し、出典から元のページを別のタブで開ける", async () => {
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse({
            recipe: {
              ...tomatoPastaDetailResponse.recipe,
              source: {
                sourceUrl: "https://www.example.com/recipes/tomato",
                normalizedSourceUrl: "https://www.example.com/recipes/tomato",
                sourceName: "Example Kitchen",
              },
            },
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/recipe_123");

    await screen.findByRole("heading", { name: "Tomato pasta" });
    expect(screen.getAllByRole("heading", { name: "Tomato pasta" })).toHaveLength(1);
    const sourceLinks = screen.getAllByRole("link", { name: /元のページを開く/ });
    expect(sourceLinks).toHaveLength(2);
    for (const link of sourceLinks) {
      expect(link).toHaveAttribute("href", "https://www.example.com/recipes/tomato");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    }
    expect(screen.getByText("example.com")).toBeInTheDocument();
  });

  it("詳細画面の材料と手順は押せる操作にせず、文字として出す", async () => {
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse({
            recipe: {
              ...tomatoPastaDetailResponse.recipe,
              content: {
                title: "Tomato pasta",
                yieldText: "2人分",
                ingredientGroups: [
                  {
                    ingredients: [
                      { name: "トマト缶", amount: "1缶" },
                      { name: "塩 少々", amount: "" },
                    ],
                  },
                ],
                steps: [
                  { text: "煮詰める", images: [] },
                  { text: "塩で味を調える", images: [] },
                ],
              },
            },
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/recipe_123");

    const ingredients = within(await screen.findByRole("region", { name: "材料" })).getAllByRole(
      "listitem",
    );
    expect(ingredients.map((ingredient) => ingredient.textContent)).toEqual([
      "トマト缶1缶",
      // 分量を分けられなかった行は、名前だけの行になる。
      "塩 少々",
    ]);
    const steps = within(screen.getByRole("region", { name: "手順" })).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual(["1煮詰める", "2塩で味を調える"]);
    expect(screen.queryByRole("button", { name: /トマト缶|煮詰める/ })).not.toBeInTheDocument();
    // wake lockを使えないブラウザでは切り替えを出さない。
    expect(screen.queryByRole("button", { name: "画面を消さない" })).not.toBeInTheDocument();
  });

  it("画面を消さないを押している間だけ、画面のwake lockを持つ", async () => {
    const release = vi.fn(async () => {});
    const request = vi.fn(async () => ({ released: false, release }));
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });

    try {
      mockFetch(
        async (input) => {
          if (getRequestPath(input) === "/api/recipes/recipe_123") {
            return jsonResponse({
              recipe: {
                ...tomatoPastaDetailResponse.recipe,
                content: {
                  title: "Tomato pasta",
                  ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
                  steps: [{ text: "煮詰める", images: [] }],
                },
              },
            });
          }

          return new Response(null, { status: 404 });
        },
        { authenticated: true },
      );

      await renderApp("/recipes/recipe_123");

      const toggle = await screen.findByRole("button", { name: "画面を消さない" });
      await userEvent.click(toggle);

      await waitFor(() => {
        expect(request).toHaveBeenCalledWith("screen");
      });
      expect(toggle).toHaveAttribute("aria-pressed", "true");

      await userEvent.click(toggle);

      await waitFor(() => {
        expect(release).toHaveBeenCalled();
      });
      expect(toggle).toHaveAttribute("aria-pressed", "false");
    } finally {
      Reflect.deleteProperty(navigator, "wakeLock");
    }
  });

  it("詳細画面で読み込めなかった画像は代わりの表示にし、ライトボックスにも出さない", async () => {
    mockLightboxRecipeFetch();

    await renderApp("/recipes/recipe_123");

    const user = userEvent.setup();
    fireEvent.error(await screen.findByAltText("手順1の画像1"));

    await expect(
      screen.findByRole("img", { name: "手順1の画像1を読み込めませんでした" }),
    ).resolves.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "手順1の画像1を拡大" })).not.toBeInTheDocument();

    fireEvent.error(screen.getByAltText("Tomato pasta"));

    await expect(
      screen.findByRole("img", { name: "Tomato pastaの画像を読み込めませんでした" }),
    ).resolves.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tomato pastaを拡大" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "レシピ画像1を拡大" }));

    const lightbox = await screen.findByRole("dialog", { name: "画像プレビュー" });
    expect(within(lightbox).getByText("1 / 1")).toBeInTheDocument();
  });

  it("見つからないレシピは再読み込みを出さず、一覧へ戻る導線を出す", async () => {
    mockFetch(
      async (input) => {
        if (input === "/api/recipes?limit=20") {
          return jsonResponse({ items: [], nextCursor: null });
        }

        if (getRequestPath(input) === "/api/recipes/recipe_deleted") {
          return jsonResponse(
            { error: { code: "not_found", message: "Recipe was not found." } },
            { status: 404 },
          );
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    const { appRouter } = await renderApp("/recipes/recipe_deleted");

    await expect(
      screen.findByRole("heading", { name: "レシピが見つかりません" }),
    ).resolves.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "再読み込み" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "レシピ一覧へ" }));

    await waitFor(() => {
      expect(appRouter.state.location.pathname).toBe("/recipes");
    });
  });

  it("詳細からの削除に失敗したら、ダイアログを開いたまま中にエラーを出す", async () => {
    mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return init?.method === "DELETE"
            ? new Response(null, { status: 500 })
            : jsonResponse(tomatoPastaDetailResponse);
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/recipe_123");
    await userEvent.click(await screen.findByRole("button", { name: "操作メニュー" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /削除/ }));
    const deleteDialog = await screen.findByRole("alertdialog", {
      name: "レシピを削除しますか？",
    });
    await userEvent.click(within(deleteDialog).getByRole("button", { name: "削除" }));

    await expect(within(deleteDialog).findByRole("alert")).resolves.toHaveTextContent(
      "レシピを削除できませんでした。",
    );
    expect(deleteDialog).toBeInTheDocument();
    expect(within(deleteDialog).getByRole("button", { name: "削除" })).toBeEnabled();

    // 開き直したときは、前回の失敗を出さない。
    await userEvent.click(within(deleteDialog).getByRole("button", { name: "キャンセル" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "操作メニュー" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /削除/ }));
    const reopenedDialog = await screen.findByRole("alertdialog", {
      name: "レシピを削除しますか？",
    });
    expect(within(reopenedDialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("詳細を読み込めなかったら、再読み込みで取り直せる", async () => {
    let detailRequests = 0;
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          detailRequests += 1;

          return detailRequests === 1
            ? jsonResponse(
                { error: { code: "unknown", message: "Unexpected error occurred." } },
                { status: 500 },
              )
            : jsonResponse(tomatoPastaDetailResponse);
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/recipe_123");

    await expect(
      screen.findByRole("heading", { name: "レシピを表示できません" }),
    ).resolves.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "再読み込み" }));

    await expect(
      screen.findByRole("heading", { name: "Tomato pasta" }),
    ).resolves.toBeInTheDocument();
    expect(detailRequests).toBe(2);
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

    const { appRouter } = await renderApp("/recipes/recipe_locked");

    await expect(
      screen.findByRole("heading", { name: "ロック中のレシピ" }),
    ).resolves.toBeInTheDocument();
    expect(
      screen.getByText(`Freeで開けるのは、新しく保存した${FREE_RECIPE_LIMIT}件までです。`),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "プランを見る" })).toHaveAttribute(
      "href",
      "/settings/billing",
    );
    expect(screen.queryByRole("link", { name: "編集" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "材料" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "レシピ一覧へ戻る" }));
    expect(appRouter.state.location.pathname).toBe("/recipes");
  });

  it("編集画面の初回読み込みではフォームskeletonを表示する", async () => {
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return new Promise<Response>(() => {});
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/recipe_123/edit");

    expect(screen.getByText("レシピ編集フォームを読み込み中")).toBeInTheDocument();
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

    const { appRouter } = await renderApp("/recipes/recipe_locked/edit");

    await expect(
      screen.findByRole("heading", { name: "レシピを編集できません" }),
    ).resolves.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更新" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "レシピ詳細へ戻る" }));
    expect(appRouter.state.location.pathname).toBe("/recipes/recipe_locked");
  });

  it("詳細画面から編集して本文だけを更新できる", async () => {
    const recipeResponse = {
      recipe: {
        id: "recipe_123",
        title: "Tomato pasta",
        content: {
          title: "Tomato pasta",
          yieldText: "2人分",
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
        tags: [],
        locked: false,
      },
    };
    const updatedRecipeMutationResponse = {
      recipe: {
        ...recipeResponse.recipe,
        title: "Potato salad",
        content: {
          title: "Potato salad",
          yieldText: "3人分",
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
        tags: [],
      },
    };
    const updatedRecipeDetailResponse = {
      recipe: {
        ...recipeResponse.recipe,
        title: "Potato salad",
        content: {
          ...recipeResponse.recipe.content,
          title: "Potato salad",
          yieldText: "3人分",
        },
        updatedAt: "2026-05-27T00:00:00.000Z",
        tags: [],
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
    await expect(screen.findByLabelText("レシピ名")).resolves.toBeInTheDocument();
    expect(screen.getByDisplayValue("Tomato pasta")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2人分")).toBeInTheDocument();
    expect(screen.getByDisplayValue("トマト缶")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1缶")).toBeInTheDocument();
    expect(screen.getByDisplayValue("煮詰める")).toBeInTheDocument();
    expect(screen.getByDisplayValue("仕上げにオリーブオイル。")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("レシピ名"));
    await userEvent.type(screen.getByLabelText("レシピ名"), "Potato salad");
    await userEvent.clear(screen.getByLabelText("できあがり量"));
    await userEvent.type(screen.getByLabelText("できあがり量"), "3人分");
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
        yieldText: "3人分",
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
              tags: [],
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

    await userEvent.click(screen.getByRole("button", { name: "手順1の画像1を削除" }));

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
        tags: [],
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

    const firstSavedImageRemoveButton = await screen.findByRole("button", {
      name: "手順1の画像1を削除",
    });
    expect(screen.queryByAltText("手順1の画像1プレビュー")).not.toBeInTheDocument();
    expect(screen.getByAltText("手順1の画像2プレビュー")).toHaveAttribute(
      "src",
      "https://images.example/step-b.webp",
    );

    await userEvent.click(firstSavedImageRemoveButton);
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

  it("編集画面でレシピ画像上限に達したらレシピ画像追加を無効にする", async () => {
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse({
            recipe: {
              id: "recipe_123",
              title: "Tomato pasta",
              content: {
                title: "Tomato pasta",
                referenceImages: savedImages(MAX_RECIPE_REFERENCE_IMAGES, "source"),
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
              tags: [],
              locked: false,
            },
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/recipe_123/edit");

    await expect(screen.findByLabelText("レシピ名")).resolves.toBeInTheDocument();
    expect(getReferenceImageInput()).toBeDisabled();
    expect(screen.getByText("上限に達しました")).toBeInTheDocument();
    expect(screen.getByLabelText("手順1の画像")).not.toBeDisabled();
  });

  it("編集画面で手順画像上限に達したら該当手順の画像追加だけを無効にする", async () => {
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
                  { text: "煮詰める", images: savedImages(MAX_RECIPE_STEP_IMAGES, "step") },
                  { text: "盛り付ける", images: [] },
                ],
              },
              source: {
                sourceUrl: null,
                normalizedSourceUrl: null,
                sourceName: null,
              },
              createdAt: "2026-05-26T00:00:00.000Z",
              updatedAt: "2026-05-26T00:00:00.000Z",
              tags: [],
              locked: false,
            },
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/recipe_123/edit");

    await expect(screen.findByLabelText("レシピ名")).resolves.toBeInTheDocument();
    expect(screen.getByLabelText("手順1の画像")).toBeDisabled();
    expect(screen.getByLabelText("手順2の画像")).not.toBeDisabled();
    expect(screen.getByText("上限に達しました")).toBeInTheDocument();
  });

  it("レシピ画像の残り枠を超えて選ぶと、全件をすぐ拒否して未変更のままにする", async () => {
    const recipeResponse = {
      recipe: {
        ...tomatoPastaDetailResponse.recipe,
        content: {
          ...tomatoPastaDetailResponse.recipe.content,
          referenceImages: savedImages(MAX_RECIPE_REFERENCE_IMAGES - 1, "source"),
          steps: [{ text: "煮詰める", images: [] }],
        },
      },
    };
    const fetchMock = mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse(recipeResponse);
        }

        if (getRequestPath(input) === "/api/images/upload-url" && init?.method === "POST") {
          return new Response(null, { status: 500 });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );
    const { appRouter } = await renderApp("/recipes/recipe_123/edit");

    await screen.findByLabelText("レシピ名");
    await userEvent.upload(getReferenceImageInput(), [
      new File(["first"], "first.webp", { type: "image/webp" }),
      new File(["second"], "second.webp", { type: "image/webp" }),
    ]);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "追加できる画像はあと1枚です。画像を選び直してください。",
    );
    expect(screen.queryByLabelText("レシピ画像をアップロード中")).not.toBeInTheDocument();
    expect(
      screen.queryByAltText(`レシピ画像${MAX_RECIPE_REFERENCE_IMAGES}プレビュー`),
    ).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          getRequestPath(input) === "/api/images/upload-url" && init?.method === "POST",
      ),
    ).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "閉じる" }));
    await waitFor(() => {
      expect(appRouter.state.location.pathname).toBe("/recipes/recipe_123");
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("手順画像の残り枠超過を全件拒否し、枚数内で選び直すとアップロードする", async () => {
    const recipeResponse = {
      recipe: {
        ...tomatoPastaDetailResponse.recipe,
        content: {
          ...tomatoPastaDetailResponse.recipe.content,
          steps: [
            {
              text: "煮詰める",
              images: savedImages(MAX_RECIPE_STEP_IMAGES - 1, "step"),
            },
          ],
        },
      },
    };
    let uploadUrlRequests = 0;
    const fetchMock = mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse(recipeResponse);
        }

        if (getRequestPath(input) === "/api/images/upload-url" && init?.method === "POST") {
          uploadUrlRequests += 1;
          return jsonResponse({
            uploadUrl: "https://upload.example/step.webp",
            objectKey: "tmp/user_123/step.webp",
            expiresAt: "2026-05-31T00:15:00.000Z",
          });
        }

        if (input === "https://upload.example/step.webp") {
          return new Response(null, { status: 200 });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/recipe_123/edit");

    const stepImageInput = await screen.findByLabelText("手順1の画像");
    await userEvent.upload(stepImageInput, [
      new File(["first"], "first.webp", { type: "image/webp" }),
      new File(["second"], "second.webp", { type: "image/webp" }),
    ]);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "追加できる画像はあと1枚です。画像を選び直してください。",
    );
    expect(screen.queryByLabelText("手順1の画像をアップロード中")).not.toBeInTheDocument();
    expect(
      screen.queryByAltText(`手順1の画像${MAX_RECIPE_STEP_IMAGES}プレビュー`),
    ).not.toBeInTheDocument();
    expect(uploadUrlRequests).toBe(0);

    await userEvent.upload(
      stepImageInput,
      new File(["retry"], "retry.webp", { type: "image/webp" }),
    );

    await expect(
      screen.findByAltText(`手順1の画像${MAX_RECIPE_STEP_IMAGES}プレビュー`),
    ).resolves.toBeInTheDocument();
    expect(uploadUrlRequests).toBe(1);
    expect(
      screen.queryByText("追加できる画像はあと1枚です。画像を選び直してください。"),
    ).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://upload.example/step.webp",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("編集画面で全体画像上限に達したらレシピ画像と手順画像追加を無効にしカバー画像変更は許可する", async () => {
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
                referenceImages: savedImages(MAX_RECIPE_REFERENCE_IMAGES, "source"),
                ingredientGroups: [],
                steps: savedStepsWithImages(
                  MAX_RECIPE_TOTAL_IMAGES - MAX_RECIPE_REFERENCE_IMAGES,
                  "step",
                ),
              },
              source: {
                sourceUrl: null,
                normalizedSourceUrl: null,
                sourceName: null,
              },
              createdAt: "2026-05-26T00:00:00.000Z",
              updatedAt: "2026-05-26T00:00:00.000Z",
              tags: [],
              locked: false,
            },
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/recipe_123/edit");

    await expect(screen.findByLabelText("レシピ名")).resolves.toBeInTheDocument();
    expect(screen.getByLabelText("表紙の写真")).not.toBeDisabled();
    expect(getReferenceImageInput()).toBeDisabled();
    expect(screen.getByLabelText("手順1の画像")).toBeDisabled();
    expect(screen.getAllByText("上限に達しました").length).toBeGreaterThan(1);
  });

  it("編集画面でレシピ画像を削除して保存できる", async () => {
    const recipeResponse = {
      recipe: {
        id: "recipe_123",
        title: "Tomato pasta",
        content: {
          title: "Tomato pasta",
          referenceImages: [
            savedImage(
              "recipes/user_123/recipe_123/source-a.webp",
              "https://images.example/source-a.webp",
            ),
            savedImage(
              "recipes/user_123/recipe_123/source-b.webp",
              "https://images.example/source-b.webp",
            ),
          ],
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
        tags: [],
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

    const firstPreview = await screen.findByAltText("レシピ画像1プレビュー");
    expect(firstPreview).toHaveAttribute("src", "https://images.example/source-a.webp");
    expect(screen.getByAltText("レシピ画像2プレビュー")).toHaveAttribute(
      "src",
      "https://images.example/source-b.webp",
    );

    await userEvent.click(screen.getByRole("button", { name: "レシピ画像1を削除" }));
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
        referenceImages: [
          {
            type: "existingObjectKey",
            key: "recipes/user_123/recipe_123/source-b.webp",
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
          yieldText: "2人分",
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
        tags: [],
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
              tags: [],
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

    await userEvent.clear(await screen.findByLabelText("レシピ名"));
    await userEvent.type(screen.getByLabelText("レシピ名"), "Potato salad");
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
    expect(screen.getByRole("button", { name: "レシピ一覧へ戻る" })).toBeInTheDocument();
    expect(screen.queryByText("レシピを更新できませんでした。")).not.toBeInTheDocument();
  });

  it("詳細画面から削除すると一覧に戻る", async () => {
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
        tags: [],
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
    await userEvent.click(await screen.findByRole("button", { name: "操作メニュー" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /削除/ }));
    const deleteDialog = await screen.findByRole("alertdialog", {
      name: "レシピを削除しますか？",
    });
    await userEvent.click(within(deleteDialog).getByRole("button", { name: "削除" }));

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

    await userEvent.type(await screen.findByLabelText("レシピ名"), "Tomato pasta");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await expect(screen.findByRole("alert")).resolves.toHaveTextContent(
      "保存できるレシピ数の上限に達しています。",
    );
  });

  it("編集画面で変更してから閉じると破棄を確認し、編集を続けるか破棄するかを選べる", async () => {
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse(tomatoPastaDetailResponse);
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    const { appRouter } = await renderApp("/recipes/recipe_123/edit");

    await userEvent.type(await screen.findByLabelText("レシピ名"), "!");
    await userEvent.click(screen.getByRole("button", { name: "閉じる" }));

    const keepEditingDialog = await screen.findByRole("alertdialog", {
      name: "変更を破棄しますか？",
    });
    await userEvent.click(within(keepEditingDialog).getByRole("button", { name: "編集を続ける" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(appRouter.state.location.pathname).toBe("/recipes/recipe_123/edit");
    expect(screen.getByLabelText("レシピ名")).toHaveValue("Tomato pasta!");

    await userEvent.click(screen.getByRole("button", { name: "閉じる" }));
    const discardDialog = await screen.findByRole("alertdialog", {
      name: "変更を破棄しますか？",
    });
    await userEvent.click(within(discardDialog).getByRole("button", { name: "破棄する" }));

    await waitFor(() => {
      expect(appRouter.state.location.pathname).toBe("/recipes/recipe_123");
    });
  });

  it("保存の通信中は閉じるボタンを押せない", async () => {
    mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/recipes" && init?.method === "POST") {
          return new Promise<Response>(() => {});
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    const { appRouter } = await renderApp("/recipes/new");

    await userEvent.type(await screen.findByLabelText("レシピ名"), "Tomato pasta");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    const closeButton = screen.getByRole("button", { name: "閉じる" });
    await waitFor(() => {
      expect(closeButton).toBeDisabled();
    });

    await userEvent.click(closeButton);
    expect(appRouter.state.location.pathname).toBe("/recipes/new");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("画像のアップロード中に閉じると、ほかに変更がなくても破棄を確認する", async () => {
    // アップロードの同時数はモジュールで共有する。止めたままにすると枠を握って終わり、
    // 後続のテストで3枚同時に始められなくなるので、最後に必ず失敗させて返す。
    let failUploadUrl!: () => void;
    const heldUploadUrlRequest = new Promise<Response>((resolve) => {
      failUploadUrl = () => resolve(new Response(null, { status: 500 }));
    });

    mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/images/upload-url" && init?.method === "POST") {
          return heldUploadUrlRequest;
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    const { appRouter } = await renderApp("/recipes/new");

    await screen.findByLabelText("レシピ名");
    await userEvent.upload(getReferenceImageInput(), [
      new File(["reference"], "reference.webp", { type: "image/webp" }),
    ]);
    await screen.findByLabelText("レシピ画像をアップロード中");

    await userEvent.click(screen.getByRole("button", { name: "閉じる" }));

    const discardDialog = await screen.findByRole("alertdialog", {
      name: "変更を破棄しますか？",
    });
    expect(appRouter.state.location.pathname).toBe("/recipes/new");

    await userEvent.click(within(discardDialog).getByRole("button", { name: "編集を続ける" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(appRouter.state.location.pathname).toBe("/recipes/new");

    await act(async () => {
      failUploadUrl();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("欄の下に出せない検証で保存が止まったときは、その理由を知らせる", async () => {
    const fetchMock = mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse({
            recipe: {
              id: "recipe_123",
              title: "Tomato pasta",
              content: {
                title: "Tomato pasta",
                ingredientGroups: [],
                steps: savedStepsWithImages(MAX_RECIPE_TOTAL_IMAGES + 1, "step"),
              },
              source: {
                sourceUrl: null,
                normalizedSourceUrl: null,
                sourceName: null,
              },
              createdAt: "2026-05-26T00:00:00.000Z",
              updatedAt: "2026-05-26T00:00:00.000Z",
              tags: [],
              locked: false,
            },
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/recipe_123/edit");

    await screen.findByLabelText("レシピ名");
    await userEvent.click(screen.getByRole("button", { name: "更新" }));

    await expect(screen.findByRole("alert")).resolves.toHaveTextContent(
      `画像は全部で${MAX_RECIPE_TOTAL_IMAGES}枚までです。`,
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });

  // 保存済みの本文には上限を置かないので、上限より長いRecipeも編集画面までは開ける。
  it("上限より長い手順を持つ既存のレシピは、保存を止めて長さの理由を知らせる", async () => {
    const fetchMock = mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse({
            recipe: {
              id: "recipe_123",
              title: "Tomato pasta",
              content: {
                title: "Tomato pasta",
                ingredientGroups: [],
                steps: [{ text: "あ".repeat(MAX_RECIPE_STEP_TEXT_LENGTH + 1), images: [] }],
              },
              source: {
                sourceUrl: null,
                normalizedSourceUrl: null,
                sourceName: null,
              },
              createdAt: "2026-05-26T00:00:00.000Z",
              updatedAt: "2026-05-26T00:00:00.000Z",
              tags: [],
              locked: false,
            },
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/recipe_123/edit");

    await screen.findByLabelText("レシピ名");
    await userEvent.click(screen.getByRole("button", { name: "更新" }));

    await expect(screen.findByRole("alert")).resolves.toHaveTextContent(
      `1つの手順は${MAX_RECIPE_STEP_TEXT_LENGTH}文字までです。`,
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });

  it("編集画面で何も変えていなければ、確認せずに閉じる", async () => {
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse(tomatoPastaDetailResponse);
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    const { appRouter } = await renderApp("/recipes/recipe_123/edit");

    await screen.findByLabelText("レシピ名");
    await userEvent.click(screen.getByRole("button", { name: "閉じる" }));

    await waitFor(() => {
      expect(appRouter.state.location.pathname).toBe("/recipes/recipe_123");
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("新しいレシピで入力を消して元に戻したら、確認せずに閉じる", async () => {
    mockFetch(async () => new Response(null, { status: 404 }), { authenticated: true });

    const { appRouter } = await renderApp("/recipes/new");

    const titleInput = await screen.findByLabelText("レシピ名");
    await userEvent.type(titleInput, "a");
    await userEvent.clear(titleInput);
    await userEvent.click(screen.getByRole("button", { name: "閉じる" }));

    await waitFor(() => {
      expect(appRouter.state.location.pathname).toBe("/recipes");
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("レシピ名が空白だけのまま保存すると、レシピ名の下に知らせて送信しない", async () => {
    const fetchMock = mockFetch(async () => new Response(null, { status: 404 }), {
      authenticated: true,
    });

    await renderApp("/recipes/new");

    const titleInput = await screen.findByLabelText("レシピ名");
    await userEvent.type(titleInput, "   ");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await expect(screen.findByText("レシピ名を入力してください")).resolves.toBeInTheDocument();
    expect(titleInput).toHaveAttribute("aria-invalid", "true");
    expect(titleInput).toHaveFocus();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => getRequestPath(input) === "/api/recipes" && init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("レシピ画像は複数まとめて選ぶと、選んだ順に並べて保存する", async () => {
    let uploadUrlRequests = 0;
    const fetchMock = mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/images/upload-url" && init?.method === "POST") {
          uploadUrlRequests += 1;
          return jsonResponse({
            uploadUrl: `https://upload.example/${uploadUrlRequests}`,
            objectKey: `tmp/user_123/reference-${uploadUrlRequests}.webp`,
            expiresAt: "2026-05-31T00:15:00.000Z",
          });
        }

        if (typeof input === "string" && input.startsWith("https://upload.example/")) {
          return new Response(null, { status: 200 });
        }

        if (getRequestPath(input) === "/api/recipes" && init?.method === "POST") {
          return jsonResponse(tomatoPastaDetailResponse, { status: 201 });
        }

        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse(tomatoPastaDetailResponse);
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/new");

    await userEvent.type(await screen.findByLabelText("レシピ名"), "Tomato pasta");
    await userEvent.upload(getReferenceImageInput(), [
      new File(["first"], "first.webp", { type: "image/webp" }),
      new File(["second"], "second.webp", { type: "image/webp" }),
    ]);
    await screen.findByAltText("レシピ画像2プレビュー");
    expect(screen.getByAltText("レシピ画像1プレビュー")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(findFetchCall(fetchMock, "/api/recipes")).toBeDefined();
    });
    const createRecipeCall = findFetchCall(fetchMock, "/api/recipes");
    expect(JSON.parse(String(createRecipeCall?.[1]?.body))).toMatchObject({
      content: {
        referenceImages: [
          { type: "tmpObjectKey", key: "tmp/user_123/reference-1.webp" },
          { type: "tmpObjectKey", key: "tmp/user_123/reference-2.webp" },
        ],
      },
    });
  });

  it("レシピ画像はアップロードが終わったものから順に並び、前が残っている間は後ろを待たせる", async () => {
    let uploadUrlRequests = 0;
    const heldUploads = new Map<string, () => void>();
    const finishUpload = async (uploadUrl: string) => {
      await waitFor(() => {
        expect(heldUploads.has(uploadUrl)).toBe(true);
      });
      heldUploads.get(uploadUrl)?.();
      // 解放した1枚の後始末が画面に届くまで一巡させる。
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };

    const fetchMock = mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/images/upload-url" && init?.method === "POST") {
          uploadUrlRequests += 1;
          return jsonResponse({
            uploadUrl: `https://upload.example/${uploadUrlRequests}`,
            objectKey: `tmp/user_123/reference-${uploadUrlRequests}.webp`,
            expiresAt: "2026-05-31T00:15:00.000Z",
          });
        }

        if (typeof input === "string" && input.startsWith("https://upload.example/")) {
          await new Promise<void>((resolve) => {
            heldUploads.set(input, resolve);
          });
          return new Response(null, { status: 200 });
        }

        if (getRequestPath(input) === "/api/recipes" && init?.method === "POST") {
          return jsonResponse(tomatoPastaDetailResponse, { status: 201 });
        }

        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse(tomatoPastaDetailResponse);
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/new");

    await userEvent.type(await screen.findByLabelText("レシピ名"), "Tomato pasta");
    await userEvent.upload(getReferenceImageInput(), [
      new File(["first"], "first.webp", { type: "image/webp" }),
      new File(["second"], "second.webp", { type: "image/webp" }),
      new File(["third"], "third.webp", { type: "image/webp" }),
    ]);

    // 1枚目が終わった時点で、残り2枚を待たずに並ぶ。
    await finishUpload("https://upload.example/1");
    expect(screen.getByAltText("レシピ画像1プレビュー")).toBeInTheDocument();
    expect(screen.getAllByLabelText("レシピ画像をアップロード中")).toHaveLength(2);

    // 3枚目が先に終わっても、2枚目が残っている間は並べない。
    await finishUpload("https://upload.example/3");
    expect(screen.getAllByLabelText("レシピ画像をアップロード中")).toHaveLength(2);
    expect(screen.queryByAltText("レシピ画像2プレビュー")).not.toBeInTheDocument();

    // 2枚目が終わると、待たせていた3枚目も続けて並ぶ。
    await finishUpload("https://upload.example/2");
    expect(screen.queryAllByLabelText("レシピ画像をアップロード中")).toHaveLength(0);
    expect(screen.getByAltText("レシピ画像3プレビュー")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(findFetchCall(fetchMock, "/api/recipes")).toBeDefined();
    });
    const createRecipeCall = findFetchCall(fetchMock, "/api/recipes");
    expect(JSON.parse(String(createRecipeCall?.[1]?.body))).toMatchObject({
      content: {
        referenceImages: [
          { type: "tmpObjectKey", key: "tmp/user_123/reference-1.webp" },
          { type: "tmpObjectKey", key: "tmp/user_123/reference-2.webp" },
          { type: "tmpObjectKey", key: "tmp/user_123/reference-3.webp" },
        ],
      },
    });
  });

  it("編集画面で読み込めなかった画像は代わりの表示にし、削除はできる", async () => {
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse({
            recipe: {
              ...tomatoPastaDetailResponse.recipe,
              content: {
                title: "Tomato pasta",
                referenceImages: [
                  savedImage(
                    "recipes/user_123/recipe_123/source-a.webp",
                    "https://images.example/source-a.webp",
                  ),
                ],
                ingredientGroups: [],
                steps: [],
              },
            },
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes/recipe_123/edit");

    fireEvent.error(await screen.findByAltText("レシピ画像1プレビュー"));

    expect(
      await screen.findByRole("img", { name: "レシピ画像1を表示できません" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "レシピ画像1を削除" }));
    expect(
      screen.queryByRole("img", { name: "レシピ画像1を表示できません" }),
    ).not.toBeInTheDocument();
  });
});
