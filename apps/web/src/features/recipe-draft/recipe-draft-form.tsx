import { Button, Input, Label, ProgressBar, TextArea, TextField } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { type DraftImageRef } from "@recipestock/schemas";
import { useEffect, useMemo, useRef, useState } from "react";
import { type FieldPathByValue, useController, useFieldArray, useForm } from "react-hook-form";
import { RecipeImageUploadError, uploadRecipeImage } from "./image-upload";
import {
  createEmptyIngredientGroup,
  createEmptyStep,
  type RecipeDraftFormValues,
  recipeDraftFormSchema,
} from "./recipe-draft-form-values";

type RecipeDraftFormProps = {
  defaultValues: RecipeDraftFormValues;
  submitLabel: string;
  submitError?: string | null;
  showSourceMediaInput?: boolean;
  coverImagePreviewUrl?: string;
  sourceMediaPreviewUrls?: string[];
  stepImagePreviewUrls?: string[][];
  uploadImage?: (file: File) => Promise<DraftImageRef>;
  onSubmit(values: RecipeDraftFormValues): Promise<void> | void;
};

type RecipeDraftFormControl = ReturnType<typeof useForm<RecipeDraftFormValues>>["control"];
type RecipeDraftTextFieldPath = FieldPathByValue<RecipeDraftFormValues, string | undefined>;
type RecipeDraftImageFieldPath = FieldPathByValue<RecipeDraftFormValues, DraftImageRef | undefined>;
type RecipeDraftImageArrayFieldPath = FieldPathByValue<RecipeDraftFormValues, DraftImageRef[]>;
type ImagePreviewUrlsByImageId = Record<string, string>;

const imageInputAccept = "image/jpeg,image/png,image/webp";
const imageInputHelpText = "JPEG / PNG / WebP、5MBまで";

const imageRefId = (image: DraftImageRef) =>
  `${image.type}:${"key" in image ? image.key : image.url}`;

