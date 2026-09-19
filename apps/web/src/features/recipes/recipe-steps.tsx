import { type RecipeStepWithUrl } from "@recipestock/schemas";
import { type ReactNode, useId } from "react";
import { SectionHeader } from "../../components/section-header";
import { withOccurrenceKeys } from "./occurrence-keys";

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
  const keyedSteps = withOccurrenceKeys(
    steps,
    (step) => step.text ?? step.images.map((image) => image.objectKey).join(":"),
  );

  return (
    <section aria-labelledby={headingId}>
      <SectionHeader action={action} id={headingId} title="手順" />
      <ol className="mt-2">
        {keyedSteps.map(({ item: step, key }, stepIndex) => {
          const images = renderImages(stepIndex);

          return (
            <li className="py-0.5" key={key}>
              <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2 py-3">
                <span className="font-bold text-brand-orange-dark text-lg leading-7 tabular-nums">
                  {stepIndex + 1}
                </span>
                <span className="whitespace-pre-wrap break-words text-base text-brand-ink leading-7">
                  {step.text ?? ""}
                </span>
              </div>
              {images ? <div className="mt-1 mb-3 pl-9">{images}</div> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
};
