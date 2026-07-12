import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  billingStatusResponse,
  createSessionResponse,
  findFetchCall,
  getRequestPath,
  jsonResponse,
  mockFetch,
  renderApp,
  viewerResponse,
} from "../test/router-test-utils";
import { checkoutRedirect } from "./settings";

describe("Settings routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("PWAからShortcut連携トークンを発行する", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    const fetchMock = mockFetch(
      async (input, init) => {
        const path = getRequestPath(input);
        if (path === "/api/ios-share/channels" && init?.method === "GET") {
          return jsonResponse({ channels: [] });
        }
        if (path === "/api/ios-share/channels" && init?.method === "POST") {
          return jsonResponse(
            {
              channel: {
                id: "channel_1",
                name: "iPhone",
                tokenSuffix: "aaaaaa",
                createdAt: "2026-07-11T00:00:00.000Z",
                lastUsedAt: null,
              },
              token: `rssc_${"a".repeat(64)}`,
            },
            { status: 201 },
          );
        }
        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/settings");
    await userEvent.click(await screen.findByRole("button", { name: "連携トークンを発行" }));

    await expect(screen.findByLabelText("連携トークン")).resolves.toHaveValue(
      `rssc_${"a".repeat(64)}`,
    );
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          getRequestPath(input) === "/api/ios-share/channels" && init?.method === "POST",
      ),
    ).toBe(true);
  });

  it("設定画面からメールアドレス変更確認メールを送信できる", async () => {
    const fetchMock = mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/auth/change-email" && init?.method === "POST") {
          return jsonResponse({ status: true });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );
    await renderApp("/settings");

    await userEvent.type(await screen.findByLabelText("新しいメールアドレス"), "new@example.com");
    await userEvent.click(screen.getByRole("button", { name: "確認メールを送信" }));

    const changeEmailCall = findFetchCall(fetchMock, "/api/auth/change-email");
    expect(changeEmailCall).toEqual([
      "/api/auth/change-email",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    ]);
    expect(JSON.parse(String(changeEmailCall?.[1]?.body))).toEqual({
      newEmail: "new@example.com",
      callbackURL: "/settings",
    });
    await expect(screen.findByText("確認メールを送信しました。")).resolves.toBeInTheDocument();
    expect(screen.getByLabelText("新しいメールアドレス")).toHaveValue("");
  });

  it("設定画面からパスワードを変更できる", async () => {
    const fetchMock = mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/auth/change-password" && init?.method === "POST") {
          return jsonResponse({ status: true });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );
    await renderApp("/settings");

    await userEvent.type(await screen.findByLabelText("現在のパスワード"), "password123");
    await userEvent.type(screen.getByLabelText("新しいパスワード"), "newpassword123");
    await userEvent.click(screen.getByRole("button", { name: "パスワードを変更" }));

    const changePasswordCall = findFetchCall(fetchMock, "/api/auth/change-password");
    expect(changePasswordCall).toEqual([
      "/api/auth/change-password",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    ]);
    expect(JSON.parse(String(changePasswordCall?.[1]?.body))).toEqual({
      currentPassword: "password123",
      newPassword: "newpassword123",
      revokeOtherSessions: true,
    });
    await expect(screen.findByText("パスワードを変更しました。")).resolves.toBeInTheDocument();
    expect(screen.getByLabelText("現在のパスワード")).toHaveValue("");
    expect(screen.getByLabelText("新しいパスワード")).toHaveValue("");
  });

  it("アカウント設定の変更に失敗した場合は固定文言を表示する", async () => {
    mockFetch(
      async (input, init) => {
        const path = getRequestPath(input);

        if (
          (path === "/api/auth/change-email" || path === "/api/auth/change-password") &&
          init?.method === "POST"
        ) {
          return jsonResponse({ message: "Auth request failed." }, { status: 400 });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );
    await renderApp("/settings");

    await userEvent.type(await screen.findByLabelText("新しいメールアドレス"), "new@example.com");
    await userEvent.click(screen.getByRole("button", { name: "確認メールを送信" }));

    await expect(
      screen.findByText("メールアドレスを変更できませんでした。時間をおいて再度お試しください。"),
    ).resolves.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("現在のパスワード"), "password123");
    await userEvent.type(screen.getByLabelText("新しいパスワード"), "newpassword123");
    await userEvent.click(screen.getByRole("button", { name: "パスワードを変更" }));

    await expect(
      screen.findByText("パスワードを変更できませんでした。入力内容を確認してください。"),
    ).resolves.toBeInTheDocument();
  });

  it("Freeユーザーは課金設定からCheckoutを開始できる", async () => {
    const fetchMock = mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/billing/checkout" && init?.method === "POST") {
          return jsonResponse({ url: "https://checkout.stripe.com/session_123" });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );
    const assign = vi.spyOn(checkoutRedirect, "assign").mockImplementation(() => {});
    await renderApp("/settings/billing");

    await userEvent.click(await screen.findByRole("button", { name: "Proにアップグレード" }));

    await waitFor(() => {
      expect(findFetchCall(fetchMock, "/api/billing/checkout")).toEqual([
        "/api/billing/checkout",
        expect.objectContaining({
          credentials: "include",
          method: "POST",
        }),
      ]);
    });
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/session_123");
    expect(screen.queryByRole("button", { name: "請求管理" })).not.toBeInTheDocument();
  });

  it("ProユーザーにはPro契約ボタンを表示しない", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = getRequestPath(input);

      if (path.endsWith("/get-session")) {
        return createSessionResponse(true);
      }

      if (path === "/api/me") {
        return jsonResponse({
          ...viewerResponse,
          plan: "pro",
          recipeLimit: null,
          aiUsage: {
            ...viewerResponse.aiUsage,
            limit: 300,
          },
        });
      }

      if (path === "/api/billing/status") {
        return jsonResponse({
          plan: "pro",
          subscription: {
            status: "active",
            cancelAtPeriodEnd: false,
            currentPeriodEnd: "2026-07-04T00:00:00.000Z",
            cancelAt: null,
          },
        });
      }

      return new Response(null, { status: 404 });
    });

    await renderApp("/settings/billing");

    await expect(screen.findByText("Pro契約中です。")).resolves.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pro契約" })).not.toBeInTheDocument();
  });

  it("ProユーザーはCustomer Portalを開ける", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = getRequestPath(input);

      if (path.endsWith("/get-session")) {
        return createSessionResponse(true);
      }

      if (path === "/api/me") {
        return jsonResponse({
          ...viewerResponse,
          plan: "pro",
          recipeLimit: null,
        });
      }

      if (path === "/api/billing/status") {
        return jsonResponse({
          plan: "pro",
          subscription: {
            status: "active",
            cancelAtPeriodEnd: false,
            currentPeriodEnd: "2026-07-04T00:00:00.000Z",
            cancelAt: null,
          },
        });
      }

      if (path === "/api/billing/portal" && init?.method === "POST") {
        return jsonResponse({ url: "https://billing.stripe.com/session_123" });
      }

      return new Response(null, { status: 404 });
    });
    const assign = vi.spyOn(checkoutRedirect, "assign").mockImplementation(() => {});

    await renderApp("/settings/billing");
    await userEvent.click(await screen.findByRole("button", { name: "請求管理" }));

    await waitFor(() => {
      expect(findFetchCall(fetchMock, "/api/billing/portal")).toEqual([
        "/api/billing/portal",
        expect.objectContaining({
          credentials: "include",
          method: "POST",
        }),
      ]);
    });
    expect(assign).toHaveBeenCalledWith("https://billing.stripe.com/session_123");
  });

  it("Portal作成に失敗した場合は案内を表示する", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = getRequestPath(input);

      if (path.endsWith("/get-session")) {
        return createSessionResponse(true);
      }

      if (path === "/api/me") {
        return jsonResponse({
          ...viewerResponse,
          plan: "pro",
          recipeLimit: null,
        });
      }

      if (path === "/api/billing/status") {
        return jsonResponse({
          plan: "pro",
          subscription: {
            status: "active",
            cancelAtPeriodEnd: false,
            currentPeriodEnd: "2026-07-04T00:00:00.000Z",
            cancelAt: null,
          },
        });
      }

      if (path === "/api/billing/portal" && init?.method === "POST") {
        return jsonResponse(
          {
            error: {
              code: "unknown",
              message: "Unexpected error occurred.",
            },
          },
          { status: 500 },
        );
      }

      return new Response(null, { status: 404 });
    });

    await renderApp("/settings/billing");
    await userEvent.click(await screen.findByRole("button", { name: "請求管理" }));

    await expect(
      screen.findByText("請求管理を開けませんでした。時間をおいて再度お試しください。"),
    ).resolves.toBeInTheDocument();
  });

  it("already_subscribedの場合は案内を表示してviewerを再取得する", async () => {
    let meCalls = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = getRequestPath(input);

      if (path.endsWith("/get-session")) {
        return createSessionResponse(true);
      }

      if (path === "/api/me") {
        meCalls += 1;
        return jsonResponse(viewerResponse);
      }

      if (path === "/api/billing/status") {
        return jsonResponse(billingStatusResponse);
      }

      if (path === "/api/billing/checkout" && init?.method === "POST") {
        return jsonResponse(
          {
            error: {
              code: "already_subscribed",
              message: "User already has an active Pro subscription.",
            },
          },
          { status: 409 },
        );
      }

      return new Response(null, { status: 404 });
    });
    await renderApp("/settings/billing");

    await userEvent.click(await screen.findByRole("button", { name: "Proにアップグレード" }));

    await expect(
      screen.findByText("既にPro契約があります。表示を更新してください。"),
    ).resolves.toBeInTheDocument();
    expect(findFetchCall(fetchMock, "/api/billing/checkout")).toBeDefined();
    await waitFor(() => {
      expect(meCalls).toBeGreaterThan(1);
    });
  });
});
