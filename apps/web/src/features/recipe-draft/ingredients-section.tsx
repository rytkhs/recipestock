import { Plus } from "@phosphor-icons/react";
import {
  MAX_INGREDIENT_AMOUNT_LENGTH,
  MAX_INGREDIENT_GROUP_LABEL_LENGTH,
  MAX_INGREDIENT_NAME_LENGTH,
  MAX_RECIPE_YIELD_TEXT_LENGTH,
} from "@recipestock/schemas";
import { useId } from "react";
import { useController, useFieldArray } from "react-hook-form";
import { cn } from "@/lib/utils";
import { SectionHeader } from "../../components/section-header";
import { DraftRowMenu } from "./draft-row-menu";
import {
  draftAddRowButtonClass,
  draftInlineFieldClass,
  focusFormField,
  isAdvanceEnter,
  type RecipeDraftFormControl,
  toSingleLine,
} from "./form-internals";
import { type PastedIngredient, parsePastedIngredients } from "./ingredient-lines";
import { createEmptyIngredient, createEmptyIngredientGroup } from "./recipe-draft-form-values";

type IngredientsSectionProps = {
  control: RecipeDraftFormControl;
};

// 詳細と同じく名前を左、分量を右に置く。長い名前も分量も切らずに折り返す。
const IngredientRow = ({
  control,
  groupIndex,
  ingredientIndex,
  isFirst,
  isLast,
  onAdvanceFromAmount,
  onMoveDown,
  onMoveUp,
  onPasteLines,
  onRemove,
}: {
  control: RecipeDraftFormControl;
  groupIndex: number;
  ingredientIndex: number;
  isFirst: boolean;
  isLast: boolean;
  onAdvanceFromAmount: (amountField: HTMLTextAreaElement) => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onPasteLines: (lines: PastedIngredient[], replacesRow: boolean) => void;
  onRemove: () => void;
}) => {
  const { field: nameField } = useController({
    control,
    name: `ingredientGroups.${groupIndex}.ingredients.${ingredientIndex}.name`,
  });
  const { field: amountField } = useController({
    control,
    name: `ingredientGroups.${groupIndex}.ingredients.${ingredientIndex}.amount`,
  });
  const name = nameField.value ?? "";
  const amount = amountField.value ?? "";

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_minmax(0,7rem)_2.5rem] items-start gap-x-1 border-brand-line-soft border-b py-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)_2.5rem]">
      <textarea
        aria-label="材料名"
        className={cn(draftInlineFieldClass, "field-sizing-content")}
        enterKeyHint="next"
        maxLength={MAX_INGREDIENT_NAME_LENGTH}
        name={nameField.name}
        placeholder="材料名"
        ref={nameField.ref}
        rows={1}
        value={name}
        onBlur={nameField.onBlur}
        onChange={(event) => nameField.onChange(toSingleLine(event.target.value))}
        onKeyDown={(event) => {
          if (isAdvanceEnter(event)) {
            event.preventDefault();
            focusFormField(event.currentTarget, amountField.name);
          }
        }}
        onPaste={(event) => {
          const lines = parsePastedIngredients(event.clipboardData.getData("text/plain"));

          if (lines.length < 2) {
            return;
          }

          event.preventDefault();
          onPasteLines(lines, !name.trim() && !amount.trim());
        }}
      />
      <textarea
        aria-label="分量"
        className={cn(
          draftInlineFieldClass,
          "field-sizing-content text-right font-medium tabular-nums",
        )}
        enterKeyHint="next"
        maxLength={MAX_INGREDIENT_AMOUNT_LENGTH}
        name={amountField.name}
        placeholder="分量"
        ref={amountField.ref}
        rows={1}
        value={amount}
        onBlur={amountField.onBlur}
        onChange={(event) => amountField.onChange(toSingleLine(event.target.value))}
        onKeyDown={(event) => {
          if (isAdvanceEnter(event)) {
            event.preventDefault();
            onAdvanceFromAmount(event.currentTarget);
          }
        }}
      />
      <DraftRowMenu
        isFirst={isFirst}
        isLast={isLast}
        label={name.trim() ? `${name.trim()}の操作` : `材料${ingredientIndex + 1}の操作`}
        onMoveDown={onMoveDown}
        onMoveUp={onMoveUp}
        onRemove={onRemove}
      />
    </li>
  );
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
  const ingredientsName = `ingredientGroups.${groupIndex}.ingredients` as const;
  const { append, fields, insert, move, remove } = useFieldArray({
    control,
    name: ingredientsName,
  });
  const { field: labelField } = useController({
    control,
    name: `ingredientGroups.${groupIndex}.label`,
  });

  // 分量でEnterを押したら次の行へ。最後の行なら行を足す(追加した行の材料名に移る)。
  const advanceFromAmount = (ingredientIndex: number, amountField: HTMLTextAreaElement) => {
    if (ingredientIndex < fields.length - 1) {
      focusFormField(amountField, `${ingredientsName}.${ingredientIndex + 1}.name`);
      return;
    }

    append(createEmptyIngredient());
  };

  // 貼り付けた行は、貼り付けた行の位置に並べる。空の行に貼り付けたら、その行を置き換える。
  const pasteLines = (ingredientIndex: number, lines: PastedIngredient[], replacesRow: boolean) => {
    if (replacesRow) {
      remove(ingredientIndex);
      insert(ingredientIndex, lines, { focusIndex: ingredientIndex + lines.length - 1 });
      return;
    }

    insert(ingredientIndex + 1, lines, { focusIndex: ingredientIndex + lines.length });
  };

  return (
    <div className="mt-2">
      {showGroupLabel ? (
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-x-1">
          <input
            aria-label="グループ名"
            className={cn(draftInlineFieldClass, "font-semibold text-brand-muted")}
            maxLength={MAX_INGREDIENT_GROUP_LABEL_LENGTH}
            name={labelField.name}
            placeholder="グループ名（例：ソース）"
            ref={labelField.ref}
            value={labelField.value ?? ""}
            onBlur={labelField.onBlur}
            onChange={(event) => labelField.onChange(event.target.value)}
          />
          {onRemoveGroup ? (
            <DraftRowMenu
              label={`${labelField.value?.trim() || `グループ${groupIndex + 1}`}の操作`}
              removeLabel="グループを削除"
              onRemove={onRemoveGroup}
            />
          ) : null}
        </div>
      ) : null}

      <ul>
        {fields.map((field, ingredientIndex) => (
          <IngredientRow
            control={control}
            groupIndex={groupIndex}
            ingredientIndex={ingredientIndex}
            isFirst={ingredientIndex === 0}
            isLast={ingredientIndex === fields.length - 1}
            key={field.id}
            onAdvanceFromAmount={(amountField) => advanceFromAmount(ingredientIndex, amountField)}
            onMoveDown={() => move(ingredientIndex, ingredientIndex + 1)}
            onMoveUp={() => move(ingredientIndex, ingredientIndex - 1)}
            onPasteLines={(lines, replacesRow) => pasteLines(ingredientIndex, lines, replacesRow)}
            onRemove={() => remove(ingredientIndex)}
          />
        ))}
      </ul>

      <button
        className={draftAddRowButtonClass}
        type="button"
        onClick={() => append(createEmptyIngredient())}
      >
        <Plus aria-hidden="true" size={16} weight="bold" />
        材料を追加
      </button>
    </div>
  );
};

