import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findFetchCall,
  getRequestPath,
  jsonResponse,
  mockFetch,
  renderApp,
} from "../test/router-test-utils";

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
          ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
          steps: [{ text: "煮詰める" }],
          note: "仕上げにオリーブオイル。",
        },
        source: {
          sourceType: "manual",
          sourcePlatform: null,
          sourceUrl: "https://example.com/recipes/tomato",
          normalizedSourceUrl: "https://example.com/recipes/tomato",
          sourceName: "Example Kitchen",
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
    await userEvent.type(screen.getByLabelText("出典名"), "Example Kitchen");
    await userEvent.type(screen.getByLabelText("元URL"), "https://example.com/recipes/tomato");
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
        steps: [{ text: "煮詰める" }],
        note: "仕上げにオリーブオイル。",
      },
      source: {
        sourceType: "manual",
        sourceName: "Example Kitchen",
        sourceUrl: "https://example.com/recipes/tomato",
      },
    });
    await expect(
      screen.findByRole("heading", { name: "Tomato pasta" }),
    ).resolves.toBeInTheDocument();
    expect(screen.getByText("トマト缶 1缶")).toBeInTheDocument();
    expect(screen.getByText("煮詰める")).toBeInTheDocument();
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
