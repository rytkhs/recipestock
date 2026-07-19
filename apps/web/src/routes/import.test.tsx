import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findFetchCall,
  getRequestPath,
  jsonResponse,
  mockFetch,
  renderApp,
} from "../test/router-test-utils";

describe("Import routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });

  const mockClipboardReadText = (readText: () => Promise<string>) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: vi.fn(readText) },
    });
  };

  it("ペーストボタンでクリップボードのURLを入力する", async () => {
    mockFetch(() => new Response(null, { status: 404 }), { authenticated: true });
    mockClipboardReadText(async () => " https://example.com/recipes/pasted ");

    await renderApp("/import/url");

    await userEvent.click(await screen.findByRole("button", { name: "ペースト" }));

    expect(screen.getByLabelText("URL")).toHaveValue("https://example.com/recipes/pasted");
  });

  it("クリアボタンで入力URLを空にする", async () => {
    mockFetch(() => new Response(null, { status: 404 }), { authenticated: true });

    await renderApp("/import/url");

    const input = await screen.findByLabelText("URL");
    await userEvent.type(input, "https://example.com/recipes/tomato");
    await userEvent.click(screen.getByRole("button", { name: "クリア" }));

    expect(input).toHaveValue("");
  });

  it("クリップボードを読み取れない場合はエラーを表示する", async () => {
    mockFetch(() => new Response(null, { status: 404 }), { authenticated: true });
    mockClipboardReadText(async () => {
      throw new Error("NotAllowedError");
    });

    await renderApp("/import/url");

    await userEvent.click(await screen.findByRole("button", { name: "ペースト" }));

    await expect(screen.findByRole("alert")).resolves.toHaveTextContent(
      "クリップボードを読み取れませんでした。",
    );
  });

  it("共有URLのurl paramを入力欄の初期値にする", async () => {
    mockFetch(() => new Response(null, { status: 404 }), { authenticated: true });

    await renderApp(`/import/url?url=${encodeURIComponent("https://example.com/recipes/tomato")}`);

    await expect(screen.findByLabelText("URL")).resolves.toHaveValue(
      "https://example.com/recipes/tomato",
    );
  });

  it("共有URLのtext paramから最初のURLを入力欄の初期値にする", async () => {
    mockFetch(() => new Response(null, { status: 404 }), { authenticated: true });

    await renderApp(
      `/import/url?text=${encodeURIComponent("Check https://example.com/recipes/tomato")}`,
    );

    await expect(screen.findByLabelText("URL")).resolves.toHaveValue(
      "https://example.com/recipes/tomato",
    );
  });

  it("共有テキストのURLに続く文末のピリオドを除外する", async () => {
    mockFetch(() => new Response(null, { status: 404 }), { authenticated: true });

    await renderApp(
      `/import/url?text=${encodeURIComponent("Check https://example.com/recipes/tomato.")}`,
    );

    await expect(screen.findByLabelText("URL")).resolves.toHaveValue(
      "https://example.com/recipes/tomato",
    );
  });

  it("共有テキストのURLに続く句点を除外する", async () => {
    mockFetch(() => new Response(null, { status: 404 }), { authenticated: true });

    await renderApp(
      `/import/url?text=${encodeURIComponent("このレシピです https://example.com/recipes/tomato。")}`,
    );

    await expect(screen.findByLabelText("URL")).resolves.toHaveValue(
      "https://example.com/recipes/tomato",
    );
  });

  it("かぎ括弧で囲まれた共有テキストからURLだけを抽出する", async () => {
    mockFetch(() => new Response(null, { status: 404 }), { authenticated: true });

    await renderApp(
      `/import/url?text=${encodeURIComponent("「https://example.com/recipes/tomato」")}`,
    );

    await expect(screen.findByLabelText("URL")).resolves.toHaveValue(
      "https://example.com/recipes/tomato",
    );
  });

  it("山括弧で囲まれた共有テキストからURLだけを抽出する", async () => {
    mockFetch(() => new Response(null, { status: 404 }), { authenticated: true });

    await renderApp(
      `/import/url?text=${encodeURIComponent("<https://example.com/recipes/tomato>")}`,
    );

    await expect(screen.findByLabelText("URL")).resolves.toHaveValue(
      "https://example.com/recipes/tomato",
    );
  });

  it("丸括弧で囲まれた共有テキストから余分な閉じ括弧を除外する", async () => {
    mockFetch(() => new Response(null, { status: 404 }), { authenticated: true });

    await renderApp(
      `/import/url?text=${encodeURIComponent("(https://example.com/recipes/tomato)")}`,
    );

    await expect(screen.findByLabelText("URL")).resolves.toHaveValue(
      "https://example.com/recipes/tomato",
    );
  });

  it("URL自身に含まれる対応済みの丸括弧は保持する", async () => {
    mockFetch(() => new Response(null, { status: 404 }), { authenticated: true });

    await renderApp(
      `/import/url?text=${encodeURIComponent("See https://example.com/recipes/tomato_(easy)")}`,
    );

    await expect(screen.findByLabelText("URL")).resolves.toHaveValue(
      "https://example.com/recipes/tomato_(easy)",
    );
  });

  it("url paramとtext paramが両方ある場合はurl paramを優先する", async () => {
    mockFetch(() => new Response(null, { status: 404 }), { authenticated: true });

    await renderApp(
      `/import/url?url=${encodeURIComponent("https://example.com/recipes/url")}&text=${encodeURIComponent("Check https://example.com/recipes/text")}`,
    );

    await expect(screen.findByLabelText("URL")).resolves.toHaveValue(
      "https://example.com/recipes/url",
    );
  });

  it("同じimportルートで共有URLが変わると入力欄を更新する", async () => {
    mockFetch(() => new Response(null, { status: 404 }), { authenticated: true });
    const { appRouter } = await renderApp(
      `/import/url?url=${encodeURIComponent("https://example.com/recipes/first")}`,
    );

    await expect(screen.findByLabelText("URL")).resolves.toHaveValue(
      "https://example.com/recipes/first",
    );

    await act(async () => {
      await appRouter.navigate({
        to: "/import/url",
        search: { url: "https://example.com/recipes/second" },
      });
    });

    expect(screen.getByLabelText("URL")).toHaveValue("https://example.com/recipes/second");
  });

  it("共有URLの初期値でimport jobを作成する", async () => {
    const fetchMock = mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/import/url/jobs") {
          return jsonResponse(
            {
              kind: "created",
              job: {
                id: "job_123",
                kind: "url",
                status: "queued",
                url: "https://example.com/recipes/tomato",
                recipeId: null,
                errorCode: null,
                createdAt: "2026-06-01T00:00:00.000Z",
                startedAt: null,
                finishedAt: null,
              },
            },
            { status: 202 },
          );
        }

        if (getRequestPath(input) === "/api/recipes?limit=20") {
          return jsonResponse({ items: [], nextCursor: null });
        }

        if (getRequestPath(input) === "/api/import/jobs/recent") {
          return jsonResponse({
            jobs: [
              {
                id: "job_123",
                kind: "url",
                status: "queued",
                url: "https://example.com/recipes/tomato",
                recipeId: null,
                errorCode: null,
                createdAt: "2026-06-01T00:00:00.000Z",
                startedAt: null,
                finishedAt: null,
              },
            ],
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp(`/import/url?url=${encodeURIComponent("https://example.com/recipes/tomato")}`);

    await userEvent.click(await screen.findByRole("button", { name: "取り込む" }));

    await expect(screen.findByRole("button", { name: "検索" })).resolves.toBeInTheDocument();
    expect(findFetchCall(fetchMock, "/api/import/url/jobs")).toEqual([
      "/api/import/url/jobs",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/recipes/tomato" }),
      }),
    ]);
  });

  it("URLを入力してimport jobを作成しレシピ一覧へ遷移する", async () => {
    const fetchMock = mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/import/url/jobs") {
          return jsonResponse(
            {
              kind: "created",
              job: {
                id: "job_123",
                kind: "url",
                status: "queued",
                url: "https://example.com/recipes/tomato",
                recipeId: null,
                errorCode: null,
                createdAt: "2026-06-01T00:00:00.000Z",
                startedAt: null,
                finishedAt: null,
              },
            },
            { status: 202 },
          );
        }

        if (getRequestPath(input) === "/api/recipes?limit=20") {
          return jsonResponse({ items: [], nextCursor: null });
        }

        if (getRequestPath(input) === "/api/import/jobs/recent") {
          return jsonResponse({
            jobs: [
              {
                id: "job_123",
                kind: "url",
                status: "queued",
                url: "https://example.com/recipes/tomato",
                recipeId: null,
                errorCode: null,
                createdAt: "2026-06-01T00:00:00.000Z",
                startedAt: null,
                finishedAt: null,
              },
            ],
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/import/url");

    await userEvent.type(await screen.findByLabelText("URL"), "https://example.com/recipes/tomato");
    await userEvent.click(screen.getByRole("button", { name: "取り込む" }));

    await expect(screen.findByRole("button", { name: "検索" })).resolves.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1件を取り込み中");
    expect(findFetchCall(fetchMock, "/api/import/url/jobs")).toEqual([
      "/api/import/url/jobs",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/recipes/tomato" }),
      }),
    ]);
  });

  it("URL import job作成に失敗したら入力画面にエラーを表示する", async () => {
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/import/url/jobs") {
          return jsonResponse(
            {
              error: {
                code: "recipe_limit_exceeded",
                message: "Recipe limit exceeded.",
              },
            },
            { status: 403 },
          );
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/import/url");

    await userEvent.type(await screen.findByLabelText("URL"), "https://example.com/recipes/tomato");
    await userEvent.click(screen.getByRole("button", { name: "取り込む" }));

    await expect(screen.findByRole("alert")).resolves.toHaveTextContent(
      "保存できるレシピ数の上限に達しています。",
    );
  });

  it("private/login required errorを入力画面に表示する", async () => {
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/import/url/jobs") {
          return jsonResponse(
            {
              error: {
                code: "private_or_login_required",
                message: "Instagram post is private, unavailable, or requires login.",
              },
            },
            { status: 422 },
          );
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/import/url");

    await userEvent.type(await screen.findByLabelText("URL"), "https://www.instagram.com/p/test/");
    await userEvent.click(screen.getByRole("button", { name: "取り込む" }));

    await expect(screen.findByRole("alert")).resolves.toHaveTextContent(
      "この投稿を取得できませんでした。非公開またはログインが必要な投稿です。",
    );
  });

  it("同じURLのactive jobがある場合もレシピ一覧へ遷移する", async () => {
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/import/url/jobs") {
          return jsonResponse(
            {
              kind: "existing_active_job",
              job: {
                id: "job_active",
                kind: "url",
                status: "running",
                url: "https://example.com/recipes/active",
                recipeId: null,
                errorCode: null,
                createdAt: "2026-06-01T00:00:00.000Z",
                startedAt: "2026-06-01T00:00:01.000Z",
                finishedAt: null,
              },
            },
            { status: 202 },
          );
        }

        if (getRequestPath(input) === "/api/recipes?limit=20") {
          return jsonResponse({ items: [], nextCursor: null });
        }

        if (getRequestPath(input) === "/api/import/jobs/recent") {
          return jsonResponse({
            jobs: [
              {
                id: "job_active",
                kind: "url",
                status: "running",
                url: "https://example.com/recipes/active",
                recipeId: null,
                errorCode: null,
                createdAt: "2026-06-01T00:00:00.000Z",
                startedAt: "2026-06-01T00:00:01.000Z",
                finishedAt: null,
              },
            ],
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/import/url");

    await userEvent.type(await screen.findByLabelText("URL"), "https://example.com/recipes/new");
    await userEvent.click(screen.getByRole("button", { name: "取り込む" }));

    await expect(screen.findByRole("button", { name: "検索" })).resolves.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1件を取り込み中");
  });
});
