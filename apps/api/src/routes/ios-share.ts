import { zValidator } from "@hono/zod-validator";
import { createDb } from "@recipestock/db";
import {
  createIosShareChannelRequestSchema,
  createIosShareChannelResponseSchema,
  createIosShareHandoffRequestSchema,
  createIosShareHandoffResponseSchema,
  deliverIosShareHandoffRequestSchema,
  deliverIosShareHandoffResponseSchema,
  getIosShareHandoffStatusResponseSchema,
  getPendingIosShareHandoffResponseSchema,
  listIosShareChannelsResponseSchema,
  revokeIosShareChannelResponseSchema,
} from "@recipestock/schemas";
import { Hono } from "hono";
import { ulid } from "ulid";
import { z } from "zod";
import { notFoundResponse, unauthorizedResponse, validationFailedResponse } from "../api-error";
import { type AuthService } from "../auth";
import { type ApiEnv } from "../context";
import {
  createIosShareRepository,
  createIosShareService,
  createIosShareToken,
  type IosShareService,
} from "../ios-share";
import { requireAuth } from "../middleware/auth";

type IosShareRouteDependencies = {
  auth: AuthService;
  iosShareService?: IosShareService;
  createId?: () => string;
  createToken?: () => string;
  getCurrentDate?: () => Date;
};

const bearerToken = (header: string | undefined) => {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

export const createIosShareRoutes = ({
  auth,
  iosShareService,
  createId = ulid,
  createToken = createIosShareToken,
  getCurrentDate,
}: IosShareRouteDependencies) => {
  const routes = new Hono<ApiEnv>();
  const serviceFor = (env: ApiEnv["Bindings"]) =>
    iosShareService ?? createIosShareService(createIosShareRepository(createDb(env.DATABASE_URL)));
  const now = () => getCurrentDate?.() ?? new Date();

  return routes
    .get("/channels", requireAuth(auth), async (c) => {
      const channels = await serviceFor(c.env).listChannels(c.get("userId"));
      return c.json(listIosShareChannelsResponseSchema.parse({ channels }));
    })
    .post("/channels", requireAuth(auth), async (c) => {
      const rawBody = await c.req.json().catch(() => null);
      const request = createIosShareChannelRequestSchema.safeParse(rawBody);
      if (!request.success) {
        return validationFailedResponse(request.error.flatten());
      }

      const result = await serviceFor(c.env).provisionChannel({
        id: createId(),
        userId: c.get("userId"),
        name: request.data.name,
        token: createToken(),
        now: now(),
      });
      return c.json(createIosShareChannelResponseSchema.parse(result), 201);
    })
    .delete("/channels/:channelId", requireAuth(auth), async (c) => {
      const revoked = await serviceFor(c.env).revokeChannel({
        channelId: c.req.param("channelId"),
        userId: c.get("userId"),
        now: now(),
      });
      if (!revoked) {
        return notFoundResponse("iOS share channel was not found.");
      }
      return c.json(revokeIosShareChannelResponseSchema.parse({ revoked: true }));
    })
    .post("/shortcut/handoffs", async (c) => {
      const token = bearerToken(c.req.header("authorization"));
      if (!token) {
        return unauthorizedResponse();
      }

      const rawBody = await c.req.json().catch(() => null);
      const request = createIosShareHandoffRequestSchema.safeParse(rawBody);
      if (!request.success) {
        return validationFailedResponse(request.error.flatten());
      }

      const result = await serviceFor(c.env).submitHandoff({
        id: createId(),
        token,
        url: request.data.url,
        origin: new URL(c.env.BETTER_AUTH_URL).origin,
        now: now(),
      });
      if (!result) {
        return unauthorizedResponse();
      }
      return c.json(createIosShareHandoffResponseSchema.parse(result), 201);
    })
    .get("/shortcut/handoffs/:handoffId", async (c) => {
      const token = bearerToken(c.req.header("authorization"));
      if (!token) {
        return unauthorizedResponse();
      }
      const status = await serviceFor(c.env).inspectHandoff({
        handoffId: c.req.param("handoffId"),
        token,
        now: now(),
      });
      if (!status) {
        return notFoundResponse("Share handoff was not found.");
      }
      return c.json(getIosShareHandoffStatusResponseSchema.parse({ status }));
    })
    .get("/handoffs/pending", requireAuth(auth), async (c) => {
      const handoff = await serviceFor(c.env).findPendingHandoff({
        userId: c.get("userId"),
        now: now(),
      });
      return c.json(getPendingIosShareHandoffResponseSchema.parse({ handoff }));
    })
    .patch(
      "/handoffs/:handoffId/delivery",
      requireAuth(auth),
      zValidator("json", deliverIosShareHandoffRequestSchema, (result) =>
        result.success ? undefined : validationFailedResponse(z.flattenError(result.error)),
      ),
      async (c) => {
        const request = c.req.valid("json");
        const status = await serviceFor(c.env).deliverHandoff({
          handoffId: c.req.param("handoffId"),
          userId: c.get("userId"),
          target: request.target,
          now: now(),
        });
        if (!status) {
          return notFoundResponse("Share handoff was not found.");
        }
        return c.json(deliverIosShareHandoffResponseSchema.parse({ status }));
      },
    );
};
