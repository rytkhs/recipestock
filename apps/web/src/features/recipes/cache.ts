import { type ListRecipesResponse } from "@recipestock/schemas";
import { type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { recipesQueryKeys } from "./query-keys";

export const invalidateRecipeLists = async (queryClient: QueryClient) => {
  await queryClient.invalidateQueries({ queryKey: recipesQueryKeys.lists() });
};

export const removeRecipeDetail = (queryClient: QueryClient, recipeId: string) => {
  queryClient.removeQueries({ queryKey: recipesQueryKeys.detail(recipeId) });
};

export const syncDeletedRecipeCaches = async (queryClient: QueryClient, recipeId: string) => {
  removeRecipeDetail(queryClient, recipeId);
  queryClient.setQueriesData<InfiniteData<ListRecipesResponse, string | null>>(
    { queryKey: recipesQueryKeys.lists() },
    (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.filter((recipe) => recipe.id !== recipeId),
            })),
          }
        : data,
  );
  await invalidateRecipeLists(queryClient);
};
