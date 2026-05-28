import { Hono } from "hono";
import { type AuthService, authService } from "./auth";
import { type ApiEnv } from "./context";
import { type MeRepository } from "./me";
import { type RecipeRepository } from "./recipes";
import { createAuthRoutes } from "./routes/auth";
import { createHealthRoutes } from "./routes/health";
import { createMeRoutes } from "./routes/me";
import { createRecipeRoutes } from "./routes/recipes";

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

  return app
    .route("/health", createHealthRoutes())
    .route("/auth", createAuthRoutes({ auth }))
    .route(
      "/me",
      createMeRoutes({
        auth,
        meRepository: dependencies.meRepository,
        getCurrentMonth: dependencies.getCurrentMonth,
      }),
    )
    .route(
      "/recipes",
      createRecipeRoutes({
        auth,
        recipeRepository: dependencies.recipeRepository,
        createRecipeId: dependencies.createRecipeId,
      }),
    );
};

const app = createApp();

export type AppType = ReturnType<typeof createApp>;
export default app;
