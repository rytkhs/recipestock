import { createDb } from "@recipestock/db";
import { getMeResponseSchema } from "@recipestock/schemas";
import { Hono } from "hono";
import { type AuthService } from "../auth";
import { type ApiEnv } from "../context";
import { buildMeResponse, createMeRepository, type MeRepository } from "../me";
import { requireAuth } from "../middleware/auth";
import { getCurrentJstMonth, resolveAiMonthlyLimit } from "../usage";

type MeRouteDependencies = {
  auth: AuthService;
  meRepository?: MeRepository;
  getCurrentMonth?: () => string;
};

export const createMeRoutes = ({ auth, meRepository, getCurrentMonth }: MeRouteDependencies) => {
  const routes = new Hono<ApiEnv>();

  return routes.get("/", requireAuth(auth), async (c) => {
    const userId = c.get("userId");
    const repository = meRepository ?? createMeRepository(createDb(c.env.DATABASE_URL));
    const month = getCurrentMonth?.() ?? getCurrentJstMonth();
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
          aiUsage: storedAiUsage ?? { month, used: 0 },
          aiUsageLimit: resolveAiMonthlyLimit(appUser.plan, c.env),
        }),
      ),
    );
  });
};
