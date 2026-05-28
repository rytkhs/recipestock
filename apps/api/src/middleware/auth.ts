import { createMiddleware } from "hono/factory";
import { unauthorizedResponse } from "../api-error";
import { type AuthService } from "../auth";
import { type ApiEnv } from "../context";

export const requireAuth = (auth: AuthService) =>
  createMiddleware<ApiEnv>(async (c, next) => {
    const session = await auth.getSession(c.req.raw, c.env);

    if (!session) {
      return unauthorizedResponse();
    }

    c.set("authSession", session);
    c.set("userId", session.user.id);
    await next();
  });
