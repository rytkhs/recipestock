import { Plus } from "@phosphor-icons/react";
import { type DraftImageRef, MAX_RECIPE_STEP_IMAGES } from "@recipestock/schemas";
import { useId, useRef } from "react";
import { useController, useFieldArray, useWatch } from "react-hook-form";
import { cn } from "@/lib/utils";
import { RecipeSectionHeader } from "../recipes/recipe-detail-section";
import {
  DraftAddImageButton,
  DraftAddPhotoButton,
  DraftImageTile,
  DraftPendingImageTile,
} from "./draft-image-tile";
import { DraftRowMenu } from "./draft-row-menu";
import {
  draftAddRowButtonClass,
  draftInlineFieldClass,
  type ImagePreviewUrlsByImageId,
  imageInputAccept,
  imageLimitReachedText,
  imageRefId,
  type RecipeDraftFormControl,
} from "./form-internals";
import { createEmptyStep } from "./recipe-draft-form-values";
import { useDraftImageList } from "./use-draft-image-list";

type StepImageProps = {
  control: RecipeDraftFormControl;
  onUploadStateChange(isUploading: boolean): void;
  previewUrlsByImageId?: ImagePreviewUrlsByImageId;
  uploadImage: (file: File) => Promise<DraftImageRef>;
};

type StepsSectionProps = StepImageProps & {
  // 手順画像の書き戻し先は steps.N.images の N で決まる。上げている途中で行が動くと
  // 別の手順に画像が入るので、どこか1枚でもアップロード中の間は行を動かさない。
  // 表紙の分も含めて受け取るのは、止める範囲を画面全体で揃えるため。
  isUploadingImage: boolean;
  remainingTotalImages: number;
};

const StepImages = ({
  control,
  maxAddable,
  onUploadStateChange,
  previewUrlsByImageId,
  stepIndex,
  uploadImage,
}: StepImageProps & {
  maxAddable: number;
  stepIndex: number;
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const stepLabel = `手順${stepIndex + 1}`;
  const { addFiles, error, images, isUploading, pendingImages, previewUrlFor, removeImage } =
    useDraftImageList({
      control,
      maxAddable,
      name: `steps.${stepIndex}.images`,
      onUploadStateChange,
      previewUrlsByImageId,
      uploadImage,
    });
  const isAddDisabled = maxAddable <= 0;
  const openPicker = () => inputRef.current?.click();

  return (
    <div className="px-2">
      <input
        ref={inputRef}
        accept={imageInputAccept}
        aria-label={`${stepLabel}の画像`}
        className="sr-only"
        disabled={isUploading || isAddDisabled}
        multiple
        type="file"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void addFiles(files);
        }}
      />

      {images.length > 0 || pendingImages.length > 0 ? (
        <div className="flex snap-x gap-2 overflow-x-auto pt-1 pb-2">
          {images.map((image, imageIndex) => (
            <DraftImageTile
              className="size-20"
              disabled={isUploading}
              key={imageRefId(image)}
              label={`${stepLabel}の画像${imageIndex + 1}`}
              src={previewUrlFor(image)}
              onRemove={() => removeImage(imageIndex)}
            />
          ))}
          {pendingImages.map((pendingImage) => (
            <DraftPendingImageTile
              className="size-20"
              key={pendingImage.id}
              label={`${stepLabel}の画像をアップロード中`}
              previewUrl={pendingImage.previewUrl}
            />
          ))}
          {isAddDisabled ? null : (
            <DraftAddImageButton
              className="size-20"
              disabled={isUploading}
              label={`${stepLabel}に写真を追加`}
              onClick={openPicker}
            />
          )}
        </div>
      ) : null}
      {images.length === 0 && pendingImages.length === 0 && !isAddDisabled ? (
        <div className="-mx-2 pb-1">
          <DraftAddPhotoButton label={`${stepLabel}に写真を追加`} onClick={openPicker} />
        </div>
      ) : null}

      {isAddDisabled ? (
        <p className="pb-2 text-brand-muted text-xs">{imageLimitReachedText}</p>
      ) : null}
      {error ? (
        <p className="pb-2 text-brand-danger text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
};

const StepRow = ({
  isFirst,
  isLast,
  isUploading,
  maxAddableImages,
  stepIndex,
  onMoveDown,
  onMoveUp,
  onRemove,
  ...imageProps
}: StepImageProps & {
  isFirst: boolean;
  isLast: boolean;
  isUploading: boolean;
  maxAddableImages: number;
  stepIndex: number;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onRemove: () => void;
}) => {
  const { field } = useController({ control: imageProps.control, name: `steps.${stepIndex}.text` });
  const stepLabel = `手順${stepIndex + 1}`;

  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)_2.5rem] gap-x-1 border-brand-line-soft border-b py-1.5 last:border-b-0">
      <span
        aria-hidden="true"
        className="py-2 font-bold text-brand-orange-dark text-lg leading-7 tabular-nums"
      >
        {stepIndex + 1}
      </span>
      <textarea
        aria-label={stepLabel}
        className={cn(draftInlineFieldClass, "field-sizing-content min-h-[4.5rem] leading-7")}
        name={field.name}
        placeholder="手順を入力"
        ref={field.ref}
        rows={2}
        value={field.value ?? ""}
        onBlur={field.onBlur}
        onChange={(event) => field.onChange(event.target.value)}
      />
      <DraftRowMenu
        disabled={isUploading}
        isFirst={isFirst}
        isLast={isLast}
        label={`${stepLabel}の操作`}
        onMoveDown={onMoveDown}
        onMoveUp={onMoveUp}
        onRemove={onRemove}
      />
      <div className="col-start-2 col-end-4">
        <StepImages {...imageProps} maxAddable={maxAddableImages} stepIndex={stepIndex} />
      </div>
    </li>
  );
};

export const StepsSection = ({
  control,
  isUploadingImage,
  onUploadStateChange,
  previewUrlsByImageId,
  remainingTotalImages,
  uploadImage,
}: StepsSectionProps) => {
  const headingId = useId();
  const { append, fields, remove, swap } = useFieldArray({ control, name: "steps" });
  const watchedSteps = useWatch({ control, name: "steps" });

  return (
    <section aria-labelledby={headingId}>
      <RecipeSectionHeader id={headingId} title="手順" />
      <ol className="mt-1">
        {fields.map((field, stepIndex) => (
          <StepRow
            control={control}
            isFirst={stepIndex === 0}
            isLast={stepIndex === fields.length - 1}
            isUploading={isUploadingImage}
            key={field.id}
            maxAddableImages={Math.min(
              MAX_RECIPE_STEP_IMAGES - (watchedSteps?.[stepIndex]?.images?.length ?? 0),
              remainingTotalImages,
            )}
            previewUrlsByImageId={previewUrlsByImageId}
            stepIndex={stepIndex}
            uploadImage={uploadImage}
            onMoveDown={() => swap(stepIndex, stepIndex + 1)}
            onMoveUp={() => swap(stepIndex, stepIndex - 1)}
            onRemove={() => remove(stepIndex)}
            onUploadStateChange={onUploadStateChange}
          />
        ))}
      </ol>
      <button
        className={draftAddRowButtonClass}
        type="button"
        onClick={() => append(createEmptyStep())}
      >
        <Plus aria-hidden="true" size={16} weight="bold" />
        手順を追加
      </button>
    </section>
  );
};
