import { createDb } from "@recipestock/db";
import { getAiUsageResponseSchema } from "@recipestock/schemas";
import { Hono } from "hono";
import { type AuthService } from "../auth";
import { type ApiEnv } from "../context";
import { requireAuth } from "../middleware/auth";
import {
  buildAiUsageResponse,
  createUsageRepository,
  getCurrentJstMonth,
  getNextJstMonthResetAt,
  resolveAiMonthlyLimit,
  type UsageRepository,
} from "../usage";

type UsageRouteDependencies = {
  auth: AuthService;
  usageRepository?: UsageRepository;
  getCurrentDate?: () => Date;
};

export const createUsageRoutes = ({
  auth,
  usageRepository,
  getCurrentDate,
}: UsageRouteDependencies) => {
  const routes = new Hono<ApiEnv>();

  return routes.get("/ai", requireAuth(auth), async (c) => {
    const userId = c.get("userId");
    const repository = usageRepository ?? createUsageRepository(createDb(c.env.DATABASE_URL));
    const currentDate = getCurrentDate?.() ?? new Date();
    const month = getCurrentJstMonth(currentDate);
    const appUser = await repository.getOrCreateAppUser(userId);
    const usage = (await repository.getAiUsage(userId, month)) ?? { month, used: 0 };
    const limit = resolveAiMonthlyLimit(appUser.plan, c.env);

    return c.json(
      getAiUsageResponseSchema.parse(
        buildAiUsageResponse({
          ...usage,
          limit,
          resetAt: getNextJstMonthResetAt(currentDate),
        }),
      ),
    );
  });
};
