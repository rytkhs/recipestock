const recipeListQueryRoot = "recipes";
const recipeDetailQueryRoot = "recipe";

export const recipesQueryKeys = {
  list: (query: string, cursor: string | null) => [recipeListQueryRoot, query, cursor] as const,
  detail: (recipeId: string) => [recipeDetailQueryRoot, recipeId] as const,
};

export const recipesUserScopedQueryRoots = [recipeListQueryRoot, recipeDetailQueryRoot] as const;
