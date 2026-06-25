import { type RecipeSourceDraft, recipeSourceDraftSchema } from "@recipestock/schemas";
import { z } from "zod";
import {
  type FetchedImportPage,
  type RecipeImportAIInput,
  type RecipeImportImageCandidate,
} from "../types";

export type SourceExtractionMatchInput = {
  normalizedUrl: string;
  host: string;
};

export type SourceExtractionFetchRequest = {
  url: string;
};

export type SourceExtractionContext = {
  normalizedUrl: string;
  page: FetchedImportPage;
};

export type SourceExtractionResult = {
  input: RecipeImportAIInput;
  imageCandidates: RecipeImportImageCandidate[];
  source: RecipeSourceDraft;
  warnings: string[];
};

export type SourceExtractionAdapter = {
  id: string;
  match(input: SourceExtractionMatchInput): boolean;
  resolveFetchRequest(input: SourceExtractionMatchInput): SourceExtractionFetchRequest;
  convert(context: SourceExtractionContext): Promise<SourceExtractionResult>;
};

const sourceExtractionImageCandidateSchema = z.strictObject({
  id: z.string().min(1),
  url: z.string().url(),
  alt: z.string().optional(),
  position: z.number().int().nonnegative(),
});

const sourceExtractionResultSchema = z.strictObject({
  input: z.strictObject({
    source: z.strictObject({
      finalUrl: z.string().url(),
      host: z.string().min(1),
    }),
    markdownContent: z.string().min(1),
    recipeStructuredEvidence: z.array(z.unknown()),
  }),
  imageCandidates: z.array(sourceExtractionImageCandidateSchema),
  source: recipeSourceDraftSchema,
  warnings: z.array(z.string()),
});

export const parseSourceExtractionResult = (value: SourceExtractionResult) =>
  sourceExtractionResultSchema.parse(value) as SourceExtractionResult;
