import {
  type DraftImageRef,
  MAX_IMAGE_UPLOAD_SIZE_BYTES,
  type RecipeContent,
  type RecipeContentWithUrls,
  type RecipeDraftContent,
  type RecipeImage,
  recipeContentSchema,
  recipeContentWithUrlsSchema,
} from "@recipestock/schemas";
import { getRecipeImageKeys, type RecipeImageService } from "./images";
import { createRecipeId } from "./recipes";

type FinalizeRecipeDraftImagesParams = {
  draft: RecipeDraftContent;
  userId: string;
  recipeId: string;
  imageService?: RecipeImageService;
  existingContent?: RecipeContent;
  createImageId?: () => string;
};

export type FinalizedRecipeImages = {
  content: RecipeContent;
  copiedKeys: string[];
  tmpKeys: string[];
};

export class RecipeImageFinalizeError extends Error {
  constructor(message = "Recipe image could not be finalized.") {
    super(message);
    this.name = "RecipeImageFinalizeError";
  }
}

const extensionFromObjectKey = (objectKey: string) => objectKey.split(".").at(-1) ?? "webp";

const isUserTmpObjectKey = (userId: string, objectKey: string) =>
  objectKey.startsWith(`tmp/${userId}/`);

const draftImageRefId = (image: DraftImageRef | undefined) => {
  if (!image) return null;
  return `${image.type}:${"key" in image ? image.key : image.url}`;
};

const destinationObjectKey = ({
  userId,
  recipeId,
  sourceKey,
  createImageId,
}: {
  userId: string;
  recipeId: string;
  sourceKey: string;
  createImageId: () => string;
}) => `recipes/${userId}/${recipeId}/${createImageId()}.${extensionFromObjectKey(sourceKey)}`;

const destinationObjectKeyPrefix = ({
  userId,
  recipeId,
  createImageId,
}: {
  userId: string;
  recipeId: string;
  createImageId: () => string;
}) => `recipes/${userId}/${recipeId}/${createImageId()}`;

const assertImageObjectSizeAllowed = async (
  imageService: RecipeImageService,
  objectKey: string,
) => {
  const size = await imageService.getObjectSize?.(objectKey);

  if (size === null || size === undefined) {
    throw new RecipeImageFinalizeError("Temporary image object was not found.");
  }

  if (size > MAX_IMAGE_UPLOAD_SIZE_BYTES) {
    throw new RecipeImageFinalizeError("Temporary image object is too large.");
  }
};

const resolveImageRef = async ({
  image,
  userId,
  recipeId,
  imageService,
  existingImages,
  createImageId,
  copiedKeys,
  tmpKeys,
}: {
  image: DraftImageRef | undefined;
  userId: string;
  recipeId: string;
  imageService?: RecipeImageService;
  existingImages: Map<string, RecipeImage>;
  createImageId: () => string;
  copiedKeys: string[];
  tmpKeys: string[];
}): Promise<RecipeImage | undefined> => {
  if (!image) {
    return undefined;
  }

  if (image.type === "existingObjectKey") {
    const existingImage = existingImages.get(image.key);

    if (!existingImage) {
      throw new RecipeImageFinalizeError("Existing image object key is not allowed.");
    }

    return existingImage;
  }

  if (image.type === "externalImageUrl") {
    if (!imageService?.copyExternalImageUrl) {
      return undefined;
    }

    try {
      const result = await imageService.copyExternalImageUrl({
        sourceUrl: image.url,
        destinationKeyPrefix: destinationObjectKeyPrefix({
          userId,
          recipeId,
          createImageId,
        }),
      });
      copiedKeys.push(result.objectKey);
      return result;
    } catch {
      return undefined;
    }
  }

  if (!imageService || !isUserTmpObjectKey(userId, image.key)) {
    throw new RecipeImageFinalizeError("Temporary image object key is not allowed.");
  }

  const destinationKey = destinationObjectKey({
    userId,
    recipeId,
    sourceKey: image.key,
    createImageId,
  });

  try {
    await assertImageObjectSizeAllowed(imageService, image.key);
    const dimensions = await imageService.copyObject(image.key, destinationKey);
    copiedKeys.push(destinationKey);
    tmpKeys.push(image.key);
    return { objectKey: destinationKey, ...dimensions };
  } catch (error) {
    throw new RecipeImageFinalizeError(
      error instanceof Error ? error.message : "Recipe image copy failed.",
    );
  }
};

