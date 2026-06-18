import { type FetchedImportPage, type RecipeImportResult } from "../types";

export type DeterministicImportMatchInput = {
  normalizedUrl: string;
  host: string;
};

export type DeterministicImportContext = DeterministicImportMatchInput & {
  page: FetchedImportPage;
  fetchUrl: string;
  finalUrl: string;
};

export type DeterministicImportAdapter = {
  id: string;
  match(input: DeterministicImportMatchInput): boolean;
  resolveFetchUrl?(input: DeterministicImportMatchInput): string;
  convert(context: DeterministicImportContext): Promise<RecipeImportResult>;
};

export type DeterministicImportRegistry = {
  select(input: DeterministicImportMatchInput): DeterministicImportAdapter | null;
};
