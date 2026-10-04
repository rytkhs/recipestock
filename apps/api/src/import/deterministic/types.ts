import { type RecipeDraftContent } from "@recipestock/schemas";
import { type FetchedImportPage } from "../types";

export type DeterministicImportMatchInput = {
  normalizedUrl: string;
};

export type DeterministicFetchRequest = {
  id: string;
  url: string;
};

export type DeterministicImportContext = {
  normalizedUrl: string;
  pages: ReadonlyMap<string, FetchedImportPage>;
};

/** 見出しの行と本文で書くまとまり。書式はimporterがそろえる。 */
export type DeterministicTextSection = {
  heading: string;
  body: string;
};

export type DeterministicStep = {
  text?: string;
  /** 手順に付いた補足（ページの「ポイント」など）。手順の本文のあとに置く。 */
  supplements?: DeterministicTextSection[];
  imageUrls: string[];
};

/** ページから取り出したレシピ。`RecipeDraftContent`へはimporterが組み立てる。 */
export type DeterministicRecipe = {
  title: string;
  yieldText?: string;
  coverImageUrl?: string;
  ingredientGroups: RecipeDraftContent["ingredientGroups"];
  steps: DeterministicStep[];
  /** 取り込めなかった部分の告知など、アプリが書く文。noteの先頭に見出しなしで置く。 */
  notice?: string;
  noteSections?: DeterministicTextSection[];
};

export type DeterministicImportResult = {
  recipe: DeterministicRecipe;
  sourceUrl: string;
};

export type DeterministicImportAdapter = {
  id: string;
  /** 取り込んだRecipeの出典名。 */
  sourceName: string;
  match(input: DeterministicImportMatchInput): boolean;
  resolveFetchRequests(input: DeterministicImportMatchInput): readonly DeterministicFetchRequest[];
  convert(context: DeterministicImportContext): Promise<DeterministicImportResult>;
};
