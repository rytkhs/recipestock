import {
  CaretRight,
  CheckCircle,
  CircleNotch,
  DotsThreeVertical,
  Globe,
  List,
  LockSimple,
  MagnifyingGlass,
  PencilSimple,
  SquaresFour,
  Trash,
  UserCircle,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { type RecentImportJobsResponse } from "@recipestock/schemas";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { RecipeCardSkeleton } from "../components/loading";
import {
  dismissFinishedImportJob,
  fetchRecentImportJobs,
  getImportJobFailureMessage,
  hasActiveImportJob,
  importJobQueryKeys,
  retryImportUrlJob,
} from "../features/import-jobs";
import {
  deleteRecipe,
  invalidateRecipeLists,
  listRecipes,
  recipesQueryKeys,
  syncDeletedRecipeCaches,
} from "../features/recipes";
import { RecipeThumbnail } from "../features/recipes/recipe-thumbnail";

const importJobSuccessDismissDelayMs = 4000;
const gridRecipeSkeletonKeys = [
  "grid-recipe-skeleton-1",
  "grid-recipe-skeleton-2",
  "grid-recipe-skeleton-3",
  "grid-recipe-skeleton-4",
  "grid-recipe-skeleton-5",
  "grid-recipe-skeleton-6",
  "grid-recipe-skeleton-7",
  "grid-recipe-skeleton-8",
];
const listRecipeSkeletonKeys = [
  "list-recipe-skeleton-1",
  "list-recipe-skeleton-2",
  "list-recipe-skeleton-3",
  "list-recipe-skeleton-4",
  "list-recipe-skeleton-5",
];

const RecipeCardActionMenu = ({
  isList,
  recipeId,
  title,
  onDelete,
}: {
  isList: boolean;
  recipeId: string;
  title: string;
  onDelete: () => void;
}) => {
  const navigate = useNavigate();

  return (
    <div
      className={`absolute z-10 ${
        isList ? "top-2 right-2 sm:top-3 sm:right-3" : "top-1 right-1 sm:top-2 sm:right-2"
      }`}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${title}の操作メニュー`}
          className={`flex h-8 w-8 items-center justify-center sm:h-9 sm:w-9 ${
            isList ? "text-brand-walnut" : "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)]"
          }`}
        >
          <DotsThreeVertical size={19} weight="bold" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-[140px] rounded-[20px] border border-brand-line-soft bg-brand-paper shadow-pantry">
          <DropdownMenuItem
            onClick={() => {
              void navigate({ to: "/recipes/$recipeId/edit", params: { recipeId } });
            }}
          >
            <div className="flex items-center gap-2 text-brand-walnut">
              <PencilSimple size={16} weight="bold" />
              <span className="text-sm font-semibold">編集</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDelete}>
            <div className="flex items-center gap-2 text-brand-danger">
              <Trash size={16} weight="bold" />
              <span className="text-sm font-semibold">削除</span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

const ImportJobIsland = () => {
  const queryClient = useQueryClient();
  const [isExpanded, setIsExpanded] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const observedSuccessIdsRef = useRef(new Set<string>());
  const successTimersRef = useRef(new Map<string, number>());
  const { data } = useQuery({
    queryKey: importJobQueryKeys.recent(),
    queryFn: fetchRecentImportJobs,
    refetchInterval: (query) => (hasActiveImportJob(query.state.data?.jobs ?? []) ? 2500 : false),
  });
  const dismissMutation = useMutation({
    mutationFn: dismissFinishedImportJob,
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: importJobQueryKeys.recent() });
    },
  });
  const retryMutation = useMutation({
    mutationFn: retryImportUrlJob,
    onSuccess: async () => {
      setRetryError(null);
      await queryClient.invalidateQueries({ queryKey: importJobQueryKeys.recent() });
    },
    onError: () => {
      setRetryError("再試行を開始できませんでした。");
    },
  });
  const jobs = data?.jobs ?? [];

  const dismissImportJob = useCallback(
    (jobId: string) => {
      const timer = successTimersRef.current.get(jobId);
      if (timer) {
        window.clearTimeout(timer);
        successTimersRef.current.delete(jobId);
      }
      queryClient.setQueryData<RecentImportJobsResponse>(importJobQueryKeys.recent(), (current) =>
        current
          ? {
              ...current,
              jobs: current.jobs.filter((job) => job.id !== jobId),
            }
          : current,
      );
      dismissMutation.mutate(jobId);
    },
    [dismissMutation, queryClient],
  );

  useEffect(() => {
    return () => {
      for (const timer of successTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      successTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    for (const job of jobs) {
      if (job.status !== "succeeded" || observedSuccessIdsRef.current.has(job.id)) {
        continue;
      }

      observedSuccessIdsRef.current.add(job.id);
      void invalidateRecipeLists(queryClient);
      const timer = window.setTimeout(() => {
        successTimersRef.current.delete(job.id);
        dismissImportJob(job.id);
      }, importJobSuccessDismissDelayMs);
      successTimersRef.current.set(job.id, timer);
    }
  }, [dismissImportJob, jobs, queryClient]);

  if (jobs.length === 0) {
    return null;
  }

  const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "running");
  const failedJobs = jobs.filter((job) => job.status === "failed");
  const succeededJobs = jobs.filter((job) => job.status === "succeeded");
  const summary = [
    activeJobs.length > 0 ? `${activeJobs.length}件を取り込み中` : null,
    failedJobs.length > 0 ? `${failedJobs.length}件取り込めませんでした` : null,
    succeededJobs.length > 0 ? `${succeededJobs.length}件保存しました` : null,
  ]
    .filter(Boolean)
    .join("・");
  const hasFailure = failedJobs.length > 0;
  const hasActive = activeJobs.length > 0;

  return (
    <div
      className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-4 right-4 z-50 mx-auto max-w-[520px] rounded-[20px] border border-brand-line-soft bg-brand-paper/95 text-sm shadow-pantry backdrop-blur-xl sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-[76px] sm:w-[min(520px,calc(100vw-2rem))] sm:-translate-x-1/2"
      role={hasFailure ? "alert" : "status"}
    >
      <button
        aria-expanded={isExpanded}
        className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left"
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
      >
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            hasFailure
              ? "bg-brand-danger/10 text-brand-danger"
              : hasActive
                ? "bg-brand-orange-soft/60 text-brand-orange"
                : "bg-brand-sage-soft text-brand-sage-dark"
          }`}
        >
          {hasActive && !hasFailure ? (
            <CircleNotch
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
              size={19}
              weight="bold"
            />
          ) : null}
          {!hasActive && !hasFailure ? <CheckCircle size={19} weight="fill" /> : null}
          {hasFailure ? <WarningCircle size={19} weight="fill" /> : null}
        </div>

        <p className="min-w-0 flex-1 truncate font-semibold text-brand-ink text-sm">{summary}</p>
        <CaretRight
          className={`shrink-0 text-brand-muted transition-transform ${isExpanded ? "rotate-90" : ""}`}
          size={17}
          weight="bold"
        />
      </button>

      {isExpanded ? (
        <div className="max-h-[min(55vh,420px)] overflow-y-auto border-brand-line-soft border-t px-3 py-2">
          {jobs.map((job) => {
            const isActive = job.status === "queued" || job.status === "running";
            const isFailed = job.status === "failed";
            const isSucceeded = job.status === "succeeded";
            const status =
              job.status === "queued"
                ? "取り込み待ち"
                : job.status === "running"
                  ? "取り込み中"
                  : isFailed
                    ? "取り込めませんでした"
                    : "保存しました";

            return (
              <div
                className="flex min-w-0 items-center gap-3 rounded-[14px] px-2 py-2"
                key={job.id}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-brand-ink text-xs">{status}</p>
                  <p className="mt-0.5 truncate text-brand-muted text-xs">
                    {isFailed ? getImportJobFailureMessage(job) : job.url}
                  </p>
                </div>
                {isSucceeded && job.recipeId ? (
                  <Link
                    className="inline-flex min-h-8 shrink-0 items-center justify-center rounded-full bg-brand-sage px-3 font-semibold text-white text-xs no-underline hover:bg-brand-sage-dark"
                    params={{ recipeId: job.recipeId }}
                    to="/recipes/$recipeId"
                    onClick={() => dismissImportJob(job.id)}
                  >
                    開く
                  </Link>
                ) : null}
                {isFailed ? (
                  <Button
                    className="h-8 shrink-0 rounded-full bg-brand-sage px-3 text-white text-xs font-semibold hover:bg-brand-sage-dark"
                    disabled={!job.url || retryMutation.isPending}
                    size="sm"
                    variant="default"
                    onClick={() => retryMutation.mutate(job)}
                  >
                    再試行
                  </Button>
                ) : null}
                {!isActive ? (
                  <Button
                    aria-label={`${job.url ?? status}を閉じる`}
                    className="h-8 w-8 shrink-0 rounded-full bg-transparent text-brand-muted hover:bg-brand-paper-muted hover:text-brand-walnut"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => dismissImportJob(job.id)}
                  >
                    <X size={16} weight="bold" />
                  </Button>
                ) : null}
              </div>
            );
          })}
          {retryError ? (
            <p className="px-2 pb-1 text-brand-danger text-xs" role="alert">
              {retryError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

const SourceIcon = () => {
  return <Globe className="h-3.5 w-3.5 text-brand-wheat" weight="bold" />;
};

export const RecipesIndexRoute = () => {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    try {
      return (localStorage.getItem("recipeViewMode") as "grid" | "list") || "grid";
    } catch {
      return "grid";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("recipeViewMode", viewMode);
    } catch {}
  }, [viewMode]);

  const { data, error, fetchNextPage, hasNextPage, isFetching } = useInfiniteQuery({
    queryKey: recipesQueryKeys.list(query),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listRecipes({ query, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const deleteMutation = useMutation({
    mutationFn: (recipeId: string) => deleteRecipe(recipeId),
    onSuccess: async (_response, recipeId) => {
      await syncDeletedRecipeCaches(queryClient, recipeId);
    },
  });
  const recipes = data?.pages.flatMap((page) => page.items) ?? [];
  const isInitialRecipesLoading = isFetching && recipes.length === 0 && !error;
  const recipeSkeletonKeys = viewMode === "grid" ? gridRecipeSkeletonKeys : listRecipeSkeletonKeys;

  const submitSearch = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    setQuery(searchInput.trim());
  };

  const loadNextPage = () => {
    if (hasNextPage && !isFetching) {
      void fetchNextPage();
    }
  };
  const confirmDelete = () => {
    if (!deleteTargetId) {
      return;
    }

    const recipeId = deleteTargetId;
    setDeleteTargetId(null);
    deleteMutation.mutate(recipeId);
  };

  return (
    <section className="mx-auto w-full max-w-[1120px] px-4 pb-3 sm:pb-8 sm:px-6 lg:px-10">
      <div className="-mx-4 sticky top-0 z-30 flex min-w-0 items-center gap-3 bg-brand-cream/95 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:top-16 sm:px-6 sm:py-4 lg:-mx-10 lg:px-10">
        <form className="flex min-w-0 flex-1 items-end gap-3" onSubmit={submitSearch}>
          <div className="relative min-w-0 flex-1">
            <Field className="min-w-0">
              <FieldLabel className="sr-only" htmlFor={searchId}>
                検索
              </FieldLabel>
              <div className="relative min-w-0">
                <MagnifyingGlass
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-wheat"
                  size={18}
                  weight="bold"
                />
                <Input
                  className="w-full min-w-0 pl-10"
                  enterKeyHint="search"
                  id={searchId}
                  placeholder="レシピを検索..."
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                />
              </div>
            </Field>
          </div>
          <Button
            className="hidden shrink-0 rounded-full border border-brand-line bg-brand-paper-raised font-semibold text-brand-walnut hover:bg-brand-paper-muted sm:inline-flex"
            type="submit"
            variant="secondary"
          >
            検索
          </Button>
        </form>
        <Link
          aria-label="アカウント"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-brand-line bg-brand-paper-raised text-brand-walnut no-underline transition-colors hover:bg-brand-paper-muted sm:hidden"
          to="/settings"
        >
          <UserCircle size={24} weight="bold" />
        </Link>
      </div>

      <ImportJobIsland />

      {error ? (
        <div className="mt-6 rounded-[14px] border border-brand-danger/20 bg-brand-danger/5 p-4">
          <p className="text-brand-danger text-sm" role="alert">
            レシピ一覧を読み込めませんでした。
          </p>
        </div>
      ) : null}
      {deleteMutation.error ? (
        <div className="mt-6 rounded-[14px] border border-brand-danger/20 bg-brand-danger/5 p-4">
          <p className="text-brand-danger text-sm" role="alert">
            レシピを削除できませんでした。
          </p>
        </div>
      ) : null}
      {isInitialRecipesLoading ? (
        <div aria-label="レシピ一覧を読み込み中" className="sr-only" role="status">
          レシピ一覧を読み込み中
        </div>
      ) : null}
      {!isFetching && recipes.length === 0 && !error ? (
        <div className="mt-16 flex flex-col items-center justify-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-sage-soft">
            <MagnifyingGlass size={28} className="text-brand-sage" weight="bold" />
          </div>
          <p className="mt-4 text-brand-walnut font-semibold">レシピがありません</p>
          <p className="mt-1 text-brand-muted text-sm">最初のレシピを追加してみましょう</p>
        </div>
      ) : null}

      {recipes.length > 0 || isInitialRecipesLoading ? (
        <div className="mt-6 flex justify-end">
          <ToggleGroup
            aria-label="レシピ一覧の表示形式"
            className="inline-flex shrink-0 p-1 rounded-full border border-brand-line-soft bg-brand-paper-raised"
            value={[viewMode]}
            onValueChange={(groupValue) => {
              const [selectedKey] = groupValue;

              if (selectedKey === "grid" || selectedKey === "list") {
                setViewMode(selectedKey);
              }
            }}
          >
            <ToggleGroupItem
              aria-label="グリッド表示"
              className="h-9 w-9 rounded-full text-brand-muted transition-all duration-200 aria-pressed:bg-brand-paper aria-pressed:shadow-pantry-sm aria-pressed:text-brand-ink hover:text-brand-ink sm:h-10 sm:w-10"
              value="grid"
            >
              <SquaresFour size={18} weight={viewMode === "grid" ? "fill" : "bold"} />
            </ToggleGroupItem>
            <ToggleGroupItem
              aria-label="リスト表示"
              className="h-9 w-9 rounded-full text-brand-muted transition-all duration-200 aria-pressed:bg-brand-paper aria-pressed:shadow-pantry-sm aria-pressed:text-brand-ink hover:text-brand-ink sm:h-10 sm:w-10"
              value="list"
            >
              <List size={18} weight="bold" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      ) : null}

      <div
        className={
          viewMode === "grid"
            ? "mt-3 grid grid-cols-2 gap-3 sm:gap-5 sm:grid-cols-3 lg:grid-cols-4"
            : "mt-3 flex flex-col gap-2 sm:gap-3"
        }
      >
        {isInitialRecipesLoading
          ? recipeSkeletonKeys.map((key) => <RecipeCardSkeleton key={key} viewMode={viewMode} />)
          : null}
        {recipes.map((recipe, recipeIndex) => {
          const isList = viewMode === "list";
          const content = isList ? (
            <div className="flex min-w-0 w-full items-center p-1.5 sm:p-2">
              <div className="relative aspect-square h-16 w-16 sm:h-20 sm:w-20 shrink-0 bg-brand-paper-muted overflow-hidden rounded-[10px] sm:rounded-[12px]">
                {recipe.coverImageUrl ? (
                  <RecipeThumbnail
                    alt={recipe.title}
                    index={recipeIndex}
                    src={recipe.coverImageUrl}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <div className="text-brand-line text-2xl">🍳</div>
                  </div>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col justify-center py-1 pr-10 pl-4 sm:pr-12">
                <h2 className="line-clamp-2 font-bold text-sm sm:text-base leading-tight text-brand-ink">
                  {recipe.title}
                </h2>
                <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                  {recipe.sourceName ? (
                    <div className="inline-flex min-w-0 flex-1 items-center gap-1.5 truncate rounded-full bg-brand-paper-muted px-2 py-0.5 font-medium text-[10px] text-brand-muted sm:text-xs">
                      <SourceIcon />
                      <span className="truncate">{recipe.sourceName}</span>
                    </div>
                  ) : (
                    <div />
                  )}
                  {recipe.locked ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-brand-line px-1.5 py-0.5 font-medium text-[10px] text-brand-muted sm:text-xs">
                      <LockSimple size={10} weight="bold" />
                      <span className="hidden sm:inline">ロック中</span>
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="relative aspect-[4/3] sm:aspect-video w-full bg-brand-paper-muted overflow-hidden rounded-t-[18px] sm:rounded-t-[20px]">
                {recipe.coverImageUrl ? (
                  <RecipeThumbnail
                    alt={recipe.title}
                    index={recipeIndex}
                    src={recipe.coverImageUrl}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <div className="text-brand-line text-3xl sm:text-4xl">🍳</div>
                  </div>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col p-3 sm:p-4">
                <h2 className="line-clamp-2 font-bold text-sm sm:text-base leading-tight text-brand-ink">
                  {recipe.title}
                </h2>
                <div className="mt-auto flex min-w-0 items-center justify-between gap-2 pt-2.5 sm:pt-3">
                  {recipe.sourceName ? (
                    <div className="inline-flex min-w-0 flex-1 items-center gap-1.5 truncate rounded-full bg-brand-paper-muted px-2.5 py-1 font-medium text-[10px] text-brand-muted sm:text-xs">
                      <SourceIcon />
                      <span className="truncate">{recipe.sourceName}</span>
                    </div>
                  ) : (
                    <div />
                  )}
                  {recipe.locked ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-brand-line px-2 py-1 font-medium text-[10px] text-brand-muted sm:text-xs">
                      <LockSimple size={10} weight="bold" />
                      <span className="hidden sm:inline">ロック中</span>
                    </span>
                  ) : null}
                </div>
              </div>
            </>
          );

          if (recipe.locked) {
            return (
              <div
                key={recipe.id}
                className={`flex min-w-0 overflow-hidden rounded-[18px] border border-brand-line-soft bg-brand-paper opacity-60 sm:rounded-[20px] ${isList ? "flex-row items-center" : "flex-col"}`}
              >
                {content}
              </div>
            );
          }

          return (
            <div
              key={recipe.id}
              className={`group relative flex min-w-0 overflow-hidden rounded-[18px] border border-brand-line-soft bg-brand-paper shadow-pantry-sm transition-shadow duration-200 hover:shadow-pantry sm:rounded-[20px] ${isList ? "flex-row items-center" : "flex-col"}`}
            >
              <Link
                to="/recipes/$recipeId"
                params={{ recipeId: recipe.id }}
                className={`flex min-w-0 flex-1 ${isList ? "flex-row items-center" : "flex-col"}`}
              >
                {content}
              </Link>
              <RecipeCardActionMenu
                isList={isList}
                recipeId={recipe.id}
                title={recipe.title}
                onDelete={() => setDeleteTargetId(recipe.id)}
              />
            </div>
          );
        })}
      </div>

      {hasNextPage ? (
        <div className="mt-8 flex justify-center">
          <Button
            className="rounded-full bg-brand-paper-raised border border-brand-line text-brand-walnut font-semibold hover:bg-brand-paper-muted"
            disabled={isFetching}
            variant="secondary"
            onClick={loadNextPage}
          >
            もっと見る
          </Button>
        </div>
      ) : null}

      <AlertDialog
        open={Boolean(deleteTargetId)}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setDeleteTargetId(null);
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-brand-danger/10 text-brand-danger">
              <WarningCircle weight="fill" />
            </AlertDialogMedia>
            <AlertDialogTitle>レシピを削除しますか？</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              disabled={deleteMutation.isPending}
              variant="outline"
              onClick={() => setDeleteTargetId(null)}
            >
              キャンセル
            </Button>
            <Button
              disabled={deleteMutation.isPending}
              variant="destructive"
              onClick={confirmDelete}
            >
              削除
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};
