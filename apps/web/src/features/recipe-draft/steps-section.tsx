import { Button, ProgressBar, TextArea, TextField } from "@heroui/react";
import { CaretDown, CaretUp, ImageSquare, Plus, X } from "@phosphor-icons/react";
import { type DraftImageRef, MAX_RECIPE_STEP_IMAGES } from "@recipestock/schemas";
import { useEffect, useRef, useState } from "react";
import { useController, useFieldArray, useWatch } from "react-hook-form";
import {
  createLocalPreviewUrl,
  type ImagePreviewUrlsByImageId,
  imageInputAccept,
  imageLimitReachedText,
  imageRefId,
  type RecipeDraftFormControl,
  revokeLocalPreviewUrl,
} from "./form-internals";
import { RecipeImageUploadError } from "./image-upload";
import { createEmptyStep } from "./recipe-draft-form-values";

type StepsSectionProps = {
  control: RecipeDraftFormControl;
  isTotalImageLimitReached: boolean;
  onUploadStateChange(isUploading: boolean): void;
  previewUrlsByImageId?: ImagePreviewUrlsByImageId;
  uploadImage: (file: File) => Promise<DraftImageRef>;
  uploadingImageCount: number;
};

const handleTextAreaInput = (event: React.FormEvent<HTMLTextAreaElement>) => {
  const target = event.currentTarget;
  target.style.height = "auto";
  target.style.height = `${target.scrollHeight}px`;
};

const StepImages = ({
  control,
  isAddDisabled,
  onUploadStateChange,
  previewUrlsByImageId,
  stepIndex,
  uploadImage,
}: {
  control: RecipeDraftFormControl;
  isAddDisabled: boolean;
  onUploadStateChange(isUploading: boolean): void;
  previewUrlsByImageId?: ImagePreviewUrlsByImageId;
  stepIndex: number;
  uploadImage: (file: File) => Promise<DraftImageRef>;
}) => {
  const { field } = useController({
    control,
    name: `steps.${stepIndex}.images`,
  });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [localPreviewUrlsByImageId, setLocalPreviewUrlsByImageId] = useState<
    Record<string, string>
  >({});
  const localPreviewUrlsByImageIdRef = useRef(localPreviewUrlsByImageId);
  const images = field.value ?? [];

  localPreviewUrlsByImageIdRef.current = localPreviewUrlsByImageId;

  useEffect(
    () => () => {
      Object.values(localPreviewUrlsByImageIdRef.current).forEach(revokeLocalPreviewUrl);
    },
    [],
  );

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setError(null);
    const nextPreviewUrl = createLocalPreviewUrl(file);
    setIsUploading(true);
    onUploadStateChange(true);

    try {
      const uploadedImage = await uploadImage(file);
      const uploadedImageId = imageRefId(uploadedImage);
      setLocalPreviewUrlsByImageId((currentUrls) => ({
        ...currentUrls,
        [uploadedImageId]: nextPreviewUrl,
      }));
      field.onChange([...images, uploadedImage]);
    } catch (uploadError) {
      revokeLocalPreviewUrl(nextPreviewUrl);
      setError(
        uploadError instanceof RecipeImageUploadError && uploadError.code === "image_too_large"
          ? "画像は5MB以下にしてください。"
          : "画像をアップロードできませんでした。",
      );
    } finally {
      setIsUploading(false);
      onUploadStateChange(false);
    }
  };

  const handleRemove = (imageIndex: number) => {
    const image = images[imageIndex];
    if (!image) {
      return;
    }

    const removedImageId = imageRefId(image);
    setLocalPreviewUrlsByImageId((currentUrls) => {
      const nextUrls = { ...currentUrls };
      revokeLocalPreviewUrl(nextUrls[removedImageId]);
      delete nextUrls[removedImageId];
      return nextUrls;
    });
    field.onChange(images.filter((_, currentIndex) => currentIndex !== imageIndex));
  };

  const stepLabel = `手順${stepIndex + 1}の画像`;

  return (
    <div className="grid gap-2">
      <input
        ref={inputRef}
        accept={imageInputAccept}
        aria-label={stepLabel}
        className="sr-only"
        disabled={isUploading || isAddDisabled}
        type="file"
        onChange={(event) => void handleChange(event)}
      />
      <div className="flex snap-x gap-2 overflow-x-auto pb-1">
        {images.map((image, imageIndex) => {
          const imageId = imageRefId(image);
          const imagePreviewUrl =
            localPreviewUrlsByImageId[imageId] ?? previewUrlsByImageId?.[imageId];

          return (
            <div
              className="group relative aspect-square w-20 shrink-0 snap-start overflow-hidden rounded-[14px] border border-brand-line-soft bg-brand-paper-muted shadow-pantry-sm"
              key={imageId}
            >
              <div className="grid h-full place-items-center">
                {imagePreviewUrl ? (
                  <img
                    alt={`${stepLabel}${imageIndex + 1}プレビュー`}
                    className="h-full w-full object-cover"
                    src={imagePreviewUrl}
                  />
                ) : (
                  <ImageSquare className="text-brand-muted" size={20} />
                )}
              </div>
              <Button
                aria-label={`${stepLabel}${imageIndex + 1}を削除`}
                className="absolute top-1 right-1 h-5 min-w-5 rounded-full bg-black/50 px-0 text-xs leading-none text-white opacity-0 group-hover:opacity-100 transition-opacity"
                isDisabled={isUploading}
                isIconOnly
                variant="tertiary"
                onPress={() => handleRemove(imageIndex)}
              >
                <X size={12} weight="bold" />
              </Button>
            </div>
          );
        })}
        {!isAddDisabled ? (
          <button
            aria-label="画像を追加"
            className="grid aspect-square w-20 shrink-0 place-items-center rounded-[14px] border border-dashed border-brand-line bg-brand-paper-muted text-brand-muted transition-colors hover:border-brand-sage hover:bg-brand-paper-raised hover:text-brand-sage disabled:opacity-50"
            disabled={isUploading}
            type="button"
            onClick={() => inputRef.current?.click()}
          >
            <Plus size={20} weight="bold" />
          </button>
        ) : null}
      </div>
      {isUploading ? (
        <ProgressBar aria-label={`${stepLabel}アップロード中`} isIndeterminate />
      ) : null}
      {isAddDisabled ? (
        <span className="text-brand-muted text-xs">{imageLimitReachedText}</span>
      ) : null}
      {error ? (
        <div className="rounded-[10px] bg-brand-danger/5 border border-brand-danger/20 px-3 py-2">
          <p className="text-brand-danger text-xs" role="alert">
            {error}
          </p>
        </div>
      ) : null}
    </div>
  );
};

