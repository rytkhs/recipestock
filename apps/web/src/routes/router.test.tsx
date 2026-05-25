import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRouter } from "./router";

describe("AppRouter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, "", "/");
  });

  it("初期ルートを表示する", async () => {
    render(<AppRouter />);

    await expect(
      screen.findByRole("heading", { name: "Recipe Stock" }),
    ).resolves.toBeInTheDocument();
  });

  it("ログインルートからGoogleログインを開始する", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ url: "https://accounts.google.com/o/oauth2/v2/auth" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    window.history.pushState({}, "", "/login");
    render(<AppRouter />);

    await userEvent.click(await screen.findByRole("button", { name: "Googleでログイン" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/sign-in/social",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      provider: "google",
      disableRedirect: true,
    });
  });

  it("ログインルートからメールコードログインを開始する", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    window.history.pushState({}, "", "/login");
    render(<AppRouter />);

    await userEvent.type(await screen.findByLabelText("メールアドレス"), "chef@example.com");
    await userEvent.click(screen.getByRole("button", { name: "コードを送信" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/email-otp/send-verification-otp",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      email: "chef@example.com",
      type: "sign-in",
    });
  });
});
