import { createDb } from "@recipestock/db";
import {
  deleteTagResponseSchema,
  listTagsResponseSchema,
  mergeTagRequestSchema,
  mergeTagResponseSchema,
  renameTagRequestSchema,
  renameTagResponseSchema,
} from "@recipestock/schemas";
import { Hono } from "hono";
import {
  invalidTagNameResponse,
  notFoundResponse,
  tagNameConflictResponse,
  validationFailedResponse,
} from "../api-error";
import { type AuthService } from "../auth";
import { type ApiEnv } from "../context";
import { requireAuth } from "../middleware/auth";
import { createTagRepository, normalizeRequestedTagName, type TagRepository } from "../tags";

type TagRouteDependencies = {
  auth: AuthService;
  tagRepository?: TagRepository;
};

export const createTagRoutes = ({ auth, tagRepository }: TagRouteDependencies) => {
  const routes = new Hono<ApiEnv>();

  return routes
    .get("/", requireAuth(auth), async (c) => {
      const repository = tagRepository ?? createTagRepository(createDb(c.env.DATABASE_URL));
      const tags = await repository.listTags(c.get("userId"));

      return c.json(listTagsResponseSchema.parse({ tags }));
    })
    .patch("/:tagId", requireAuth(auth), async (c) => {
      const rawBody = await c.req.json().catch(() => null);
      const request = renameTagRequestSchema.safeParse(rawBody);

      if (!request.success) {
        return validationFailedResponse(request.error.flatten());
      }

      const name = normalizeRequestedTagName(request.data.name);

      if (!name) {
        return invalidTagNameResponse("name");
      }

      const repository = tagRepository ?? createTagRepository(createDb(c.env.DATABASE_URL));
      const result = await repository.renameTag({
        userId: c.get("userId"),
        tagId: c.req.param("tagId"),
        name,
        now: new Date(),
      });

      if (result.status === "notFound") {
        return notFoundResponse("Tag was not found.");
      }

      if (result.status === "conflict") {
        return tagNameConflictResponse(result.tag);
      }

      return c.json(renameTagResponseSchema.parse({ tag: result.tag }));
    })
    .post("/:tagId/merge", requireAuth(auth), async (c) => {
      const tagId = c.req.param("tagId");
      const rawBody = await c.req.json().catch(() => null);
      const request = mergeTagRequestSchema.safeParse(rawBody);

      if (!request.success) {
        return validationFailedResponse(request.error.flatten());
      }

      if (request.data.intoTagId === tagId) {
        return validationFailedResponse({
          formErrors: [],
          fieldErrors: { intoTagId: ["A tag cannot be merged into itself."] },
        });
      }

      const repository = tagRepository ?? createTagRepository(createDb(c.env.DATABASE_URL));
      const result = await repository.mergeTag({
        userId: c.get("userId"),
        tagId,
        intoTagId: request.data.intoTagId,
      });

      if (result.status === "notFound") {
        return notFoundResponse("Tag was not found.");
      }

      return c.json(mergeTagResponseSchema.parse({ tag: result.tag }));
    })
    .delete("/:tagId", requireAuth(auth), async (c) => {
      const repository = tagRepository ?? createTagRepository(createDb(c.env.DATABASE_URL));
      const deleted = await repository.deleteTag(c.get("userId"), c.req.param("tagId"));

      if (!deleted) {
        return notFoundResponse("Tag was not found.");
      }

      return c.json(deleteTagResponseSchema.parse({ ok: true }));
    });
};
