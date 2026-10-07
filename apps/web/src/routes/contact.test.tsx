import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_USER_EMAIL, MOCK_USER_ID } from "../mocks/fixtures";
import { type FetchMock, mockFetch, renderApp } from "../test/router-test-utils";

const contactFormUrl = "https://ssgform.com/s/test-form";

const findContactFormCall = (fetchMock: FetchMock) =>
  fetchMock.mock.calls.find(([input]) => input === contactFormUrl);

const fillContactForm = async ({ email }: { email?: string } = {}) => {
  await userEvent.selectOptions(await screen.findByLabelText("種別"), "不具合");
  if (email !== undefined) {
    await userEvent.type(screen.getByLabelText("返信先のメールアドレス"), email);
  }
  await userEvent.type(screen.getByLabelText("内容"), "  取り込みが終わりません  ");
};

describe("ContactRoute", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_CONTACT_FORM_URL", contactFormUrl);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("ログインしていなくても送れ、送った内容と返信先をSSGformへ渡す", async () => {
    const fetchMock = mockFetch(async () => new Response(null, { status: 200 }));
    await renderApp("/contact");

    await fillContactForm({ email: "guest@example.com" });
    await userEvent.click(screen.getByRole("button", { name: "送信する" }));

    expect(await screen.findByRole("heading", { name: "送信しました" })).toHaveFocus();
    expect(screen.getByText("guest@example.com")).toBeInTheDocument();

    const [, init] = findContactFormCall(fetchMock) ?? [];
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "X-Requested-With": "XMLHttpRequest" });
    const body = init?.body as FormData;
    expect(body.get("category")).toBe("不具合");
    expect(body.get("email")).toBe("guest@example.com");
    expect(body.get("message")).toBe("取り込みが終わりません");
    expect(body.get("userAgent")).toBe(navigator.userAgent);
    expect(body.has("userId")).toBe(false);
  });

  it("ログイン中はアカウントのメールアドレスを返信先に入れ、どのアカウントかを添える", async () => {
    const fetchMock = mockFetch(async () => new Response(null, { status: 200 }), {
      authenticated: true,
    });
    await renderApp("/contact");

    expect(await screen.findByLabelText("返信先のメールアドレス")).toHaveValue(MOCK_USER_EMAIL);

    await fillContactForm();
    await userEvent.click(screen.getByRole("button", { name: "送信する" }));

    await screen.findByRole("heading", { name: "送信しました" });
    const body = findContactFormCall(fetchMock)?.[1]?.body as FormData;
    expect(body.get("email")).toBe(MOCK_USER_EMAIL);
    expect(body.get("userId")).toBe(MOCK_USER_ID);
  });

  it("入力が足りなければ送らずに、欄ごとに理由を出す", async () => {
    const fetchMock = mockFetch(async () => new Response(null, { status: 200 }));
    await renderApp("/contact");

    await userEvent.type(await screen.findByLabelText("返信先のメールアドレス"), "guest@");
    await userEvent.type(screen.getByLabelText("内容"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "送信する" }));

    expect(await screen.findByText("種別を選んでください")).toBeInTheDocument();
    expect(screen.getByText("メールアドレスを正しく入力してください")).toBeInTheDocument();
    expect(screen.getByText("内容を入力してください")).toBeInTheDocument();
    expect(findContactFormCall(fetchMock)).toBeUndefined();
  });

  it("SSGformが受け付けなければ、入力を残したまま送れなかったと知らせる", async () => {
    mockFetch(async () => new Response(null, { status: 403 }));
    await renderApp("/contact");

    await fillContactForm({ email: "guest@example.com" });
    await userEvent.click(screen.getByRole("button", { name: "送信する" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "送信できませんでした。時間をおいて再度お試しください。",
    );
    expect(screen.getByLabelText("内容")).toHaveValue("  取り込みが終わりません  ");
    expect(screen.queryByRole("heading", { name: "送信しました" })).not.toBeInTheDocument();
  });
});
