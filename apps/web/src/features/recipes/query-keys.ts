import { type RecipeListSort } from "@recipestock/schemas";

const recipeListQueryRoot = "recipes";
const recipeDetailQueryRoot = "recipe";

export type RecipeListQuery = {
  query: string;
  sort: RecipeListSort;
  tagIds: readonly string[];
  untagged: boolean;
};

export const recipesQueryKeys = {
  lists: () => [recipeListQueryRoot] as const,
  list: ({ query, sort, tagIds, untagged }: RecipeListQuery) =>
    [recipeListQueryRoot, { query, sort, tagIds, untagged }] as const,
  details: () => [recipeDetailQueryRoot] as const,
  detail: (recipeId: string) => [recipeDetailQueryRoot, recipeId] as const,
};

export const recipesUserScopedQueryRoots = [recipeListQueryRoot, recipeDetailQueryRoot] as const;
