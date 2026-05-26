import { createDb } from "@recipestock/db";
import {
  createRecipeRequestSchema,
  createRecipeResponseSchema,
  getMeResponseSchema,
  getRecipeResponseSchema,
} from "@recipestock/schemas";
import { Hono } from "hono";
import { type AuthService, authService } from "./auth";
import { type Bindings } from "./env";
import { buildMeResponse, createMeRepository, getCurrentJstMonth, type MeRepository } from "./me";
import {
  buildRecipeSearchText,
  createRecipeId as createDefaultRecipeId,
  createRecipeRepository,
  normalizeRecipeSource,
  type RecipeRepository,
  toRecipeContent,
  toRecipeDetail,
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

      const db =
        dependencies.meRepository || dependencies.recipeRepository
          ? null
          : createDb(c.env.DATABASE_URL);
      const meRepository =
        dependencies.meRepository ?? createMeRepository(db ?? createDb(c.env.DATABASE_URL));
      const appUser = await meRepository.getOrCreateAppUser(session.user.id);
      const recipeCount = await meRepository.countRecipes(session.user.id);

      if (appUser.plan === "free" && recipeCount >= 5) {
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

      const repository =
        dependencies.recipeRepository ?? createRecipeRepository(db ?? createDb(c.env.DATABASE_URL));
      const content = toRecipeContent(request.data.content);
      const source = normalizeRecipeSource(request.data.source);
      const now = new Date();
      const recipe = await repository.createRecipe({
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

      return c.json(createRecipeResponseSchema.parse({ recipe: toRecipeDetail(recipe) }), 201);
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
