import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRouter, createAppRouter } from "./router";

const renderApp = async (initialPath = "/") => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const appRouter = createAppRouter({
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <AppRouter appRouter={appRouter} />
    </QueryClientProvider>,
  );

  await act(async () => {
    await appRouter.load();
  });
  return view;
};

describe("AppRouter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("初期ルートを表示する", async () => {
    await renderApp();

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
    await renderApp("/login");

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
    await renderApp("/login");

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

  it("新規レシピを保存して詳細画面で閲覧する", async () => {
    const recipeResponse = {
      recipe: {
        id: "recipe_123",
        title: "Tomato pasta",
        content: {
          title: "Tomato pasta",
          servingsText: "2人分",
          ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
          steps: [{ text: "煮詰める" }],
          note: "仕上げにオリーブオイル。",
        },
        source: {
          sourceType: "web",
          sourcePlatform: null,
          sourceUrl: "https://example.com/recipes/tomato",
          normalizedSourceUrl: "https://example.com/recipes/tomato",
          sourceName: "Example Kitchen",
        },
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z",
        locked: false,
      },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "/api/recipes" && init?.method === "POST") {
        return new Response(JSON.stringify(recipeResponse), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }

      if (input === "/api/recipes/recipe_123") {
        return new Response(JSON.stringify(recipeResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(null, { status: 404 });
    });

    await renderApp("/recipes/new");

    await userEvent.type(await screen.findByLabelText("タイトル"), "Tomato pasta");
    await userEvent.type(screen.getByLabelText("人数"), "2人分");
    await userEvent.type(screen.getByLabelText("材料名"), "トマト缶");
    await userEvent.type(screen.getByLabelText("分量"), "1缶");
    await userEvent.type(screen.getByLabelText("手順"), "煮詰める");
    await userEvent.type(screen.getByLabelText("メモ"), "仕上げにオリーブオイル。");
    await userEvent.type(screen.getByLabelText("出典名"), "Example Kitchen");
    await userEvent.type(screen.getByLabelText("元URL"), "https://example.com/recipes/tomato");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/recipes",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
        }),
      );
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      content: {
        title: "Tomato pasta",
        servingsText: "2人分",
        ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
        steps: [{ text: "煮詰める" }],
        note: "仕上げにオリーブオイル。",
      },
      source: {
        sourceType: "web",
        sourceName: "Example Kitchen",
        sourceUrl: "https://example.com/recipes/tomato",
      },
    });
    await expect(
      screen.findByRole("heading", { name: "Tomato pasta" }),
    ).resolves.toBeInTheDocument();
    expect(screen.getByText("トマト缶 1缶")).toBeInTheDocument();
    expect(screen.getByText("煮詰める")).toBeInTheDocument();
  });
});
