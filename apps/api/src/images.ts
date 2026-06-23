import {
  IMAGE_UPLOAD_URL_EXPIRES_IN_SECONDS,
  type ImageContentType,
  imageContentTypeSchema,
  MAX_IMAGE_UPLOAD_SIZE_BYTES,
} from "@recipestock/schemas";
import { AwsClient } from "aws4fetch";
import { imageSize } from "image-size";
import { type Bindings } from "./env";
import { isHttpFetchUrlAllowed } from "./url-safety";

export type ImageUrlResult = {
  url: string;
  expiresAt: Date;
};

export type CreateUploadUrlParams = {
  objectKey: string;
  contentType: ImageContentType;
};

export type CreateSignedGetUrlParams = {
  objectKey: string;
};

export type CopyExternalImageUrlParams = {
  sourceUrl: string;
  destinationKeyPrefix: string;
};

export type ImageDimensions = {
  width: number;
  height: number;
};

export type RecipeImageService = {
  createUploadUrl(params: CreateUploadUrlParams): Promise<ImageUrlResult>;
  createSignedGetUrl(params: CreateSignedGetUrlParams): Promise<ImageUrlResult>;
  getObjectSize?(objectKey: string): Promise<number | null>;
  copyObject(sourceKey: string, destinationKey: string): Promise<ImageDimensions>;
  copyExternalImageUrl?(
    params: CopyExternalImageUrlParams,
  ): Promise<{ objectKey: string } & ImageDimensions>;
  deleteObject(objectKey: string): Promise<void>;
  deletePrefixBestEffort(prefix: string): Promise<void>;
};

const EXTERNAL_IMAGE_FETCH_TIMEOUT_MS = 10_000;
const MAX_EXTERNAL_IMAGE_REDIRECTS = 5;

const addSeconds = (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000);

const encodeObjectKey = (objectKey: string) =>
  objectKey.split("/").map(encodeURIComponent).join("/");

const createR2ObjectUrl = (env: Bindings, objectKey: string) =>
  `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com/${encodeURIComponent(
    env.R2_BUCKET_NAME,
  )}/${encodeObjectKey(objectKey)}`;

const createR2PresignedUrl = async ({
  env,
  objectKey,
  method,
  contentType,
}: {
  env: Bindings;
  objectKey: string;
  method: "GET" | "PUT";
  contentType?: ImageContentType;
}) => {
  const url = new URL(createR2ObjectUrl(env, objectKey));
  url.searchParams.set("X-Amz-Expires", String(IMAGE_UPLOAD_URL_EXPIRES_IN_SECONDS));
  const aws = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
  const signed = await aws.sign(url, {
    method,
    headers: contentType ? { "content-type": contentType } : undefined,
    aws: {
      signQuery: true,
      allHeaders: Boolean(contentType),
    },
  });

  return signed.url;
};

const normalizeImageContentType = (contentType: string | null): ImageContentType => {
  const normalized = contentType?.split(";").at(0)?.trim().toLowerCase();
  const parsed = imageContentTypeSchema.safeParse(normalized);

  if (!parsed.success) {
    throw new Error("External image content type is not supported.");
  }

  return parsed.data;
};

const assertExternalImageUrlAllowed = (sourceUrl: string) => {
  if (!isHttpFetchUrlAllowed(sourceUrl)) {
    throw new Error("External image URL is not allowed.");
  }
};

const assertExternalImageContentLengthAllowed = (contentLength: string | null) => {
  if (!contentLength) {
    return;
  }

  const size = Number(contentLength);
  if (Number.isFinite(size) && size > MAX_IMAGE_UPLOAD_SIZE_BYTES) {
    throw new Error("External image is too large.");
  }
};

const isRedirectStatus = (status: number) =>
  status === 301 || status === 302 || status === 303 || status === 307 || status === 308;

