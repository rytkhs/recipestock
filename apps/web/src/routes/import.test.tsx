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

    await expect(screen.findByRole("heading", { name: "Recipes" })).resolves.toBeInTheDocument();
    expect(screen.getByText("取り込み中...")).toBeInTheDocument();
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
});
