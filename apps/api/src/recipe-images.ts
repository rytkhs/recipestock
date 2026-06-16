import {
  type DraftImageRef,
  MAX_IMAGE_UPLOAD_SIZE_BYTES,
  type RecipeContent,
  type RecipeContentWithUrls,
  type RecipeDraftContent,
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
  existingKeys,
  createImageId,
  copiedKeys,
  tmpKeys,
}: {
  image: DraftImageRef | undefined;
  userId: string;
  recipeId: string;
  imageService?: RecipeImageService;
  existingKeys: Set<string>;
  createImageId: () => string;
  copiedKeys: string[];
  tmpKeys: string[];
}) => {
  if (!image) {
    return undefined;
  }

  if (image.type === "existingObjectKey") {
    if (!existingKeys.has(image.key)) {
      throw new RecipeImageFinalizeError("Existing image object key is not allowed.");
    }

    return image.key;
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
      return result.objectKey;
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
    await imageService.copyObject(image.key, destinationKey);
    copiedKeys.push(destinationKey);
    tmpKeys.push(image.key);
    return destinationKey;
  } catch (error) {
    throw new RecipeImageFinalizeError(
      error instanceof Error ? error.message : "Recipe image copy failed.",
    );
  }
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
    const existingKeys = existingContent ? getRecipeImageKeys(existingContent) : new Set<string>();
    const coverImageKey = await resolveImageRef({
      image: draft.coverImage,
      userId,
      recipeId,
      imageService,
      existingKeys,
      createImageId,
      copiedKeys,
      tmpKeys,
    });
    const steps: RecipeContent["steps"] = [];

    for (const step of draft.steps) {
      const imageKeys = (
        await Promise.all(
          step.images.map((image) =>
            resolveImageRef({
              image,
              userId,
              recipeId,
              imageService,
              existingKeys,
              createImageId,
              copiedKeys,
              tmpKeys,
            }),
          ),
        )
      ).filter((imageKey): imageKey is string => Boolean(imageKey));

      if (!step.text && imageKeys.length === 0) {
        continue;
      }

      steps.push({
        text: step.text,
        imageKeys,
      });
    }

    return {
      content: recipeContentSchema.parse({
        title: draft.title,
        servingsText: draft.servingsText,
        coverImageKey,
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

  const coverImageUrl = content.coverImageKey
    ? await imageService
        .createSignedGetUrl({ objectKey: content.coverImageKey })
        .then((result) => result.url)
        .catch(() => undefined)
    : undefined;
  const steps = await Promise.all(
    content.steps.map(async (step) => ({
      ...step,
      imageUrls: await Promise.all(
        step.imageKeys.map((imageKey) =>
          imageService.createSignedGetUrl({ objectKey: imageKey }).then((result) => result.url),
        ),
      ).catch(() => []),
    })),
  );

  return {
    ...content,
    coverImageUrl,
    steps,
  };
};
