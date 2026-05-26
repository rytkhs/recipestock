import { type AppType } from "@recipestock/api";
import { type ClientResponse, hc, parseResponse } from "hono/client";

export const api = hc<AppType>("/", {
  init: {
    credentials: "include",
  },
});

export const parseApiResponse = async <T>(response: Promise<ClientResponse<unknown>>) => {
  return (await parseResponse(response)) as T;
};
