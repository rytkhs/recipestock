import { type DraftImageRef } from "@recipestock/schemas";
import { type FieldPathByValue, type useForm } from "react-hook-form";
import { type RecipeDraftFormValues } from "./recipe-draft-form-values";

export type RecipeDraftFormControl = ReturnType<typeof useForm<RecipeDraftFormValues>>["control"];
export type RecipeDraftTextFieldPath = FieldPathByValue<RecipeDraftFormValues, string | undefined>;
export type RecipeDraftImageFieldPath = FieldPathByValue<
  RecipeDraftFormValues,
  DraftImageRef | undefined
>;
export type RecipeDraftImageArrayFieldPath = FieldPathByValue<
  RecipeDraftFormValues,
  DraftImageRef[]
>;
export type ImagePreviewUrlsByImageId = Record<string, string>;

export const imageInputAccept = "image/jpeg,image/png,image/webp";
export const imageLimitReachedText = "上限に達しました";

export const imageRefId = (image: DraftImageRef) =>
  `${image.type}:${"key" in image ? image.key : image.url}`;

export const createLocalPreviewUrl = (file: File) => URL.createObjectURL(file);

export const revokeLocalPreviewUrl = (url?: string | null) => {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
};

export const addImagePreviewUrls = (
  previewUrlsByImageId: ImagePreviewUrlsByImageId,
  images: DraftImageRef[],
  previewUrls?: string[],
) => {
  if (!previewUrls || previewUrls.length !== images.length) {
    return;
  }

  images.forEach((image, imageIndex) => {
    const previewUrl = previewUrls[imageIndex];

    if (previewUrl) {
      previewUrlsByImageId[imageRefId(image)] = previewUrl;
    }
  });
};

export const createImagePreviewUrlsByImageId = ({
  defaultValues,
  referenceImagePreviewUrls,
  stepImagePreviewUrls,
}: {
  defaultValues: RecipeDraftFormValues;
  referenceImagePreviewUrls?: string[];
  stepImagePreviewUrls?: string[][];
}): ImagePreviewUrlsByImageId => {
  const previewUrlsByImageId: ImagePreviewUrlsByImageId = {};

  addImagePreviewUrls(
    previewUrlsByImageId,
    defaultValues.referenceImages,
    referenceImagePreviewUrls,
  );

  defaultValues.steps.forEach((step, stepIndex) => {
    addImagePreviewUrls(previewUrlsByImageId, step.images, stepImagePreviewUrls?.[stepIndex]);
  });

  return previewUrlsByImageId;
};

export const countFormImages = ({
  referenceImages,
  steps,
}: {
  referenceImages?: DraftImageRef[];
  steps?: { images?: DraftImageRef[] }[];
}) =>
  (referenceImages?.length ?? 0) +
  (steps ?? []).reduce((count, step) => count + (step.images?.length ?? 0), 0);
