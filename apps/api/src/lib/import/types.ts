import { type RecipeDraftContent, type RecipeSourceDraft } from "@recipestock/schemas";

export type ImportErrorCode =
  | "invalid_url"
  | "fetch_failed"
  | "unsupported_page"
  | "extraction_failed"
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
