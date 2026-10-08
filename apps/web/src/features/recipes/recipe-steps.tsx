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
            <li key={key}>
              <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 py-2">
                <span className="font-bold text-base text-brand-orange-dark leading-6 tabular-nums">
                  {stepIndex + 1}
                </span>
                <span className="whitespace-pre-wrap break-words text-[15px] text-brand-ink leading-6">
                  {step.text ?? ""}
                </span>
              </div>
              {images ? <div className="mt-1 mb-2 pl-8">{images}</div> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
};
