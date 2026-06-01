import { createDb } from "@recipestock/db";
import { importUrlRequestSchema, importUrlResponseSchema } from "@recipestock/schemas";
import { Hono } from "hono";
import {
  aiSchemaInvalidResponse,
  aiTimeoutResponse,
  aiUsageLimitExceededResponse,
  apiErrorResponse,
  extractionFailedResponse,
  fetchFailedResponse,
  invalidUrlResponse,
  unsupportedPageResponse,
} from "../api-error";
import { type AuthService } from "../auth";
import { type ApiEnv } from "../context";
import {
  createDefaultRecipeImportAIProvider,
  importRecipeFromUrl,
  type RecipeImportAIProvider,
  RecipeImportError,
  type RecipeImportFetcher,
} from "../import-url";
import { requireAuth } from "../middleware/auth";
import { createUsageRepository, type UsageRepository } from "../usage";

type ImportRouteDependencies = {
  auth: AuthService;
  usageRepository?: UsageRepository;
  aiProvider?: RecipeImportAIProvider;
  fetcher?: RecipeImportFetcher;
  getCurrentDate?: () => Date;
};

export const createImportRoutes = ({
  auth,
  usageRepository,
  aiProvider,
  fetcher,
  getCurrentDate,
}: ImportRouteDependencies) => {
  const routes = new Hono<ApiEnv>();

  return routes.post("/url", requireAuth(auth), async (c) => {
    const userId = c.get("userId");
    const rawBody = await c.req.json().catch(() => null);
    const request = importUrlRequestSchema.safeParse(rawBody);

    if (!request.success) {
      return invalidUrlResponse();
    }

    const repository = usageRepository ?? createUsageRepository(createDb(c.env.DATABASE_URL));
    const provider = aiProvider ?? createDefaultRecipeImportAIProvider(c.env);

    try {
      const result = await importRecipeFromUrl({
        rawUrl: request.data.url,
        userId,
        env: c.env,
        usageRepository: repository,
        aiProvider: provider,
        fetcher,
        now: getCurrentDate?.(),
      });

      return c.json(importUrlResponseSchema.parse(result));
    } catch (error) {
      if (!(error instanceof RecipeImportError)) {
        throw error;
      }

      switch (error.code) {
        case "invalid_url":
          return invalidUrlResponse();
        case "fetch_failed":
          return fetchFailedResponse();
        case "unsupported_page":
          return unsupportedPageResponse();
        case "extraction_failed":
          return extractionFailedResponse();
        case "ai_usage_limit_exceeded":
          return aiUsageLimitExceededResponse();
        case "ai_timeout":
          return aiTimeoutResponse();
        case "ai_schema_invalid":
          return aiSchemaInvalidResponse();
        default:
          return apiErrorResponse({
            status: 500,
            code: "unknown",
            message: "Unexpected error occurred.",
          });
      }
    }
  });
};
