type RecipeSearchInput = {
  title: string;
  sourceName?: string | null;
  ingredientTexts?: string[];
  stepTexts?: string[];
};

export const buildSearchText = ({
  title,
  sourceName,
  ingredientTexts = [],
  stepTexts = [],
}: RecipeSearchInput) => {
  return [title, sourceName, ...ingredientTexts, ...stepTexts]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .toLowerCase()
    .normalize("NFKC");
};
