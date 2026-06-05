import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { act, render } from "@testing-library/react";
import { vi } from "vitest";
import { authClient } from "../lib/auth";
import { AppRouter, createAppRouter } from "../routes/router";

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

export const viewerResponse = {
  userId: "user_123",
  email: "chef@example.com",
  plan: "free",
  recipeCount: 0,
  recipeLimit: 5,
  isRecipeLimitReached: false,
  aiUsage: {
    month: "2026-05",
    used: 0,
    limit: 10,
    resetAt: "2026-05-31T15:00:00.000Z",
  },
};

export const billingStatusResponse = {
  plan: "free",
  subscription: null,
};

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

export const mockFetch = (
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response,
  { authenticated = false }: { authenticated?: boolean } = {},
) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const path = getRequestPath(input);

    if (path.endsWith("/get-session")) {
      return createSessionResponse(authenticated);
    }

    if (path === "/api/me" && authenticated) {
      return jsonResponse(viewerResponse);
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
