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
import { ScreenTopBar, ScreenTopBarIconButton } from "../../components/screen-top-bar";
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
      <ScreenTopBar
        leading={
          <ScreenTopBarIconButton aria-label="閉じる" onPress={handleClose}>
            <X size={20} weight="bold" />
          </ScreenTopBarIconButton>
        }
        title={title}
        trailing={
          <Button
            className="h-10 rounded-full bg-brand-sage px-5 font-semibold text-white shadow-pantry-sm hover:bg-brand-sage-dark sm:h-11"
            isDisabled={formState.isSubmitting || uploadingImageCount > 0}
            type="submit"
            variant="primary"
          >
            {submitLabel}
          </Button>
        }
      />

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