const StepTextField = ({
  control,
  stepIndex,
}: {
  control: RecipeDraftFormControl;
  stepIndex: number;
}) => {
  const { field } = useController({
    control,
    name: `steps.${stepIndex}.text`,
  });
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = textAreaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, []);

  return (
    <TextField aria-label={`手順${stepIndex + 1}`}>
      <TextArea
        className="min-h-20 rounded-[14px] bg-brand-paper-raised text-sm leading-6 sm:min-h-24 sm:text-base"
        name={field.name}
        placeholder="手順を入力"
        ref={(node) => {
          field.ref(node);
          textAreaRef.current = node;
        }}
        rows={2}
        value={field.value ?? ""}
        onBlur={field.onBlur}
        onChange={(event) => field.onChange(event.target.value)}
        onInput={handleTextAreaInput}
      />
    </TextField>
  );
};

export const StepsSection = ({
  control,
  isTotalImageLimitReached,
  onUploadStateChange,
  previewUrlsByImageId,
  uploadImage,
  uploadingImageCount,
}: StepsSectionProps) => {
  const { fields, append, remove, swap } = useFieldArray({
    control,
    name: "steps",
  });
  const watchedSteps = useWatch({ control, name: "steps" });

  return (
    <section
      className="min-w-0 overflow-hidden rounded-[16px] border border-brand-line-soft bg-brand-paper shadow-pantry-sm sm:rounded-[18px]"
      aria-labelledby="recipe-draft-steps-title"
    >
      <div className="border-brand-line-soft border-b bg-brand-paper-muted/70 px-3.5 py-3 sm:px-5">
        <h2
          className="font-semibold text-brand-walnut text-sm sm:font-bold sm:text-base"
          id="recipe-draft-steps-title"
        >
          手順
        </h2>
      </div>

      <div className="grid gap-0 px-3.5 sm:px-5">
        {fields.map((field, stepIndex) => {
          const isFirst = stepIndex === 0;
          const isLast = stepIndex === fields.length - 1;

          return (
            <div
              className="grid gap-3 border-b border-brand-line-soft py-3.5 last:border-b-0 sm:py-4"
              key={field.id}
            >
              <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-start gap-2.5 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto] sm:gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-brand-orange-soft bg-brand-orange-soft/30 text-brand-orange text-sm font-bold sm:h-11 sm:w-11 sm:text-base">
                  {stepIndex + 1}
                </div>

                <div className="min-w-0 flex-1">
                  <StepTextField control={control} stepIndex={stepIndex} />
                </div>

                <div className="flex shrink-0 flex-col rounded-full border border-brand-line-soft bg-brand-paper">
                  <Button
                    aria-label="上に移動"
                    className="h-8 min-w-8 rounded-full px-0 text-brand-muted"
                    isDisabled={isFirst || uploadingImageCount > 0}
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    onPress={() => swap(stepIndex, stepIndex - 1)}
                  >
                    <CaretUp size={13} weight="bold" />
                  </Button>
                  <Button
                    aria-label="下に移動"
                    className="h-8 min-w-8 rounded-full px-0 text-brand-muted"
                    isDisabled={isLast || uploadingImageCount > 0}
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    onPress={() => swap(stepIndex, stepIndex + 1)}
                  >
                    <CaretDown size={13} weight="bold" />
                  </Button>
                  <Button
                    aria-label={`手順${stepIndex + 1}を削除`}
                    className="h-8 min-w-8 rounded-full px-0 text-brand-muted hover:text-brand-danger"
                    isDisabled={uploadingImageCount > 0}
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    onPress={() => remove(stepIndex)}
                  >
                    <X size={15} weight="bold" />
                  </Button>
                </div>
              </div>

              <div className="pl-[calc(2.25rem+0.625rem)] sm:pl-[calc(3.5rem+1rem)]">
                <div className="min-w-0 flex-1">
                  <StepImages
                    control={control}
                    isAddDisabled={
                      isTotalImageLimitReached ||
                      (watchedSteps?.[stepIndex]?.images?.length ?? 0) >= MAX_RECIPE_STEP_IMAGES
                    }
                    onUploadStateChange={onUploadStateChange}
                    previewUrlsByImageId={previewUrlsByImageId}
                    stepIndex={stepIndex}
                    uploadImage={uploadImage}
                  />
                </div>
              </div>
            </div>
          );
        })}

        <Button
          className="my-3 justify-self-center rounded-full border border-brand-line bg-brand-paper px-5 text-brand-sage font-semibold hover:bg-brand-paper-muted sm:my-4"
          variant="secondary"
          onPress={() => append(createEmptyStep())}
        >
          <Plus size={16} weight="bold" />
          手順を追加
        </Button>
      </div>
    </section>
  );
};