const resolveImageRefOnce = ({
  image,
  resolvedImages,
  ...params
}: Parameters<typeof resolveImageRef>[0] & {
  resolvedImages: Map<string, Promise<RecipeImage | undefined>>;
}) => {
  const imageId = draftImageRefId(image);
  if (!imageId) return Promise.resolve(undefined);

  const cached = resolvedImages.get(imageId);
  if (cached) return cached;

  const resolved = resolveImageRef({ image, ...params });
  resolvedImages.set(imageId, resolved);
  return resolved;
};

export const finalizeRecipeDraftImages = async ({
  draft,
  userId,
  recipeId,
  imageService,
  existingContent,
  createImageId = createRecipeId,
}: FinalizeRecipeDraftImagesParams): Promise<FinalizedRecipeImages> => {
  const copiedKeys: string[] = [];
  const tmpKeys: string[] = [];
  try {
    const existingImages = new Map(
      existingContent
        ? [
            ...(existingContent.coverImage ? [existingContent.coverImage] : []),
            ...(existingContent.sourceMedia ?? []),
            ...existingContent.steps.flatMap((step) => step.images),
          ].map((image) => [image.objectKey, image] as const)
        : [],
    );
    const resolvedImages = new Map<string, Promise<RecipeImage | undefined>>();
    const resolveDraftImage = (image: DraftImageRef | undefined) =>
      resolveImageRefOnce({
        image,
        userId,
        recipeId,
        imageService,
        existingImages,
        createImageId,
        copiedKeys,
        tmpKeys,
        resolvedImages,
      });

    const coverImage = await resolveDraftImage(draft.coverImage);
    const sourceMedia = (
      await Promise.all((draft.sourceMedia ?? []).map((image) => resolveDraftImage(image)))
    ).filter((image): image is RecipeImage => Boolean(image));
    const steps: RecipeContent["steps"] = [];

    for (const step of draft.steps) {
      const images = (
        await Promise.all(step.images.map((image) => resolveDraftImage(image)))
      ).filter((image): image is RecipeImage => Boolean(image));

      if (!step.text && images.length === 0) {
        continue;
      }

      steps.push({
        text: step.text,
        images,
      });
    }

    return {
      content: recipeContentSchema.parse({
        title: draft.title,
        yieldText: draft.yieldText,
        coverImage,
        sourceMedia,
        ingredientGroups: draft.ingredientGroups,
        steps,
        note: draft.note,
      }),
      copiedKeys,
      tmpKeys,
    };
  } catch (error) {
    await deleteObjectsBestEffort(imageService, copiedKeys);
    throw error;
  }
};

export const deleteObjectsBestEffort = async (
  imageService: RecipeImageService | undefined,
  objectKeys: Iterable<string>,
) => {
  if (!imageService) {
    return;
  }

  await Promise.all(
    Array.from(objectKeys, async (objectKey) => {
      try {
        await imageService.deleteObject(objectKey);
      } catch {
        // Best-effort cleanup must not affect the recipe mutation result.
      }
    }),
  );
};

export const getRemovedRecipeImageKeys = (previous: RecipeContent, next: RecipeContent) => {
  const nextKeys = getRecipeImageKeys(next);
  return Array.from(getRecipeImageKeys(previous)).filter((key) => !nextKeys.has(key));
};

export const attachRecipeImageUrls = async (
  content: RecipeContent,
  imageService: RecipeImageService | undefined,
): Promise<RecipeContentWithUrls> => {
  if (!imageService) {
    return recipeContentWithUrlsSchema.parse(content);
  }

  const attachImageUrl = async (image: RecipeImage) => {
    try {
      const result = await imageService.createSignedGetUrl({ objectKey: image.objectKey });
      return { ...image, url: result.url };
    } catch {
      return image;
    }
  };

  const coverImage = content.coverImage ? await attachImageUrl(content.coverImage) : undefined;
  const sourceMedia = await Promise.all((content.sourceMedia ?? []).map(attachImageUrl));
  const steps = await Promise.all(
    content.steps.map(async (step) => ({
      ...step,
      images: await Promise.all(step.images.map(attachImageUrl)),
    })),
  );

  return recipeContentWithUrlsSchema.parse({
    ...content,
    coverImage,
    sourceMedia,
    steps,
  });
};
