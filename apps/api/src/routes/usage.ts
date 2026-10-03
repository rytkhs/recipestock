import { getAiUsageResponseSchema } from "@recipestock/schemas";
import { Hono } from "hono";
import { type AuthService } from "../auth";
import { type ApiEnv } from "../context";
import { requireAuth } from "../middleware/auth";
import {
  buildAiUsageResponse,
  getCurrentJstMonth,
  getNextJstMonthResetAt,
  resolveAiMonthlyLimit,
  type UsageRepository,
} from "../usage";

type UsageRouteDependencies = {
  auth: AuthService;
  usageRepositoryFor: (env: ApiEnv["Bindings"]) => UsageRepository;
  getCurrentDate?: () => Date;
};

export const createUsageRoutes = ({
  auth,
  usageRepositoryFor,
  getCurrentDate,
}: UsageRouteDependencies) => {
  const routes = new Hono<ApiEnv>();

  return routes.get("/ai", requireAuth(auth), async (c) => {
    const userId = c.get("userId");
    const currentDate = getCurrentDate?.() ?? new Date();
    const repository = usageRepositoryFor(c.env);
    const month = getCurrentJstMonth(currentDate);
    const [plan, storedUsage] = await Promise.all([
      repository.getAppUserPlan(userId),
      repository.getAiUsage(userId, month),
    ]);
    const usage = storedUsage ?? { month, used: 0 };
    const limit = resolveAiMonthlyLimit(plan, c.env);

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
