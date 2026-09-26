import { infiniteQueryOptions } from "@tanstack/react-query";
import { listRecipes } from "./client";
import { type RecipeListQuery, recipesQueryKeys } from "./query-keys";

// 一覧の画面と、起動時にsessionの確認と並べて取りに行くrouterのloaderで同じものを使う。
// keyや鮮度がずれると、先に取った結果を画面が使わずに取り直す。
export const recipeListQueryOptions = ({ query, sort, tagIds, untagged }: RecipeListQuery) =>
  infiniteQueryOptions({
    queryKey: recipesQueryKeys.list({ query, sort, tagIds, untagged }),
    staleTime: 5 * 60 * 1000,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listRecipes({ query, sort, tagIds, untagged, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
