import { type AppType } from "@recipestock/api";
import { hc } from "hono/client";

export const api = hc<AppType>("/");
