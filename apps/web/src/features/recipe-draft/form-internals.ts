import { type DraftImageRef } from "@recipestock/schemas";
import { type KeyboardEvent } from "react";
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

// 入力欄は詳細と同じ位置・大きさで文字を置き、枠は触れたときにだけ出す。
export const draftInlineFieldClass =
  "w-full min-w-0 resize-none rounded-[8px] border border-transparent bg-transparent px-2 py-2 text-base text-brand-ink leading-6 outline-none transition-colors placeholder:text-brand-muted/70 hover:bg-brand-paper-muted/70 focus-visible:border-brand-orange/50 focus-visible:bg-brand-paper focus-visible:ring-3 focus-visible:ring-brand-orange/15 disabled:opacity-50 aria-invalid:border-brand-danger/60";

export const draftAddRowButtonClass =
  "inline-flex h-11 items-center gap-1.5 rounded-[10px] px-2 font-semibold text-brand-sage-dark text-sm outline-none transition-colors hover:bg-brand-paper-muted focus-visible:outline-2 focus-visible:outline-brand-orange";

// Enterで次の欄へ進める。日本語入力で変換を確定するEnterでは進めない。
// SafariはisComposingがfalseのままkeyCode 229を返すことがある。
export const isAdvanceEnter = (event: KeyboardEvent) =>
  event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229;

// レシピ名や材料のように1行で持つ値に、貼り付けで入った改行を残さない。
export const toSingleLine = (value: string) => value.replace(/\r?\n/g, " ");

export const focusFormField = (from: HTMLInputElement | HTMLTextAreaElement, name: string) => {
  const field = from.form?.elements.namedItem(name);

  if (field instanceof HTMLElement) {
    field.focus();
  }
};

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

// 表紙は数えない。APIの上限(recipeDraftContentSchema)と同じ数え方にする。
export const countFormImages = ({
  referenceImages,
  steps,
}: {
  referenceImages?: DraftImageRef[];
  steps?: { images?: DraftImageRef[] }[];
}) =>
  (referenceImages?.length ?? 0) +
  (steps ?? []).reduce((count, step) => count + (step.images?.length ?? 0), 0);
