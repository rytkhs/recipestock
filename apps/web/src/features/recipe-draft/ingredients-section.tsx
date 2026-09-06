import { CaretDown, CaretUp, Plus, Trash, X } from "@phosphor-icons/react";
import { useController, useFieldArray } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type RecipeDraftFormControl } from "./form-internals";
import { createEmptyIngredientGroup } from "./recipe-draft-form-values";

type IngredientsSectionProps = {
  control: RecipeDraftFormControl;
};

const IngredientGroupBlock = ({
  control,
  groupIndex,
  showGroupLabel,
  onRemoveGroup,
}: {
  control: RecipeDraftFormControl;
  groupIndex: number;
  showGroupLabel: boolean;
  onRemoveGroup?: () => void;
}) => {
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: `ingredientGroups.${groupIndex}.ingredients`,
  });

  const groupLabel = useController({
    control,
    name: `ingredientGroups.${groupIndex}.label`,
  });

  return (
    <FieldGroup className="grid min-w-0 gap-3">
      {showGroupLabel && (
        <div className="grid min-w-0 gap-2 border-t border-brand-line-soft pt-4 first:border-t-0 first:pt-0 sm:flex sm:items-center">
          <Field className="min-w-0 flex-1">
            <Input
              aria-label="グループ名"
              name={groupLabel.field.name}
              placeholder="例）ソース、仕上げ"
              ref={groupLabel.field.ref}
              value={groupLabel.field.value ?? ""}
              onBlur={groupLabel.field.onBlur}
              onChange={(event) => groupLabel.field.onChange(event.target.value)}
            />
          </Field>
          {onRemoveGroup && (
            <Button
              aria-label="グループを削除"
              className="justify-self-end"
              size="icon-sm"
              variant="ghost"
              onClick={onRemoveGroup}
            >
              <Trash />
            </Button>
          )}
        </div>
      )}

      {fields.map((field, ingredientIndex) => (
        <IngredientRow
          key={field.id}
          control={control}
          groupIndex={groupIndex}
          ingredientIndex={ingredientIndex}
          isFirst={ingredientIndex === 0}
          isLast={ingredientIndex === fields.length - 1}
          onMoveDown={() => move(ingredientIndex, ingredientIndex + 1)}
          onMoveUp={() => move(ingredientIndex, ingredientIndex - 1)}
          onRemove={() => remove(ingredientIndex)}
        />
      ))}

      <Button
        className="mt-1 justify-self-center"
        size="sm"
        variant="secondary"
        onClick={() => append({ name: "", amount: "" })}
      >
        <Plus data-icon="inline-start" />
        材料を追加
      </Button>
    </FieldGroup>
  );
};

const IngredientRow = ({
  control,
  groupIndex,
  ingredientIndex,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  control: RecipeDraftFormControl;
  groupIndex: number;
  ingredientIndex: number;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) => {
  const nameField = useController({
    control,
    name: `ingredientGroups.${groupIndex}.ingredients.${ingredientIndex}.name`,
  });

  const amountField = useController({
    control,
    name: `ingredientGroups.${groupIndex}.ingredients.${ingredientIndex}.amount`,
  });

  return (
    <FieldGroup className="grid min-w-0 grid-cols-[minmax(0,1fr)_5rem_auto] items-center gap-2 rounded-[14px] border border-transparent py-0.5 transition-colors hover:border-brand-line-soft hover:bg-brand-paper-raised/70 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:py-1">
      <Field className="min-w-0">
        <Input
          aria-label="材料名"
          name={nameField.field.name}
          placeholder="材料名"
          ref={nameField.field.ref}
          value={nameField.field.value ?? ""}
          onBlur={nameField.field.onBlur}
          onChange={(event) => nameField.field.onChange(event.target.value)}
        />
      </Field>

      <Field className="min-w-0">
        <Input
          aria-label="量"
          name={amountField.field.name}
          placeholder="量"
          ref={amountField.field.ref}
          value={amountField.field.value ?? ""}
          onBlur={amountField.field.onBlur}
          onChange={(event) => amountField.field.onChange(event.target.value)}
        />
      </Field>

      <div className="flex shrink-0 items-center rounded-full border border-brand-line-soft bg-brand-paper">
        <Button
          aria-label="上に移動"
          disabled={isFirst}
          size="icon-sm"
          variant="ghost"
          onClick={onMoveUp}
        >
          <CaretUp />
        </Button>
        <Button
          aria-label="下に移動"
          disabled={isLast}
          size="icon-sm"
          variant="ghost"
          onClick={onMoveDown}
        >
          <CaretDown />
        </Button>
        <Button aria-label="材料を削除" size="icon-sm" variant="destructive" onClick={onRemove}>
          <X />
        </Button>
      </div>
    </FieldGroup>
  );
};

export const IngredientsSection = ({ control }: IngredientsSectionProps) => {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "ingredientGroups",
  });

  const yieldField = useController({ control, name: "yieldText" });

  const shouldShowSingleGroupLabel = fields.length !== 1 || Boolean(fields[0]?.label?.trim());

  return (
    <section
      className="min-w-0 overflow-hidden rounded-[16px] border border-brand-line-soft bg-brand-paper shadow-pantry-sm sm:rounded-[18px]"
      aria-labelledby="recipe-draft-ingredients-title"
    >
      <div className="flex items-center justify-between gap-3 border-brand-line-soft border-b bg-brand-paper-muted/70 px-3.5 py-3 sm:gap-4 sm:px-5">
        <h2
          className="font-semibold text-brand-walnut text-sm sm:font-bold sm:text-base"
          id="recipe-draft-ingredients-title"
        >
          材料
        </h2>
        <Button size="sm" variant="ghost" onClick={() => append(createEmptyIngredientGroup())}>
          <Plus data-icon="inline-start" />
          材料グループを追加
        </Button>
      </div>

      <div className="grid min-w-0 gap-4 px-3.5 py-3 sm:px-5">
        <FieldGroup className="sm:max-w-48">
          <Field>
            <FieldLabel htmlFor="recipe-yield-text">できあがり量</FieldLabel>
            <Input
              id="recipe-yield-text"
              name={yieldField.field.name}
              placeholder="例）2人分"
              ref={yieldField.field.ref}
              value={yieldField.field.value ?? ""}
              onBlur={yieldField.field.onBlur}
              onChange={(event) => yieldField.field.onChange(event.target.value)}
            />
          </Field>
        </FieldGroup>

        {fields.map((field, groupIndex) => (
          <IngredientGroupBlock
            key={field.id}
            control={control}
            groupIndex={groupIndex}
            showGroupLabel={shouldShowSingleGroupLabel}
            onRemoveGroup={fields.length > 1 ? () => remove(groupIndex) : undefined}
          />
        ))}
      </div>
    </section>
  );
};
