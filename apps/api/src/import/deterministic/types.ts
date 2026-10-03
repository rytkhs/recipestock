import { type FetchedImportPage, type RecipeImportResult } from "../types";

export type DeterministicImportMatchInput = {
  normalizedUrl: string;
  host: string;
};

export type DeterministicFetchRequest = {
  id: string;
  url: string;
};

export type DeterministicImportContext = {
  normalizedUrl: string;
  pages: ReadonlyMap<string, FetchedImportPage>;
};

export type DeterministicImportAdapter = {
  id: string;
  match(input: DeterministicImportMatchInput): boolean;
  resolveFetchRequests(input: DeterministicImportMatchInput): readonly DeterministicFetchRequest[];
  convert(context: DeterministicImportContext): Promise<RecipeImportResult>;
};
