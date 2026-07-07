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

describe("Import routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(screen.getByText("取り込み待ち")).toBeInTheDocument();
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

  it("active jobがある場合は入力画面に警告を表示して入力URLを保持する", async () => {
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

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/import/url");

    const input = await screen.findByLabelText("URL");
    await userEvent.type(input, "https://example.com/recipes/new");
    await userEvent.click(screen.getByRole("button", { name: "取り込む" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "別のレシピを取り込み中です。しばらく待ってから再度実行してください。",
    );
    expect(alert).toHaveTextContent("https://example.com/recipes/active");
    expect(input).toHaveValue("https://example.com/recipes/new");
    expect(screen.getByRole("heading", { name: "URLから取り込む" })).toBeInTheDocument();
  });

  it("active jobの警告から処理状況を確認できる", async () => {
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
    await userEvent.click(await screen.findByRole("link", { name: "処理状況を見る" }));

    await expect(screen.findByRole("button", { name: "検索" })).resolves.toBeInTheDocument();
    expect(screen.getByText("取り込み中")).toBeInTheDocument();
  });
});
