import {
  CaretRight,
  CheckCircle,
  CookingPot,
  GearSix,
  List,
  MagnifyingGlass,
  SlidersHorizontal,
  SquaresFour,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  MAX_RECIPE_TAGS,
  type RecentImportJobsResponse,
  type RecipeListSort,
} from "@recipestock/schemas";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { RecipeCardSkeleton } from "../components/loading";
import { PlanLink } from "../features/billing/plan-link";
import { derivePlanState, isStillResolvedByUpgrade } from "../features/billing/plan-state";
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
import { writeRecipeListSort } from "../features/recipes/list-search";
import { LockedShelfNotice, RecipeCard } from "../features/recipes/recipe-card";
import { groupRecipesByPeriod, recipeShelfContainerClass } from "../features/recipes/recipe-shelf";
import {
  type RecipeViewMode,
  readRecipeViewMode,
  writeRecipeViewMode,
} from "../features/recipes/view-mode";
import { listTags, tagsQueryKeys } from "../features/tags";
import { TagFilterBar } from "../features/tags/tag-filter-bar";
import { useViewer } from "../lib/viewer";

// routeには遅延読み込みのcomponentをそのまま渡し、routerに画面のコードを先読みさせる。
// そのため並び順はpropsではなく、ここでrouteから読む。
const recipesRouteApi = getRouteApi("/_protected/recipes");
const importJobSuccessDismissDelayMs = 4000;
const nextPageRootMargin = "480px 0px";
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

