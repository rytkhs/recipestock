import { type RecipeListSort } from "@recipestock/schemas";

export type RecipeListFilters = {
  q?: string;
};

// 一覧で最後に使った並び順と絞り込み条件。アプリを開き直したら既定に戻すので、保存せずメモリにだけ持つ。
let recipeListSort: RecipeListSort = "newest";
let recipeListFilters: RecipeListFilters = {};

// 並び順は、並び順を指定せずに一覧へ移るどの遷移でも引き継ぐ（/recipesのsearch middleware）。
export const readRecipeListSort = () => recipeListSort;

export const writeRecipeListSort = (sort: RecipeListSort) => {
  recipeListSort = sort;
};

// 絞り込み条件は、各画面の戻る・閉じるボタンと詳細での削除後にだけ、searchとして渡して引き継ぐ。
// ヘッダーの一覧リンクや取り込みの送信後は条件を外して開き、取り込んだRecipeが絞り込みで棚から隠れないようにする。
export const readRecipeListFilters = (): RecipeListFilters => ({ ...recipeListFilters });

export const writeRecipeListFilters = (filters: RecipeListFilters) => {
  recipeListFilters = filters;
};
