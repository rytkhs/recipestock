import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRequestPath, jsonResponse, mockFetch, renderApp } from "../test/router-test-utils";

const listItem = (id: string, title: string, locked = false) => ({
  id,
  title,
  coverImageUrl: null,
  sourceName: null,
  createdAt: "2026-05-25T00:00:00.000Z",
  locked,
});

const detailResponse = (title = "Tomato pasta", tags: { id: string; name: string }[] = []) => ({
  recipe: {
    id: "recipe_123",
    title,
    content: { title, ingredientGroups: [], steps: [{ text: "煮詰める", images: [] }] },
    source: { sourceUrl: null, normalizedSourceUrl: null, sourceName: null },
    createdAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z",
    tags,
    locked: false,
  },
});

// 一覧・詳細・編集の保存をまとめて返す。保存するとレシピ名が変わる。
const mockRecipeFetch = ({ listPath }: { listPath: string }) => {
  let title = "Tomato pasta";

  return mockFetch(
    async (input, init) => {
      const path = getRequestPath(input);

      if (path === "/api/recipes/recipe_123" && init?.method === "PUT") {
        title = "Potato salad";
        return jsonResponse(detailResponse(title));
      }

      if (path === "/api/recipes" && init?.method === "POST") {
        return jsonResponse(detailResponse(title), { status: 201 });
      }

      if (path === "/api/recipes/recipe_123") {
        return jsonResponse(detailResponse(title));
      }

      if (path === listPath) {
        return jsonResponse({ items: [listItem("recipe_123", title)], nextCursor: null });
      }

      return new Response(null, { status: 404 });
    },
    { authenticated: true },
  );
};

const renameRecipeAndSave = async () => {
  const titleInput = await screen.findByLabelText("レシピ名");
  await userEvent.clear(titleInput);
  await userEvent.type(titleInput, "Potato salad");
  await userEvent.click(screen.getByRole("button", { name: "更新" }));
};

