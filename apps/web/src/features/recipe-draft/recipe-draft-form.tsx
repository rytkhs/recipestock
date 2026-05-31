import { Button, Input, Label, TextArea, TextField } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { type DraftImageRef } from "@recipestock/schemas";
import { useState } from "react";
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
  uploadImage?: (file: File) => Promise<DraftImageRef>;
  onSubmit(values: RecipeDraftFormValues): Promise<void> | void;
};

type RecipeDraftFormControl = ReturnType<typeof useForm<RecipeDraftFormValues>>["control"];
type RecipeDraftTextFieldPath = FieldPathByValue<RecipeDraftFormValues, string | undefined>;
type RecipeDraftImageFieldPath = FieldPathByValue<RecipeDraftFormValues, DraftImageRef | undefined>;

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
  uploadImage,
}: {
  control: RecipeDraftFormControl;
  label: string;
  name: RecipeDraftImageFieldPath;
  onUploadStateChange(isUploading: boolean): void;
  uploadImage: (file: File) => Promise<DraftImageRef>;
}) => {
  const { field } = useController({ control, name });
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setError(null);
    setIsUploading(true);
    onUploadStateChange(true);

    try {
      field.onChange(await uploadImage(file));
    } catch (uploadError) {
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

  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          accept="image/jpeg,image/png,image/webp"
          aria-label={label}
          type="file"
          onChange={(event) => void handleChange(event)}
        />
        {field.value ? (
          <Button variant="secondary" onPress={() => field.onChange(undefined)}>
            画像を削除
          </Button>
        ) : null}
      </div>
      {isUploading ? <p className="text-default-600 text-sm">アップロード中</p> : null}
      {field.value ? <p className="text-default-600 text-sm">画像あり</p> : null}
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
                <ImageInput
                  control={control}
                  label={`手順${stepIndex + 1}の画像`}
                  name={`steps.${stepIndex}.image`}
                  onUploadStateChange={handleUploadStateChange}
                  uploadImage={uploadImage}
                />
              </div>
              <Button variant="secondary" onPress={() => steps.remove(stepIndex)}>
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
