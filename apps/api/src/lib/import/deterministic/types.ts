import { type RecipePageEvidence } from "../../../import-page-evidence";
import { type FetchedImportPage, type RecipeImportResult } from "../../../import-url";

export type DeterministicImportMatchInput = {
  finalUrl: string;
  normalizedUrl: string;
  host: string;
};

export type DeterministicImportContext = DeterministicImportMatchInput & {
  page: FetchedImportPage;
  evidence: RecipePageEvidence;
};

export type DeterministicImportAdapter = {
  id: string;
  match(input: DeterministicImportMatchInput): boolean;
  convert(context: DeterministicImportContext): Promise<RecipeImportResult>;
};

export type DeterministicImportRegistry = {
  select(input: DeterministicImportMatchInput): DeterministicImportAdapter | null;
};