describe("戻る・閉じる", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("タグの管理", () => {
    it("設定から開いたときの戻るは、履歴を戻って設定に帰る", async () => {
      mockFetch(
        async (input) => {
          if (getRequestPath(input) === "/api/tags") {
            return jsonResponse({ tags: [{ id: "tag_1", name: "鶏肉", recipeCount: 1 }] });
          }

          return new Response(null, { status: 404 });
        },
        { authenticated: true },
      );

      const { appRouter } = await renderApp("/settings");

      await userEvent.click(await screen.findByRole("link", { name: /タグ.*1個/ }));
      await userEvent.click(await screen.findByRole("button", { name: "戻る" }));

      await waitFor(() => {
        expect(appRouter.state.location.pathname).toBe("/settings");
      });
      expect(appRouter.history.canGoBack()).toBe(false);
    });

    it("詳細のシートから開いたときの戻るは詳細に帰り、詳細の戻るで一覧に帰る", async () => {
      mockFetch(
        async (input) => {
          const path = getRequestPath(input);

          if (path === "/api/recipes/recipe_123") {
            return jsonResponse(detailResponse("Tomato pasta", [{ id: "tag_1", name: "鶏肉" }]));
          }

          if (path === "/api/tags") {
            return jsonResponse({ tags: [{ id: "tag_1", name: "鶏肉", recipeCount: 1 }] });
          }

          if (path === "/api/recipes?limit=20") {
            return jsonResponse({
              items: [listItem("recipe_123", "Tomato pasta")],
              nextCursor: null,
            });
          }

          return new Response(null, { status: 404 });
        },
        { authenticated: true },
      );

      const { appRouter } = await renderApp("/recipes");

      await userEvent.click(await screen.findByRole("link", { name: /Tomato pasta/ }));
      await userEvent.click(await screen.findByRole("button", { name: "タグを編集" }));
      const sheet = await screen.findByRole("dialog", { name: "タグ" });
      await userEvent.click(within(sheet).getByRole("link", { name: "タグを管理" }));
      await screen.findByRole("list", { name: "タグ" });
      await userEvent.click(screen.getByRole("button", { name: "戻る" }));

      await waitFor(() => {
        expect(appRouter.state.location.pathname).toBe("/recipes/recipe_123");
      });

      await userEvent.click(await screen.findByRole("button", { name: "戻る" }));

      await waitFor(() => {
        expect(appRouter.state.location.pathname).toBe("/recipes");
      });
      expect(appRouter.history.canGoBack()).toBe(false);
    });

    it("直接開いたときの戻るは、設定を開いて今の履歴と置き換える", async () => {
      mockFetch(
        async (input) => {
          if (getRequestPath(input) === "/api/tags") {
            return jsonResponse({ tags: [] });
          }

          return new Response(null, { status: 404 });
        },
        { authenticated: true },
      );

      const { appRouter } = await renderApp("/tags");

      await userEvent.click(await screen.findByRole("button", { name: "戻る" }));

      await waitFor(() => {
        expect(appRouter.state.location.pathname).toBe("/settings");
      });
      expect(appRouter.history.canGoBack()).toBe(false);
    });
  });

  describe("編集", () => {
    it("一覧のカードから開いて閉じると、絞り込んだ一覧に帰る", async () => {
      mockRecipeFetch({ listPath: "/api/recipes?limit=20&q=tomato" });

      const { appRouter } = await renderApp("/recipes?q=tomato");

      await userEvent.click(
        await screen.findByRole("button", { name: "Tomato pastaの操作メニュー" }),
      );
      await userEvent.click(await screen.findByRole("menuitem", { name: "編集" }));
      await screen.findByLabelText("レシピ名");
      await userEvent.click(screen.getByRole("button", { name: "閉じる" }));

      await waitFor(() => {
        expect(appRouter.state.location.pathname).toBe("/recipes");
      });
      expect(appRouter.state.location.searchStr).toBe("?q=tomato");
      expect(appRouter.history.canGoBack()).toBe(false);
    });

    it("一覧のカードから開いて保存すると、一覧に帰って保存したことを知らせる", async () => {
      mockRecipeFetch({ listPath: "/api/recipes?limit=20&q=tomato" });

      const { appRouter } = await renderApp("/recipes?q=tomato");

      await userEvent.click(
        await screen.findByRole("button", { name: "Tomato pastaの操作メニュー" }),
      );
      await userEvent.click(await screen.findByRole("menuitem", { name: "編集" }));
      await renameRecipeAndSave();

      await waitFor(() => {
        expect(appRouter.state.location.pathname).toBe("/recipes");
      });
      expect(appRouter.state.location.searchStr).toBe("?q=tomato");
      expect(appRouter.history.canGoBack()).toBe(false);
      await expect(screen.findByText("保存しました")).resolves.toBeInTheDocument();
      await expect(
        screen.findByRole("heading", { name: "Potato salad" }),
      ).resolves.toBeInTheDocument();
    });

    it("詳細から開いて保存すると詳細に帰り、詳細の戻るで一覧に帰る", async () => {
      mockRecipeFetch({ listPath: "/api/recipes?limit=20" });

      const { appRouter } = await renderApp("/recipes");

      await userEvent.click(await screen.findByRole("link", { name: /Tomato pasta/ }));
      await userEvent.click(await screen.findByRole("link", { name: "編集" }));
      await renameRecipeAndSave();

      await waitFor(() => {
        expect(appRouter.state.location.pathname).toBe("/recipes/recipe_123");
      });
      await expect(
        screen.findByRole("heading", { level: 1, name: "Potato salad" }),
      ).resolves.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "戻る" }));

      await waitFor(() => {
        expect(appRouter.state.location.pathname).toBe("/recipes");
      });
      expect(appRouter.history.canGoBack()).toBe(false);
    });
  });

  it("新しいレシピを保存すると詳細を開き、詳細の戻るは新規作成を通らず一覧に帰る", async () => {
    mockRecipeFetch({ listPath: "/api/recipes?limit=20" });

    const { appRouter } = await renderApp("/recipes");
    await screen.findByRole("link", { name: /Tomato pasta/ });

    await act(async () => {
      await appRouter.navigate({ href: "/recipes/new" });
    });
    await userEvent.type(await screen.findByLabelText("レシピ名"), "Tomato pasta");
    await userEvent.type(screen.getByLabelText("手順1"), "煮詰める");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(appRouter.state.location.pathname).toBe("/recipes/recipe_123");
    });

    await userEvent.click(await screen.findByRole("button", { name: "戻る" }));

    await waitFor(() => {
      expect(appRouter.state.location.pathname).toBe("/recipes");
    });
    expect(appRouter.history.canGoBack()).toBe(false);
  });

  it("一覧のロック中の案内からプランを開いて戻ると、絞り込んだ一覧に帰る", async () => {
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/recipes?limit=20&q=pasta") {
          return jsonResponse({
            items: [
              listItem("recipe_open", "Tomato pasta"),
              listItem("recipe_locked", "Locked pasta", true),
            ],
            nextCursor: null,
          });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    const { appRouter } = await renderApp("/recipes?q=pasta");

    await userEvent.click(await screen.findByRole("link", { name: "プランを見る" }));
    await waitFor(() => {
      expect(appRouter.state.location.pathname).toBe("/settings/billing");
    });
    await userEvent.click(await screen.findByRole("button", { name: "戻る" }));

    await waitFor(() => {
      expect(appRouter.state.location.pathname).toBe("/recipes");
    });
    expect(appRouter.state.location.searchStr).toBe("?q=pasta");
  });
});
