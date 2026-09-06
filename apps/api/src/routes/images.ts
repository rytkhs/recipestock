import {
  createImageUploadUrlRequestSchema,
  createImageUploadUrlResponseSchema,
  imageContentTypeSchema,
  MAX_IMAGE_UPLOAD_SIZE_BYTES,
} from "@recipestock/schemas";
import { Hono } from "hono";
import {
  apiErrorResponse,
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
import { parseRecipeImageKey } from "../recipe-image-keys";
import {
  createRecipeThumbnailResponse,
  getImagesErrorCode,
  isUnsupportedRecipeThumbnailSourceError,
  RECIPE_THUMBNAIL_VERSION,
} from "../recipe-thumbnails";
import { createRecipeId as createDefaultImageId } from "../recipes";

type ImageRouteDependencies = {
  auth: AuthService;
  imageService?: RecipeImageService;
  createImageId?: () => string;
};

const IMAGE_OBJECT_ROUTE_PREFIX = "/api/images/object/";
const UNSUPPORTED_THUMBNAIL_CACHE_CONTROL = "private, max-age=3600";

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
  routes.use("/thumbnail/*", async (c, next) => {
    await next();
    if (
      c.res.status >= 400 &&
      c.res.headers.get("cache-control") !== UNSUPPORTED_THUMBNAIL_CACHE_CONTROL
    )
      c.header("cache-control", "no-store");
  });

  return routes
    .get("/thumbnail/:version/*", requireAuth(auth), async (c) => {
      if (c.req.param("version") !== RECIPE_THUMBNAIL_VERSION)
        return notFoundResponse("Image was not found.");
      const url = new URL(c.req.url);
      let objectKey: string;
      try {
        const encoded = url.pathname.slice(
          `/api/images/thumbnail/${RECIPE_THUMBNAIL_VERSION}/`.length,
        );
        const parts = encoded.split("/").map(decodeURIComponent);
        if (parts.some((part) => part.includes("/"))) return validationFailedResponse(undefined);
        objectKey = parts.join("/");
      } catch {
        return validationFailedResponse(undefined);
      }
      const parsed = parseRecipeImageKey(objectKey);
      if (!parsed || url.search) return validationFailedResponse(undefined);
      if (parsed.userId !== c.get("userId")) return forbiddenResponse();
      try {
        const response = await createRecipeThumbnailResponse({
          bucket: c.env.RECIPE_IMAGES,
          images: c.env.IMAGES,
          objectKey,
          requestHeaders: c.req.raw.headers,
          logger: c.get("logger"),
        });
        return response ?? notFoundResponse("Image was not found.");
      } catch (error) {
        const cloudflareErrorCode = getImagesErrorCode(error);
        const sourceUnsupported = isUnsupportedRecipeThumbnailSourceError(error);
        c.get("logger").error("recipe_thumbnail_failed", {
          error,
          cloudflareErrorCode,
          failureKind: sourceUnsupported ? "source_unsupported" : "unavailable",
        });
        if (sourceUnsupported) {
          const response = apiErrorResponse({
            status: 422,
            code: "thumbnail_source_unsupported",
            message: "Thumbnail source is not supported.",
          });
          response.headers.set("cache-control", UNSUPPORTED_THUMBNAIL_CACHE_CONTROL);
          return response;
        }
        return apiErrorResponse({
          status: 503,
          code: "thumbnail_unavailable",
          message: "Thumbnail is temporarily unavailable.",
        });
      }
    })
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

      if (objectKey.split("/").includes("_thumbnails")) return forbiddenResponse();

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
