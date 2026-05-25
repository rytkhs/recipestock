import { createDb } from "@recipestock/db";
import { getMeResponseSchema } from "@recipestock/schemas";
import { Hono } from "hono";
import { type AuthService, authService } from "./auth";
import { type Bindings } from "./env";
import { buildMeResponse, createMeRepository, getCurrentJstMonth, type MeRepository } from "./me";

type AppDependencies = {
  auth?: AuthService;
  meRepository?: MeRepository;
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
    });

  return routes;
};

const app = createApp();

export type AppType = ReturnType<typeof createApp>;
export default app;
