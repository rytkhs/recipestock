import { screen } from "@testing-library/react";
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

describe("LoginRoute", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
    let authenticated = false;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = getRequestPath(input);

      if (path.endsWith("/get-session")) {
        return createSessionResponse(authenticated);
      }

      if (path === "/api/auth/sign-in/email" && init?.method === "POST") {
        authenticated = true;
        return jsonResponse({ token: "session_token" });
      }

      if (path === "/api/me" && authenticated) {
        return jsonResponse(viewerResponse);
      }

      if (path === "/api/recipes?limit=20") {
        return jsonResponse({ items: [], nextCursor: null });
      }

      return new Response(null, { status: 404 });
    });
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
    await expect(screen.findByRole("button", { name: "検索" })).resolves.toBeInTheDocument();
    expect(findFetchCall(fetchMock, "/api/me")).toBeDefined();
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
    const fetchMock = mockFetch(async (input) => {
      if (getRequestPath(input) === "/api/auth/sign-up/email") {
        return jsonResponse({ token: null });
      }

      return jsonResponse({ success: true });
    });
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
});
