import { Button, Input, Label, TextArea, TextField } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm } from "react-hook-form";
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
type RecipeDraftFormRegister = ReturnType<typeof useForm<RecipeDraftFormValues>>["register"];

const IngredientGroupFields = ({
  control,
  register,
  groupIndex,
}: {
  control: RecipeDraftFormControl;
  register: RecipeDraftFormRegister;
  groupIndex: number;
}) => {
  const { fields, append, remove } = useFieldArray({
    control,
    name: `ingredientGroups.${groupIndex}.ingredients`,
  });

  return (
    <fieldset className="grid min-w-0 gap-4 rounded-lg border border-border bg-surface p-4">
      <legend className="px-1 font-semibold">材料グループ</legend>
      <TextField>
        <Label>グループ名</Label>
        <Input {...register(`ingredientGroups.${groupIndex}.label`)} />
      </TextField>

      <div className="grid gap-3">
        {fields.map((field, ingredientIndex) => (
          <div
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,12rem)_auto] sm:items-end"
            key={field.id}
          >
            <TextField>
              <Label>材料名</Label>
              <Input
                {...register(`ingredientGroups.${groupIndex}.ingredients.${ingredientIndex}.name`)}
              />
            </TextField>
            <TextField>
              <Label>分量</Label>
              <Input
                {...register(
                  `ingredientGroups.${groupIndex}.ingredients.${ingredientIndex}.amount`,
                )}
              />
            </TextField>
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
  const { control, formState, handleSubmit, register } = useForm<RecipeDraftFormValues>({
    resolver: zodResolver(recipeDraftFormSchema),
    defaultValues,
  });
  const ingredientGroups = useFieldArray({ control, name: "ingredientGroups" });
  const steps = useFieldArray({ control, name: "steps" });
  const handleFormSubmit = handleSubmit(onSubmit);

  return (
    <form className="mt-6 grid gap-4" onSubmit={(event) => void handleFormSubmit(event)}>
      <TextField isRequired>
        <Label>タイトル</Label>
        <Input {...register("title")} />
      </TextField>

      <TextField>
        <Label>人数</Label>
        <Input {...register("servingsText")} />
      </TextField>

      {ingredientGroups.fields.map((field, groupIndex) => (
        <IngredientGroupFields
          control={control}
          groupIndex={groupIndex}
          key={field.id}
          register={register}
        />
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
              <TextField>
                <Label>手順</Label>
                <TextArea rows={3} {...register(`steps.${stepIndex}.text`)} />
              </TextField>
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

      <TextField>
        <Label>メモ</Label>
        <TextArea rows={4} {...register("note")} />
      </TextField>

      <TextField>
        <Label>出典名</Label>
        <Input {...register("sourceName")} />
      </TextField>

      <TextField type="url">
        <Label>元URL</Label>
        <Input inputMode="url" {...register("sourceUrl")} />
      </TextField>

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
