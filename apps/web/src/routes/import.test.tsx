import { screen, waitFor } from "@testing-library/react";
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
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("URLを入力して取り込み確認画面へ遷移する", async () => {
    const fetchMock = mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/import/url") {
          return jsonResponse({
            recipeDraftContent: {
              title: "Tomato pasta",
              ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
              steps: [{ text: "煮詰める" }],
            },
            source: {
              sourceType: "web",
              sourcePlatform: "other",
              sourceUrl: "https://example.com/recipes/tomato",
              sourceName: "Example Kitchen",
            },
            warnings: [],
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/import/url");

    await userEvent.type(await screen.findByLabelText("URL"), "https://example.com/recipes/tomato");
    await userEvent.click(screen.getByRole("button", { name: "取り込む" }));

    await expect(
      screen.findByRole("heading", { name: "取り込み確認" }),
    ).resolves.toBeInTheDocument();
    expect(screen.getByDisplayValue("Tomato pasta")).toBeInTheDocument();
    expect(findFetchCall(fetchMock, "/api/import/url")).toEqual([
      "/api/import/url",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/recipes/tomato" }),
      }),
    ]);
  });

  it("取り込み確認画面からsource metadata付きで保存する", async () => {
    sessionStorage.setItem(
      "recipestock.import.url.result",
      JSON.stringify({
        recipeDraftContent: {
          title: "Tomato pasta",
          servingsText: "2人分",
          coverImage: { type: "externalImageUrl", url: "https://example.com/cover.jpg" },
          ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
          steps: [
            {
              text: "煮詰める",
              image: { type: "externalImageUrl", url: "https://example.com/step.jpg" },
            },
          ],
        },
        source: {
          sourceType: "web",
          sourcePlatform: "other",
          sourceUrl: "https://example.com/recipes/tomato",
          sourceName: "Example Kitchen",
        },
        warnings: [
          "AI returned image URL outside extracted candidates: https://cdn.example/out.jpg",
        ],
      }),
    );
    const fetchMock = mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/recipes" && init?.method === "POST") {
          return jsonResponse(
            {
              recipe: {
                id: "recipe_123",
                title: "Tomato pasta",
                content: {
                  title: "Tomato pasta",
                  servingsText: "2人分",
                  ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
                  steps: [{ text: "煮詰める" }],
                },
                source: {
                  sourceType: "web",
                  sourcePlatform: "other",
                  sourceUrl: "https://example.com/recipes/tomato",
                  normalizedSourceUrl: "https://example.com/recipes/tomato",
                  sourceName: "Example Kitchen",
                },
                createdAt: "2026-05-26T00:00:00.000Z",
                updatedAt: "2026-05-26T00:00:00.000Z",
                locked: false,
              },
            },
            { status: 201 },
          );
        }

        if (getRequestPath(input) === "/api/recipes/recipe_123") {
          return jsonResponse({
            recipe: {
              id: "recipe_123",
              title: "Tomato pasta",
              content: {
                title: "Tomato pasta",
                ingredientGroups: [],
                steps: [],
              },
              source: {
                sourceType: "web",
                sourcePlatform: "other",
                sourceUrl: "https://example.com/recipes/tomato",
                normalizedSourceUrl: "https://example.com/recipes/tomato",
                sourceName: "Example Kitchen",
              },
              createdAt: "2026-05-26T00:00:00.000Z",
              updatedAt: "2026-05-26T00:00:00.000Z",
              locked: false,
            },
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/import/confirm");

    await expect(
      screen.findByRole("heading", { name: "取り込み確認" }),
    ).resolves.toBeInTheDocument();
    expect(
      screen.getByText(/AI returned image URL outside extracted candidates/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(findFetchCall(fetchMock, "/api/recipes")).toEqual([
        "/api/recipes",
        expect.objectContaining({
          credentials: "include",
          method: "POST",
          body: JSON.stringify({
            content: {
              title: "Tomato pasta",
              servingsText: "2人分",
              coverImage: { type: "externalImageUrl", url: "https://example.com/cover.jpg" },
              ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
              steps: [
                {
                  text: "煮詰める",
                  image: { type: "externalImageUrl", url: "https://example.com/step.jpg" },
                },
              ],
            },
            source: {
              sourceType: "web",
              sourcePlatform: "other",
              sourceUrl: "https://example.com/recipes/tomato",
              sourceName: "Example Kitchen",
            },
          }),
        }),
      ]);
    });
    await expect(
      screen.findByRole("heading", { name: "Tomato pasta" }),
    ).resolves.toBeInTheDocument();
    expect(sessionStorage.getItem("recipestock.import.url.result")).toBeNull();
  });

  it("取り込み結果がない確認画面ではURL入力へ戻れる", async () => {
    mockFetch(async () => new Response(null, { status: 404 }), { authenticated: true });

    await renderApp("/import/confirm");

    await expect(
      screen.findByText("確認できる取り込み結果がありません。"),
    ).resolves.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "URL入力へ戻る" })).toHaveAttribute(
      "href",
      "/import/url",
    );
  });
});
