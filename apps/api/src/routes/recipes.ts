import { createDb } from "@recipestock/db";
import {
  createRecipeRequestSchema,
  createRecipeResponseSchema,
  deleteRecipeResponseSchema,
  getRecipeResponseSchema,
  listRecipesQuerySchema,
  listRecipesResponseSchema,
  updateRecipeRequestSchema,
  updateRecipeResponseSchema,
} from "@recipestock/schemas";
import { Hono } from "hono";
import {
  invalidRecipeListCursorResponse,
  notFoundResponse,
  recipeLimitExceededResponse,
  validationFailedResponse,
} from "../api-error";
import { type AuthService } from "../auth";
import { type ApiEnv } from "../context";
import { requireAuth } from "../middleware/auth";
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
} from "../recipes";

type RecipeRouteDependencies = {
  auth: AuthService;
  recipeRepository?: RecipeRepository;
  createRecipeId?: () => string;
};

export const createRecipeRoutes = ({
  auth,
  recipeRepository,
  createRecipeId,
}: RecipeRouteDependencies) => {
  const routes = new Hono<ApiEnv>();

  return routes
    .post("/", requireAuth(auth), async (c) => {
      const userId = c.get("userId");
      const rawBody = await c.req.json().catch(() => null);
      const request = createRecipeRequestSchema.safeParse(rawBody);

      if (!request.success) {
        return validationFailedResponse(request.error.flatten());
      }

      const repository = recipeRepository ?? createRecipeRepository(createDb(c.env.DATABASE_URL));
      const content = toRecipeContent(request.data.content);
      const source = normalizeRecipeSource(request.data.source);
      const now = new Date();
      const result = await repository.createRecipeEnforcingPlanLimit({
        id: createRecipeId?.() ?? createDefaultRecipeId(),
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
    .get("/", requireAuth(auth), async (c) => {
      const userId = c.get("userId");
      const query = listRecipesQuerySchema.safeParse(c.req.query());

      if (!query.success) {
        return validationFailedResponse(query.error.flatten());
      }

      const repository = recipeRepository ?? createRecipeRepository(createDb(c.env.DATABASE_URL));
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
    .get("/:recipeId", requireAuth(auth), async (c) => {
      const userId = c.get("userId");
      const repository = recipeRepository ?? createRecipeRepository(createDb(c.env.DATABASE_URL));
      const recipe = await repository.getRecipe(userId, c.req.param("recipeId"));

      if (!recipe) {
        return notFoundResponse("Recipe was not found.");
      }

      return c.json(getRecipeResponseSchema.parse({ recipe: toRecipeDetail(recipe) }));
    })
    .put("/:recipeId", requireAuth(auth), async (c) => {
      const userId = c.get("userId");
      const rawBody = await c.req.json().catch(() => null);
      const request = updateRecipeRequestSchema.safeParse(rawBody);

      if (!request.success) {
        return validationFailedResponse(request.error.flatten());
      }

      const repository = recipeRepository ?? createRecipeRepository(createDb(c.env.DATABASE_URL));
      const existingRecipe = await repository.getRecipe(userId, c.req.param("recipeId"));

      if (!existingRecipe) {
        return notFoundResponse("Recipe was not found.");
      }

      const content = toRecipeContent(request.data.content);
      const recipe = await repository.updateRecipe({
        userId,
        recipeId: existingRecipe.id,
        title: content.title,
        content,
        searchText: buildRecipeSearchText({
          content,
          sourceName: existingRecipe.sourceName,
        }),
        updatedAt: new Date(),
      });

      if (!recipe) {
        return notFoundResponse("Recipe was not found.");
      }

      return c.json(updateRecipeResponseSchema.parse({ recipe: toRecipeDetail(recipe) }));
    })
    .delete("/:recipeId", requireAuth(auth), async (c) => {
      const userId = c.get("userId");
      const repository = recipeRepository ?? createRecipeRepository(createDb(c.env.DATABASE_URL));
      const deleted = await repository.deleteRecipe(userId, c.req.param("recipeId"));

      if (!deleted) {
        return notFoundResponse("Recipe was not found.");
      }

      return c.json(deleteRecipeResponseSchema.parse({ ok: true }));
    });
};