export const IngredientsSection = ({ control }: IngredientsSectionProps) => {
  const headingId = useId();
  const { append, fields, remove } = useFieldArray({
    control,
    name: "ingredientGroups",
  });
  const { field: yieldField } = useController({ control, name: "yieldText" });

  const shouldShowSingleGroupLabel = fields.length !== 1 || Boolean(fields[0]?.label?.trim());

  return (
    <section aria-labelledby={headingId}>
      <SectionHeader
        id={headingId}
        meta={
          <input
            aria-label="できあがり量"
            className={cn(draftInlineFieldClass, "-my-1 max-w-44 py-1 text-brand-muted")}
            maxLength={MAX_RECIPE_YIELD_TEXT_LENGTH}
            name={yieldField.name}
            placeholder="例）2人分"
            ref={yieldField.ref}
            value={yieldField.value ?? ""}
            onBlur={yieldField.onBlur}
            onChange={(event) => yieldField.onChange(event.target.value)}
          />
        }
        title="材料"
      />

      {fields.map((field, groupIndex) => (
        <IngredientGroupBlock
          control={control}
          groupIndex={groupIndex}
          key={field.id}
          showGroupLabel={shouldShowSingleGroupLabel}
          onRemoveGroup={fields.length > 1 ? () => remove(groupIndex) : undefined}
        />
      ))}

      <button
        className={cn(draftAddRowButtonClass, "text-brand-muted")}
        type="button"
        onClick={() => append(createEmptyIngredientGroup())}
      >
        <Plus aria-hidden="true" size={16} weight="bold" />
        材料グループを追加
      </button>
    </section>
  );
};
