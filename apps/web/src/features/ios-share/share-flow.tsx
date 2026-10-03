import { CaretRight, Export } from "@phosphor-icons/react";
import { Fragment } from "react";
import { cn } from "@/lib/utils";

const chipClass =
  "inline-flex h-8 items-center gap-1.5 rounded-full border border-brand-line-soft bg-brand-paper px-3 font-semibold text-brand-walnut text-sm";

/**
 * 共有から取り込むときに押すものを、押す順に並べる。`Recipe Stock`の札だけ塗り、共有メニューで探すものを示す。
 * 順に押すものなので、読み上げでは1つの文として読ませる。
 */
export const ShareFlow = ({ after, before }: { after?: string; before?: string }) => {
  const steps = [
    ...(before ? [{ key: "before", label: before }] : []),
    { key: "share", label: "共有" },
    { key: "app", label: "Recipe Stock" },
    ...(after ? [{ key: "after", label: after }] : []),
  ];

  return (
    <p className="flex flex-wrap items-center gap-1.5">
      <span className="sr-only">{steps.map((step) => step.label).join(" → ")}</span>
      {steps.map((step, index) => (
        <Fragment key={step.key}>
          {index > 0 ? (
            <CaretRight
              aria-hidden="true"
              className="shrink-0 text-brand-wheat"
              size={14}
              weight="bold"
            />
          ) : null}
          <span
            aria-hidden="true"
            className={cn(
              chipClass,
              step.key === "app" && "border-brand-sage bg-brand-sage text-white",
            )}
          >
            {step.key === "share" ? <Export size={16} weight="bold" /> : null}
            {step.label}
          </span>
        </Fragment>
      ))}
    </p>
  );
};
