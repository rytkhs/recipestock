import {
  Article,
  CaretRight,
  CaretUp,
  Check,
  CookingPot,
  Globe,
  type Icon,
  InstagramLogo,
  TiktokLogo,
  X,
  XLogo,
  YoutubeLogo,
} from "@phosphor-icons/react";
import { type RecentImportJob } from "@recipestock/schemas";
import { Link } from "@tanstack/react-router";
import { useRef } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { PlanLink } from "../billing/plan-link";
import { RecipeCover } from "../recipes/recipe-cover";
import { type ImportIslandView } from "./island-state";
import { getImportJobFailureMessage } from "./messages";
import { getImportJobRecovery } from "./recovery";
import { describeImportSource, type ImportSourceKind } from "./source";
import { type ImportIsland as ImportIslandState } from "./use-import-island";
import { isActiveImportJob } from "./workflow";

/**
 * - `beside-fab`: スマホの一覧では追加ボタンの左に並べる。連続して取り込めるよう、保存できたときも大きさを変えない
 * - `center`: ほかの画面では下の中央に置き、保存できたときはレシピ名が読めるよう広げる
 */
export type ImportIslandPlacement = "beside-fab" | "center";

const sourceIcons: Record<ImportSourceKind, Icon> = {
  youtube: YoutubeLogo,
  instagram: InstagramLogo,
  tiktok: TiktokLogo,
  x: XLogo,
  web: Globe,
  text: Article,
};

const activeStatusLabel = (job: RecentImportJob) =>
  job.status === "queued" ? "取り込み待ち" : "取り込み中";

const jobIconToneClass = (job: RecentImportJob) => {
  if (job.status === "failed") return "bg-brand-danger/10 text-brand-danger";
  if (job.status === "succeeded") return "bg-brand-sage-soft text-brand-sage-dark";
  return "bg-brand-orange-soft/60 text-brand-orange-dark";
};

const ImportJobIcon = ({ job }: { job: RecentImportJob }) => {
  const SourceIcon = sourceIcons[describeImportSource(job).kind];

  return (
    <span aria-hidden="true" className="relative flex size-10 shrink-0">
      <span
        className={cn(
          "flex size-10 items-center justify-center rounded-full",
          jobIconToneClass(job),
        )}
      >
        <SourceIcon size={20} weight="bold" />
      </span>
      {job.status === "running" ? (
        <svg
          aria-hidden="true"
          className="absolute -inset-1 size-12 animate-spin text-brand-orange [animation-duration:1.1s] motion-reduce:animate-none"
          viewBox="0 0 48 48"
        >
          <circle
            cx="24"
            cy="24"
            fill="none"
            r="22"
            stroke="currentColor"
            strokeDasharray="38 101"
            strokeLinecap="round"
            strokeWidth="2.5"
          />
        </svg>
      ) : null}
      {job.status === "queued" ? (
        <svg
          aria-hidden="true"
          className="absolute -inset-1 size-12 text-brand-line"
          viewBox="0 0 48 48"
        >
          <circle
            cx="24"
            cy="24"
            fill="none"
            r="22"
            stroke="currentColor"
            strokeDasharray="2 5"
            strokeLinecap="round"
            strokeWidth="2"
          />
        </svg>
      ) : null}
    </span>
  );
};

const StackedJobIcons = ({ jobs }: { jobs: readonly RecentImportJob[] }) => (
  <span aria-hidden="true" className="flex shrink-0 items-center">
    {jobs.slice(0, 3).map((job, index) => {
      const SourceIcon = sourceIcons[describeImportSource(job).kind];

      return (
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-full border-2 border-brand-paper",
            jobIconToneClass(job),
            index > 0 && "-ml-2.5",
          )}
          key={job.id}
        >
          <SourceIcon size={15} weight="bold" />
        </span>
      );
    })}
  </span>
);

const SavedRecipeThumb = ({ job, isCompact }: { job: RecentImportJob; isCompact: boolean }) => (
  <span
    aria-hidden="true"
    className={cn(
      "flex shrink-0 items-center justify-center overflow-hidden border-2 border-brand-sage-dark bg-brand-paper-muted text-brand-wheat",
      isCompact ? "size-10 rounded-[10px]" : "size-12 rounded-[12px]",
    )}
  >
    {job.recipeId && job.recipe ? (
      <span className="@container size-full">
        <RecipeCover
          index={0}
          recipe={{
            id: job.recipeId,
            title: job.recipe.title,
            coverImageUrl: job.recipe.coverImageUrl,
          }}
        />
      </span>
    ) : (
      <CookingPot size={22} weight="bold" />
    )}
  </span>
);