const ImportJobIsland = () => {
  const queryClient = useQueryClient();
  const viewer = useViewer({ enabled: true });
  const planState = viewer.data ? derivePlanState(viewer.data) : undefined;
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
          {hasActive && !hasFailure ? <Spinner aria-hidden="true" role="presentation" /> : null}
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
            const label = job.kind === "text" ? (job.textPreview ?? "貼り付けたテキスト") : job.url;
            // 上限で止まったものは、今も上限にいれば再試行しても同じ理由で止まる。直せる先へ案内する。
            const needsPlanChange = isFailed && isStillResolvedByUpgrade(job.errorCode, planState);

            return (
              <div
                className="flex min-w-0 items-center gap-3 rounded-[14px] px-2 py-2"
                key={job.id}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-brand-ink text-xs">{status}</p>
                  <p className="mt-0.5 truncate text-brand-muted text-xs">
                    {isFailed ? getImportJobFailureMessage(job) : label}
                  </p>
                </div>
                {isSucceeded && job.recipeId ? (
                  <Link
                    className={cn(buttonVariants({ size: "sm" }), "shrink-0 no-underline")}
                    params={{ recipeId: job.recipeId }}
                    to="/recipes/$recipeId"
                    onClick={() => dismissImportJob(job.id)}
                  >
                    開く
                  </Link>
                ) : null}
                {needsPlanChange ? <PlanLink variant="default" /> : null}
                {isFailed && !needsPlanChange && job.kind === "text" ? (
                  <Link
                    className={cn(buttonVariants({ size: "sm" }), "shrink-0 no-underline")}
                    search={{ fromJob: job.id }}
                    to="/import/text"
                  >
                    再試行
                  </Link>
                ) : null}
                {isFailed && !needsPlanChange && job.kind === "url" ? (
                  <Button
                    className="shrink-0"
                    disabled={!job.url || retryMutation.isPending}
                    size="sm"
                    onClick={() => retryMutation.mutate(job)}
                  >
                    再試行
                  </Button>
                ) : null}
                {!isActive ? (
                  <Button
                    aria-label={`${label ?? status}を閉じる`}
                    className="shrink-0"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => dismissImportJob(job.id)}
                  >
                    <X weight="bold" />
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

// URLにタグの指定がないときに使う。描画のたびに新しい配列にすると、条件が変わったと見なされる。
const noTagIds: string[] = [];

// 絞り込んで0件になったときの見出し。どの条件で絞っているかを言葉にする。
const describeFilterMiss = ({
  query,
  tagNames,
  untagged,
}: {
  query: string;
  tagNames: readonly string[];
  untagged: boolean;
}) => {
  const tagLabel = tagNames.map((name) => `「${name}」`).join("");

  if (untagged) {
    return query
      ? `「${query}」に一致する、タグのないレシピはありません`
      : "すべてのレシピにタグが付いています";
  }

  if (tagLabel) {
    return query
      ? `「${query}」に一致し、${tagLabel}が付いたレシピはありません`
      : `${tagLabel}が付いたレシピはありません`;
  }

  return query ? `「${query}」に一致するレシピはありません` : "条件に合うレシピはありません";
};

export const RecipesIndexRoute = () => {
  const queryClient = useQueryClient();
  const {
    sort = "newest",
    q: query = "",
    tags: requestedTagIdsInUrl = noTagIds,
    untagged: untaggedInUrl,
  } = recipesRouteApi.useSearch();
  const navigate = recipesRouteApi.useNavigate();
  const [searchInput, setSearchInput] = useState(query);
  const searchId = useId();
  const shelfId = useId();
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<RecipeViewMode>(readRecipeViewMode);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const tagsQuery = useQuery({ queryKey: tagsQueryKeys.all(), queryFn: listTags });
  // 「タグなし」はタグの指定と同時に使わない。URLで両方来たら「タグなし」を採る。
  const untagged = untaggedInUrl === true;
  const requestedTagIds = untagged ? noTagIds : requestedTagIdsInUrl;
  // 削除や統合で消えたタグのidが、URLや戻る操作で残ることがある。タグ一覧を読んだところで外す。
  // 読み直している間のキャッシュには作ったばかりのタグがないことがあるので、読み終えた一覧でだけ判定する。
  const isTagsSettled = tagsQuery.isSuccess && !tagsQuery.isFetching;
  const tagIds = useMemo(() => {
    if (!isTagsSettled || !tagsQuery.data) {
      return requestedTagIds;
    }

    const knownTagIds = new Set(tagsQuery.data.map((tag) => tag.id));
    return requestedTagIds.filter((tagId) => knownTagIds.has(tagId));
  }, [isTagsSettled, requestedTagIds, tagsQuery.data]);
  const hasUnknownTagIds = tagIds.length !== requestedTagIds.length;
  // 消えたidかどうかはタグ一覧を読み終えるまで分からないので、それまでは絞った一覧を取りに行かない。
  // タグ一覧を読めなかったときは、URLのidのまま取りに行く。
  const isWaitingForTags = requestedTagIds.length > 0 && !isTagsSettled && !tagsQuery.isError;

  useEffect(() => {
    writeRecipeViewMode(viewMode);
  }, [viewMode]);

  // URLで開いた並び順も、並び順を指定せずに一覧へ移るとき（ヘッダーのリンクなど）に引き継ぐ。
  useEffect(() => {
    writeRecipeListSort(sort);
  }, [sort]);

  // ヘッダーのリンクなどでURLから検索語が外れたら、入力欄も合わせる。
  useEffect(() => {
    setSearchInput(query);
  }, [query]);

  useEffect(() => {
    if (hasUnknownTagIds) {
      void navigate({
        search: (prev) => ({ ...prev, tags: tagIds.length > 0 ? tagIds : undefined }),
        replace: true,
      });
    }
  }, [hasUnknownTagIds, navigate, tagIds]);

  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    isPending: isListPending,
  } = useInfiniteQuery({
    queryKey: recipesQueryKeys.list({ query, sort, tagIds, untagged }),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listRecipes({ query, sort, tagIds, untagged, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !isWaitingForTags && !hasUnknownTagIds,
  });
  const deleteMutation = useMutation({
    mutationFn: (recipeId: string) => deleteRecipe(recipeId),
    // 付いていたタグの件数が減るので、チップ列のためにタグ一覧も読み直す。
    onSuccess: async (_response, recipeId) => {
      await Promise.all([
        syncDeletedRecipeCaches(queryClient, recipeId),
        queryClient.invalidateQueries({ queryKey: tagsQueryKeys.all() }),
      ]);
    },
  });
  const recipes = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
  // 絞った一覧を取りに行くのを待っている間も、取得中と同じに扱う。
  const isInitialRecipesLoading = (isFetching || isListPending) && recipes.length === 0 && !error;
  const recipeSkeletonKeys = viewMode === "grid" ? gridRecipeSkeletonKeys : listRecipeSkeletonKeys;
  const containerClass = recipeShelfContainerClass(viewMode);
  // 一覧もfreeプランのロック判定も追加日が軸なので、ロック中のRecipeは並び順や絞り込みによらず一続きになる。
  // 案内は最初のロック中Recipeの前に一度だけ出す。
  const firstLockedRecipeId = recipes.find((recipe) => recipe.locked)?.id ?? null;
  const shelf = useMemo(() => {
    const sections = query
      ? [{ key: "search-results", label: "", recipes }]
      : groupRecipesByPeriod(recipes);
    const offsets: number[] = [];
    let renderedCount = 0;

    for (const section of sections) {
      offsets.push(renderedCount);
      renderedCount += section.recipes.length;
    }

    return { offsets, sections };
  }, [query, recipes]);
  const selectedTags = useMemo(
    () => tagIds.flatMap((tagId) => tagsQuery.data?.find((tag) => tag.id === tagId) ?? []),
    [tagIds, tagsQuery.data],
  );
  // 付いているRecipeがあるタグだけを並べる。選んでいるタグは0件になっても外せるように残す。
  const filterBarTags = (tagsQuery.data ?? []).filter(
    (tag) => tag.recipeCount > 0 || tagIds.includes(tag.id),
  );
  const hasTagFilterBar = filterBarTags.length > 0 || untagged;
  const hasFilter = query !== "" || tagIds.length > 0 || untagged;
  // 取得前はdataが無く、hasNextPageもfalseになる。dataを見ないと「0件」が一瞬出る。
  const loadedCountLabel = data && !hasNextPage ? `${recipes.length}件` : null;
  const shelfSummary = [
    query ? `「${query}」の検索結果` : null,
    selectedTags.length > 0 ? selectedTags.map((tag) => `「${tag.name}」`).join("") : null,
    untagged ? "タグなし" : null,
    loadedCountLabel,
  ]
    .filter(Boolean)
    .join(" · ");
  const hasShelfToolbar = isInitialRecipesLoading || recipes.length > 0 || hasFilter;
  const isListEmpty = !isFetching && !isListPending && !error && recipes.length === 0;
  const isFilterMiss = isListEmpty && hasFilter;
  const isShelfEmpty = isListEmpty && !hasFilter;

  // 検索語もタグの条件も並び順もURLに持つ。戻る操作で条件が行き来しないようにreplaceし、
  // 別の条件の結果は先頭から見せる。ほかの条件は残したまま、変えたものだけを差し替える。
  const changeQuery = (nextQuery: string) => {
    if (nextQuery === query) {
      return;
    }

    void navigate({ search: (prev) => ({ ...prev, q: nextQuery || undefined }), replace: true });
    window.scrollTo({ top: 0 });
  };
  const submitSearch = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    changeQuery(searchInput.trim());
  };
  const clearSearch = () => {
    setSearchInput("");
    changeQuery("");
  };
  const changeTagFilter = (nextTagIds: readonly string[], nextUntagged: boolean) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        tags: nextTagIds.length > 0 ? [...nextTagIds] : undefined,
        untagged: nextUntagged ? true : undefined,
      }),
      replace: true,
    });
    window.scrollTo({ top: 0 });
  };
  const toggleTag = (tagId: string) => {
    if (tagIds.includes(tagId)) {
      changeTagFilter(
        tagIds.filter((id) => id !== tagId),
        false,
      );
      return;
    }

    // APIが受け付ける個数を超えては選ばせない。
    if (tagIds.length < MAX_RECIPE_TAGS) {
      changeTagFilter([...tagIds, tagId], false);
    }
  };
  const toggleUntagged = () => changeTagFilter([], !untagged);
  const clearFilters = () => {
    setSearchInput("");
    void navigate({
      search: (prev) => ({ ...prev, q: undefined, tags: undefined, untagged: undefined }),
      replace: true,
    });
    window.scrollTo({ top: 0 });
  };
  // 遷移より先に覚え、この遷移で描き直すヘッダーのリンクにも選んだ並び順を使わせる。
  const changeSort = (nextSort: RecipeListSort) => {
    writeRecipeListSort(nextSort);
    void navigate({ search: (prev) => ({ ...prev, sort: nextSort }), replace: true });
    window.scrollTo({ top: 0 });
  };
  const loadNextPage = useCallback(() => {
    if (hasNextPage && !isFetching) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetching]);
  const confirmDelete = () => {
    if (!deleteTargetId) {
      return;
    }

    const recipeId = deleteTargetId;
    setDeleteTargetId(null);
    deleteMutation.mutate(recipeId);
  };

  // 末尾が見えたら次ページを取りに行く。失敗したあとは「もっと見る」を押されるまで止める。
  useEffect(() => {
    const sentinel = loadMoreRef.current;

    if (!sentinel || !hasNextPage || isFetching || error) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void fetchNextPage();
        }
      },
      { rootMargin: nextPageRootMargin },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [error, fetchNextPage, hasNextPage, isFetching]);

  return (
    <section className="mx-auto w-full max-w-[1120px] px-4 pb-3 sm:pb-8 sm:px-6 lg:px-10">
      <div className="-mx-4 sticky top-0 z-30 bg-brand-cream/95 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:top-16 sm:px-6 sm:py-4 lg:-mx-10 lg:px-10">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <form className="flex min-w-0 flex-1 items-end gap-3" onSubmit={submitSearch}>
            <FieldGroup className="min-w-0 flex-1">
              <Field className="min-w-0">
                <FieldLabel className="sr-only" htmlFor={searchId}>
                  検索
                </FieldLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <MagnifyingGlass weight="bold" />
                  </InputGroupAddon>
                  <InputGroupInput
                    enterKeyHint="search"
                    id={searchId}
                    placeholder="レシピを検索..."
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                  />
                  {searchInput ? (
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        aria-label="検索を消す"
                        size="icon-xs"
                        onClick={clearSearch}
                      >
                        <X weight="bold" />
                      </InputGroupButton>
                    </InputGroupAddon>
                  ) : null}
                </InputGroup>
              </Field>
            </FieldGroup>
            <Button className="hidden shrink-0 sm:inline-flex" type="submit" variant="outline">
              検索
            </Button>
          </form>
          {hasShelfToolbar ? (
            <>
              {shelfSummary ? (
                <p className="hidden shrink-0 truncate text-brand-muted text-sm sm:block sm:max-w-56">
                  {shelfSummary}
                </p>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={sort === "oldest" ? "表示の設定（古い順）" : "表示の設定"}
                  render={<Button className="relative shrink-0" size="icon-lg" variant="outline" />}
                >
                  <SlidersHorizontal weight="bold" />
                  {sort === "oldest" ? (
                    <span
                      aria-hidden="true"
                      className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-brand-orange"
                    />
                  ) : null}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto min-w-40">
                  <DropdownMenuRadioGroup
                    value={sort}
                    onValueChange={(value) => {
                      if (value === "newest" || value === "oldest") {
                        changeSort(value);
                      }
                    }}
                  >
                    <DropdownMenuLabel>並び順</DropdownMenuLabel>
                    <DropdownMenuRadioItem value="newest">新しい順</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="oldest">古い順</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup
                    value={viewMode}
                    onValueChange={(value) => {
                      if (value === "grid" || value === "list") {
                        setViewMode(value);
                      }
                    }}
                  >
                    <DropdownMenuLabel>表示</DropdownMenuLabel>
                    <DropdownMenuRadioItem value="grid">
                      <SquaresFour weight="bold" />
                      グリッド
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="list">
                      <List weight="bold" />
                      リスト
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null}
          <Link
            aria-label="設定"
            className={cn(
              buttonVariants({ size: "icon-lg", variant: "outline" }),
              "shrink-0 no-underline sm:hidden",
            )}
            to="/settings"
          >
            <GearSix weight="bold" />
          </Link>
        </div>
        {/* ツールバーと一緒に固定し、スクロールしても絞り込み中の条件が見えるようにする。
            検索の行と同じflexに入れると、チップ列の負のmarginで折り返しの判定が狂い、検索欄が潰れる。 */}
        {hasTagFilterBar ? (
          <TagFilterBar
            className="mt-2 sm:mt-3"
            onToggleTag={toggleTag}
            onToggleUntagged={toggleUntagged}
            selectedTagIds={tagIds}
            tags={filterBarTags}
            untagged={untagged}
          />
        ) : null}
      </div>

      {/* 狭い画面ではツールバーにまとめを出さず、選んだチップも横スクロールで隠れることがあるので、
          絞り込み中はここに条件と件数を出し、まとめて外せるようにする。0件のときは下の案内が同じ役目を持つ。 */}
      {hasFilter && recipes.length > 0 ? (
        <div className="mt-2 flex min-w-0 items-center justify-between gap-3 sm:hidden">
          <p className="min-w-0 truncate text-brand-muted text-sm">{shelfSummary}</p>
          <Button className="-mr-2.5 shrink-0" variant="ghost" onClick={clearFilters}>
            すべて表示
          </Button>
        </div>
      ) : null}

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

      {isShelfEmpty ? (
        <div className="mt-16 flex flex-col items-center justify-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-sage-soft">
            <CookingPot size={28} className="text-brand-sage-dark" weight="bold" />
          </div>
          <p className="mt-5 font-semibold text-brand-walnut text-lg">レシピはまだありません</p>
          <p className="mt-2 max-w-xs text-brand-muted text-sm leading-relaxed">
            サイトや動画のURLを貼ると、材料と手順に整えて保存します。
          </p>
          <Link className={cn(buttonVariants(), "mt-6 no-underline")} to="/import/url">
            URLから取り込む
          </Link>
        </div>
      ) : null}
      {isFilterMiss ? (
        <div className="mt-14 flex flex-col items-center justify-center text-center">
          <p className="max-w-sm font-semibold text-brand-walnut text-lg">
            {describeFilterMiss({
              query,
              tagNames: selectedTags.map((tag) => tag.name),
              untagged,
            })}
          </p>
          {query ? (
            <p className="mt-2 text-brand-muted text-sm">材料名・出典・タグでも探せます。</p>
          ) : null}
          <Button className="mt-6" variant="outline" onClick={clearFilters}>
            すべてのレシピを表示
          </Button>
        </div>
      ) : null}

      {isInitialRecipesLoading ? (
        <div className={cn("mt-6", containerClass)}>
          {recipeSkeletonKeys.map((key) => (
            <RecipeCardSkeleton key={key} viewMode={viewMode} />
          ))}
        </div>
      ) : null}

      {shelf.sections.map((section, sectionIndex) => {
        const headingId = `${shelfId}-${section.key}`;

        return (
          <section
            aria-label={section.label ? undefined : "検索結果"}
            aria-labelledby={section.label ? headingId : undefined}
            className={sectionIndex === 0 ? "mt-6" : "mt-9"}
            key={section.key}
          >
            {section.label ? (
              <div className="mb-3 flex items-center gap-3">
                <h2
                  className="shrink-0 font-semibold text-[11px] text-brand-muted tracking-[0.08em]"
                  id={headingId}
                >
                  {section.label}
                </h2>
                <span aria-hidden="true" className="h-px flex-1 bg-brand-line-soft" />
              </div>
            ) : null}
            <div className={containerClass}>
              {section.recipes.map((recipe, recipeIndex) => (
                <Fragment key={recipe.id}>
                  {recipe.id === firstLockedRecipeId ? <LockedShelfNotice /> : null}
                  <RecipeCard
                    index={shelf.offsets[sectionIndex] + recipeIndex}
                    onDelete={setDeleteTargetId}
                    recipe={recipe}
                    viewMode={viewMode}
                  />
                </Fragment>
              ))}
            </div>
          </section>
        );
      })}

      {hasNextPage ? (
        <div className="mt-8 flex justify-center" ref={loadMoreRef}>
          {isFetchingNextPage ? (
            <p className="flex items-center gap-2 text-brand-muted text-sm">
              <Spinner aria-hidden="true" role="presentation" />
              読み込み中
            </p>
          ) : (
            <Button disabled={isFetching} variant="outline" onClick={loadNextPage}>
              もっと見る
            </Button>
          )}
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
            <AlertDialogMedia>
              <WarningCircle weight="fill" />
            </AlertDialogMedia>
            <AlertDialogTitle>レシピを削除しますか？</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              variant="destructive"
              onClick={confirmDelete}
            >
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};
