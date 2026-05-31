import { createDb } from "@recipestock/db";
import {
  createImageUploadUrlRequestSchema,
  createImageUploadUrlResponseSchema,
  getImageSignedUrlQuerySchema,
  getImageSignedUrlResponseSchema,
  imageContentTypeSchema,
  MAX_IMAGE_UPLOAD_SIZE_BYTES,
} from "@recipestock/schemas";
import { Hono } from "hono";
import {
  forbiddenResponse,
  imageTooLargeResponse,
  invalidImageTypeResponse,
  notFoundResponse,
  validationFailedResponse,
} from "../api-error";
import { type AuthService } from "../auth";
import { type ApiEnv } from "../context";
import {
  createRecipeImageService,
  getRecipeImageKeys,
  imageExtensionFromContentType,
  type RecipeImageService,
  recipeIdFromImageObjectKey,
} from "../images";
import { requireAuth } from "../middleware/auth";
import {
  createRecipeId as createDefaultImageId,
  createRecipeRepository,
  type RecipeRepository,
} from "../recipes";

type ImageRouteDependencies = {
  auth: AuthService;
  recipeRepository?: RecipeRepository;
  imageService?: RecipeImageService;
  createImageId?: () => string;
};

export const createImageRoutes = ({
  auth,
  recipeRepository,
  imageService,
  createImageId,
}: ImageRouteDependencies) => {
  const routes = new Hono<ApiEnv>();

  return routes
    .post("/upload-url", requireAuth(auth), async (c) => {
      const userId = c.get("userId");
      const rawBody = await c.req.json().catch(() => null);

      if (
        rawBody &&
        typeof rawBody === "object" &&
        !imageContentTypeSchema.safeParse((rawBody as { contentType?: unknown }).contentType)
          .success
      ) {
        return invalidImageTypeResponse();
      }

      if (
        rawBody &&
        typeof rawBody === "object" &&
        typeof (rawBody as { sizeBytes?: unknown }).sizeBytes === "number" &&
        (rawBody as { sizeBytes: number }).sizeBytes > MAX_IMAGE_UPLOAD_SIZE_BYTES
      ) {
        return imageTooLargeResponse();
      }

      const request = createImageUploadUrlRequestSchema.safeParse(rawBody);

      if (!request.success) {
        return validationFailedResponse(request.error.flatten());
      }

      const objectKey = `tmp/${userId}/${createImageId?.() ?? createDefaultImageId()}.${imageExtensionFromContentType(
        request.data.contentType,
      )}`;
      const images = imageService ?? createRecipeImageService(c.env);
      const uploadUrl = await images.createUploadUrl({
        objectKey,
        contentType: request.data.contentType,
      });

      return c.json(
        createImageUploadUrlResponseSchema.parse({
          uploadUrl: uploadUrl.url,
          objectKey,
          expiresAt: uploadUrl.expiresAt.toISOString(),
        }),
      );
    })
    .get("/signed-url", requireAuth(auth), async (c) => {
      const userId = c.get("userId");
      const query = getImageSignedUrlQuerySchema.safeParse(c.req.query());

      if (!query.success) {
        return validationFailedResponse(query.error.flatten());
      }

      const recipeId = recipeIdFromImageObjectKey(userId, query.data.key);

      if (!recipeId) {
        return forbiddenResponse();
      }

      const repository = recipeRepository ?? createRecipeRepository(createDb(c.env.DATABASE_URL));
      const recipe = await repository.getRecipe(userId, recipeId);

      if (!recipe) {
        return notFoundResponse("Recipe was not found.");
      }

      if (!getRecipeImageKeys(recipe.content).has(query.data.key)) {
        return forbiddenResponse();
      }

      const images = imageService ?? createRecipeImageService(c.env);
      const signedUrl = await images.createSignedGetUrl({ objectKey: query.data.key });

      return c.json(
        getImageSignedUrlResponseSchema.parse({
          url: signedUrl.url,
          expiresAt: signedUrl.expiresAt.toISOString(),
        }),
      );
    });
};
