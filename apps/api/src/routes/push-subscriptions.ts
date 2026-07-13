import { createDb } from "@recipestock/db";
import {
  getPushSubscriptionsResponseSchema,
  pushSubscriptionRequestSchema,
  registerPushSubscriptionResponseSchema,
  revokePushSubscriptionRequestSchema,
  revokePushSubscriptionResponseSchema,
} from "@recipestock/schemas";
import { Hono } from "hono";
import { ulid } from "ulid";
import { forbiddenResponse, validationFailedResponse } from "../api-error";
import { type AuthService } from "../auth";
import { type ApiEnv } from "../context";
import { requireAuth } from "../middleware/auth";
import {
  createPushSubscriptionRepository,
  type PushSubscriptionRepository,
} from "../push-subscriptions";

type PushSubscriptionRouteDependencies = {
  auth: AuthService;
  pushSubscriptionRepository?: PushSubscriptionRepository;
  createId?: () => string;
  getCurrentDate?: () => Date;
};

export const createPushSubscriptionRoutes = ({
  auth,
  pushSubscriptionRepository,
  createId = ulid,
  getCurrentDate,
}: PushSubscriptionRouteDependencies) => {
  const routes = new Hono<ApiEnv>();
  const repositoryFor = (env: ApiEnv["Bindings"]) =>
    pushSubscriptionRepository ?? createPushSubscriptionRepository(createDb(env.DATABASE_URL));

  return routes
    .get("/", requireAuth(auth), async (c) => {
      const subscriptions = await repositoryFor(c.env).listByUser(c.get("userId"));
      return c.json(
        getPushSubscriptionsResponseSchema.parse({
          applicationServerKey: c.env.VAPID_PUBLIC_KEY,
          subscriptions,
        }),
      );
    })
    .post("/", requireAuth(auth), async (c) => {
      const rawBody = await c.req.json().catch(() => null);
      const request = pushSubscriptionRequestSchema.safeParse(rawBody);
      if (!request.success) {
        return validationFailedResponse(request.error.flatten());
      }

      const subscription = await repositoryFor(c.env).register({
        id: createId(),
        userId: c.get("userId"),
        endpoint: request.data.endpoint,
        expirationTime: request.data.expirationTime,
        p256dh: request.data.keys.p256dh,
        auth: request.data.keys.auth,
        now: getCurrentDate?.() ?? new Date(),
      });
      if (!subscription) {
        return forbiddenResponse("Push subscription belongs to another user.");
      }

      return c.json(registerPushSubscriptionResponseSchema.parse({ subscription }));
    })
    .delete("/", requireAuth(auth), async (c) => {
      const rawBody = await c.req.json().catch(() => null);
      const request = revokePushSubscriptionRequestSchema.safeParse(rawBody);
      if (!request.success) {
        return validationFailedResponse(request.error.flatten());
      }

      await repositoryFor(c.env).revoke({
        userId: c.get("userId"),
        endpoint: request.data.endpoint,
      });
      return c.json(revokePushSubscriptionResponseSchema.parse({ revoked: true }));
    });
};