const addImagePreviewUrls = (
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

const createImagePreviewUrlsByImageId = ({
  defaultValues,
  sourceMediaPreviewUrls,
  stepImagePreviewUrls,
}: {
  defaultValues: RecipeDraftFormValues;
  sourceMediaPreviewUrls?: string[];
  stepImagePreviewUrls?: string[][];
}): ImagePreviewUrlsByImageId => {
  const previewUrlsByImageId: ImagePreviewUrlsByImageId = {};

  addImagePreviewUrls(previewUrlsByImageId, defaultValues.sourceMedia, sourceMediaPreviewUrls);

  defaultValues.steps.forEach((step, stepIndex) => {
    addImagePreviewUrls(previewUrlsByImageId, step.images, stepImagePreviewUrls?.[stepIndex]);
  });

  return previewUrlsByImageId;
};

const createLocalPreviewUrl = (file: File) => URL.createObjectURL(file);

const revokeLocalPreviewUrl = (url?: string | null) => {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
};

const FormInput = ({
  control,
  isRequired,
  label,
  name,
}: {
  control: RecipeDraftFormControl;
  isRequired?: boolean;
  label: string;
  name: RecipeDraftTextFieldPath;
}) => {
  const { field } = useController({ control, name });

  return (
    <TextField isRequired={isRequired}>
      <Label className="text-brand-walnut font-semibold text-sm">{label}</Label>
      <Input
        name={field.name}
        ref={field.ref}
        value={field.value ?? ""}
        onBlur={field.onBlur}
        onChange={(event) => field.onChange(event.target.value)}
      />
    </TextField>
  );
};

const ImageInput = ({
  control,
  label,
  name,
  onUploadStateChange,
  previewUrl,
  uploadImage,
}: {
  control: RecipeDraftFormControl;
  label: string;
  name: RecipeDraftImageFieldPath;
  onUploadStateChange(isUploading: boolean): void;
  previewUrl?: string;
  uploadImage: (file: File) => Promise<DraftImageRef>;
}) => {
  const { field } = useController({ control, name });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const currentPreviewUrl = localPreviewUrl ?? (field.value ? previewUrl : undefined);

  useEffect(() => () => revokeLocalPreviewUrl(localPreviewUrl), [localPreviewUrl]);

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
      setLocalPreviewUrl((currentUrl) => {
        revokeLocalPreviewUrl(currentUrl);
        return nextPreviewUrl;
      });
      field.onChange(uploadedImage);
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

  const handleRemove = () => {
    setError(null);
    setLocalPreviewUrl((currentUrl) => {
      revokeLocalPreviewUrl(currentUrl);
      return null;
    });
    field.onChange(undefined);
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Label className="text-brand-walnut font-semibold text-sm">{label}</Label>
        <p className="text-brand-muted text-sm">{imageInputHelpText}</p>
      </div>
      <div className="overflow-hidden rounded-[20px] border border-brand-line-soft bg-brand-paper shadow-pantry-sm">
        <div className="grid aspect-video place-items-center bg-brand-paper-muted">
          {currentPreviewUrl ? (
            <img
              alt={`${label}プレビュー`}
              className="h-full w-full object-cover"
              src={currentPreviewUrl}
            />
          ) : (
            <div className="px-4 text-center text-brand-muted text-sm">
              画像が選択されていません
            </div>
          )}
        </div>
        {isUploading ? <ProgressBar aria-label={`${label}アップロード中`} isIndeterminate /> : null}
        <div className="flex flex-wrap items-center gap-2 p-4">
          <input
            ref={inputRef}
            accept={imageInputAccept}
            aria-label={label}
            className="sr-only"
            disabled={isUploading}
            type="file"
            onChange={(event) => void handleChange(event)}
          />
          <Button
            className="rounded-full font-semibold"
            isDisabled={isUploading}
            variant={field.value ? "secondary" : "primary"}
            onPress={() => inputRef.current?.click()}
          >
            {field.value ? "画像を変更" : "画像を選択"}
          </Button>
          {field.value ? (
            <Button
              className="rounded-full"
              isDisabled={isUploading}
              variant="tertiary"
              onPress={handleRemove}
            >
              画像を削除
            </Button>
          ) : null}
          {isUploading ? <span className="text-brand-muted text-sm">アップロード中</span> : null}
        </div>
      </div>
      {error ? (
        <div className="rounded-[14px] bg-brand-danger/5 border border-brand-danger/20 p-3">
          <p className="text-brand-danger text-sm" role="alert">
            {error}
          </p>
        </div>
      ) : null}
    </div>
  );
};

const StepImagesInput = ({
  control,
  label,
  name,
  onUploadStateChange,
  previewUrlsByImageId,
  uploadImage,
}: {
  control: RecipeDraftFormControl;
  label: string;
  name: RecipeDraftImageArrayFieldPath;
  onUploadStateChange(isUploading: boolean): void;
  previewUrlsByImageId?: ImagePreviewUrlsByImageId;
  uploadImage: (file: File) => Promise<DraftImageRef>;
}) => {
  const { field } = useController({ control, name });
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

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Label className="text-brand-walnut font-semibold text-sm">{label}</Label>
        <p className="text-brand-muted text-sm">{imageInputHelpText}</p>
      </div>
      <input
        ref={inputRef}
        accept={imageInputAccept}
        aria-label={label}
        className="sr-only"
        disabled={isUploading}
        type="file"
        onChange={(event) => void handleChange(event)}
      />
      {images.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {images.map((image, imageIndex) => {
            const imageId = imageRefId(image);
            const imagePreviewUrl =
              localPreviewUrlsByImageId[imageId] ?? previewUrlsByImageId?.[imageId];

            return (
              <div
                className="group relative overflow-hidden rounded-[14px] border border-brand-line-soft bg-brand-paper-muted"
                key={imageId}
              >
                <div className="grid aspect-square place-items-center">
                  {imagePreviewUrl ? (
                    <img
                      alt={`${label}${imageIndex + 1}プレビュー`}
                      className="h-full w-full object-cover"
                      src={imagePreviewUrl}
                    />
                  ) : (
                    <span className="px-2 text-center text-brand-muted text-xs">保存済み画像</span>
                  )}
                </div>
                <Button
                  className="absolute top-2 right-2 rounded-full"
                  isDisabled={isUploading}
                  variant="danger"
                  onPress={() => handleRemove(imageIndex)}
                >
                  削除
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="justify-self-start rounded-full font-semibold"
          isDisabled={isUploading}
          variant="secondary"
          onPress={() => inputRef.current?.click()}
        >
          画像を追加
        </Button>
        {isUploading ? <span className="text-brand-muted text-sm">アップロード中</span> : null}
      </div>
      {isUploading ? <ProgressBar aria-label={`${label}アップロード中`} isIndeterminate /> : null}
      {error ? (
        <div className="rounded-[14px] bg-brand-danger/5 border border-brand-danger/20 p-3">
          <p className="text-brand-danger text-sm" role="alert">
            {error}
          </p>
        </div>
      ) : null}
    </div>
  );
};

const FormTextArea = ({
  control,
  label,
  name,
  rows,
}: {
  control: RecipeDraftFormControl;
  label: string;
  name: RecipeDraftTextFieldPath;
  rows: number;
}) => {
  const { field } = useController({ control, name });

  return (
    <TextField>
      <Label className="text-brand-walnut font-semibold text-sm">{label}</Label>
      <TextArea
        name={field.name}
        ref={field.ref}
        rows={rows}
        value={field.value ?? ""}
        onBlur={field.onBlur}
        onChange={(event) => field.onChange(event.target.value)}
      />
    </TextField>
  );
};

const IngredientGroupFields = ({
  control,
  groupIndex,
}: {
  control: RecipeDraftFormControl;
  groupIndex: number;
}) => {
  const { fields, append, remove } = useFieldArray({
    control,
    name: `ingredientGroups.${groupIndex}.ingredients`,
  });

  return (
    <fieldset className="grid min-w-0 gap-4 rounded-[20px] border border-brand-line-soft bg-brand-paper p-5 shadow-pantry-sm">
      <legend className="px-2 font-bold text-brand-walnut">材料グループ</legend>
      <FormInput
        control={control}
        label="グループ名"
        name={`ingredientGroups.${groupIndex}.label`}
      />

      <div className="grid gap-3">
        {fields.map((field, ingredientIndex) => (
          <div
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,12rem)_auto] sm:items-end"
            key={field.id}
          >
            <FormInput
              control={control}
              label="材料名"
              name={`ingredientGroups.${groupIndex}.ingredients.${ingredientIndex}.name`}
            />
            <FormInput
              control={control}
              label="分量"
              name={`ingredientGroups.${groupIndex}.ingredients.${ingredientIndex}.amount`}
            />
            <Button
              className="rounded-full"
              variant="secondary"
              onPress={() => remove(ingredientIndex)}
            >
              削除
            </Button>
          </div>
        ))}
      </div>

      <Button
        className="justify-self-start rounded-full font-semibold"
        variant="secondary"
        onPress={() => append({ name: "", amount: "" })}
      >
        材料を追加
      </Button>
    </fieldset>
  );
};

export const RecipeDraftForm = ({
  defaultValues,
  submitLabel,
  submitError,
  showSourceMediaInput = true,
  coverImagePreviewUrl,
  sourceMediaPreviewUrls,
  stepImagePreviewUrls,
  uploadImage = uploadRecipeImage,
  onSubmit,
}: RecipeDraftFormProps) => {
  const { control, formState, handleSubmit } = useForm<RecipeDraftFormValues>({
    resolver: zodResolver(recipeDraftFormSchema),
    defaultValues,
  });
  const ingredientGroups = useFieldArray({ control, name: "ingredientGroups" });
  const steps = useFieldArray({ control, name: "steps" });
  const [uploadingImageCount, setUploadingImageCount] = useState(0);
  const imagePreviewUrlsByImageId = useMemo(
    () =>
      createImagePreviewUrlsByImageId({
        defaultValues,
        sourceMediaPreviewUrls,
        stepImagePreviewUrls,
      }),
    [defaultValues, sourceMediaPreviewUrls, stepImagePreviewUrls],
  );
  const handleFormSubmit = handleSubmit(onSubmit);
  const handleUploadStateChange = (isUploading: boolean) => {
    setUploadingImageCount((count) => Math.max(0, count + (isUploading ? 1 : -1)));
  };

  return (
    <form className="mt-6 grid gap-5" onSubmit={(event) => void handleFormSubmit(event)}>
      <ImageInput
        control={control}
        label="カバー画像"
        name="coverImage"
        onUploadStateChange={handleUploadStateChange}
        previewUrl={coverImagePreviewUrl}
        uploadImage={uploadImage}
      />

      <FormInput control={control} isRequired label="タイトル" name="title" />

      <FormInput control={control} label="人数" name="servingsText" />

      {showSourceMediaInput ? (
        <fieldset className="grid min-w-0 gap-4 rounded-[20px] border border-brand-line-soft bg-brand-paper p-5 shadow-pantry-sm">
          <legend className="px-2 font-bold text-brand-walnut">投稿画像</legend>
          <StepImagesInput
            control={control}
            label="投稿画像"
            name="sourceMedia"
            onUploadStateChange={handleUploadStateChange}
            previewUrlsByImageId={imagePreviewUrlsByImageId}
            uploadImage={uploadImage}
          />
        </fieldset>
      ) : null}

      {ingredientGroups.fields.map((field, groupIndex) => (
        <IngredientGroupFields control={control} groupIndex={groupIndex} key={field.id} />
      ))}

      <Button
        className="justify-self-start rounded-full font-semibold"
        variant="secondary"
        onPress={() => ingredientGroups.append(createEmptyIngredientGroup())}
      >
        グループを追加
      </Button>

      <fieldset className="grid min-w-0 gap-4 rounded-[20px] border border-brand-line-soft bg-brand-paper p-5 shadow-pantry-sm">
        <legend className="px-2 font-bold text-brand-walnut">手順</legend>
        <div className="grid gap-4">
          {steps.fields.map((field, stepIndex) => (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]" key={field.id}>
              <div className="grid gap-3">
                <FormTextArea
                  control={control}
                  label="手順"
                  name={`steps.${stepIndex}.text`}
                  rows={3}
                />
                <StepImagesInput
                  control={control}
                  label={`手順${stepIndex + 1}の画像`}
                  name={`steps.${stepIndex}.images`}
                  onUploadStateChange={handleUploadStateChange}
                  previewUrlsByImageId={imagePreviewUrlsByImageId}
                  uploadImage={uploadImage}
                />
              </div>
              <Button
                className="rounded-full"
                isDisabled={uploadingImageCount > 0}
                variant="secondary"
                onPress={() => steps.remove(stepIndex)}
              >
                削除
              </Button>
            </div>
          ))}
        </div>
        <Button
          className="justify-self-start rounded-full font-semibold"
          variant="secondary"
          onPress={() => steps.append(createEmptyStep())}
        >
          手順を追加
        </Button>
      </fieldset>

      <FormTextArea control={control} label="メモ" name="note" rows={4} />

      <Button
        className="rounded-full bg-brand-sage text-white font-semibold hover:bg-brand-sage-dark"
        isDisabled={formState.isSubmitting || uploadingImageCount > 0}
        type="submit"
        variant="primary"
      >
        {submitLabel}
      </Button>

      {submitError ? (
        <div className="rounded-[14px] bg-brand-danger/5 border border-brand-danger/20 p-3">
          <p className="text-brand-danger text-sm" role="alert">
            {submitError}
          </p>
        </div>
      ) : null}
    </form>
  );
};
