import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRouter, createAppRouter } from "./router";

const authenticatedSession = {
  session: {
    id: "session_123",
    userId: "user_123",
  },
  user: {
    id: "user_123",
    email: "chef@example.com",
    name: "chef",
  },
};

const getRequestPath = (input: RequestInfo | URL) => {
  const toPath = (urlValue: string) => {
    try {
      const url = new URL(urlValue, window.location.origin);
      return `${url.pathname}${url.search}`;
    } catch {
      return urlValue;
    }
  };

  if (typeof input === "string") {
    return toPath(input);
  }

  if (input instanceof URL) {
    return `${input.pathname}${input.search}`;
  }

  return toPath(input.url);
};

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });

const createSessionResponse = (authenticated: boolean) =>
  jsonResponse(authenticated ? authenticatedSession : null);

const mockFetch = (
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response,
  { authenticated = false }: { authenticated?: boolean } = {},
) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (getRequestPath(input).endsWith("/get-session")) {
      return createSessionResponse(authenticated);
    }

    return handler(input, init);
  });

type FetchMock = {
  mock: {
    calls: [RequestInfo | URL, RequestInit?][];
  };
};

const findFetchCall = (fetchMock: FetchMock, path: string) =>
  fetchMock.mock.calls.find(([input]) => getRequestPath(input) === path);

