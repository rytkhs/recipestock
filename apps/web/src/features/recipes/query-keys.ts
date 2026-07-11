const recipeListQueryRoot = "recipes";
const recipeDetailQueryRoot = "recipe";

export const recipesQueryKeys = {
  lists: () => [recipeListQueryRoot] as const,
  list: (query: string) => [recipeListQueryRoot, { query }] as const,
  detail: (recipeId: string) => [recipeDetailQueryRoot, recipeId] as const,
};

export const recipesUserScopedQueryRoots = [recipeListQueryRoot, recipeDetailQueryRoot] as const;
