import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSessionResponse,
  findFetchCall,
  getRequestPath,
  jsonResponse,
  mockFetch,
  renderApp,
  viewerResponse,
} from "../test/router-test-utils";

describe("AppRouter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("初期ルートを表示する", async () => {
    mockFetch(async () => new Response(null, { status: 404 }));
    await renderApp();

    await expect(
      screen.findByRole("heading", { name: "Recipe Stock" }),
    ).resolves.toBeInTheDocument();
  });

  it("認証確認中は未ログインナビと共通ローディングを出さず保護ルートskeletonを表示する", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (getRequestPath(input).endsWith("/get-session")) {
        return new Promise<Response>(() => {});
      }

      return new Response(null, { status: 404 });
    });

    await renderApp("/recipes");

    expect(screen.queryByRole("button", { name: "サインアップ / ログイン" })).toBeNull();
    expect(screen.queryByRole("status", { name: "読み込み中" })).toBeNull();
    expect(screen.getByText("レシピ一覧を読み込み中")).toBeInTheDocument();
    expect(screen.getAllByTestId("recipe-card-skeleton")).toHaveLength(8);
  });

  it("未ログインで認証必須ルートに入るとログインへ遷移する", async () => {
    mockFetch(async () => new Response(null, { status: 404 }));
    await renderApp("/recipes");

    await expect(screen.findByRole("heading", { name: "ログイン" })).resolves.toBeInTheDocument();
  });

  it("未ログインで共有URLに入るとqueryをログイン復帰先へ保持する", async () => {
    mockFetch(async () => new Response(null, { status: 404 }));
    const sharedUrl = "https://example.com/recipes/tomato?portion=2";
    const importPath = `/import/url?url=${encodeURIComponent(sharedUrl)}`;
    const { appRouter } = await renderApp(importPath);

    await expect(screen.findByRole("heading", { name: "ログイン" })).resolves.toBeInTheDocument();
    expect(appRouter.state.location.pathname).toBe("/login");
    expect(appRouter.state.location.search).toEqual({ redirect: importPath });
  });

  it("ログイン済みでログインルートに入るとレシピ一覧へ遷移する", async () => {
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes?limit=20") {
          return jsonResponse({ items: [], nextCursor: null });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/login");

    await expect(screen.findByRole("button", { name: "検索" })).resolves.toBeInTheDocument();
  });

  it("ログイン済みで認証必須ルートに入るとviewerを取得してから画面を表示する", async () => {
    const fetchMock = mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes?limit=20") {
          return jsonResponse({ items: [], nextCursor: null });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes");

    await expect(screen.findByRole("button", { name: "検索" })).resolves.toBeInTheDocument();
    expect(findFetchCall(fetchMock, "/api/me")).toEqual([
      "/api/me",
      expect.objectContaining({
        credentials: "include",
        method: "GET",
      }),
    ]);
  });

  it("/api/meがunauthorizedを返すとユーザー依存キャッシュを消してログインへ遷移する", async () => {
    let authenticated = true;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = getRequestPath(input);

      if (path.endsWith("/get-session")) {
        return createSessionResponse(authenticated);
      }

      if (path === "/api/me") {
        authenticated = false;
        return jsonResponse(
          {
            error: {
              code: "unauthorized",
              message: "Authentication is required.",
            },
          },
          { status: 401 },
        );
      }

      return new Response(null, { status: 404 });
    });
    const { queryClient } = await renderApp("/recipes", (queryClient) => {
      queryClient.setQueryData(["viewer"], viewerResponse);
      queryClient.setQueryData(["billing-status"], {
        plan: "pro",
        subscription: {
          status: "active",
          cancelAtPeriodEnd: false,
          currentPeriodEnd: "2026-07-04T00:00:00.000Z",
          cancelAt: null,
        },
      });
      queryClient.setQueryData(["recipes", { query: "" }], {
        pages: [{ items: [], nextCursor: null }],
        pageParams: [null],
      });
    });

    await expect(screen.findByRole("heading", { name: "ログイン" })).resolves.toBeInTheDocument();
    expect(findFetchCall(fetchMock, "/api/me")).toBeDefined();
    expect(queryClient.getQueryData(["viewer"])).toBeUndefined();
    expect(queryClient.getQueryData(["billing-status"])).toBeUndefined();
    expect(queryClient.getQueryData(["recipes", { query: "" }])).toBeUndefined();
  });

  it("ログイン済みで初期ルートに入るとレシピ一覧へ遷移する", async () => {
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes?limit=20") {
          return jsonResponse({ items: [], nextCursor: null });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/");

    await expect(screen.findByRole("button", { name: "検索" })).resolves.toBeInTheDocument();
  });

  it("ログアウトするとユーザー依存キャッシュを消してログインへ遷移する", async () => {
    let authenticated = true;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = getRequestPath(input);

      if (path.endsWith("/get-session")) {
        return createSessionResponse(authenticated);
      }

      if (path === "/api/me" && authenticated) {
        return jsonResponse(viewerResponse);
      }

      if (path === "/api/auth/sign-out" && init?.method === "POST") {
        authenticated = false;
        return jsonResponse({ success: true });
      }

      if (path === "/api/recipes?limit=20") {
        return jsonResponse({ items: [], nextCursor: null });
      }

      return new Response(null, { status: 404 });
    });
    const { queryClient } = await renderApp("/settings");
    queryClient.setQueryData(["recipes", { query: "" }], {
      pages: [{ items: [], nextCursor: null }],
      pageParams: [null],
    });
    queryClient.setQueryData(["recipe", "recipe_123"], { id: "recipe_123" });
    queryClient.setQueryData(["viewer"], viewerResponse);
    queryClient.setQueryData(["billing-status"], {
      plan: "pro",
      subscription: {
        status: "active",
        cancelAtPeriodEnd: false,
        currentPeriodEnd: "2026-07-04T00:00:00.000Z",
        cancelAt: null,
      },
    });

    await userEvent.click(await screen.findByRole("button", { name: "ログアウト" }));

    expect(findFetchCall(fetchMock, "/api/auth/sign-out")).toEqual([
      "/api/auth/sign-out",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    ]);
    await expect(screen.findByRole("heading", { name: "ログイン" })).resolves.toBeInTheDocument();
    expect(queryClient.getQueryData(["recipes", { query: "" }])).toBeUndefined();
    expect(queryClient.getQueryData(["recipe", "recipe_123"])).toBeUndefined();
    expect(queryClient.getQueryData(["viewer"])).toBeUndefined();
    expect(queryClient.getQueryData(["billing-status"])).toBeUndefined();
  });
});
