import { type ShortcutCredential } from "@recipestock/schemas";
import { PLAN_LIMITS } from "@recipestock/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { act, render } from "@testing-library/react";
import { vi } from "vitest";
import { writeRecipeListSort } from "../features/recipes/list-search";
import { authClient } from "../lib/auth";
import {
  billingStatusFixture,
  passwordLoginAccountsFixture,
  sessionFixture,
  viewerFixture,
} from "../mocks/fixtures";
import { AppRouter, createAppRouter } from "../routes/router";

const authenticatedSession = sessionFixture();

export const viewerResponse = viewerFixture({
  aiUsage: {
    month: "2026-05",
    used: 0,
    limit: PLAN_LIMITS.free.monthlyAiImports,
    resetAt: "2026-05-31T15:00:00.000Z",
  },
});

export const billingStatusResponse = billingStatusFixture();

// 断らない限り、メールアドレスとパスワードでログインした人として扱う。
export const loginAccountsResponse = passwordLoginAccountsFixture();

export const getRequestPath = (input: RequestInfo | URL) => {
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

export const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });

export const createSessionResponse = (authenticated: boolean) =>
  jsonResponse(authenticated ? authenticatedSession : null);

// get-sessionはfresh確認のときだけ`disableCookieCache`を付ける。
// mockはqueryに依存せず判定する。
export const isGetSessionRequest = (input: RequestInfo | URL) =>
  getRequestPath(input).split("?")[0].endsWith("/get-session");

export const mockFetch = (
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response,
  {
    authenticated = false,
    loginAccounts = loginAccountsResponse,
    shortcutCredentials,
    viewer = viewerResponse,
  }: {
    authenticated?: boolean;
    loginAccounts?: typeof loginAccountsResponse;
    /** 指定すると、連携キーの一覧をこの内容で返す。 */
    shortcutCredentials?: ShortcutCredential[];
    viewer?: typeof viewerResponse;
  } = {},
) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const path = getRequestPath(input);

    if (isGetSessionRequest(input)) {
      return createSessionResponse(authenticated);
    }

    if (path === "/api/me" && authenticated) {
      return jsonResponse(viewer);
    }

    if (path === "/api/auth/list-accounts" && authenticated) {
      return jsonResponse(loginAccounts);
    }

    if (path === "/api/billing/status" && authenticated) {
      return jsonResponse(billingStatusResponse);
    }

    if (
      path === "/api/shortcut-credentials" &&
      (init?.method ?? "GET") === "GET" &&
      authenticated &&
      shortcutCredentials
    ) {
      return jsonResponse({ credentials: shortcutCredentials });
    }

    return handler(input, init);
  });

// 共有から取り込む方法は端末で変わるので、画面を開く端末をUser-Agentで決める。
export const iPhoneUserAgent =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
export const androidUserAgent =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

/** navigatorごと差し替えるテストでは、差し替えるnavigatorに`userAgent`を含める。 */
export const stubUserAgent = (userAgent: string) =>
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);

export type FetchMock = {
  mock: {
    calls: [RequestInfo | URL, RequestInit?][];
  };
};

export const findFetchCall = (fetchMock: FetchMock, path: string) =>
  fetchMock.mock.calls.find(([input]) => getRequestPath(input) === path);

const resetAuthSessionStore = () => {
  const sessionAtom = authClient.$store.atoms.session;
  const currentSession = sessionAtom.get();

  sessionAtom.set({
    data: null,
    error: null,
    isPending: true,
    isRefetching: false,
    refetch: currentSession.refetch,
  });
};

export const renderApp = async (
  initialPath = "/",
  setupQueryClient?: (queryClient: QueryClient) => void,
) => {
  resetAuthSessionStore();
  // 一覧の並び順はモジュールに覚えるので、アプリを開き直した状態に戻す。
  writeRecipeListSort("newest");
  // 送り直す保存も、テストでは待たずに送り直させる。
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retryDelay: 0 },
    },
  });
  setupQueryClient?.(queryClient);
  const appRouter = createAppRouter({
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    queryClient,
  });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <AppRouter appRouter={appRouter} />
    </QueryClientProvider>,
  );

  authClient.$store.notify("$sessionSignal");

  await act(async () => {
    await appRouter.load();
  });
  return { ...view, appRouter, queryClient };
};
