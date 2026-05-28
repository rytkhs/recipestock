import { Button, Input, Label, TextArea, TextField } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { type FieldPathByValue, useController, useFieldArray, useForm } from "react-hook-form";
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
  onSubmit(values: RecipeDraftFormValues): Promise<void> | void;
};

type RecipeDraftFormControl = ReturnType<typeof useForm<RecipeDraftFormValues>>["control"];
type RecipeDraftTextFieldPath = FieldPathByValue<RecipeDraftFormValues, string | undefined>;

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
  onSubmit,
}: RecipeDraftFormProps) => {
  const { control, formState, handleSubmit } = useForm<RecipeDraftFormValues>({
    resolver: zodResolver(recipeDraftFormSchema),
    defaultValues,
  });
  const ingredientGroups = useFieldArray({ control, name: "ingredientGroups" });
  const steps = useFieldArray({ control, name: "steps" });
  const handleFormSubmit = handleSubmit(onSubmit);

  return (
    <form className="mt-6 grid gap-4" onSubmit={(event) => void handleFormSubmit(event)}>
      <FormInput control={control} isRequired label="タイトル" name="title" />

      <FormInput control={control} label="人数" name="servingsText" />

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
            <div
              className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
              key={field.id}
            >
              <FormTextArea
                control={control}
                label="手順"
                name={`steps.${stepIndex}.text`}
                rows={3}
              />
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

      <Button isDisabled={formState.isSubmitting} type="submit" variant="primary">
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
