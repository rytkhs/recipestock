import { Button, Input } from "@heroui/react";
import { CaretDown, CaretUp, Plus, Trash, X } from "@phosphor-icons/react";
import { useController, useFieldArray } from "react-hook-form";
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
    <div className="grid gap-3">
      {showGroupLabel && (
        <div className="grid gap-2 border-t border-brand-line-soft pt-4 first:border-t-0 first:pt-0 sm:flex sm:items-center">
          <Input
            aria-label="グループ名"
            className="h-9 min-w-0 flex-1 text-sm font-semibold sm:h-10 sm:text-base"
            name={groupLabel.field.name}
            placeholder="例）ソース、仕上げ"
            ref={groupLabel.field.ref}
            variant="secondary"
            value={groupLabel.field.value ?? ""}
            onBlur={groupLabel.field.onBlur}
            onChange={(event) => groupLabel.field.onChange(event.target.value)}
          />
          {onRemoveGroup && (
            <Button
              aria-label="グループを削除"
              className="h-9 min-w-9 justify-self-end rounded-full px-0 text-brand-muted"
              isIconOnly
              size="sm"
              variant="tertiary"
              onPress={onRemoveGroup}
            >
              <Trash size={16} />
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
        className="mt-1 justify-self-center rounded-full border border-brand-line bg-brand-paper px-4 text-brand-sage text-sm font-semibold hover:bg-brand-paper-muted"
        size="sm"
        variant="secondary"
        onPress={() => append({ name: "", amount: "" })}
      >
        <Plus size={14} />
        材料を追加
      </Button>
    </div>
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
    <div className="grid grid-cols-[minmax(0,1fr)_6rem_auto] items-center gap-2 rounded-[14px] border border-transparent py-0.5 transition-colors hover:border-brand-line-soft hover:bg-brand-paper-raised/70 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:py-1">
      <Input
        aria-label="材料名"
        className="h-9 min-w-0 text-sm sm:h-10 sm:text-base"
        name={nameField.field.name}
        placeholder="材料名"
        ref={nameField.field.ref}
        variant="secondary"
        value={nameField.field.value ?? ""}
        onBlur={nameField.field.onBlur}
        onChange={(event) => nameField.field.onChange(event.target.value)}
      />

      <Input
        aria-label="量"
        className="h-9 min-w-0 text-sm sm:h-10 sm:text-base"
        name={amountField.field.name}
        placeholder="量"
        ref={amountField.field.ref}
        variant="secondary"
        value={amountField.field.value ?? ""}
        onBlur={amountField.field.onBlur}
        onChange={(event) => amountField.field.onChange(event.target.value)}
      />

      <div className="flex shrink-0 items-center rounded-full border border-brand-line-soft bg-brand-paper">
        <Button
          aria-label="上に移動"
          className="h-8 min-w-8 rounded-full px-0 text-brand-muted"
          isDisabled={isFirst}
          isIconOnly
          size="sm"
          variant="ghost"
          onPress={onMoveUp}
        >
          <CaretUp size={13} />
        </Button>
        <Button
          aria-label="下に移動"
          className="h-8 min-w-8 rounded-full px-0 text-brand-muted"
          isDisabled={isLast}
          isIconOnly
          size="sm"
          variant="ghost"
          onPress={onMoveDown}
        >
          <CaretDown size={13} />
        </Button>
        <Button
          aria-label="材料を削除"
          className="h-8 min-w-8 rounded-full px-0 text-brand-muted hover:text-brand-danger"
          isIconOnly
          size="sm"
          variant="ghost"
          onPress={onRemove}
        >
          <X size={15} />
        </Button>
      </div>
    </div>
  );
};

export const IngredientsSection = ({ control }: IngredientsSectionProps) => {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "ingredientGroups",
  });

  const yieldField = useController({ control, name: "yieldText" });

  const isSingleEmptyLabelGroup = fields.length === 1;

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
        <Button
          className="h-8 rounded-full px-3 text-brand-sage text-xs font-semibold sm:text-sm"
          size="sm"
          variant="ghost"
          onPress={() => append(createEmptyIngredientGroup())}
        >
          <Plus size={14} />
          材料グループを追加
        </Button>
      </div>

      <div className="grid gap-4 px-3.5 py-3 sm:px-5">
        <div className="grid gap-2 sm:max-w-48">
          <label className="text-brand-walnut text-sm font-semibold" htmlFor="recipe-yield-text">
            できあがり量
          </label>
          <Input
            id="recipe-yield-text"
            aria-label="できあがり量"
            className="h-9 text-sm sm:h-10 sm:text-base"
            name={yieldField.field.name}
            placeholder="例）2人分"
            ref={yieldField.field.ref}
            variant="secondary"
            value={yieldField.field.value ?? ""}
            onBlur={yieldField.field.onBlur}
            onChange={(event) => yieldField.field.onChange(event.target.value)}
          />
        </div>

        {fields.map((field, groupIndex) => (
          <IngredientGroupBlock
            key={field.id}
            control={control}
            groupIndex={groupIndex}
            showGroupLabel={!isSingleEmptyLabelGroup}
            onRemoveGroup={fields.length > 1 ? () => remove(groupIndex) : undefined}
          />
        ))}
      </div>
    </section>
  );
};
