import { type RecipeSourceDraft, recipeSourceDraftSchema } from "@recipestock/schemas";
import { z } from "zod";
import { type YtDlpMetadataClient } from "../../../ytdlp-metadata";
import {
  type FetchedImportPage,
  type RecipeImportImageCandidate,
  type RecipeImportImagePlacement,
  type RecipeImportSocialAIInput,
} from "../types";

export type SourceExtractionMatchInput = {
  normalizedUrl: string;
  host: string;
};

export type SourceExtractionContext = {
  normalizedUrl: string;
  host: string;
  timeoutMs: number;
  fetchHtml(url: string): Promise<FetchedImportPage>;
  ytdlpMetadataClient?: YtDlpMetadataClient;
};

export type SourceExtractionResult = {
  promptProfile: "social";
  input: RecipeImportSocialAIInput;
  imageCandidates: RecipeImportImageCandidate[];
  imagePlacement?: RecipeImportImagePlacement;
  source: RecipeSourceDraft;
  warnings: string[];
};

export type SourceExtractionAdapter = {
  id: string;
  match(input: SourceExtractionMatchInput): boolean;
  extract(context: SourceExtractionContext): Promise<SourceExtractionResult>;
};

const sourceExtractionImageCandidateSchema = z.strictObject({
  id: z.string().min(1),
  url: z.string().url(),
  alt: z.string().optional(),
  position: z.number().int().nonnegative(),
});

const sourceExtractionImagePlacementSchema = z.strictObject({
  coverImageUrl: z.string().url().optional(),
  sourceMediaUrls: z.array(z.string().url()),
});

const sourceExtractionResultSchema = z.strictObject({
  promptProfile: z.literal("social"),
  input: z.strictObject({
    source: z.strictObject({
      finalUrl: z.string().url(),
      host: z.string().min(1),
    }),
    markdownContent: z.string().min(1),
  }),
  imageCandidates: z.array(sourceExtractionImageCandidateSchema),
  imagePlacement: sourceExtractionImagePlacementSchema.optional(),
  source: recipeSourceDraftSchema,
  warnings: z.array(z.string()),
});

export const parseSourceExtractionResult = (value: SourceExtractionResult) =>
  sourceExtractionResultSchema.parse(value) as SourceExtractionResult;