const SavedSummary = ({
  jobs,
  isCompact,
}: {
  jobs: readonly RecentImportJob[];
  isCompact: boolean;
}) => {
  const [firstJob] = jobs;

  return (
    <>
      <span className="relative flex shrink-0 items-center">
        {jobs.slice(0, 3).map((job, index) => (
          <span className={cn(index > 0 && (isCompact ? "-ml-5" : "-ml-6"))} key={job.id}>
            <SavedRecipeThumb isCompact={isCompact} job={job} />
          </span>
        ))}
        <span
          aria-hidden="true"
          className="absolute -right-1.5 -bottom-1.5 flex size-5 items-center justify-center rounded-full border-2 border-brand-sage-dark bg-brand-sage-soft text-brand-sage-dark"
        >
          <Check size={11} weight="bold" />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-brand-sage-soft text-xs">保存しました</span>
        <span
          className={cn(
            "mt-0.5 block truncate font-semibold text-white",
            isCompact ? "text-sm" : "text-[15px]",
          )}
        >
          {jobs.length === 1 ? (firstJob?.recipe?.title ?? "レシピ") : `${jobs.length}件のレシピ`}
        </span>
      </span>
    </>
  );
};

const SingleSummary = ({
  job,
  isHighlighted,
}: {
  job: RecentImportJob;
  isHighlighted: boolean;
}) => {
  const isFailed = job.status === "failed";
  const title = isFailed
    ? "取り込めませんでした"
    : isHighlighted
      ? "もう取り込んでいます"
      : activeStatusLabel(job);

  return (
    <>
      <ImportJobIcon job={job} />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate font-semibold text-sm",
            isFailed ? "text-brand-danger" : "text-brand-ink",
          )}
        >
          {title}
        </span>
        <span className="mt-0.5 block truncate text-brand-muted text-xs">
          {isFailed ? getImportJobFailureMessage(job) : describeImportSource(job).label}
        </span>
      </span>
    </>
  );
};

const MultipleSummary = ({ view }: { view: Extract<ImportIslandView, { mode: "multiple" }> }) => {
  const { activeCount, failedCount, jobs } = view;

  return (
    <>
      <StackedJobIcons jobs={jobs} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-brand-ink text-sm">
          {activeCount > 0
            ? `${activeCount}件を取り込み中`
            : `${failedCount}件取り込めませんでした`}
        </span>
        <span className="mt-0.5 block truncate text-brand-muted text-xs">
          {activeCount > 0 && failedCount > 0
            ? `${failedCount}件は取り込めず`
            : jobs.map((job) => describeImportSource(job).label).join("・")}
        </span>
      </span>
    </>
  );
};

const summarizePanel = (jobs: readonly RecentImportJob[]) => {
  const activeCount = jobs.filter(isActiveImportJob).length;
  const failedCount = jobs.filter((job) => job.status === "failed").length;
  const savedCount = jobs.filter((job) => job.status === "succeeded").length;

  return [
    activeCount > 0 ? `${activeCount}件取り込み中` : null,
    failedCount > 0 ? `${failedCount}件取り込めませんでした` : null,
    savedCount > 0 ? `${savedCount}件保存しました` : null,
  ]
    .filter(Boolean)
    .join("・");
};

const RecoveryAction = ({ island, job }: { island: ImportIslandState; job: RecentImportJob }) => {
  const recovery = getImportJobRecovery(job, island.planState);
  const linkClass = cn(buttonVariants({ size: "sm" }), "shrink-0 no-underline");

  if (recovery === "plan") {
    return <PlanLink variant="default" />;
  }

  if (recovery === "retry-url") {
    return (
      <Button
        className="shrink-0"
        disabled={island.isRetrying}
        size="sm"
        onClick={() => island.retryUrlJob(job)}
      >
        再試行
      </Button>
    );
  }

  if (recovery === "edit-text") {
    return (
      <Link className={linkClass} search={{ fromJob: job.id }} to="/import/text">
        再試行
      </Link>
    );
  }

  if (recovery === "paste-text") {
    return (
      <Link className={linkClass} search={{ fromJob: job.id }} to="/import/text">
        <Article data-icon="inline-start" weight="bold" />
        テキストを貼って取り込む
      </Link>
    );
  }

  return null;
};

