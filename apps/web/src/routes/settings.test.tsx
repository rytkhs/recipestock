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
import { checkoutRedirect } from "./settings";

describe("Settings routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("設定画面から課金設定へ移動できる", async () => {
    mockFetch(async () => new Response(null, { status: 404 }), { authenticated: true });
    await renderApp("/settings");

    await expect(screen.findByRole("heading", { name: "Settings" })).resolves.toBeInTheDocument();
    expect(screen.getByText("現在のプラン: Free")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "課金設定" })).toHaveAttribute(
      "href",
      "/settings/billing",
    );
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

    await userEvent.click(await screen.findByRole("button", { name: "Pro契約" }));

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
  });

  it("Checkout成功後はwebhook反映待ちの案内を表示する", async () => {
    mockFetch(async () => new Response(null, { status: 404 }), { authenticated: true });

    await renderApp("/settings/billing?checkout=success");

    await expect(
      screen.findByText("契約処理を受け付けました。反映には少し時間がかかる場合があります。"),
    ).resolves.toBeInTheDocument();
  });

  it("Checkoutキャンセル後はキャンセル案内を表示する", async () => {
    mockFetch(async () => new Response(null, { status: 404 }), { authenticated: true });

    await renderApp("/settings/billing?checkout=cancel");

    await expect(
      screen.findByText("契約手続きはキャンセルされました。"),
    ).resolves.toBeInTheDocument();
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

      return new Response(null, { status: 404 });
    });

    await renderApp("/settings/billing");

    await expect(screen.findByText("Pro契約中です。")).resolves.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pro契約" })).not.toBeInTheDocument();
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

    await userEvent.click(await screen.findByRole("button", { name: "Pro契約" }));

    await expect(
      screen.findByText("既にPro契約があります。表示を更新してください。"),
    ).resolves.toBeInTheDocument();
    expect(findFetchCall(fetchMock, "/api/billing/checkout")).toBeDefined();
    await waitFor(() => {
      expect(meCalls).toBeGreaterThan(1);
    });
  });
});
