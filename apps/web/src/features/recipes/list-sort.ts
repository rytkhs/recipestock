import { type RecipeListSort } from "@recipestock/schemas";

// 一覧で最後に使った並び順。詳細などから一覧へ移るときに引き継ぐ。
// アプリを開き直したら新しい順に戻すので、保存せずメモリにだけ持つ。
let recipeListSort: RecipeListSort = "newest";

export const readRecipeListSort = () => recipeListSort;

export const writeRecipeListSort = (sort: RecipeListSort) => {
  recipeListSort = sort;
};
