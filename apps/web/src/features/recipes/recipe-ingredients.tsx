import { Check } from "@phosphor-icons/react";
import { type IngredientGroup } from "@recipestock/schemas";
import { type ReactNode, useId, useState } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "../../components/section-header";
import { withOccurrenceKeys } from "./occurrence-keys";

// 材料は用意できたものに印を付けながら読む。印は画面を開いている間だけ持ち、保存しない。
export const RecipeIngredients = ({
  action,
  groups,
  yieldText,
}: {
  action?: ReactNode;
  groups: readonly IngredientGroup[];
  yieldText?: string;
}) => {
  const headingId = useId();
  const [checkedKeys, setCheckedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const keyedGroups = withOccurrenceKeys(
    groups,
    (group) =>
      `${group.label ?? ""}|${group.ingredients.map((ingredient) => ingredient.name).join(",")}`,
  );

  const toggleChecked = (key: string) => {
    setCheckedKeys((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  };

  return (
    <section aria-labelledby={headingId}>
      <SectionHeader action={action} id={headingId} meta={yieldText} title="材料" />
      {keyedGroups.map(({ item: group, key: groupKey }) => (
        <div className="mt-3" key={groupKey}>
          {group.label ? (
            <h3 className="pt-2 pb-0.5 font-semibold text-[13px] text-brand-muted tracking-[0.04em]">
              {group.label}
            </h3>
          ) : null}
          <ul className="divide-y divide-brand-line-soft">
            {withOccurrenceKeys(
              group.ingredients,
              (ingredient) => `${ingredient.name}:${ingredient.amount}`,
            ).map(({ item: ingredient, key }) => {
              const checkedKey = `${groupKey}/${key}`;
              const isChecked = checkedKeys.has(checkedKey);

              return (
                <li key={key}>
                  <button
                    aria-pressed={isChecked}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-[6px] py-2.5 text-left outline-none transition-colors focus-visible:outline-2 focus-visible:outline-brand-orange focus-visible:outline-offset-2",
                      isChecked ? "text-brand-muted" : "text-brand-ink",
                    )}
                    type="button"
                    onClick={() => toggleChecked(checkedKey)}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border transition-colors",
                        isChecked
                          ? "border-brand-sage bg-brand-sage text-primary-foreground"
                          : "border-brand-line bg-brand-paper",
                      )}
                    >
                      {isChecked ? <Check size={12} weight="bold" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 text-base leading-6">{ingredient.name}</span>
                    {ingredient.amount ? (
                      <span className="max-w-[45%] shrink-0 text-right font-medium text-base leading-6 tabular-nums">
                        {ingredient.amount}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
};
