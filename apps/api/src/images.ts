import { IMAGE_UPLOAD_URL_EXPIRES_IN_SECONDS, type ImageContentType } from "@recipestock/schemas";
import { AwsClient } from "aws4fetch";
import { type Bindings } from "./env";

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

export type RecipeImageService = {
  createUploadUrl(params: CreateUploadUrlParams): Promise<ImageUrlResult>;
  createSignedGetUrl(params: CreateSignedGetUrlParams): Promise<ImageUrlResult>;
  copyObject(sourceKey: string, destinationKey: string): Promise<void>;
  deleteObject(objectKey: string): Promise<void>;
  deletePrefixBestEffort(prefix: string): Promise<void>;
};

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
  async copyObject(sourceKey, destinationKey) {
    const sourceObject = await env.RECIPE_IMAGES.get(sourceKey);

    if (!sourceObject?.body) {
      throw new Error(`R2 object was not found: ${sourceKey}`);
    }

    await env.RECIPE_IMAGES.put(destinationKey, sourceObject.body, {
      httpMetadata: sourceObject.httpMetadata,
      customMetadata: sourceObject.customMetadata,
    });
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
  coverImageKey?: string;
  steps: { imageKey?: string }[];
}) =>
  new Set([
    ...(content.coverImageKey ? [content.coverImageKey] : []),
    ...content.steps.flatMap((step) => (step.imageKey ? [step.imageKey] : [])),
  ]);

export const recipeIdFromImageObjectKey = (userId: string, objectKey: string) => {
  const parts = objectKey.split("/");

  if (parts.length < 4 || parts[0] !== "recipes" || parts[1] !== userId) {
    return null;
  }

  return parts[2] || null;
};
