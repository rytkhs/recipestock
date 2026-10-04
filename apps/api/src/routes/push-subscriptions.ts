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
import { type PushSubscriptionRepository } from "../push-subscriptions";

type PushSubscriptionRouteDependencies = {
  auth: AuthService;
  pushSubscriptionRepositoryFor: (env: ApiEnv["Bindings"]) => PushSubscriptionRepository;
  createId?: () => string;
  getCurrentDate: () => Date;
};

export const createPushSubscriptionRoutes = ({
  auth,
  pushSubscriptionRepositoryFor,
  createId = ulid,
  getCurrentDate,
}: PushSubscriptionRouteDependencies) => {
  const routes = new Hono<ApiEnv>();

  return routes
    .get("/", requireAuth(auth), async (c) => {
      const subscriptions = await pushSubscriptionRepositoryFor(c.env).listByUser(c.get("userId"));
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

      const subscription = await pushSubscriptionRepositoryFor(c.env).register({
        id: createId(),
        userId: c.get("userId"),
        endpoint: request.data.endpoint,
        expirationTime: request.data.expirationTime,
        p256dh: request.data.keys.p256dh,
        auth: request.data.keys.auth,
        now: getCurrentDate(),
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

      await pushSubscriptionRepositoryFor(c.env).revoke({
        userId: c.get("userId"),
        endpoint: request.data.endpoint,
      });
      return c.json(revokePushSubscriptionResponseSchema.parse({ revoked: true }));
    });
};
