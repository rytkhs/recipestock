const recipeViewModeStorageKey = "recipeViewMode";

export type RecipeViewMode = "grid" | "list";

export const readRecipeViewMode = (): RecipeViewMode => {
  try {
    return localStorage.getItem(recipeViewModeStorageKey) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
};

export const writeRecipeViewMode = (viewMode: RecipeViewMode) => {
  try {
    localStorage.setItem(recipeViewModeStorageKey, viewMode);
  } catch {
    // ストレージが使えなくても表示形式は今のセッションで維持できる。
  }
};