const fetchExternalImageUrl = async (sourceUrl: string, signal: AbortSignal) => {
  let currentUrl = sourceUrl;

  for (let redirectCount = 0; redirectCount <= MAX_EXTERNAL_IMAGE_REDIRECTS; redirectCount++) {
    assertExternalImageUrlAllowed(currentUrl);

    const response = await fetch(currentUrl, {
      redirect: "manual",
      signal,
    });

    if (!isRedirectStatus(response.status)) {
      if (response.url) {
        assertExternalImageUrlAllowed(response.url);
      }

      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new Error("External image redirect location was missing.");
    }

    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error("External image had too many redirects.");
};

const readResponseBodyWithinLimit = async (response: Response) => {
  if (!response.body) {
    throw new Error("External image response body was empty.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  while (true) {
    const result = await reader.read();

    if (result.done) {
      break;
    }

    totalSize += result.value.byteLength;
    if (totalSize > MAX_IMAGE_UPLOAD_SIZE_BYTES) {
      throw new Error("External image is too large.");
    }

    chunks.push(result.value);
  }

  const body = new Uint8Array(totalSize);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
};

export const getImageDimensions = (body: Uint8Array): ImageDimensions => {
  const result = imageSize(body);
  if (result.type !== "jpg" && result.type !== "png" && result.type !== "webp") {
    throw new Error("Image format is not supported.");
  }

  const swapDimensions =
    result.orientation === 5 ||
    result.orientation === 6 ||
    result.orientation === 7 ||
    result.orientation === 8;
  const width = swapDimensions ? result.height : result.width;
  const height = swapDimensions ? result.width : result.height;

  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("Image dimensions could not be determined.");
  }

  return { width, height };
};

export const createRecipeImageService = (env: Bindings): RecipeImageService => ({
  async createUploadUrl({ objectKey, contentType }) {
    return {
      url: await createR2PresignedUrl({ env, objectKey, method: "PUT", contentType }),
      expiresAt: addSeconds(new Date(), IMAGE_UPLOAD_URL_EXPIRES_IN_SECONDS),
    };
  },
  async createSignedGetUrl({ objectKey }) {
    return {
      url: await createR2PresignedUrl({ env, objectKey, method: "GET" }),
      expiresAt: addSeconds(new Date(), IMAGE_UPLOAD_URL_EXPIRES_IN_SECONDS),
    };
  },
  async getObjectSize(objectKey) {
    const object = await env.RECIPE_IMAGES.head(objectKey);
    return object?.size ?? null;
  },
  async copyObject(sourceKey, destinationKey) {
    const sourceObject = await env.RECIPE_IMAGES.get(sourceKey);

    if (!sourceObject?.body) {
      throw new Error(`R2 object was not found: ${sourceKey}`);
    }

    if (sourceObject.size > MAX_IMAGE_UPLOAD_SIZE_BYTES) {
      throw new Error(`R2 object is too large: ${sourceKey}`);
    }

    const body = new Uint8Array(await sourceObject.arrayBuffer());
    const dimensions = getImageDimensions(body);

    await env.RECIPE_IMAGES.put(destinationKey, body, {
      httpMetadata: sourceObject.httpMetadata,
      customMetadata: sourceObject.customMetadata,
    });

    return dimensions;
  },
  async copyExternalImageUrl({ sourceUrl, destinationKeyPrefix }) {
    assertExternalImageUrlAllowed(sourceUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXTERNAL_IMAGE_FETCH_TIMEOUT_MS);

    try {
      const response = await fetchExternalImageUrl(sourceUrl, controller.signal);

      if (!response.ok) {
        throw new Error("External image fetch failed.");
      }

      const contentType = normalizeImageContentType(response.headers.get("content-type"));
      assertExternalImageContentLengthAllowed(response.headers.get("content-length"));

      const objectKey = `${destinationKeyPrefix}.${imageExtensionFromContentType(contentType)}`;
      const body = await readResponseBodyWithinLimit(response);
      const dimensions = getImageDimensions(body);

      await env.RECIPE_IMAGES.put(objectKey, body, {
        httpMetadata: { contentType },
      });

      return { objectKey, ...dimensions };
    } finally {
      clearTimeout(timeout);
    }
  },
  async deleteObject(objectKey) {
    await env.RECIPE_IMAGES.delete(objectKey);
  },
  async deletePrefixBestEffort(prefix) {
    let cursor: string | undefined;

    do {
      const result = await env.RECIPE_IMAGES.list({ prefix, cursor });
      await Promise.all(result.objects.map((object) => env.RECIPE_IMAGES.delete(object.key)));
      cursor = result.truncated ? result.cursor : undefined;
    } while (cursor);
  },
});

export const imageExtensionFromContentType = (contentType: ImageContentType) => {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
  }
};

export const getRecipeImageKeys = (content: {
  coverImage?: { objectKey: string };
  steps: { images: { objectKey: string }[] }[];
}) =>
  new Set([
    ...(content.coverImage ? [content.coverImage.objectKey] : []),
    ...content.steps.flatMap((step) => step.images.map((image) => image.objectKey)),
  ]);

export const recipeIdFromImageObjectKey = (userId: string, objectKey: string) => {
  const parts = objectKey.split("/");

  if (parts.length < 4 || parts[0] !== "recipes" || parts[1] !== userId) {
    return null;
  }

  return parts[2] || null;
};
