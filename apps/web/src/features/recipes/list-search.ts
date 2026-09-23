import { type RecipeListSort } from "@recipestock/schemas";

// 一覧で最後に使った並び順。アプリを開き直したら既定に戻すので、保存せずメモリにだけ持つ。
// 絞り込み条件はURLにだけ持ち、戻る操作では履歴ごと戻す（ADR 0030）。
let recipeListSort: RecipeListSort = "newest";

// 並び順は、並び順を指定せずに一覧へ移るどの遷移でも引き継ぐ（/recipesのsearch middleware）。
export const readRecipeListSort = () => recipeListSort;

export const writeRecipeListSort = (sort: RecipeListSort) => {
  recipeListSort = sort;
};
