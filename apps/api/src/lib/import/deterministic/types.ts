import { type FetchedImportPage, type RecipeImportResult } from "../types";

export type DeterministicImportMatchInput = {
  normalizedUrl: string;
  host: string;
};

export type DeterministicFetchRequest = {
  id: string;
  url: string;
};

export type DeterministicFetchedPage = {
  requestId: string;
  requestedUrl: string;
  finalUrl: string;
  page: FetchedImportPage;
};

export type DeterministicImportContext = DeterministicImportMatchInput & {
  pages: ReadonlyMap<string, DeterministicFetchedPage>;
};

export type DeterministicImportAdapter = {
  id: string;
  match(input: DeterministicImportMatchInput): boolean;
  resolveFetchRequests(input: DeterministicImportMatchInput): readonly DeterministicFetchRequest[];
  convert(context: DeterministicImportContext): Promise<RecipeImportResult>;
};

export type DeterministicImportRegistry = {
  select(input: DeterministicImportMatchInput): DeterministicImportAdapter | null;
};
