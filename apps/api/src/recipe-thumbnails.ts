import { MAX_IMAGE_UPLOAD_SIZE_BYTES } from "@recipestock/schemas";
import { createRecipeImageResponseHeaders } from "./images";
import { type Logger } from "./logger";
import { recipeThumbnailPrefix } from "./recipe-image-keys";

export const RECIPE_THUMBNAIL_VERSION = "v1";

export const createRecipeThumbnailUrl = ({ objectKey }: { objectKey: string }) =>
  `/api/images/thumbnail/${RECIPE_THUMBNAIL_VERSION}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;

const thumbnailResponse = (object: R2Object, body: BodyInit, requestHeaders: Headers) => {
  const headers = createRecipeImageResponseHeaders(object);
  const condition = requestHeaders.get("if-none-match");
  const matches = condition
    ?.split(",")
    .some((tag) => tag.trim() === "*" || tag.trim().replace(/^W\//, "") === object.httpEtag);
  if (matches) {
    if (body instanceof ReadableStream) void body.cancel();
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { headers });
};

export const createRecipeThumbnailResponse = async ({
  bucket,
  images,
  objectKey,
  requestHeaders,
  logger,
}: {
  bucket: R2Bucket;
  images: ImagesBinding;
  objectKey: string;
  requestHeaders: Headers;
  logger: Logger;
}): Promise<Response | null> => {
  const prefix = recipeThumbnailPrefix(objectKey);
  if (!prefix) return null;
  const thumbnailKey = `${prefix}${RECIPE_THUMBNAIL_VERSION}.webp`;
  const startedAt = Date.now();
  // A surviving derivative must not make a deleted source readable again.
  const sourceMetadata = await bucket.head(objectKey);
  if (!sourceMetadata) return null;
  const cached = await bucket.get(thumbnailKey);
  if (cached) {
    logger.info("recipe_thumbnail_served", {
      cache: "hit",
      durationMs: Date.now() - startedAt,
      outputBytes: cached.size,
    });
    return thumbnailResponse(cached, cached.body, requestHeaders);
  }

  const source = await bucket.get(objectKey);
  if (!source) return null;
  if (source.size > MAX_IMAGE_UPLOAD_SIZE_BYTES) {
    await source.body.cancel();
    throw new Error("Thumbnail source is too large.");
  }
  const transformStartedAt = Date.now();
  const transformed = await images
    .input(source.body)
    .transform({ width: 640, height: 640, fit: "scale-down" })
    .output({ format: "image/webp", quality: 80, anim: false });
  const bytes = await transformed.response().arrayBuffer();
  const transformMs = Date.now() - transformStartedAt;
  const stored = await bucket.put(thumbnailKey, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "image/webp" },
  });
  if (!(await bucket.head(objectKey))) {
    await bucket.delete(thumbnailKey);
    return null;
  }
  logger.info("recipe_thumbnail_served", {
    cache: "miss",
    durationMs: Date.now() - startedAt,
    transformMs,
    sourceBytes: source.size,
    outputBytes: bytes.byteLength,
    concurrentWrite: !stored,
  });
  if (stored) return thumbnailResponse(stored, bytes, requestHeaders);
  // Another request won the conditional write. Serve its bytes and ETag together.
  const winner = await bucket.get(thumbnailKey);
  return winner ? thumbnailResponse(winner, winner.body, requestHeaders) : null;
};