const ImportJobRow = ({ island, job }: { island: ImportIslandState; job: RecentImportJob }) => {
  const source = describeImportSource(job);
  const isActive = isActiveImportJob(job);
  const isFailed = job.status === "failed";
  const isHighlighted = isActive && island.highlightedJobId === job.id;
  const title = job.status === "succeeded" ? (job.recipe?.title ?? "レシピ") : source.label;
  const detail = isFailed
    ? getImportJobFailureMessage(job)
    : job.status === "succeeded"
      ? "保存しました"
      : isHighlighted
        ? "もう取り込んでいます"
        : activeStatusLabel(job);
  const recoveryAction = isFailed ? <RecoveryAction island={island} job={job} /> : null;

  return (
    <li
      className={cn(
        "rounded-[16px] px-2 py-2",
        isFailed && "bg-brand-paper-muted",
        isHighlighted && "ring-2 ring-brand-orange/40",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <ImportJobIcon job={job} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-brand-ink text-sm">{title}</p>
          <p
            className={cn(
              "mt-0.5 text-xs",
              isFailed ? "text-brand-danger" : "truncate text-brand-muted",
            )}
          >
            {detail}
          </p>
        </div>
        {isActive ? (
          <Button
            aria-label={`${source.label}の取り込みを取り消す`}
            className="shrink-0 text-brand-muted"
            size="sm"
            variant="ghost"
            onClick={() => island.cancelJob(job.id)}
          >
            取り消す
          </Button>
        ) : null}
        {job.status === "succeeded" && job.recipeId ? (
          <Link
            className={cn(buttonVariants({ size: "sm" }), "shrink-0 no-underline")}
            params={{ recipeId: job.recipeId }}
            to="/recipes/$recipeId"
            onClick={() => island.dismissJob(job.id)}
          >
            開く
          </Link>
        ) : null}
        {isFailed ? (
          <Button
            aria-label={`${source.label}を閉じる`}
            className="shrink-0"
            size="icon-sm"
            variant="ghost"
            onClick={() => island.dismissJob(job.id)}
          >
            <X weight="bold" />
          </Button>
        ) : null}
      </div>
      {recoveryAction ? <div className="mt-2 flex justify-end">{recoveryAction}</div> : null}
    </li>
  );
};

const islandPositionClass = (placement: ImportIslandPlacement, isSaved: boolean) =>
  placement === "beside-fab"
    ? "left-4 right-[5.25rem] h-14 origin-right rounded-[28px] sm:right-4 sm:mx-auto sm:max-w-[360px] sm:origin-bottom"
    : cn(
        "inset-x-4 mx-auto origin-bottom",
        isSaved ? "h-[72px] max-w-[440px] rounded-[24px]" : "h-14 max-w-[360px] rounded-[28px]",
      );

const islandToneClass = (view: ImportIslandView, isHighlighted: boolean) => {
  if (view.mode === "saved") return "border-brand-sage-dark bg-brand-sage-dark";
  if (isHighlighted) return "border-brand-orange bg-brand-paper/95 ring-4 ring-brand-orange/25";

  const hasFailure =
    view.mode === "single"
      ? view.job.status === "failed"
      : view.mode === "multiple" && view.failedCount > 0;

  return hasFailure
    ? "border-brand-danger/40 bg-brand-paper/95"
    : "border-brand-line-soft bg-brand-paper/95";
};

const islandActionClass =
  "flex h-full min-w-0 flex-1 items-center gap-3 rounded-[inherit] text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-orange focus-visible:ring-inset";

/**
 * 取り込み状況のアイランド。タップすると上に一覧を開く。
 * 保存できたのが1件なら、狭い横幅でもレシピ名を読めるよう、アイランド全体でそのレシピを開く。
 */
export const ImportIsland = ({
  island,
  placement,
}: {
  island: ImportIslandState;
  placement: ImportIslandPlacement;
}) => {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const { view } = island;
  const isSaved = view.mode === "saved";
  const highlightedJob =
    view.mode === "single" || view.mode === "multiple"
      ? (view.mode === "single" ? [view.job] : view.jobs).find(
          (job) => isActiveImportJob(job) && job.id === island.highlightedJobId,
        )
      : undefined;
  const savedJobToOpen =
    view.mode === "saved" && view.jobs.length === 1 && view.jobs[0]?.recipeId ? view.jobs[0] : null;
  const summary = (
    <span
      className="flex min-w-0 flex-1 items-center gap-3 fade-in-0 slide-in-from-bottom-1 animate-in duration-300 motion-reduce:animate-none"
      key={view.mode === "single" ? `single-${view.job.id}-${view.job.status}` : view.mode}
    >
      {view.mode === "saved" ? (
        <SavedSummary isCompact={placement === "beside-fab"} jobs={view.jobs} />
      ) : null}
      {view.mode === "single" ? (
        <SingleSummary isHighlighted={Boolean(highlightedJob)} job={view.job} />
      ) : null}
      {view.mode === "multiple" ? <MultipleSummary view={view} /> : null}
    </span>
  );
  // 触れている間は、保存できたことの表示を閉じずに待つ。
  const holdHandlers = {
    onBlur: () => island.setIsHeld(false),
    onFocus: () => island.setIsHeld(true),
    onPointerEnter: () => island.setIsHeld(true),
    onPointerLeave: () => island.setIsHeld(false),
  };

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {island.announcement}
      </p>
      {island.isShown && view.mode !== "hidden" ? (
        <Popover modal open={island.isPanelOpen} onOpenChange={island.setPanelOpen}>
          <div
            className={cn(
              "fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-40 flex items-center overflow-hidden border shadow-pantry-lg backdrop-blur-xl sm:bottom-6",
              "transition-[max-width,height,border-radius,background-color,border-color] duration-500 ease-[cubic-bezier(0.2,0.9,0.25,1.12)] motion-reduce:transition-none",
              "fade-in-0 zoom-in-50 animate-in motion-reduce:animate-none",
              islandPositionClass(placement, isSaved),
              islandToneClass(view, Boolean(highlightedJob)),
            )}
            data-testid="import-island"
            ref={anchorRef}
          >
            {savedJobToOpen?.recipeId ? (
              <Link
                {...holdHandlers}
                className={cn(islandActionClass, "px-3 no-underline")}
                params={{ recipeId: savedJobToOpen.recipeId }}
                to="/recipes/$recipeId"
                onClick={() => island.dismissJob(savedJobToOpen.id)}
              >
                {summary}
                <CaretRight
                  aria-hidden="true"
                  className="shrink-0 text-brand-sage-soft"
                  size={16}
                  weight="bold"
                />
              </Link>
            ) : (
              <PopoverTrigger
                {...holdHandlers}
                className={cn(islandActionClass, isSaved ? "px-3" : "pr-4 pl-2")}
              >
                {summary}
                <CaretUp
                  aria-hidden="true"
                  className={cn(
                    "shrink-0 transition-transform",
                    isSaved ? "text-brand-sage-soft" : "text-brand-muted",
                    island.isPanelOpen && "rotate-180",
                  )}
                  size={16}
                  weight="bold"
                />
              </PopoverTrigger>
            )}
          </div>
          <PopoverContent
            anchor={anchorRef}
            className="w-[calc(100vw-2rem)] max-w-[440px] gap-0 rounded-[24px] border border-brand-line-soft bg-brand-paper p-2 text-brand-ink shadow-pantry-lg ring-0"
            collisionPadding={16}
            positionMethod="fixed"
            side="top"
            sideOffset={10}
            withBackdrop
          >
            <div className="flex items-center gap-2 py-1 pr-1 pl-3">
              <div className="min-w-0 flex-1">
                <PopoverTitle className="font-semibold text-brand-walnut text-sm">
                  取り込み
                </PopoverTitle>
                <p className="text-brand-muted text-xs">{summarizePanel(island.jobs)}</p>
              </div>
              <Button
                aria-label="取り込みの一覧を閉じる"
                size="icon-sm"
                variant="ghost"
                onClick={() => island.setPanelOpen(false)}
              >
                <X weight="bold" />
              </Button>
            </div>
            <ul className="flex max-h-[min(55vh,420px)] flex-col gap-0.5 overflow-y-auto">
              {island.jobs.map((job) => (
                <ImportJobRow island={island} job={job} key={job.id} />
              ))}
            </ul>
            {island.actionError ? (
              <p className="px-3 pt-1 text-brand-danger text-xs" role="alert">
                {island.actionError}
              </p>
            ) : null}
            <p className="px-3 pt-2 pb-1 text-[11px] text-brand-muted">
              アプリを閉じても取り込みは続きます
            </p>
          </PopoverContent>
        </Popover>
      ) : null}
    </>
  );
};
