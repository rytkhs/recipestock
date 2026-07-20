import { screen, waitFor } from "@testing-library/react";
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
    vi.unstubAllGlobals();
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

  it("初回session通信に失敗した保護ルートはURLを維持してbrand chromeだけを表示する", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (getRequestPath(input).endsWith("/get-session")) {
        throw new TypeError("Failed to fetch");
      }
      return new Response(null, { status: 404 });
    });
    const importPath = "/import/url?url=https%3A%2F%2Fexample.com%2Frecipes%2Ftomato";
    const { appRouter } = await renderApp(importPath);

    await expect(
      screen.findByRole("heading", { name: "接続を確認できません" }),
    ).resolves.toBeInTheDocument();
    expect(appRouter.state.location.href).toBe(importPath);
    expect(screen.queryByRole("button", { name: "サインアップ / ログイン" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Mobile navigation" })).toBeNull();
    expect(screen.queryByRole("link", { name: "アカウント" })).toBeNull();
  });

  it("取得済みviewerがあればbackground refetchの5xx後もprivate画面を維持する", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = getRequestPath(input);
      if (path.endsWith("/get-session")) return createSessionResponse(true);
      if (path === "/api/me") {
        return jsonResponse(
          {
            error: {
              code: "temporarily_unavailable",
              message: "Please retry later.",
            },
          },
          { status: 503 },
        );
      }
      if (path === "/api/recipes?limit=20") {
        return jsonResponse({ items: [], nextCursor: null });
      }
      return new Response(null, { status: 404 });
    });

    await renderApp("/recipes", (queryClient) => {
      queryClient.setQueryData(["viewer"], viewerResponse);
    });

    await expect(screen.findByRole("button", { name: "検索" })).resolves.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "アカウント" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "接続を確認できません" })).toBeNull();
  });

  it("viewer取得失敗を同じURLで再試行して回復する", async () => {
    let viewerAvailable = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = getRequestPath(input);
      if (path.endsWith("/get-session")) return createSessionResponse(true);
      if (path === "/api/me") {
        return viewerAvailable
          ? jsonResponse(viewerResponse)
          : jsonResponse(
              {
                error: {
                  code: "temporarily_unavailable",
                  message: "Please retry later.",
                },
              },
              { status: 503 },
            );
      }
      return new Response(null, { status: 404 });
    });
    const importPath = "/import/url?url=https%3A%2F%2Fexample.com%2Frecipes%2Ftomato";
    const { appRouter } = await renderApp(importPath);

    await expect(
      screen.findByRole("heading", { name: "接続を確認できません" }),
    ).resolves.toBeInTheDocument();
    viewerAvailable = true;
    await userEvent.click(screen.getByRole("button", { name: "再試行" }));

    await expect(
      screen.findByRole("heading", { name: "URLから取り込む" }),
    ).resolves.toBeInTheDocument();
    expect(appRouter.state.location.href).toBe(importPath);
  });

  it("viewer再試行の401はfresh session確認後にviewerを再取得する", async () => {
    let sessionChecks = 0;
    let viewerChecks = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = getRequestPath(input);
      if (path.endsWith("/get-session")) {
        sessionChecks += 1;
        return createSessionResponse(true);
      }
      if (path === "/api/me") {
        viewerChecks += 1;
        if (viewerChecks === 1) {
          return jsonResponse(
            {
              error: {
                code: "temporarily_unavailable",
                message: "Please retry later.",
              },
            },
            { status: 503 },
          );
        }
        if (viewerChecks === 2) {
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
        return jsonResponse(viewerResponse);
      }
      if (path === "/api/recipes?limit=20") {
        return jsonResponse({ items: [], nextCursor: null });
      }
      return new Response(null, { status: 404 });
    });
    const { appRouter } = await renderApp("/recipes");

    await expect(
      screen.findByRole("heading", { name: "接続を確認できません" }),
    ).resolves.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "再試行" }));

    await expect(screen.findByRole("button", { name: "検索" })).resolves.toBeInTheDocument();
    expect(appRouter.state.location.pathname).toBe("/recipes");
    expect(sessionChecks).toBe(2);
    expect(viewerChecks).toBe(3);
  });

  it("viewer 401後のfresh session通信失敗はloginへ送らずsession unavailableにする", async () => {
    let sessionChecks = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = getRequestPath(input);
      if (path.endsWith("/get-session")) {
        sessionChecks += 1;
        if (sessionChecks === 1) return createSessionResponse(true);
        throw new TypeError("Failed to fetch");
      }
      if (path === "/api/me") {
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
    const { appRouter } = await renderApp("/recipes");

    await expect(
      screen.findByRole("heading", { name: "接続を確認できません" }),
    ).resolves.toBeInTheDocument();
    expect(appRouter.state.location.pathname).toBe("/recipes");
    expect(screen.queryByRole("heading", { name: "ログイン" })).toBeNull();
    expect(findFetchCall(fetchMock, "/api/me")).toBeDefined();
    expect(sessionChecks).toBe(2);
  });

  it("viewer 401の回復後に再度401ならviewer unavailableで止める", async () => {
    let sessionChecks = 0;
    let viewerChecks = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = getRequestPath(input);
      if (path.endsWith("/get-session")) {
        sessionChecks += 1;
        return createSessionResponse(true);
      }
      if (path === "/api/me") {
        viewerChecks += 1;
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
    const { appRouter } = await renderApp("/recipes");

    await expect(
      screen.findByRole("heading", { name: "接続を確認できません" }),
    ).resolves.toBeInTheDocument();
    await waitFor(() => {
      expect(sessionChecks).toBe(2);
      expect(viewerChecks).toBe(2);
    });
    expect(appRouter.state.location.pathname).toBe("/recipes");
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
    queryClient.setQueryData(["push-subscriptions"], {
      applicationServerKey: "AQID",
      subscriptions: [
        {
          endpoint: "https://push.example.com/subscription/device-1",
          expirationTime: null,
        },
      ],
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
    expect(queryClient.getQueryData(["push-subscriptions"])).toBeUndefined();
  });
});
