import { Hono } from "hono";
import { type ApiEnv } from "../context";

export const createHealthRoutes = () => {
  const routes = new Hono<ApiEnv>();

  return routes.get("/", (c) => {
    return c.json({
      ok: true,
      environment: c.env?.APP_ENV ?? "development",
    });
  });
};
