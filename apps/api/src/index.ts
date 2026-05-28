import { createDb } from "@recipestock/db";
import {
  createRecipeRequestSchema,
  createRecipeResponseSchema,
  getMeResponseSchema,
  getRecipeResponseSchema,
  listRecipesQuerySchema,
  listRecipesResponseSchema,
} from "@recipestock/schemas";
import { Hono } from "hono";
import {
  invalidRecipeListCursorResponse,
  notFoundResponse,
  recipeLimitExceededResponse,
  validationFailedResponse,
} from "./api-error";
import { type AuthService, authService } from "./auth";
import { type ApiEnv } from "./context";
import { buildMeResponse, createMeRepository, getCurrentJstMonth, type MeRepository } from "./me";
import { requireAuth } from "./middleware/auth";
import {
  buildRecipeSearchText,
  createRecipeId as createDefaultRecipeId,
  createRecipeRepository,
  InvalidRecipeListCursorError,
  type ListRecipesResult,
  normalizeRecipeSearchTerms,
  normalizeRecipeSource,
  type RecipeRepository,
  toRecipeContent,
  toRecipeDetail,
  toRecipeListItem,
} from "./recipes";

type AppDependencies = {
  auth?: AuthService;
  meRepository?: MeRepository;
  recipeRepository?: RecipeRepository;
  createRecipeId?: () => string;
  getCurrentMonth?: () => string;
};

export const createApp = (dependencies: AppDependencies = {}) => {
  const app = new Hono<ApiEnv>().basePath("/api");
  const auth = dependencies.auth ?? authService;

  const routes = app
    .get("/health", (c) => {
      return c.json({
        ok: true,
        environment: c.env?.APP_ENV ?? "development",
      });
    })
    .on(["GET", "POST"], "/auth/*", (c) => {
      return auth.handleAuthRequest(c.req.raw, c.env);
    })
    .get("/me", requireAuth(auth), async (c) => {
      const userId = c.get("userId");
      const repository =
        dependencies.meRepository ?? createMeRepository(createDb(c.env.DATABASE_URL));
      const month = dependencies.getCurrentMonth?.() ?? getCurrentJstMonth();
      const appUser = await repository.getOrCreateAppUser(userId);
      const [recipeCount, storedAiUsage] = await Promise.all([
        repository.countRecipes(userId),
        repository.getAiUsage(userId, month),
      ]);

      return c.json(
        getMeResponseSchema.parse(
          buildMeResponse({
            userId,
            plan: appUser.plan,
            recipeCount,
            aiUsage: storedAiUsage ?? { month, count: 0 },
          }),
        ),
      );
    })
    .post("/recipes", requireAuth(auth), async (c) => {
      const userId = c.get("userId");
      const rawBody = await c.req.json().catch(() => null);
      const request = createRecipeRequestSchema.safeParse(rawBody);

      if (!request.success) {
        return validationFailedResponse(request.error.flatten());
      }

      const repository =
        dependencies.recipeRepository ?? createRecipeRepository(createDb(c.env.DATABASE_URL));
      const content = toRecipeContent(request.data.content);
      const source = normalizeRecipeSource(request.data.source);
      const now = new Date();
      const result = await repository.createRecipeEnforcingPlanLimit({
        id: dependencies.createRecipeId?.() ?? createDefaultRecipeId(),
        userId,
        title: content.title,
        content,
        sourceType: source.sourceType,
        sourcePlatform: source.sourcePlatform,
        sourceUrl: source.sourceUrl,
        normalizedSourceUrl: source.normalizedSourceUrl,
        sourceName: source.sourceName,
        searchText: buildRecipeSearchText({ content, sourceName: source.sourceName }),
        createdAt: now,
        updatedAt: now,
      });

      if (result.status === "limitExceeded") {
        return recipeLimitExceededResponse();
      }

      const recipe = result.recipe;

      return c.json(createRecipeResponseSchema.parse({ recipe: toRecipeDetail(recipe) }), 201);
    })
    .get("/recipes", requireAuth(auth), async (c) => {
      const userId = c.get("userId");
      const query = listRecipesQuerySchema.safeParse(c.req.query());

      if (!query.success) {
        return validationFailedResponse(query.error.flatten());
      }

      const repository =
        dependencies.recipeRepository ?? createRecipeRepository(createDb(c.env.DATABASE_URL));
      let result: ListRecipesResult;

      try {
        result = await repository.listRecipes({
          userId,
          searchTerms: normalizeRecipeSearchTerms(query.data.q),
          limit: query.data.limit,
          cursor: query.data.cursor ?? null,
        });
      } catch (error) {
        if (error instanceof InvalidRecipeListCursorError) {
          return invalidRecipeListCursorResponse();
        }

        throw error;
      }

      return c.json(
        listRecipesResponseSchema.parse({
          items: result.items.map(toRecipeListItem),
          nextCursor: result.nextCursor,
        }),
      );
    })
    .get("/recipes/:recipeId", requireAuth(auth), async (c) => {
      const userId = c.get("userId");
      const repository =
        dependencies.recipeRepository ?? createRecipeRepository(createDb(c.env.DATABASE_URL));
      const recipe = await repository.getRecipe(userId, c.req.param("recipeId"));

      if (!recipe) {
        return notFoundResponse("Recipe was not found.");
      }

      return c.json(getRecipeResponseSchema.parse({ recipe: toRecipeDetail(recipe) }));
    });

  return routes;
};

const app = createApp();

export type AppType = ReturnType<typeof createApp>;
export default app;
