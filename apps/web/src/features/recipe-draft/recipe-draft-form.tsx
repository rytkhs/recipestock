import { Button } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "@phosphor-icons/react";
import {
  type DraftImageRef,
  MAX_RECIPE_REFERENCE_IMAGES,
  MAX_RECIPE_TOTAL_IMAGES,
} from "@recipestock/schemas";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { CoverImageTitleBlock } from "./cover-image-title-block";
import {
  countFormImages,
  createImagePreviewUrlsByImageId,
  type ImagePreviewUrlsByImageId,
} from "./form-internals";
import { uploadRecipeImage } from "./image-upload";
import { IngredientsSection } from "./ingredients-section";
import { NoteSection } from "./note-section";
import { type RecipeDraftFormValues, recipeDraftFormSchema } from "./recipe-draft-form-values";
import { ReferenceImagesSection } from "./reference-images-section";
import { StepsSection } from "./steps-section";

type RecipeDraftFormProps = {
  defaultValues: RecipeDraftFormValues;
  title: string;
  submitLabel: string;
  submitError?: string | null;
  coverImagePreviewUrl?: string;
  referenceImagePreviewUrls?: string[];
  stepImagePreviewUrls?: string[][];
  uploadImage?: (file: File) => Promise<DraftImageRef>;
  onSubmit(values: RecipeDraftFormValues): Promise<void> | void;
  onClose(): void;
};

export const RecipeDraftForm = ({
  defaultValues,
  title,
  submitLabel,
  submitError,
  coverImagePreviewUrl,
  referenceImagePreviewUrls,
  stepImagePreviewUrls,
  uploadImage = uploadRecipeImage,
  onSubmit,
  onClose,
}: RecipeDraftFormProps) => {
  const { control, formState, handleSubmit } = useForm<RecipeDraftFormValues>({
    resolver: zodResolver(recipeDraftFormSchema),
    defaultValues,
  });
  const watchedReferenceImages = useWatch({ control, name: "referenceImages" });
  const watchedSteps = useWatch({ control, name: "steps" });
  const [uploadingImageCount, setUploadingImageCount] = useState(0);

  const totalImageCount = countFormImages({
    referenceImages: watchedReferenceImages,
    steps: watchedSteps,
  });
  const isTotalImageLimitReached = totalImageCount >= MAX_RECIPE_TOTAL_IMAGES;
  const isReferenceImagesLimitReached =
    (watchedReferenceImages?.length ?? 0) >= MAX_RECIPE_REFERENCE_IMAGES;

  const imagePreviewUrlsByImageId: ImagePreviewUrlsByImageId = useMemo(
    () =>
      createImagePreviewUrlsByImageId({
        defaultValues,
        referenceImagePreviewUrls,
        stepImagePreviewUrls,
      }),
    [defaultValues, referenceImagePreviewUrls, stepImagePreviewUrls],
  );

  const handleFormSubmit = handleSubmit(onSubmit);
  const handleUploadStateChange = (isUploading: boolean) => {
    setUploadingImageCount((count) => Math.max(0, count + (isUploading ? 1 : -1)));
  };

  const handleClose = () => {
    if (formState.isDirty) {
      if (window.confirm("変更を破棄しますか？")) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  return (
    <form
      className="mx-auto w-full max-w-4xl px-0 pb-10 sm:px-6 lg:px-10"
      onSubmit={(event) => void handleFormSubmit(event)}
    >
      <div className="sticky top-0 z-20 border-b border-brand-line-soft bg-brand-cream/95 px-3 py-2.5 backdrop-blur-md sm:top-3 sm:mt-3 sm:rounded-[20px] sm:border sm:px-5 sm:py-3 sm:shadow-pantry-sm">
        <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto] sm:gap-3">
          <button
            aria-label="閉じる"
            className="grid h-10 w-10 place-items-center rounded-full border border-brand-line bg-brand-paper-raised text-brand-walnut transition-colors hover:bg-brand-paper-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange sm:h-11 sm:w-11"
            type="button"
            onClick={handleClose}
          >
            <X size={20} weight="bold" />
          </button>
          <h1 className="min-w-0 truncate text-center font-bold text-brand-ink text-md leading-tight sm:text-xl">
            {title}
          </h1>
          <Button
            className="h-10 rounded-full bg-brand-sage px-5 font-semibold text-white shadow-pantry-sm hover:bg-brand-sage-dark sm:h-11"
            isDisabled={formState.isSubmitting || uploadingImageCount > 0}
            type="submit"
            variant="primary"
          >
            {submitLabel}
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-5 px-3 sm:mt-6 sm:px-0">
        <CoverImageTitleBlock
          control={control}
          coverImagePreviewUrl={coverImagePreviewUrl}
          onUploadStateChange={handleUploadStateChange}
          uploadImage={uploadImage}
        />

        <ReferenceImagesSection
          control={control}
          isAddDisabled={isReferenceImagesLimitReached || isTotalImageLimitReached}
          addDisabledReason={
            isReferenceImagesLimitReached || isTotalImageLimitReached
              ? "上限に達しました"
              : undefined
          }
          onUploadStateChange={handleUploadStateChange}
          previewUrlsByImageId={imagePreviewUrlsByImageId}
          uploadImage={uploadImage}
        />

        <IngredientsSection control={control} />

        <StepsSection
          control={control}
          isTotalImageLimitReached={isTotalImageLimitReached}
          onUploadStateChange={handleUploadStateChange}
          previewUrlsByImageId={imagePreviewUrlsByImageId}
          uploadImage={uploadImage}
          uploadingImageCount={uploadingImageCount}
        />

        <NoteSection control={control} />
      </div>

      {submitError ? (
        <div className="mt-6 rounded-[14px] border border-brand-danger/20 bg-brand-danger/5 p-3">
          <p className="text-brand-danger text-sm" role="alert">
            {submitError}
          </p>
        </div>
      ) : null}
    </form>
  );
};
