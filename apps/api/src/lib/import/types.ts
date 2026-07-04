import { type RecipeDraftContent, type RecipeSourceDraft } from "@recipestock/schemas";

export type ImportErrorCode =
  | "invalid_url"
  | "fetch_failed"
  | "unsupported_page"
  | "extraction_failed"
  | "private_or_login_required"
  | "ai_usage_limit_exceeded"
  | "ai_timeout"
  | "job_timeout"
  | "ai_schema_invalid"
  | "unknown";

export class RecipeImportError extends Error {
  readonly code: ImportErrorCode;

  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.name = "RecipeImportError";
    this.code = code;
  }
}

export type RecipeImportResult = {
  recipeDraftContent: RecipeDraftContent;
  source: RecipeSourceDraft;
  warnings: string[];
};

export type FetchedImportPage = {
  finalUrl: string;
  contentType: string;
  body: Response | string;
};

export type RecipeImportFetcher = (
  url: string,
  options: { timeoutMs: number; maxBytes: number },
) => Promise<FetchedImportPage>;

export type RecipeImportImageCandidate = {
  id: string;
  url: string;
  alt?: string;
  position: number;
};

export type RecipeImportImagePlacement = {
  coverImageUrl?: string;
  referenceImageUrls: string[];
};

export type RecipeImportStructuredInstructionEvidence = {
  text: string;
  imageUrls: string[];
};

export type RecipeImportStructuredEvidence = {
  format: "jsonLd" | "microdata" | "rdfa";
  name?: string;
  yieldText?: string;
  imageUrls: string[];
  rawIngredients: string[];
  rawInstructions: string[];
  structuredInstructions: RecipeImportStructuredInstructionEvidence[];
};

export type RecipeImportAIInputBase = {
  source: {
    finalUrl: string;
    host: string;
  };
  markdownContent: string;
};

export type RecipeImportGenericAIInput = RecipeImportAIInputBase & {
  recipeStructuredEvidence: RecipeImportStructuredEvidence[];
};

export type RecipeImportSocialAIInput = RecipeImportAIInputBase;

export type RecipeImportAIInput = RecipeImportGenericAIInput | RecipeImportSocialAIInput;

export type RecipeImportPromptProfile = "generic" | "social";

export type RecipeImportAINormalizeRequest =
  | {
      promptProfile: "generic";
      input: RecipeImportGenericAIInput;
    }
  | {
      promptProfile: "social";
      input: RecipeImportSocialAIInput;
    };

export type RecipeImportAIImageUrl = string;

export type RecipeImportAIDraftStep = {
  text?: string;
  imageUrls: RecipeImportAIImageUrl[];
};

export type RecipeImportAIDraftContent = {
  title: string | null;
  yieldText?: string;
  coverImageUrl?: RecipeImportAIImageUrl;
  ingredientGroups: Array<{
    label?: string;
    ingredients: Array<{
      name: string;
      amount: string;
    }>;
  }>;
  steps: RecipeImportAIDraftStep[];
  note?: string;
};

export type RecipeImportAIProvider = {
  normalize(request: RecipeImportAINormalizeRequest): Promise<RecipeImportAIDraftContent>;
};
