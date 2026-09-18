import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findFetchCall,
  getRequestPath,
  jsonResponse,
  mockFetch,
  renderApp,
} from "../test/router-test-utils";

const textJob = (overrides: Record<string, unknown> = {}) => ({
  id: "job_123",
  kind: "text",
  status: "queued",
  url: null,
  textPreview: "鶏むね肉のレモン煮",
  recipeId: null,
  errorCode: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  startedAt: null,
  finishedAt: null,
  ...overrides,
});

const mockClipboardReadText = (readText: () => Promise<string>) => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { readText: vi.fn(readText) },
  });
};

describe("Import text route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });

  it("入力したテキストでimport jobを作成しレシピ一覧へ遷移する", async () => {
    const fetchMock = mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/import/text/jobs") {
          return jsonResponse({ kind: "created", job: textJob() }, { status: 202 });
        }

        if (getRequestPath(input) === "/api/recipes?limit=20") {
          return jsonResponse({ items: [], nextCursor: null });
        }

        if (getRequestPath(input) === "/api/import/jobs/recent") {
          return jsonResponse({ jobs: [textJob()] });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/import/text");

    await userEvent.type(await screen.findByLabelText("テキスト"), "鶏むね肉のレモン煮");
    await userEvent.click(screen.getByRole("button", { name: "取り込む" }));

    await expect(screen.findByRole("button", { name: "検索" })).resolves.toBeInTheDocument();
    await expect(screen.findByText("1件を取り込み中")).resolves.toBeInTheDocument();
    expect(findFetchCall(fetchMock, "/api/import/text/jobs")).toEqual([
      "/api/import/text/jobs",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        body: JSON.stringify({ text: "鶏むね肉のレモン煮" }),
      }),
    ]);
  });

  it("ペーストしたテキストの文字数を前後の空白を除いて表示する", async () => {
    mockFetch(() => new Response(null, { status: 404 }), { authenticated: true });
    mockClipboardReadText(async () => "\n鶏むね肉のレモン煮\n");

    await renderApp("/import/text");

    await userEvent.click(await screen.findByRole("button", { name: "ペースト" }));

    expect(screen.getByLabelText("テキスト")).toHaveValue("\n鶏むね肉のレモン煮\n");
    expect(screen.getByText("9 / 5,000文字")).toBeInTheDocument();
  });

  it("上限文字数を超えたテキストは取り込めない", async () => {
    mockFetch(() => new Response(null, { status: 404 }), { authenticated: true });
    mockClipboardReadText(async () => "あ".repeat(5001));

    await renderApp("/import/text");

    await userEvent.click(await screen.findByRole("button", { name: "ペースト" }));

    expect(screen.getByText("5,000文字以内にしてください。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取り込む" })).toBeDisabled();
  });

  it("URLだけを貼り付けたらURL取り込みへ案内する", async () => {
    mockFetch(() => new Response(null, { status: 404 }), { authenticated: true });
    mockClipboardReadText(async () => "https://example.com/recipes/tomato");

    await renderApp("/import/text");

    await userEvent.click(await screen.findByRole("button", { name: "ペースト" }));

    expect(screen.getByRole("button", { name: "取り込む" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "URLから取り込む" })).toHaveAttribute(
      "href",
      `/import/url?url=${encodeURIComponent("https://example.com/recipes/tomato")}`,
    );
  });

  it("取り込みを開始できなければ入力画面にエラーを表示する", async () => {
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/import/text/jobs") {
          return jsonResponse(
            { error: { code: "recipe_limit_exceeded", message: "Recipe limit exceeded." } },
            { status: 403 },
          );
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/import/text");

    await userEvent.type(await screen.findByLabelText("テキスト"), "鶏むね肉のレモン煮");
    await userEvent.click(screen.getByRole("button", { name: "取り込む" }));

    await expect(screen.findByRole("alert")).resolves.toHaveTextContent(
      "保存できるレシピ数の上限に達しています。",
    );
    expect(screen.getByRole("link", { name: "プランを見る" })).toHaveAttribute(
      "href",
      "/settings/billing",
    );
  });

  it("失敗したjobの原文を読み込み、送り直したら古いjobを閉じる", async () => {
    const sourceText = "今日の夕飯\n鶏むね肉 300g";
    const fetchMock = mockFetch(
      async (input, init) => {
        const path = getRequestPath(input);

        if (path === "/api/import/jobs/job_failed" && init?.method === "GET") {
          return jsonResponse({
            job: textJob({
              id: "job_failed",
              status: "failed",
              textPreview: "今日の夕飯",
              errorCode: "extraction_failed",
            }),
            sourceText,
          });
        }

        if (path === "/api/import/text/jobs") {
          return jsonResponse({ kind: "created", job: textJob() }, { status: 202 });
        }

        if (path === "/api/import/jobs/job_failed/dismiss") {
          return jsonResponse({ job: textJob({ id: "job_failed", status: "failed" }) });
        }

        if (path === "/api/recipes?limit=20") {
          return jsonResponse({ items: [], nextCursor: null });
        }

        if (path === "/api/import/jobs/recent") {
          return jsonResponse({ jobs: [textJob()] });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/import/text?fromJob=job_failed");

    await expect(screen.findByLabelText("テキスト")).resolves.toHaveValue(sourceText);
    await userEvent.click(screen.getByRole("button", { name: "取り込む" }));

    await expect(screen.findByRole("button", { name: "検索" })).resolves.toBeInTheDocument();
    expect(findFetchCall(fetchMock, "/api/import/text/jobs")).toEqual([
      "/api/import/text/jobs",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ text: sourceText }) }),
    ]);
    expect(findFetchCall(fetchMock, "/api/import/jobs/job_failed/dismiss")).toEqual([
      "/api/import/jobs/job_failed/dismiss",
      expect.objectContaining({ method: "PATCH" }),
    ]);
  });

  it("元のテキストを読み込めなければ空の入力欄で貼り直しを案内する", async () => {
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/import/jobs/job_missing") {
          return jsonResponse(
            { error: { code: "not_found", message: "Import job was not found." } },
            { status: 404 },
          );
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/import/text?fromJob=job_missing");

    await expect(
      screen.findByText("元のテキストを読み込めませんでした。もう一度貼り付けてください。"),
    ).resolves.toBeInTheDocument();
    expect(screen.getByLabelText("テキスト")).toHaveValue("");
  });
});
