import { type IngredientGroup } from "@recipestock/schemas";
import { type ReactNode, useId } from "react";
import { SectionHeader } from "../../components/section-header";
import { withOccurrenceKeys } from "./occurrence-keys";

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
  const keyedGroups = withOccurrenceKeys(
    groups,
    (group) =>
      `${group.label ?? ""}|${group.ingredients.map((ingredient) => ingredient.name).join(",")}`,
  );

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
            ).map(({ item: ingredient, key }) => (
              <li className="flex items-start gap-3 py-2.5 text-brand-ink" key={key}>
                <span className="min-w-0 flex-1 text-base leading-6">{ingredient.name}</span>
                {ingredient.amount ? (
                  <span className="max-w-[45%] shrink-0 text-right font-medium text-base leading-6 tabular-nums">
                    {ingredient.amount}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
};
