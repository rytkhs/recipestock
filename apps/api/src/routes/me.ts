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
  getCurrentDate?: () => Date;
};

export const createMeRoutes = ({
  auth,
  meRepository,
  getCurrentMonth,
  getCurrentDate,
}: MeRouteDependencies) => {
  const routes = new Hono<ApiEnv>();

  return routes.get("/", requireAuth(auth), async (c) => {
    const userId = c.get("userId");
    const now = getCurrentDate?.() ?? new Date();
    const repository =
      meRepository ??
      createMeRepository(createDb(c.env.DATABASE_URL), {
        proPriceId: c.env.STRIPE_PRO_PRICE_ID,
        now,
      });
    const month = getCurrentMonth?.() ?? getCurrentJstMonth(now);
    // planはcountともusageとも独立なので、同じ波で引く。
    const [plan, recipeCount, storedAiUsage] = await Promise.all([
      repository.getAppUserPlan(userId),
      repository.countRecipes(userId),
      repository.getAiUsage(userId, month),
    ]);

    return c.json(
      getMeResponseSchema.parse(
        buildMeResponse({
          userId,
          email: c.get("authSession").user.email,
          plan,
          recipeCount,
          aiUsage: storedAiUsage ?? { month, used: 0 },
          aiUsageLimit: resolveAiMonthlyLimit(plan, c.env),
        }),
      ),
    );
  });
};