const renderApp = async (initialPath = "/") => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const appRouter = createAppRouter({
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <AppRouter appRouter={appRouter} />
    </QueryClientProvider>,
  );

  await act(async () => {
    await appRouter.load();
  });
  return { ...view, appRouter, queryClient };
};

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

  it("未ログインで認証必須ルートに入るとログインへ遷移する", async () => {
    mockFetch(async () => new Response(null, { status: 404 }));
    await renderApp("/recipes");

    await expect(screen.findByRole("heading", { name: "ログイン" })).resolves.toBeInTheDocument();
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

    await expect(screen.findByRole("heading", { name: "Recipes" })).resolves.toBeInTheDocument();
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

    await expect(screen.findByRole("heading", { name: "Recipes" })).resolves.toBeInTheDocument();
  });

  it("ログインルートからGoogleログインを開始する", async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse({ url: "https://accounts.google.com/o/oauth2/v2/auth" }),
    );
    await renderApp("/login");

    await userEvent.click(await screen.findByRole("button", { name: "Googleでログイン" }));

    const signInCall = findFetchCall(fetchMock, "/api/auth/sign-in/social");
    expect(signInCall).toEqual([
      "/api/auth/sign-in/social",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    ]);
    expect(JSON.parse(String(signInCall?.[1]?.body))).toMatchObject({
      provider: "google",
      disableRedirect: true,
    });
  });

  it("ログインルートからメールとパスワードでログインする", async () => {
    const fetchMock = mockFetch(async () => jsonResponse({ token: "session_token" }));
    await renderApp("/login");

    await userEvent.type(await screen.findByLabelText("メールアドレス"), "chef@example.com");
    await userEvent.type(screen.getByLabelText("パスワード"), "password123");
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));

    const signInCall = findFetchCall(fetchMock, "/api/auth/sign-in/email");
    expect(signInCall).toEqual([
      "/api/auth/sign-in/email",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    ]);
    expect(JSON.parse(String(signInCall?.[1]?.body))).toMatchObject({
      email: "chef@example.com",
      password: "password123",
    });
  });

  it("ログインルートから新規登録してOTP検証に進む", async () => {
    const fetchMock = mockFetch(async () => jsonResponse({ token: null }));
    await renderApp("/login");

    await userEvent.click(await screen.findByRole("button", { name: "アカウントを作成" }));
    await userEvent.type(screen.getByLabelText("メールアドレス"), "chef@example.com");
    await userEvent.type(screen.getByLabelText("パスワード"), "password123");
    await userEvent.click(screen.getByRole("button", { name: "登録してコードを送信" }));

    const signUpCall = findFetchCall(fetchMock, "/api/auth/sign-up/email");
    expect(signUpCall).toEqual([
      "/api/auth/sign-up/email",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    ]);
    expect(JSON.parse(String(signUpCall?.[1]?.body))).toMatchObject({
      name: "chef",
      email: "chef@example.com",
      password: "password123",
    });
    await expect(screen.findByLabelText("確認コード")).resolves.toBeInTheDocument();
  });

  it("ログインルートで登録OTPを検証する", async () => {
    const fetchMock = mockFetch(async () => jsonResponse({ success: true }));
    await renderApp("/login");

    await userEvent.click(await screen.findByRole("button", { name: "アカウントを作成" }));
    await userEvent.type(screen.getByLabelText("メールアドレス"), "chef@example.com");
    await userEvent.type(screen.getByLabelText("パスワード"), "password123");
    await userEvent.click(screen.getByRole("button", { name: "登録してコードを送信" }));
    await userEvent.type(await screen.findByLabelText("確認コード"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "登録を完了" }));

    const verifyCall = findFetchCall(fetchMock, "/api/auth/email-otp/verify-email");
    expect(verifyCall).toEqual([
      "/api/auth/email-otp/verify-email",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    ]);
    expect(JSON.parse(String(verifyCall?.[1]?.body))).toEqual({
      email: "chef@example.com",
      otp: "123456",
    });
  });

  it("ログインルートでOTP方式のパスワードリセットを実行する", async () => {
    const fetchMock = mockFetch(async () => jsonResponse({ success: true }));
    await renderApp("/login");

    await userEvent.click(await screen.findByRole("button", { name: "パスワードを忘れた場合" }));
    await userEvent.type(screen.getByLabelText("メールアドレス"), "chef@example.com");
    await userEvent.click(screen.getByRole("button", { name: "再設定コードを送信" }));
    await userEvent.type(await screen.findByLabelText("確認コード"), "123456");
    await userEvent.type(screen.getByLabelText("新しいパスワード"), "newpassword123");
    await userEvent.click(screen.getByRole("button", { name: "パスワードを再設定" }));

    const requestResetCall = findFetchCall(fetchMock, "/api/auth/email-otp/request-password-reset");
    expect(requestResetCall).toEqual([
      "/api/auth/email-otp/request-password-reset",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    ]);
    expect(JSON.parse(String(requestResetCall?.[1]?.body))).toEqual({
      email: "chef@example.com",
    });
    const resetPasswordCall = findFetchCall(fetchMock, "/api/auth/email-otp/reset-password");
    expect(resetPasswordCall).toEqual([
      "/api/auth/email-otp/reset-password",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    ]);
    expect(JSON.parse(String(resetPasswordCall?.[1]?.body))).toEqual({
      email: "chef@example.com",
      otp: "123456",
      password: "newpassword123",
    });
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
          sourceType: "web",
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
        sourceType: "web",
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

  it("ログアウトするとユーザー依存キャッシュを消してログインへ遷移する", async () => {
    let authenticated = true;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = getRequestPath(input);

      if (path.endsWith("/get-session")) {
        return createSessionResponse(authenticated);
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
    const { queryClient } = await renderApp("/recipes");
    queryClient.setQueryData(["recipes", "", null], { items: [], nextCursor: null });
    queryClient.setQueryData(["recipe", "recipe_123"], { id: "recipe_123" });
    queryClient.setQueryData(["me"], { userId: "user_123" });

    await userEvent.click(await screen.findByRole("button", { name: "ログアウト" }));

    expect(findFetchCall(fetchMock, "/api/auth/sign-out")).toEqual([
      "/api/auth/sign-out",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    ]);
    await expect(screen.findByRole("heading", { name: "ログイン" })).resolves.toBeInTheDocument();
    expect(queryClient.getQueryData(["recipes", "", null])).toBeUndefined();
    expect(queryClient.getQueryData(["recipe", "recipe_123"])).toBeUndefined();
    expect(queryClient.getQueryData(["me"])).toBeUndefined();
  });
});
