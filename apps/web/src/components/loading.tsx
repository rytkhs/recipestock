import { Skeleton } from "@heroui/react";
import { type ReactNode } from "react";

const skeletonBaseClass =
  "overflow-hidden rounded-[14px] border border-brand-line-soft/50 bg-brand-paper-muted";
const detailStepSkeletonKeys = [
  "detail-step-primary",
  "detail-step-secondary",
  "detail-step-tertiary",
];
const formStepSkeletonKeys = ["form-step-primary", "form-step-secondary"];

type SkeletonBlockProps = {
  className?: string;
};

export const SkeletonBlock = ({ className = "" }: SkeletonBlockProps) => (
  <Skeleton aria-hidden="true" className={`${skeletonBaseClass} ${className}`} />
);

export const LoadingStatus = ({ label = "読み込み中" }: { label?: string }) => (
  <section
    aria-label={label}
    className="mx-auto w-full max-w-[1120px] px-4 py-8 sm:px-6 lg:px-10"
    role="status"
  >
    <div className="inline-flex items-center gap-3 rounded-full border border-brand-line-soft bg-brand-paper/80 px-4 py-2 shadow-pantry-sm">
      <div
        aria-hidden="true"
        className="h-2.5 w-2.5 rounded-full bg-brand-sage shadow-[0_0_0_5px_rgba(118,128,85,0.13)]"
      />
      <p className="text-brand-muted text-sm">{label}</p>
    </div>
  </section>
);

export const RecipeCardSkeleton = ({ viewMode }: { viewMode: "grid" | "list" }) => {
  if (viewMode === "list") {
    return (
      <div
        aria-hidden="true"
        className="flex overflow-hidden rounded-[18px] border border-brand-line-soft bg-brand-paper p-1.5 shadow-pantry-sm sm:p-2"
        data-testid="recipe-card-skeleton"
      >
        <SkeletonBlock className="h-16 w-16 shrink-0 rounded-[10px] sm:h-20 sm:w-20 sm:rounded-[12px]" />
        <div className="flex min-w-0 flex-1 flex-col justify-center px-4 py-1">
          <SkeletonBlock className="h-4 w-3/4" />
          <SkeletonBlock className="mt-2 h-4 w-1/2" />
          <SkeletonBlock className="mt-3 h-5 w-28 rounded-full" />
        </div>
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className="flex overflow-hidden rounded-[18px] border border-brand-line-soft bg-brand-paper shadow-pantry-sm sm:rounded-[20px]"
      data-testid="recipe-card-skeleton"
    >
      <div className="flex w-full flex-col">
        <SkeletonBlock className="aspect-[4/3] w-full rounded-none border-0 sm:aspect-video" />
        <div className="flex flex-1 flex-col p-3 sm:p-4">
          <SkeletonBlock className="h-4 w-5/6" />
          <SkeletonBlock className="mt-2 h-4 w-2/3" />
          <div className="mt-auto pt-3">
            <SkeletonBlock className="h-6 w-28 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
};

const SectionSkeleton = ({ titleWidth, children }: { titleWidth: string; children: ReactNode }) => (
  <section className="rounded-[20px] border border-brand-line-soft bg-brand-paper p-5 shadow-pantry-sm sm:p-6">
    <SkeletonBlock className={`h-5 ${titleWidth}`} />
    <div className="mt-5">{children}</div>
  </section>
);

export const RecipeDetailSkeleton = () => (
  <article
    aria-label="レシピ詳細を読み込み中"
    className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-10"
    role="status"
  >
    <div className="mb-5 flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <SkeletonBlock className="h-8 w-3/4 rounded-[16px]" />
        <SkeletonBlock className="mt-3 h-6 w-36 rounded-full" />
      </div>
      <SkeletonBlock className="h-10 w-20 rounded-full" />
    </div>

    <SkeletonBlock className="aspect-[4/3] w-full rounded-[22px] sm:aspect-video" />

    <div className="mt-6 grid gap-5">
      <SectionSkeleton titleWidth="w-20">
        <div className="grid gap-3">
          <SkeletonBlock className="h-5 w-full" />
          <SkeletonBlock className="h-5 w-5/6" />
          <SkeletonBlock className="h-5 w-2/3" />
        </div>
      </SectionSkeleton>

      <SectionSkeleton titleWidth="w-20">
        <div className="grid gap-4">
          {detailStepSkeletonKeys.map((key) => (
            <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3" key={key}>
              <SkeletonBlock className="h-8 w-8 rounded-full" />
              <div>
                <SkeletonBlock className="h-5 w-full" />
                <SkeletonBlock className="mt-2 h-5 w-4/5" />
              </div>
            </div>
          ))}
        </div>
      </SectionSkeleton>

      <SectionSkeleton titleWidth="w-16">
        <SkeletonBlock className="h-20 w-full" />
      </SectionSkeleton>
    </div>
  </article>
);

export const RecipeFormSkeleton = () => (
  <form
    aria-label="レシピ編集フォームを読み込み中"
    className="mx-auto w-full max-w-4xl px-0 pb-10 sm:px-6 lg:px-10"
    role="status"
  >
    <div className="sticky top-0 z-20 border-b border-brand-line-soft bg-brand-cream/95 px-3 py-2.5 backdrop-blur-md sm:top-3 sm:mt-3 sm:rounded-[20px] sm:border sm:px-5 sm:py-3 sm:shadow-pantry-sm">
      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto] sm:gap-3">
        <SkeletonBlock className="h-10 w-10 rounded-full sm:h-11 sm:w-11" />
        <SkeletonBlock className="mx-auto h-5 w-40" />
        <SkeletonBlock className="h-10 w-20 rounded-full sm:h-11" />
      </div>
    </div>

    <div className="mt-4 grid gap-5 px-3 sm:mt-6 sm:px-0">
      <section className="rounded-[20px] border border-brand-line-soft bg-brand-paper p-4 shadow-pantry-sm sm:p-5">
        <SkeletonBlock className="aspect-[4/3] w-full rounded-[18px] sm:aspect-video" />
        <SkeletonBlock className="mt-4 h-12 w-full" />
        <SkeletonBlock className="mt-3 h-10 w-44" />
      </section>

      <SectionSkeleton titleWidth="w-28">
        <div className="grid grid-cols-3 gap-3">
          <SkeletonBlock className="aspect-square w-full rounded-[16px]" />
          <SkeletonBlock className="aspect-square w-full rounded-[16px]" />
          <SkeletonBlock className="aspect-square w-full rounded-[16px]" />
        </div>
      </SectionSkeleton>

      <SectionSkeleton titleWidth="w-16">
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <SkeletonBlock className="h-11 w-full" />
            <SkeletonBlock className="h-11 w-full" />
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <SkeletonBlock className="h-11 w-full" />
            <SkeletonBlock className="h-11 w-full" />
          </div>
        </div>
      </SectionSkeleton>

      <SectionSkeleton titleWidth="w-16">
        <div className="grid gap-4">
          {formStepSkeletonKeys.map((key) => (
            <div
              className="rounded-[16px] border border-brand-line-soft bg-brand-paper-raised p-4"
              key={key}
            >
              <SkeletonBlock className="h-24 w-full" />
              <SkeletonBlock className="mt-3 h-10 w-36 rounded-full" />
            </div>
          ))}
        </div>
      </SectionSkeleton>

      <SectionSkeleton titleWidth="w-12">
        <SkeletonBlock className="h-24 w-full" />
      </SectionSkeleton>
    </div>
  </form>
);
