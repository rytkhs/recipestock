import { Hono } from "hono";
import { type Bindings } from "./env";

const app = new Hono<{ Bindings: Bindings }>().basePath("/api");

const routes = app.get("/health", (c) => {
  return c.json({
    ok: true,
    environment: c.env?.APP_ENV ?? "development",
  });
});

export type AppType = typeof routes;
export default app;
