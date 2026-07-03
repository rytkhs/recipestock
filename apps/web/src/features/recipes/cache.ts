import { type QueryClient } from "@tanstack/react-query";
import { recipesQueryKeys } from "./query-keys";

export const invalidateRecipeLists = async (queryClient: QueryClient) => {
  await queryClient.invalidateQueries({ queryKey: recipesQueryKeys.lists() });
};

export const removeRecipeDetail = (queryClient: QueryClient, recipeId: string) => {
  queryClient.removeQueries({ queryKey: recipesQueryKeys.detail(recipeId) });
};
