import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as authModule from "./auth";
import { authClient } from "./auth";
import { type AuthCheckResult, AuthStateProvider, useAuthState } from "./auth-state";

const authenticatedSession = {
  session: { id: "session_123", userId: "user_123" },
  user: { id: "user_123", email: "chef@example.com", name: "chef" },
};

const setSessionStore = ({
  data,
  error,
  isPending = false,
}: {
  data: typeof authenticatedSession | null;
  error: Error | null;
  isPending?: boolean;
}) => {
  const sessionAtom = authClient.$store.atoms.session;
  const current = sessionAtom.get();
  sessionAtom.set({
    data,
    error,
    isPending,
    isRefetching: false,
    refetch: current.refetch,
  });
};

const AuthStateProbe = () => {
  const auth = useAuthState();

  return (
    <>
      <output>{auth.status}</output>
      <button
        type="button"
        onClick={() => {
          void Promise.all([auth.recheck(), auth.recheck()]);
        }}
      >
        recheck
      </button>
      <button
        type="button"
        onClick={() => {
          void Promise.all([auth.recheck("fresh"), auth.recheck("fresh")]);
        }}
      >
        fresh recheck
      </button>
    </>
  );
};

describe("AuthStateProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("保持済みsessionがあればbackground errorでもauthenticatedを維持する", () => {
    setSessionStore({
      data: authenticatedSession,
      error: new Error("network unavailable"),
    });

    render(
      <AuthStateProvider>
        <AuthStateProbe />
      </AuthStateProvider>,
    );

    expect(screen.getByText("authenticated")).toBeInTheDocument();
  });

  it("信頼済みsessionがない初回通信失敗をunavailableにする", () => {
    setSessionStore({ data: null, error: new Error("network unavailable") });

    render(
      <AuthStateProvider>
        <AuthStateProbe />
      </AuthStateProvider>,
    );

    expect(screen.getByText("unavailable")).toBeInTheDocument();
  });

  it("cache-aware recheckの失敗を古いsessionで上書きせず並行確認をdeduplicateする", async () => {
    setSessionStore({ data: authenticatedSession, error: null });
    let resolveResult: ((value: unknown) => void) | undefined;
    const sessionResult = new Promise((resolve) => {
      resolveResult = resolve;
    });
    const getSession = vi
      .spyOn(authModule, "getAuthSession")
      .mockReturnValue(sessionResult as ReturnType<typeof authClient.getSession>);

    render(
      <AuthStateProvider>
        <AuthStateProbe />
      </AuthStateProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "recheck" }));
    expect(getSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveResult?.({
        data: null,
        error: { status: 0, statusText: "", message: "network unavailable" },
      } satisfies { data: null; error: unknown });
      await sessionResult;
    });

    expect(screen.getByText("unavailable")).toBeInTheDocument();
  });

  it.each([
    [{ data: authenticatedSession, error: null }, "authenticated"],
    [{ data: null, error: null }, "unauthenticated"],
  ] as const)("cache-aware recheck結果を%sへ分類する", async (result, expected) => {
    setSessionStore({ data: null, error: new Error("network unavailable") });
    vi.spyOn(authModule, "getAuthSession").mockResolvedValue(
      result as Awaited<ReturnType<typeof authClient.getSession>>,
    );

    render(
      <AuthStateProvider>
        <AuthStateProbe />
      </AuthStateProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "recheck" }));

    await expect(
      screen.findByText(expected satisfies AuthCheckResult),
    ).resolves.toBeInTheDocument();
  });

  it("modeごとにsession取得を分け、同じmodeの並行確認をdeduplicateする", async () => {
    setSessionStore({ data: authenticatedSession, error: null });
    const result = { data: authenticatedSession, error: null } as Awaited<
      ReturnType<typeof authClient.getSession>
    >;
    const getSession = vi.spyOn(authModule, "getAuthSession").mockResolvedValue(result);
    const getFreshSession = vi.spyOn(authModule, "getFreshAuthSession").mockResolvedValue(result);

    render(
      <AuthStateProvider>
        <AuthStateProbe />
      </AuthStateProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: /^recheck$/ }));
    await userEvent.click(screen.getByRole("button", { name: "fresh recheck" }));

    expect(getSession).toHaveBeenCalledTimes(1);
    expect(getFreshSession).toHaveBeenCalledTimes(1);
  });
});
