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
  imageFinalizeFailedResponse,
  invalidRecipeListCursorResponse,
  lockedRecipeResponse,
  notFoundResponse,
  recipeLimitExceededResponse,
  validationFailedResponse,
} from "../api-error";
import { type AuthService } from "../auth";
import { type ApiEnv } from "../context";
import { createRecipeImageService, type RecipeImageService } from "../images";
import { requireAuth } from "../middleware/auth";
import {
  attachRecipeImageUrls,
  deleteObjectsBestEffort,
  finalizeRecipeDraftImages,
  getRemovedRecipeImageKeys,
  RecipeImageFinalizeError,
} from "../recipe-images";
import {
  buildRecipeSearchText,
  createRecipeId as createDefaultRecipeId,
  createRecipeRepository,
  InvalidRecipeListCursorError,
  type ListRecipesResult,
  normalizeRecipeSearchTerms,
  normalizeRecipeSource,
  type RecipeRepository,
  toLockedRecipeDetail,
  toRecipeDetail,
  toRecipeListItem,
} from "../recipes";

type RecipeRouteDependencies = {
  auth: AuthService;
  recipeRepository?: RecipeRepository;
  imageService?: RecipeImageService;
  createRecipeId?: () => string;
  createImageId?: () => string;
};

export const createRecipeRoutes = ({
  auth,
  recipeRepository,
  imageService,
  createRecipeId,
  createImageId,
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

      const recipeId = createRecipeId?.() ?? createDefaultRecipeId();
      const images = imageService ?? createRecipeImageService(c.env);
      let finalized: Awaited<ReturnType<typeof finalizeRecipeDraftImages>>;

      try {
        finalized = await finalizeRecipeDraftImages({
          draft: request.data.content,
          userId,
          recipeId,
          imageService: images,
          createImageId,
        });
      } catch (error) {
        if (error instanceof RecipeImageFinalizeError) {
          return imageFinalizeFailedResponse();
        }

        throw error;
      }

      const content = finalized.content;
      const source = normalizeRecipeSource(request.data.source);
      const now = new Date();
      const repository =
        recipeRepository ??
        createRecipeRepository(createDb(c.env.DATABASE_URL), {
          proPriceId: c.env.STRIPE_PRO_PRICE_ID,
          now,
        });
      let result: Awaited<ReturnType<RecipeRepository["createRecipeEnforcingPlanLimit"]>>;

      try {
        result = await repository.createRecipeEnforcingPlanLimit({
          id: recipeId,
          userId,
          title: content.title,
          content,
          originType: "manual",
          sourceUrl: source.sourceUrl,
          normalizedSourceUrl: source.normalizedSourceUrl,
          sourceName: source.sourceName,
          searchText: buildRecipeSearchText({ content, sourceName: source.sourceName }),
          createdAt: now,
          updatedAt: now,
        });
      } catch (error) {
        await deleteObjectsBestEffort(images, finalized.copiedKeys);
        throw error;
      }

      if (result.status === "limitExceeded") {
        await deleteObjectsBestEffort(images, finalized.copiedKeys);
        return recipeLimitExceededResponse();
      }

      const recipe = result.recipe;
      await deleteObjectsBestEffort(images, finalized.tmpKeys);

      return c.json(createRecipeResponseSchema.parse({ recipe: toRecipeDetail(recipe) }), 201);
    })
    .get("/", requireAuth(auth), async (c) => {
      const userId = c.get("userId");
      const query = listRecipesQuerySchema.safeParse(c.req.query());

      if (!query.success) {
        return validationFailedResponse(query.error.flatten());
      }

      const repository =
        recipeRepository ??
        createRecipeRepository(createDb(c.env.DATABASE_URL), {
          proPriceId: c.env.STRIPE_PRO_PRICE_ID,
          now: new Date(),
        });
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

      const images = imageService ?? createRecipeImageService(c.env);
      const itemsWithImages = await Promise.all(
        result.items.map(async (item) => {
          const base = toRecipeListItem(item);
          if (!item.locked && item.coverImageObjectKey) {
            try {
              const urlResult = await images.createSignedGetUrl({
                objectKey: item.coverImageObjectKey,
              });
              base.coverImageUrl = urlResult.url;
            } catch {
              // ignore
            }
          }
          return base;
        }),
      );

      return c.json(
        listRecipesResponseSchema.parse({
          items: itemsWithImages,
          nextCursor: result.nextCursor,
        }),
      );
    })
    .get("/:recipeId", requireAuth(auth), async (c) => {
      const userId = c.get("userId");
      const repository =
        recipeRepository ??
        createRecipeRepository(createDb(c.env.DATABASE_URL), {
          proPriceId: c.env.STRIPE_PRO_PRICE_ID,
          now: new Date(),
        });
      const recipe = await repository.getRecipe(userId, c.req.param("recipeId"));

      if (!recipe) {
        return notFoundResponse("Recipe was not found.");
      }

      if (recipe.locked) {
        return c.json(getRecipeResponseSchema.parse({ recipe: toLockedRecipeDetail(recipe) }));
      }

      const images = imageService ?? createRecipeImageService(c.env);
      const detail = toRecipeDetail(recipe);

      return c.json(
        getRecipeResponseSchema.parse({
          recipe: {
            ...detail,
            content: await attachRecipeImageUrls(recipe.content, images),
          },
        }),
      );
    })
    .put("/:recipeId", requireAuth(auth), async (c) => {
      const userId = c.get("userId");
      const rawBody = await c.req.json().catch(() => null);
      const request = updateRecipeRequestSchema.safeParse(rawBody);

      if (!request.success) {
        return validationFailedResponse(request.error.flatten());
      }

      const repository =
        recipeRepository ??
        createRecipeRepository(createDb(c.env.DATABASE_URL), {
          proPriceId: c.env.STRIPE_PRO_PRICE_ID,
          now: new Date(),
        });
      const existingRecipe = await repository.getRecipe(userId, c.req.param("recipeId"));

      if (!existingRecipe) {
        return notFoundResponse("Recipe was not found.");
      }

      if (existingRecipe.locked) {
        return lockedRecipeResponse();
      }

      const images = imageService ?? createRecipeImageService(c.env);
      let finalized: Awaited<ReturnType<typeof finalizeRecipeDraftImages>>;

      try {
        finalized = await finalizeRecipeDraftImages({
          draft: request.data.content,
          userId,
          recipeId: existingRecipe.id,
          imageService: images,
          existingContent: existingRecipe.content,
          createImageId,
        });
      } catch (error) {
        if (error instanceof RecipeImageFinalizeError) {
          return imageFinalizeFailedResponse();
        }

        throw error;
      }

      const content = finalized.content;
      let recipe: Awaited<ReturnType<RecipeRepository["updateRecipe"]>>;

      try {
        recipe = await repository.updateRecipe({
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
      } catch (error) {
        await deleteObjectsBestEffort(images, finalized.copiedKeys);
        throw error;
      }

      if (!recipe) {
        await deleteObjectsBestEffort(images, finalized.copiedKeys);
        return notFoundResponse("Recipe was not found.");
      }

      await deleteObjectsBestEffort(images, finalized.tmpKeys);
      await deleteObjectsBestEffort(
        images,
        getRemovedRecipeImageKeys(existingRecipe.content, content),
      );

      return c.json(updateRecipeResponseSchema.parse({ recipe: toRecipeDetail(recipe) }));
    })
    .delete("/:recipeId", requireAuth(auth), async (c) => {
      const userId = c.get("userId");
      const repository =
        recipeRepository ??
        createRecipeRepository(createDb(c.env.DATABASE_URL), {
          proPriceId: c.env.STRIPE_PRO_PRICE_ID,
          now: new Date(),
        });
      const deleted = await repository.deleteRecipe(userId, c.req.param("recipeId"));

      if (!deleted) {
        return notFoundResponse("Recipe was not found.");
      }

      const images = imageService ?? createRecipeImageService(c.env);
      try {
        await images.deletePrefixBestEffort(`recipes/${userId}/${c.req.param("recipeId")}/`);
      } catch {
        // Best-effort cleanup must not affect the recipe deletion result.
      }

      return c.json(deleteRecipeResponseSchema.parse({ ok: true }));
    });
};
