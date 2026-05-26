type RecipeSearchInput = {
  title: string;
  sourceName?: string | null;
  ingredientNames?: string[];
  ingredientAmounts?: string[];
  stepTexts?: string[];
  note?: string | null;
  sourceUrl?: string | null;
};

export const buildSearchText = ({
  title,
  sourceName,
  ingredientNames = [],
  note,
}: RecipeSearchInput) => {
  return [title, sourceName, ...ingredientNames, note]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .toLowerCase()
    .normalize("NFKC");
};
