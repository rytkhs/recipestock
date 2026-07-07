import {
  createImageUploadUrlRequestSchema,
  createImageUploadUrlResponseSchema,
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
  createRecipeImageObjectResponse,
  createRecipeImageService,
  imageExtensionFromContentType,
  type RecipeImageService,
  recipeIdFromImageObjectKey,
} from "../images";
import { requireAuth } from "../middleware/auth";
import { createRecipeId as createDefaultImageId } from "../recipes";

type ImageRouteDependencies = {
  auth: AuthService;
  imageService?: RecipeImageService;
  createImageId?: () => string;
};

const IMAGE_OBJECT_ROUTE_PREFIX = "/api/images/object/";

const objectKeyFromImageObjectPath = (pathname: string) => {
  if (!pathname.startsWith(IMAGE_OBJECT_ROUTE_PREFIX)) {
    return null;
  }

  const encodedObjectKey = pathname.slice(IMAGE_OBJECT_ROUTE_PREFIX.length);

  if (!encodedObjectKey) {
    return null;
  }

  try {
    return encodedObjectKey.split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
};

export const createImageRoutes = ({
  auth,
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
    .get("/object/*", requireAuth(auth), async (c) => {
      const userId = c.get("userId");
      const objectKey = objectKeyFromImageObjectPath(new URL(c.req.url).pathname);

      if (!objectKey) {
        return notFoundResponse("Image was not found.");
      }

      const recipeId = recipeIdFromImageObjectKey(userId, objectKey);

      if (!recipeId) {
        return forbiddenResponse();
      }

      return (
        (await createRecipeImageObjectResponse({
          bucket: c.env.RECIPE_IMAGES,
          objectKey,
          requestHeaders: c.req.raw.headers,
        })) ?? notFoundResponse("Image was not found.")
      );
    });
};
