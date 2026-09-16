import { type RecipeStepWithUrl } from "@recipestock/schemas";
import { type ReactNode, useId, useState } from "react";
import { cn } from "@/lib/utils";
import { withOccurrenceKeys } from "./occurrence-keys";
import { RecipeSectionHeader } from "./recipe-detail-section";

// 押した手順を「いまここ」として目立たせる。手を動かしたあとに画面へ戻っても位置を見失わないため。
// 位置は画面を開いている間だけ持ち、保存しない。
export const RecipeSteps = ({
  action,
  renderImages,
  steps,
}: {
  action?: ReactNode;
  renderImages: (stepIndex: number) => ReactNode;
  steps: readonly RecipeStepWithUrl[];
}) => {
  const headingId = useId();
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const keyedSteps = withOccurrenceKeys(
    steps,
    (step) => step.text ?? step.images.map((image) => image.objectKey).join(":"),
  );

  return (
    <section aria-labelledby={headingId}>
      <RecipeSectionHeader action={action} id={headingId} title="手順" />
      <ol className="mt-2">
        {keyedSteps.map(({ item: step, key }, stepIndex) => {
          const isCurrent = key === currentKey;
          const images = renderImages(stepIndex);

          return (
            <li aria-current={isCurrent ? "step" : undefined} className="py-0.5" key={key}>
              <button
                aria-pressed={isCurrent}
                className={cn(
                  "-mx-3 grid w-[calc(100%+1.5rem)] grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2 rounded-[14px] px-3 py-3 text-left outline-none transition-colors focus-visible:outline-2 focus-visible:outline-brand-orange",
                  isCurrent ? "bg-brand-orange-soft/45" : "hover:bg-brand-paper-muted",
                )}
                type="button"
                onClick={() => setCurrentKey(isCurrent ? null : key)}
              >
                <span className="font-bold text-brand-orange-dark text-lg leading-7 tabular-nums">
                  {stepIndex + 1}
                </span>
                <span className="whitespace-pre-wrap text-base text-brand-ink leading-7">
                  {step.text ?? ""}
                </span>
              </button>
              {images ? <div className="mt-1 mb-3 pl-9">{images}</div> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
};
