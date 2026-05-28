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
    <fieldset className="form-section">
      <legend>材料グループ</legend>
      <label htmlFor={`ingredient-group-${groupIndex}-label`}>グループ名</label>
      <input
        id={`ingredient-group-${groupIndex}-label`}
        {...register(`ingredientGroups.${groupIndex}.label`)}
      />

      <div className="stack">
        {fields.map((field, ingredientIndex) => (
          <div className="inline-fields" key={field.id}>
            <label>
              材料名
              <input
                {...register(`ingredientGroups.${groupIndex}.ingredients.${ingredientIndex}.name`)}
              />
            </label>
            <label>
              分量
              <input
                {...register(
                  `ingredientGroups.${groupIndex}.ingredients.${ingredientIndex}.amount`,
                )}
              />
            </label>
            <button
              className="secondary-button"
              type="button"
              onClick={() => remove(ingredientIndex)}
            >
              削除
            </button>
          </div>
        ))}
      </div>

      <button
        className="secondary-button"
        type="button"
        onClick={() => append({ name: "", amount: "" })}
      >
        材料を追加
      </button>
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
    <form className="recipe-form" onSubmit={(event) => void handleFormSubmit(event)}>
      <label htmlFor="recipe-title">タイトル</label>
      <input id="recipe-title" required {...register("title")} />

      <label htmlFor="recipe-servings">人数</label>
      <input id="recipe-servings" {...register("servingsText")} />

      {ingredientGroups.fields.map((field, groupIndex) => (
        <IngredientGroupFields
          control={control}
          groupIndex={groupIndex}
          key={field.id}
          register={register}
        />
      ))}

      <button
        className="secondary-button"
        type="button"
        onClick={() => ingredientGroups.append(createEmptyIngredientGroup())}
      >
        グループを追加
      </button>

      <fieldset className="form-section">
        <legend>手順</legend>
        <div className="stack">
          {steps.fields.map((field, stepIndex) => (
            <div className="inline-fields" key={field.id}>
              <label>
                手順
                <textarea rows={3} {...register(`steps.${stepIndex}.text`)} />
              </label>
              <button
                className="secondary-button"
                type="button"
                onClick={() => steps.remove(stepIndex)}
              >
                削除
              </button>
            </div>
          ))}
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => steps.append(createEmptyStep())}
        >
          手順を追加
        </button>
      </fieldset>

      <label htmlFor="recipe-note">メモ</label>
      <textarea id="recipe-note" rows={4} {...register("note")} />

      <label htmlFor="recipe-source-name">出典名</label>
      <input id="recipe-source-name" {...register("sourceName")} />

      <label htmlFor="recipe-source-url">元URL</label>
      <input id="recipe-source-url" inputMode="url" type="url" {...register("sourceUrl")} />

      <button className="primary-button" disabled={formState.isSubmitting} type="submit">
        {submitLabel}
      </button>

      {submitError ? <p role="alert">{submitError}</p> : null}
    </form>
  );
};
