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
import { type AuthService, authService } from "./auth";
import { type Bindings } from "./env";
import { buildMeResponse, createMeRepository, getCurrentJstMonth, type MeRepository } from "./me";
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

const unauthorizedResponse = () =>
  Response.json(
    {
      error: {
        code: "unauthorized",
        message: "Authentication is required.",
      },
    },
    { status: 401 },
  );

const validationFailedResponse = (details: unknown) =>
  Response.json(
    {
      error: {
        code: "validation_failed",
        message: "Request validation failed.",
        details,
      },
    },
    { status: 400 },
  );

export const createApp = (dependencies: AppDependencies = {}) => {
  const app = new Hono<{ Bindings: Bindings }>().basePath("/api");

  const routes = app
    .get("/health", (c) => {
      return c.json({
        ok: true,
        environment: c.env?.APP_ENV ?? "development",
      });
    })
    .on(["GET", "POST"], "/auth/*", (c) => {
      const auth = dependencies.auth ?? authService;
      return auth.handleAuthRequest(c.req.raw, c.env);
    })
    .get("/me", async (c) => {
      const auth = dependencies.auth ?? authService;
      const session = await auth.getSession(c.req.raw, c.env);

      if (!session) {
        return unauthorizedResponse();
      }

      const repository =
        dependencies.meRepository ?? createMeRepository(createDb(c.env.DATABASE_URL));
      const month = dependencies.getCurrentMonth?.() ?? getCurrentJstMonth();
      const appUser = await repository.getOrCreateAppUser(session.user.id);
      const [recipeCount, storedAiUsage] = await Promise.all([
        repository.countRecipes(session.user.id),
        repository.getAiUsage(session.user.id, month),
      ]);

      return c.json(
        getMeResponseSchema.parse(
          buildMeResponse({
            userId: session.user.id,
            plan: appUser.plan,
            recipeCount,
            aiUsage: storedAiUsage ?? { month, count: 0 },
          }),
        ),
      );
    })
    .post("/recipes", async (c) => {
      const auth = dependencies.auth ?? authService;
      const session = await auth.getSession(c.req.raw, c.env);

      if (!session) {
        return unauthorizedResponse();
      }

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
        userId: session.user.id,
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
        return Response.json(
          {
            error: {
              code: "recipe_limit_exceeded",
              message: "Recipe limit exceeded.",
            },
          },
          { status: 403 },
        );
      }

      const recipe = result.recipe;

      return c.json(createRecipeResponseSchema.parse({ recipe: toRecipeDetail(recipe) }), 201);
    })
    .get("/recipes", async (c) => {
      const auth = dependencies.auth ?? authService;
      const session = await auth.getSession(c.req.raw, c.env);

      if (!session) {
        return unauthorizedResponse();
      }

      const query = listRecipesQuerySchema.safeParse(c.req.query());

      if (!query.success) {
        return validationFailedResponse(query.error.flatten());
      }

      const repository =
        dependencies.recipeRepository ?? createRecipeRepository(createDb(c.env.DATABASE_URL));
      let result: ListRecipesResult;

      try {
        result = await repository.listRecipes({
          userId: session.user.id,
          searchTerms: normalizeRecipeSearchTerms(query.data.q),
          limit: query.data.limit,
          cursor: query.data.cursor ?? null,
        });
      } catch (error) {
        if (error instanceof InvalidRecipeListCursorError) {
          return validationFailedResponse({
            fieldErrors: {
              cursor: [error.message],
            },
            formErrors: [],
          });
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
    .get("/recipes/:recipeId", async (c) => {
      const auth = dependencies.auth ?? authService;
      const session = await auth.getSession(c.req.raw, c.env);

      if (!session) {
        return unauthorizedResponse();
      }

      const repository =
        dependencies.recipeRepository ?? createRecipeRepository(createDb(c.env.DATABASE_URL));
      const recipe = await repository.getRecipe(session.user.id, c.req.param("recipeId"));

      if (!recipe) {
        return Response.json(
          {
            error: {
              code: "not_found",
              message: "Recipe was not found.",
            },
          },
          { status: 404 },
        );
      }

      return c.json(getRecipeResponseSchema.parse({ recipe: toRecipeDetail(recipe) }));
    });

  return routes;
};

const app = createApp();

export type AppType = ReturnType<typeof createApp>;
export default app;
