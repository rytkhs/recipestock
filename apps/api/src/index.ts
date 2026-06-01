import { Hono } from "hono";
import { unknownResponse } from "./api-error";
import { type AuthService, authService } from "./auth";
import { type ApiEnv } from "./context";
import { type RecipeImageService } from "./images";
import { type RecipeImportAIProvider, type RecipeImportFetcher } from "./import-url";
import { type MeRepository } from "./me";
import { type RecipeRepository } from "./recipes";
import { createAuthRoutes } from "./routes/auth";
import { createImageRoutes } from "./routes/images";
import { createImportRoutes } from "./routes/import";
import { createMeRoutes } from "./routes/me";
import { createRecipeRoutes } from "./routes/recipes";
import { createUsageRoutes } from "./routes/usage";
import { type UsageRepository } from "./usage";

type AppDependencies = {
  auth?: AuthService;
  meRepository?: MeRepository;
  usageRepository?: UsageRepository;
  recipeRepository?: RecipeRepository;
  imageService?: RecipeImageService;
  importAIProvider?: RecipeImportAIProvider;
  importFetcher?: RecipeImportFetcher;
  createRecipeId?: () => string;
  createImageId?: () => string;
  getCurrentMonth?: () => string;
  getCurrentDate?: () => Date;
};

export const createApp = (dependencies: AppDependencies = {}) => {
  const app = new Hono<ApiEnv>().basePath("/api");
  const auth = dependencies.auth ?? authService;

  app.onError(() => unknownResponse());

  return app
    .route("/auth", createAuthRoutes({ auth }))
    .route(
      "/images",
      createImageRoutes({
        auth,
        recipeRepository: dependencies.recipeRepository,
        imageService: dependencies.imageService,
        createImageId: dependencies.createImageId,
      }),
    )
    .route(
      "/import",
      createImportRoutes({
        auth,
        usageRepository: dependencies.usageRepository,
        aiProvider: dependencies.importAIProvider,
        fetcher: dependencies.importFetcher,
        getCurrentDate: dependencies.getCurrentDate,
      }),
    )
    .route(
      "/me",
      createMeRoutes({
        auth,
        meRepository: dependencies.meRepository,
        getCurrentMonth: dependencies.getCurrentMonth,
      }),
    )
    .route(
      "/usage",
      createUsageRoutes({
        auth,
        usageRepository: dependencies.usageRepository,
        getCurrentDate: dependencies.getCurrentDate,
      }),
    )
    .route(
      "/recipes",
      createRecipeRoutes({
        auth,
        recipeRepository: dependencies.recipeRepository,
        imageService: dependencies.imageService,
        createRecipeId: dependencies.createRecipeId,
        createImageId: dependencies.createImageId,
      }),
    );
};

const app = createApp();

export type AppType = ReturnType<typeof createApp>;
export default app;
