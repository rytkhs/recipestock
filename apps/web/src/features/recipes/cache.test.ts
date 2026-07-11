import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { syncDeletedRecipeCaches } from "./cache";
import { recipesQueryKeys } from "./query-keys";

const recipeListItem = (id: string, title: string) => ({
  id,
  title,
  coverImageUrl: null,
  sourceName: null,
  createdAt: "2026-05-25T00:00:00.000Z",
  updatedAt: "2026-05-26T00:00:00.000Z",
  locked: false,
});

describe("recipe cache", () => {
  it("削除済みRecipeをすべての一覧と詳細キャッシュから除去する", async () => {
    const queryClient = new QueryClient();
    const defaultListKey = recipesQueryKeys.list("");
    const searchListKey = recipesQueryKeys.list("tomato");
    const pageParams = [null, "cursor_2"];

    queryClient.setQueryData(defaultListKey, {
      pages: [
        {
          items: [
            recipeListItem("recipe_deleted", "Tomato pasta"),
            recipeListItem("recipe_kept", "Potato salad"),
          ],
          nextCursor: "cursor_2",
        },
        {
          items: [recipeListItem("recipe_other", "Onion soup")],
          nextCursor: null,
        },
      ],
      pageParams,
    });
    queryClient.setQueryData(searchListKey, {
      pages: [
        {
          items: [recipeListItem("recipe_deleted", "Tomato pasta")],
          nextCursor: null,
        },
      ],
      pageParams: [null],
    });
    queryClient.setQueryData(recipesQueryKeys.detail("recipe_deleted"), {
      id: "recipe_deleted",
    });

    await syncDeletedRecipeCaches(queryClient, "recipe_deleted");

    expect(queryClient.getQueryData(defaultListKey)).toEqual({
      pages: [
        {
          items: [recipeListItem("recipe_kept", "Potato salad")],
          nextCursor: "cursor_2",
        },
        {
          items: [recipeListItem("recipe_other", "Onion soup")],
          nextCursor: null,
        },
      ],
      pageParams,
    });
    expect(queryClient.getQueryData(searchListKey)).toEqual({
      pages: [{ items: [], nextCursor: null }],
      pageParams: [null],
    });
    expect(queryClient.getQueryData(recipesQueryKeys.detail("recipe_deleted"))).toBeUndefined();
  });
});
