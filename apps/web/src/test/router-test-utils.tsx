import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { act, render } from "@testing-library/react";
import { vi } from "vitest";
import { writeRecipeListFilters, writeRecipeListSort } from "../features/recipes/list-search";
import { authClient } from "../lib/auth";
import {
  billingStatusFixture,
  passwordLoginAccountsFixture,
  sessionFixture,
  viewerFixture,
} from "../mocks/fixtures";
import { AppRouter, createAppRouter } from "../routes/router";

const authenticatedSession = sessionFixture();

export const viewerResponse = viewerFixture();

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
    viewer = viewerResponse,
  }: {
    authenticated?: boolean;
    loginAccounts?: typeof loginAccountsResponse;
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

    return handler(input, init);
  });

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
  // 一覧の並び順と絞り込み条件はモジュールに覚えるので、アプリを開き直した状態に戻す。
  writeRecipeListSort("newest");
  writeRecipeListFilters({});
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  setupQueryClient?.(queryClient);
  const appRouter = createAppRouter({
    history: createMemoryHistory({ initialEntries: [initialPath] }),
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
