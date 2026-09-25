import { createMiddleware } from "hono/factory";
import { unauthorizedResponse } from "../api-error";
import { type AuthService } from "../auth";
import { type ApiEnv } from "../context";

export const requireAuth = (auth: AuthService) =>
  createMiddleware<ApiEnv>(async (c, next) => {
    const { session, setCookies } = await auth.getSession(c.req.raw, c.env);

    if (!session) {
      const response = unauthorizedResponse();
      for (const cookie of setCookies) response.headers.append("set-cookie", cookie);
      return response;
    }

    c.set("authSession", session);
    c.set("userId", session.user.id);
    await next();

    // cookie cacheが切れてDBを引いたrequestは、再発行されたcookieを返して後続のrequestをcacheに戻す。
    for (const cookie of setCookies) c.header("set-cookie", cookie, { append: true });
  });
