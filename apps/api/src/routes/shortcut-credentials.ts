import {
  issueShortcutCredentialResponseSchema,
  listShortcutCredentialsResponseSchema,
  revokeShortcutCredentialResponseSchema,
} from "@recipestock/schemas";
import { Hono } from "hono";
import { notFoundResponse } from "../api-error";
import { type AuthService } from "../auth";
import { type ApiEnv } from "../context";
import { requireAuth } from "../middleware/auth";
import { type ShortcutCredentials } from "../shortcut-credentials";

type ShortcutCredentialRouteDependencies = {
  auth: AuthService;
  shortcutCredentialsFor: (env: ApiEnv["Bindings"]) => ShortcutCredentials;
};

export const createShortcutCredentialRoutes = ({
  auth,
  shortcutCredentialsFor,
}: ShortcutCredentialRouteDependencies) => {
  const routes = new Hono<ApiEnv>();

  return (
    routes
      .get("/", requireAuth(auth), async (c) => {
        const credentials = await shortcutCredentialsFor(c.env).list(c.get("userId"));
        return c.json(listShortcutCredentialsResponseSchema.parse({ credentials }));
      })
      /**
       * 端末名は初回の共有でShortcutから届くため、発行にrequest bodyは要らない (ADR 0025)。
       */
      .post("/", requireAuth(auth), async (c) => {
        const result = await shortcutCredentialsFor(c.env).issue({ userId: c.get("userId") });
        return c.json(issueShortcutCredentialResponseSchema.parse(result), 201);
      })
      .delete("/:credentialId", requireAuth(auth), async (c) => {
        const revoked = await shortcutCredentialsFor(c.env).revoke({
          credentialId: c.req.param("credentialId"),
          userId: c.get("userId"),
        });
        if (!revoked) {
          return notFoundResponse("Shortcut credential was not found.");
        }
        return c.json(revokeShortcutCredentialResponseSchema.parse({ revoked: true }));
      })
  );
};
