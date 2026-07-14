import { createDb } from "@recipestock/db";
import {
  issueShortcutCredentialRequestSchema,
  issueShortcutCredentialResponseSchema,
  listShortcutCredentialsResponseSchema,
  revokeShortcutCredentialResponseSchema,
} from "@recipestock/schemas";
import { Hono } from "hono";
import { notFoundResponse, validationFailedResponse } from "../api-error";
import { type AuthService } from "../auth";
import { type ApiEnv } from "../context";
import { requireAuth } from "../middleware/auth";
import {
  createShortcutCredentialRepository,
  createShortcutCredentials,
  type ShortcutCredentials,
} from "../shortcut-credentials";

type ShortcutCredentialRouteDependencies = {
  auth: AuthService;
  shortcutCredentials?: ShortcutCredentials;
};

export const createShortcutCredentialRoutes = ({
  auth,
  shortcutCredentials,
}: ShortcutCredentialRouteDependencies) => {
  const routes = new Hono<ApiEnv>();
  const credentialsFor = (env: ApiEnv["Bindings"]) =>
    shortcutCredentials ??
    createShortcutCredentials({
      repository: createShortcutCredentialRepository(createDb(env.DATABASE_URL)),
    });

  return routes
    .get("/", requireAuth(auth), async (c) => {
      const credentials = await credentialsFor(c.env).list(c.get("userId"));
      return c.json(listShortcutCredentialsResponseSchema.parse({ credentials }));
    })
    .post("/", requireAuth(auth), async (c) => {
      const rawBody = await c.req.json().catch(() => null);
      const request = issueShortcutCredentialRequestSchema.safeParse(rawBody);
      if (!request.success) {
        return validationFailedResponse(request.error.flatten());
      }

      const result = await credentialsFor(c.env).issue({
        userId: c.get("userId"),
        name: request.data.name,
      });
      return c.json(issueShortcutCredentialResponseSchema.parse(result), 201);
    })
    .delete("/:credentialId", requireAuth(auth), async (c) => {
      const revoked = await credentialsFor(c.env).revoke({
        credentialId: c.req.param("credentialId"),
        userId: c.get("userId"),
      });
      if (!revoked) {
        return notFoundResponse("Shortcut credential was not found.");
      }
      return c.json(revokeShortcutCredentialResponseSchema.parse({ revoked: true }));
    });
};
