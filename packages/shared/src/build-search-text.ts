type RecipeSearchInput = {
  title: string;
  sourceName?: string | null;
  ingredientTexts?: string[];
  stepTexts?: string[];
  note?: string | null;
};

export const buildSearchText = ({
  title,
  sourceName,
  ingredientTexts = [],
  stepTexts = [],
  note,
}: RecipeSearchInput) => {
  return [title, sourceName, ...ingredientTexts, ...stepTexts, note]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .toLowerCase()
    .normalize("NFKC");
};
