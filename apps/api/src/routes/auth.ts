import { Hono } from "hono";
import { type AuthService } from "../auth";
import { type ApiEnv } from "../context";

type AuthRouteDependencies = {
  auth: AuthService;
};

export const createAuthRoutes = ({ auth }: AuthRouteDependencies) => {
  const routes = new Hono<ApiEnv>();

  return routes.on(["GET", "POST"], "/*", (c) => {
    return auth.handleAuthRequest(c.req.raw, c.env);
  });
};
