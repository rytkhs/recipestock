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
  coverImagePreviewUrl?: string;
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

const createStepImagePreviewUrlsByImageId = (
  defaultValues: RecipeDraftFormValues,
  stepImagePreviewUrls?: string[][],
): ImagePreviewUrlsByImageId => {
  const previewUrlsByImageId: ImagePreviewUrlsByImageId = {};

  defaultValues.steps.forEach((step, stepIndex) => {
    step.images.forEach((image, imageIndex) => {
      const previewUrl = stepImagePreviewUrls?.[stepIndex]?.[imageIndex];

      if (previewUrl) {
        previewUrlsByImageId[imageRefId(image)] = previewUrl;
      }
    });
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
      <Label>{label}</Label>
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
    setLocalPreviewUrl((currentUrl) => {
      revokeLocalPreviewUrl(currentUrl);
      return nextPreviewUrl;
    });
    setIsUploading(true);
    onUploadStateChange(true);

    try {
      field.onChange(await uploadImage(file));
    } catch (uploadError) {
      revokeLocalPreviewUrl(nextPreviewUrl);
      setLocalPreviewUrl(null);
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
        <Label>{label}</Label>
        <p className="text-default-600 text-sm">{imageInputHelpText}</p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="grid aspect-video place-items-center bg-default-100">
          {currentPreviewUrl ? (
            <img
              alt={`${label}プレビュー`}
              className="h-full w-full object-cover"
              src={currentPreviewUrl}
            />
          ) : (
            <div className="px-4 text-center text-default-600 text-sm">
              画像が選択されていません
            </div>
          )}
        </div>
        {isUploading ? <ProgressBar aria-label={`${label}アップロード中`} isIndeterminate /> : null}
        <div className="flex flex-wrap items-center gap-2 p-3">
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
            isDisabled={isUploading}
            variant={field.value ? "secondary" : "primary"}
            onPress={() => inputRef.current?.click()}
          >
            {field.value ? "画像を変更" : "画像を選択"}
          </Button>
          {field.value ? (
            <Button isDisabled={isUploading} variant="tertiary" onPress={handleRemove}>
              画像を削除
            </Button>
          ) : null}
          {isUploading ? <span className="text-default-600 text-sm">アップロード中</span> : null}
        </div>
      </div>
      {error ? (
        <p className="text-danger text-sm" role="alert">
          {error}
        </p>
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
        <Label>{label}</Label>
        <p className="text-default-600 text-sm">{imageInputHelpText}</p>
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
                className="group relative overflow-hidden rounded-lg border border-border bg-default-100"
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
                    <span className="px-2 text-center text-default-600 text-xs">保存済み画像</span>
                  )}
                </div>
                <Button
                  className="absolute top-2 right-2"
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
          className="justify-self-start"
          isDisabled={isUploading}
          variant="secondary"
          onPress={() => inputRef.current?.click()}
        >
          画像を追加
        </Button>
        {isUploading ? <span className="text-default-600 text-sm">アップロード中</span> : null}
      </div>
      {isUploading ? <ProgressBar aria-label={`${label}アップロード中`} isIndeterminate /> : null}
      {error ? (
        <p className="text-danger text-sm" role="alert">
          {error}
        </p>
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
      <Label>{label}</Label>
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
    <fieldset className="grid min-w-0 gap-4 rounded-lg border border-border bg-surface p-4">
      <legend className="px-1 font-semibold">材料グループ</legend>
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
            <Button variant="secondary" onPress={() => remove(ingredientIndex)}>
              削除
            </Button>
          </div>
        ))}
      </div>

      <Button
        className="justify-self-start"
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
  coverImagePreviewUrl,
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
  const stepImagePreviewUrlsByImageId = useMemo(
    () => createStepImagePreviewUrlsByImageId(defaultValues, stepImagePreviewUrls),
    [defaultValues, stepImagePreviewUrls],
  );
  const handleFormSubmit = handleSubmit(onSubmit);
  const handleUploadStateChange = (isUploading: boolean) => {
    setUploadingImageCount((count) => Math.max(0, count + (isUploading ? 1 : -1)));
  };

  return (
    <form className="mt-6 grid gap-4" onSubmit={(event) => void handleFormSubmit(event)}>
      <FormInput control={control} isRequired label="タイトル" name="title" />

      <FormInput control={control} label="人数" name="servingsText" />

      <ImageInput
        control={control}
        label="カバー画像"
        name="coverImage"
        onUploadStateChange={handleUploadStateChange}
        previewUrl={coverImagePreviewUrl}
        uploadImage={uploadImage}
      />

      {ingredientGroups.fields.map((field, groupIndex) => (
        <IngredientGroupFields control={control} groupIndex={groupIndex} key={field.id} />
      ))}

      <Button
        className="justify-self-start"
        variant="secondary"
        onPress={() => ingredientGroups.append(createEmptyIngredientGroup())}
      >
        グループを追加
      </Button>

      <fieldset className="grid min-w-0 gap-4 rounded-lg border border-border bg-surface p-4">
        <legend className="px-1 font-semibold">手順</legend>
        <div className="grid gap-3">
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
                  previewUrlsByImageId={stepImagePreviewUrlsByImageId}
                  uploadImage={uploadImage}
                />
              </div>
              <Button
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
          className="justify-self-start"
          variant="secondary"
          onPress={() => steps.append(createEmptyStep())}
        >
          手順を追加
        </Button>
      </fieldset>

      <FormTextArea control={control} label="メモ" name="note" rows={4} />

      <Button
        isDisabled={formState.isSubmitting || uploadingImageCount > 0}
        type="submit"
        variant="primary"
      >
        {submitLabel}
      </Button>

      {submitError ? (
        <p className="text-danger" role="alert">
          {submitError}
        </p>
      ) : null}
    </form>
  );
};
