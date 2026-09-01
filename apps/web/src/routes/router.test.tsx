import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSessionResponse,
  findFetchCall,
  getRequestPath,
  isGetSessionRequest,
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
      if (isGetSessionRequest(input)) {
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

  it("ログイン済みで認証必須ルートに入るとviewerと画面データを並行して取得する", async () => {
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
    expect(findFetchCall(fetchMock, "/api/recipes?limit=20")).toBeDefined();
  });

  it("viewerが未解決でもルートを描画して画面データの取得を始める", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = getRequestPath(input);
      if (isGetSessionRequest(input)) return createSessionResponse(true);
      // viewerは永遠に解決しない。それでもルートは描画され、画面データを取りに行く。
      if (path === "/api/me") return new Promise<Response>(() => {});
      if (path === "/api/recipes?limit=20") {
        return jsonResponse({ items: [], nextCursor: null });
      }
      return new Response(null, { status: 404 });
    });

    await renderApp("/recipes");

    await expect(screen.findByRole("button", { name: "検索" })).resolves.toBeInTheDocument();
    expect(findFetchCall(fetchMock, "/api/recipes?limit=20")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "接続を確認できません" })).toBeNull();
  });

  it("/api/meがunauthorizedを返すとユーザー依存キャッシュを消してログインへ遷移する", async () => {
    let authenticated = true;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = getRequestPath(input);

      if (isGetSessionRequest(input)) {
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
      if (isGetSessionRequest(input)) {
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
    expect(screen.queryAllByRole("button", { name: "レシピ追加" })).toHaveLength(0);
    expect(screen.queryByRole("link", { name: "アカウント" })).toBeNull();
  });

  it("レシピ一覧ではレシピ追加FABとアカウント導線を表示する", async () => {
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes?limit=20") {
          return jsonResponse({ items: [], nextCursor: null });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/recipes");

    await expect(screen.findByTestId("add-recipe-fab")).resolves.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "アカウント" })).not.toHaveLength(0);
  });

  it("レシピ一覧以外ではレシピ追加FABを表示しない", async () => {
    mockFetch(async () => new Response(null, { status: 404 }), { authenticated: true });

    await renderApp("/settings");

    await expect(screen.findByRole("heading", { name: "設定" })).resolves.toBeInTheDocument();
    expect(screen.queryByTestId("add-recipe-fab")).toBeNull();
  });

  it("設定から戻るとレシピ一覧へ遷移する", async () => {
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes?limit=20") {
          return jsonResponse({ items: [], nextCursor: null });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    const { appRouter } = await renderApp("/settings");

    await userEvent.click(await screen.findByRole("button", { name: "レシピ一覧へ戻る" }));

    await expect(screen.findByRole("button", { name: "検索" })).resolves.toBeInTheDocument();
    expect(appRouter.state.location.pathname).toBe("/recipes");
  });

  it("viewerの5xxはルートの描画を妨げない", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = getRequestPath(input);
      if (isGetSessionRequest(input)) return createSessionResponse(true);
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

    await renderApp("/recipes");

    await expect(screen.findByRole("button", { name: "検索" })).resolves.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "アカウント" })).not.toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "接続を確認できません" })).toBeNull();
  });

  it("session取得失敗を同じURLで再試行して回復する", async () => {
    let sessionAvailable = false;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = getRequestPath(input);
      if (isGetSessionRequest(input)) {
        if (!sessionAvailable) throw new TypeError("Failed to fetch");
        return createSessionResponse(true);
      }
      if (path === "/api/me") return jsonResponse(viewerResponse);
      return new Response(null, { status: 404 });
    });
    const importPath = "/import/url?url=https%3A%2F%2Fexample.com%2Frecipes%2Ftomato";
    const { appRouter } = await renderApp(importPath);

    await expect(
      screen.findByRole("heading", { name: "接続を確認できません" }),
    ).resolves.toBeInTheDocument();
    sessionAvailable = true;
    await userEvent.click(screen.getByRole("button", { name: "再試行" }));

    await expect(
      screen.findByRole("heading", { name: "URLから取り込む" }),
    ).resolves.toBeInTheDocument();
    expect(appRouter.state.location.href).toBe(importPath);
    expect(
      fetchMock.mock.calls
        .map(([input]) => getRequestPath(input))
        .filter((path) => path.startsWith("/api/auth/get-session")),
    ).toEqual(["/api/auth/get-session", "/api/auth/get-session"]);
  });

  it("viewerの401はfresh session確認後に取り直し、ルートを描画し続ける", async () => {
    const authRequests: string[] = [];
    let viewerChecks = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = getRequestPath(input);
      if (isGetSessionRequest(input)) {
        authRequests.push(path);
        return createSessionResponse(true);
      }
      if (path === "/api/me") {
        authRequests.push("viewer");
        viewerChecks += 1;
        if (viewerChecks === 1) {
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

    await expect(screen.findByRole("button", { name: "検索" })).resolves.toBeInTheDocument();
    await vi.waitFor(() => {
      expect(authRequests).toEqual([
        "/api/auth/get-session",
        "viewer",
        "/api/auth/get-session?disableCookieCache=true",
        "viewer",
      ]);
    });
    expect(appRouter.state.location.pathname).toBe("/recipes");
    expect(screen.queryByRole("heading", { name: "接続を確認できません" })).toBeNull();
  });

  it("viewer 401後のfresh session通信失敗はloginへ送らずsession unavailableにする", async () => {
    let sessionChecks = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = getRequestPath(input);
      if (isGetSessionRequest(input)) {
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

  it("viewer 401の回復後に再度401ならルートを描画したまま打ち切る", async () => {
    let sessionChecks = 0;
    let viewerChecks = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = getRequestPath(input);
      if (isGetSessionRequest(input)) {
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

    await expect(screen.findByRole("button", { name: "検索" })).resolves.toBeInTheDocument();
    await vi.waitFor(() => {
      expect(sessionChecks).toBe(2);
      expect(viewerChecks).toBe(2);
    });

    // 回復ループが追撃しないことを確認する
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(sessionChecks).toBe(2);
    expect(viewerChecks).toBe(2);
    expect(screen.queryByRole("heading", { name: "接続を確認できません" })).toBeNull();
    expect(appRouter.state.location.pathname).toBe("/recipes");
  });

  it("ログアウトするとユーザー依存キャッシュを消してログインへ遷移する", async () => {
    let authenticated = true;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = getRequestPath(input);

      if (isGetSessionRequest(input)) {
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
