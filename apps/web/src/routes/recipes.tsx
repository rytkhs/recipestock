import {
  AlertDialog,
  Button,
  Dropdown,
  Input,
  Label,
  ProgressCircle,
  Surface,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from "@heroui/react";
import {
  CaretLeft,
  CaretRight,
  CheckCircle,
  DotsThreeVertical,
  Globe,
  List,
  LockSimple,
  MagnifyingGlass,
  PencilSimple,
  SquaresFour,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  type ImportJobSummary,
  type ListRecipesResponse,
  type RecentImportJobsResponse,
} from "@recipestock/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type TransitionEvent as ReactTransitionEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  RecipeCardSkeleton,
  RecipeDetailSkeleton,
  RecipeFormSkeleton,
} from "../components/loading";
import {
  dismissFinishedImportJob,
  fetchRecentImportJobs,
  getImportJobFailureMessage,
  hasActiveImportJob,
  importJobQueryKeys,
  retryImportUrlJob,
} from "../features/import-jobs";
import {
  createEmptyRecipeDraftFormValues,
  formValuesToCreateRecipeRequest,
  formValuesToRecipeDraftContent,
  RecipeDraftForm,
  type RecipeDraftFormValues,
  recipeDetailToFormValues,
} from "../features/recipe-draft";
import {
  createRecipe,
  deleteRecipe,
  getRecipe,
  invalidateRecipeLists,
  listRecipes,
  recipeMutationErrorMessage,
  recipesQueryKeys,
  removeRecipeDetail,
  updateRecipe,
} from "../features/recipes";
import { RecipeThumbnail } from "../features/recipes/recipe-thumbnail";

const importJobTimestamp = (job: ImportJobSummary) =>
  Date.parse(job.finishedAt ?? job.startedAt ?? job.createdAt);

const latestImportJob = (jobs: ImportJobSummary[]) =>
  [...jobs].sort((a, b) => importJobTimestamp(b) - importJobTimestamp(a))[0] ?? null;

const selectVisibleImportJob = (jobs: ImportJobSummary[]) =>
  latestImportJob(jobs.filter((job) => job.status === "queued" || job.status === "running")) ??
  latestImportJob(jobs.filter((job) => job.status === "failed")) ??
  latestImportJob(jobs.filter((job) => job.status === "succeeded"));

const importJobIslandAnimationMs = 220;
const importJobIslandUnmountDelayMs = 320;
const importJobSuccessDismissDelayMs = 4000;
const importJobFailureDismissDelayMs = 10_000;
const recipeDetailCoverImageProps = {
  decoding: "async",
  fetchPriority: "high",
} as const;
const deferredRecipeContentImageProps = {
  decoding: "async",
  loading: "lazy",
} as const;
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
      <Dropdown>
        <Dropdown.Trigger
          aria-label={`${title}の操作メニュー`}
          className={`flex h-8 w-8 items-center justify-center sm:h-9 sm:w-9 ${
            isList ? "text-brand-walnut" : "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)]"
          }`}
        >
          <DotsThreeVertical size={19} weight="bold" />
        </Dropdown.Trigger>
        <Dropdown.Popover className="min-w-[140px] rounded-[20px] border border-brand-line-soft bg-brand-paper shadow-pantry">
          <Dropdown.Menu
            onAction={(key) => {
              if (key === "edit") {
                void navigate({ to: "/recipes/$recipeId/edit", params: { recipeId } });
              } else if (key === "delete") {
                onDelete();
              }
            }}
          >
            <Dropdown.Item id="edit" textValue="編集">
              <div className="flex items-center gap-2 text-brand-walnut">
                <PencilSimple size={16} weight="bold" />
                <span className="text-sm font-semibold">編集</span>
              </div>
            </Dropdown.Item>
            <Dropdown.Item id="delete" textValue="削除">
              <div className="flex items-center gap-2 text-brand-danger">
                <Trash size={16} weight="bold" />
                <span className="text-sm font-semibold">削除</span>
              </div>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  );
};

const ImportJobIsland = () => {
  const queryClient = useQueryClient();
  const [renderedJob, setRenderedJob] = useState<ImportJobSummary | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const previousJobIdRef = useRef<string | null>(null);
  const dismissUnmountTimerRef = useRef<number | null>(null);
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
      await queryClient.invalidateQueries({ queryKey: importJobQueryKeys.recent() });
    },
  });
  const jobs = data?.jobs ?? [];

  const dismissVisibleImportJob = useCallback(
    (jobId: string) => {
      queryClient.setQueryData<RecentImportJobsResponse>(importJobQueryKeys.recent(), (current) =>
        current
          ? {
              ...current,
              jobs: current.jobs.filter((job) => job.id !== jobId),
            }
          : current,
      );
      setIsVisible(false);

      if (dismissUnmountTimerRef.current) {
        window.clearTimeout(dismissUnmountTimerRef.current);
      }

      dismissUnmountTimerRef.current = window.setTimeout(() => {
        setRenderedJob((current) => (current?.id === jobId ? null : current));
        if (previousJobIdRef.current === jobId) {
          previousJobIdRef.current = null;
        }
        dismissUnmountTimerRef.current = null;
      }, importJobIslandUnmountDelayMs);

      dismissMutation.mutate(jobId);
    },
    [dismissMutation, queryClient],
  );

  useEffect(() => {
    return () => {
      if (dismissUnmountTimerRef.current) {
        window.clearTimeout(dismissUnmountTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (jobs.some((job) => job.status === "succeeded")) {
      void invalidateRecipeLists(queryClient);
    }
  }, [jobs, queryClient]);

  const job = selectVisibleImportJob(jobs);

  useEffect(() => {
    if (!(job?.status === "succeeded" || job?.status === "failed")) {
      return;
    }

    const delay =
      job.status === "failed" ? importJobFailureDismissDelayMs : importJobSuccessDismissDelayMs;
    const timer = window.setTimeout(() => {
      dismissVisibleImportJob(job.id);
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [job, dismissVisibleImportJob]);

  useEffect(() => {
    if (job) {
      const previousJobId = previousJobIdRef.current;
      previousJobIdRef.current = job.id;
      setRenderedJob(job);

      if (previousJobId === job.id) {
        setIsVisible(true);
        return;
      }

      setIsVisible(false);
      const animationFrame = window.requestAnimationFrame(() => {
        setIsVisible(true);
      });

      return () => window.cancelAnimationFrame(animationFrame);
    }

    previousJobIdRef.current = null;
    setIsVisible(false);

    const unmountTimer = window.setTimeout(() => {
      setRenderedJob(null);
    }, importJobIslandUnmountDelayMs);

    return () => {
      window.clearTimeout(unmountTimer);
    };
  }, [job]);

  const visibleJob = renderedJob ?? job;

  if (!visibleJob) {
    return null;
  }

  const isActive = visibleJob.status === "queued" || visibleJob.status === "running";
  const isSucceeded = visibleJob.status === "succeeded";
  const isFailed = visibleJob.status === "failed";
  const title = isSucceeded
    ? "保存しました"
    : isFailed
      ? "取り込めませんでした"
      : visibleJob.status === "queued"
        ? "取り込み待ち"
        : "取り込み中";
  const description = isFailed ? getImportJobFailureMessage(visibleJob) : visibleJob.url;

  return (
    <Surface
      className={`fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-4 right-4 z-50 mx-auto flex max-w-[460px] items-center gap-3 rounded-[20px] border border-brand-line-soft bg-brand-paper/95 px-4 py-3 text-sm shadow-pantry backdrop-blur-xl transition-[opacity,transform] ease-out motion-reduce:transition-none sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-[76px] sm:w-[min(460px,calc(100vw-2rem))] sm:-translate-x-1/2 ${
        isVisible
          ? "translate-y-0 scale-100 opacity-100"
          : "pointer-events-none translate-y-6 opacity-0 sm:-translate-y-2 sm:scale-[0.98]"
      }`}
      role={isFailed ? "alert" : "status"}
      style={{ transitionDuration: `${importJobIslandAnimationMs}ms` }}
      variant="transparent"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            isSucceeded
              ? "bg-brand-sage-soft text-brand-sage-dark"
              : isFailed
                ? "bg-brand-danger/10 text-brand-danger"
                : "bg-brand-orange-soft/60 text-brand-orange"
          }`}
        >
          {isActive ? (
            <ProgressCircle
              aria-label="取り込み中"
              className="text-brand-orange"
              color="warning"
              isIndeterminate
              size="sm"
            >
              <ProgressCircle.Track>
                <ProgressCircle.TrackCircle />
                <ProgressCircle.FillCircle />
              </ProgressCircle.Track>
            </ProgressCircle>
          ) : null}
          {isSucceeded ? <CheckCircle size={19} weight="fill" /> : null}
          {isFailed ? <WarningCircle size={19} weight="fill" /> : null}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-brand-ink text-sm">{title}</p>
          {description ? (
            <p className="mt-0.5 truncate text-brand-muted text-xs">{description}</p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {isSucceeded && visibleJob.recipeId ? (
          <Link
            className="inline-flex min-h-8 items-center justify-center rounded-full bg-brand-sage px-3 font-semibold text-white text-xs no-underline transition-colors hover:bg-brand-sage-dark"
            params={{ recipeId: visibleJob.recipeId }}
            to="/recipes/$recipeId"
          >
            開く
          </Link>
        ) : null}
        {isFailed ? (
          <Button
            className="h-8 rounded-full bg-brand-sage px-3 text-white text-xs font-semibold hover:bg-brand-sage-dark"
            isDisabled={!visibleJob.url || retryMutation.isPending}
            size="sm"
            variant="primary"
            onPress={() => retryMutation.mutate(visibleJob)}
          >
            再試行
          </Button>
        ) : null}
        {!isActive ? (
          <Button
            aria-label="閉じる"
            className="h-8 w-8 rounded-full bg-transparent text-brand-muted hover:bg-brand-paper-muted hover:text-brand-walnut"
            isIconOnly
            size="sm"
            variant="ghost"
            onPress={() => dismissVisibleImportJob(visibleJob.id)}
          >
            <X size={16} weight="bold" />
          </Button>
        ) : null}
      </div>
    </Surface>
  );
};

const SourceIcon = () => {
  return <Globe className="h-3.5 w-3.5 text-brand-wheat" weight="bold" />;
};

type RecipeLightboxImage = {
  alt: string;
  height: number;
  id: string;
  url: string;
  width: number;
};

const lightboxSlideEasing = "cubic-bezier(0.22, 1, 0.36, 1)";
const lightboxRestEasing = "cubic-bezier(0.2, 0, 0, 1)";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getResistedDragOffset = (deltaX: number, stageWidth: number) => {
  const sign = Math.sign(deltaX);
  const edgeLimit = Math.max(104, stageWidth * 0.32);

  return sign * edgeLimit * (1 - Math.exp(-Math.abs(deltaX) / edgeLimit));
};

const getSwipeTransition = ({
  dragOffsetPx,
  isReturning,
  stageWidth,
  velocityX,
}: {
  dragOffsetPx: number;
  isReturning: boolean;
  stageWidth: number;
  velocityX: number;
}) => {
  if (isReturning) {
    const dragProgress = stageWidth > 0 ? Math.abs(dragOffsetPx) / stageWidth : 0;
    const durationMs = Math.round(clamp(170 + dragProgress * 20, 170, 190));

    return `transform ${durationMs}ms ${lightboxRestEasing}`;
  }

  const remainingDistance = Math.max(0, stageWidth - Math.abs(dragOffsetPx));
  const effectiveVelocity = Math.max(Math.abs(velocityX), 0.72);
  const durationMs = Math.round(clamp(remainingDistance / effectiveVelocity, 160, 240));

  return `transform ${durationMs}ms ${lightboxSlideEasing}`;
};

const RecipeImageZoomButton = ({
  alt,
  children,
  className,
  onOpen,
  style,
}: {
  alt: string;
  children: ReactNode;
  className: string;
  onOpen: () => void;
  style?: CSSProperties;
}) => (
  <button
    aria-label={`${alt}を拡大`}
    className={`${className} cursor-zoom-in border-0 bg-transparent p-0 text-left transition-transform duration-200 hover:scale-[1.01] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-orange`}
    style={style}
    type="button"
    onClick={onOpen}
  >
    {children}
  </button>
);

const RecipeImageLightbox = ({
  images,
  index,
  onChangeIndex,
  onClose,
}: {
  images: RecipeLightboxImage[];
  index: number;
  onChangeIndex: (index: number) => void;
  onClose: () => void;
}) => {
  const image = images[index];
  const hasMultipleImages = images.length > 1;
  const hasPreviousImage = index > 0;
  const hasNextImage = index < images.length - 1;
  const stageRef = useRef<HTMLDivElement | null>(null);
  const swipeGestureRef = useRef<{
    isHorizontal: boolean | null;
    lastTime: number;
    lastX: number;
    pointerId: number;
    stageWidth: number;
    startTime: number;
    startX: number;
    startY: number;
    velocityX: number;
  } | null>(null);
  const dragAnimationFrameRef = useRef<number | null>(null);
  const pendingDragOffsetRef = useRef(0);
  const currentDragOffsetRef = useRef(0);
  const didDragRef = useRef(false);
  const [dragOffsetPx, setDragOffsetPx] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [trackTransition, setTrackTransition] = useState(`transform 220ms ${lightboxSlideEasing}`);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (dragAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(dragAnimationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!image) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key === "ArrowLeft" && hasPreviousImage) {
        requestSlide(-1);
        return;
      }

      if (event.key === "ArrowRight" && hasNextImage) {
        requestSlide(1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (!image) {
    return null;
  }

  function updateDragOffset(nextOffset: number) {
    if (dragAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(dragAnimationFrameRef.current);
      dragAnimationFrameRef.current = null;
    }

    pendingDragOffsetRef.current = nextOffset;
    currentDragOffsetRef.current = nextOffset;
    setDragOffsetPx(nextOffset);
  }

  function scheduleDragOffset(nextOffset: number) {
    currentDragOffsetRef.current = nextOffset;
    pendingDragOffsetRef.current = nextOffset;

    if (dragAnimationFrameRef.current !== null) {
      return;
    }

    dragAnimationFrameRef.current = window.requestAnimationFrame(() => {
      dragAnimationFrameRef.current = null;
      setDragOffsetPx(pendingDragOffsetRef.current);
    });
  }

  function startSlide(direction: -1 | 1, velocityX = 0) {
    if (isAnimating) {
      return;
    }

    if ((direction === -1 && !hasPreviousImage) || (direction === 1 && !hasNextImage)) {
      return;
    }

    setIsDragging(false);
    setIsAnimating(true);
    setTrackTransition(
      getSwipeTransition({
        dragOffsetPx: currentDragOffsetRef.current,
        isReturning: false,
        stageWidth: stageRef.current?.clientWidth ?? window.innerWidth,
        velocityX,
      }),
    );
    updateDragOffset(0);
    onChangeIndex(index + direction);
  }

  function requestSlide(direction: -1 | 1) {
    if (isDragging) {
      return;
    }

    startSlide(direction);
  }

  function settleToRest() {
    setIsDragging(false);
    setTrackTransition(
      getSwipeTransition({
        dragOffsetPx: currentDragOffsetRef.current,
        isReturning: true,
        stageWidth: stageRef.current?.clientWidth ?? window.innerWidth,
        velocityX: 0,
      }),
    );
    setIsAnimating(Math.abs(currentDragOffsetRef.current) >= 1);
    updateDragOffset(0);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!hasMultipleImages || isAnimating || event.pointerType !== "touch") {
      return;
    }

    swipeGestureRef.current = {
      isHorizontal: null,
      lastTime: event.timeStamp,
      lastX: event.clientX,
      pointerId: event.pointerId,
      stageWidth: event.currentTarget.clientWidth,
      startTime: event.timeStamp,
      startX: event.clientX,
      startY: event.clientY,
      velocityX: 0,
    };
    didDragRef.current = false;
    setIsDragging(true);
    updateDragOffset(0);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = swipeGestureRef.current;

    if (!gesture || gesture.pointerId !== event.pointerId || isAnimating) {
      return;
    }

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const absDeltaX = Math.abs(deltaX);
    const absDeltaY = Math.abs(deltaY);

    if (gesture.isHorizontal === null) {
      if (Math.max(absDeltaX, absDeltaY) < 4) {
        return;
      }

      gesture.isHorizontal = absDeltaX > absDeltaY * 1.05;

      if (!gesture.isHorizontal) {
        setIsDragging(false);
        return;
      }
    }

    if (!gesture.isHorizontal) {
      return;
    }

    didDragRef.current = true;
    event.preventDefault();

    const elapsedMs = Math.max(1, event.timeStamp - gesture.lastTime);
    const instantVelocityX = (event.clientX - gesture.lastX) / elapsedMs;
    gesture.velocityX = gesture.velocityX * 0.65 + instantVelocityX * 0.35;
    gesture.lastX = event.clientX;
    gesture.lastTime = event.timeStamp;

    const isBlockedDirection = (deltaX > 0 && !hasPreviousImage) || (deltaX < 0 && !hasNextImage);
    scheduleDragOffset(
      isBlockedDirection ? getResistedDragOffset(deltaX, gesture.stageWidth) : deltaX,
    );
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = swipeGestureRef.current;

    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    swipeGestureRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!gesture.isHorizontal) {
      setIsDragging(false);
      updateDragOffset(0);
      return;
    }

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const absDeltaX = Math.abs(deltaX);
    const absDeltaY = Math.abs(deltaY);
    const elapsedMs = Math.max(1, event.timeStamp - gesture.startTime);
    const releaseVelocityX =
      (event.clientX - gesture.lastX) / Math.max(1, event.timeStamp - gesture.lastTime);
    const velocityX = gesture.velocityX * 0.7 + releaseVelocityX * 0.3;
    const distanceThreshold = Math.max(40, gesture.stageWidth * 0.1);
    const isDirectionIntentional = absDeltaX > absDeltaY * 1.2;
    const isDistanceSwipe = absDeltaX >= distanceThreshold;
    const isFlickSwipe = Math.abs(velocityX) >= 0.38 && elapsedMs <= 420 && absDeltaX >= 18;
    const isSwipe = isDirectionIntentional && (isDistanceSwipe || isFlickSwipe);

    if (isSwipe && deltaX < 0 && hasNextImage) {
      setIsDragging(false);
      startSlide(1, velocityX);
      return;
    }

    if (isSwipe && deltaX > 0 && hasPreviousImage) {
      setIsDragging(false);
      startSlide(-1, velocityX);
      return;
    }

    settleToRest();
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = swipeGestureRef.current;

    if (gesture?.pointerId !== event.pointerId) {
      return;
    }

    swipeGestureRef.current = null;
    settleToRest();
  }

  function handleTransitionEnd(event: ReactTransitionEvent<HTMLElement>) {
    if (event.propertyName !== "transform" || !isAnimating) {
      return;
    }

    setIsAnimating(false);
    updateDragOffset(0);
  }

  function handleSlideClick(event: ReactMouseEvent<HTMLElement>) {
    if (didDragRef.current) {
      didDragRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  const shouldTransitionTrack = !isDragging && isAnimating;

  return (
    <div
      aria-label="画像プレビュー"
      aria-modal="true"
      className="fixed inset-0 z-[60] isolate flex items-center justify-center bg-black/85 px-4 py-[calc(1rem+env(safe-area-inset-top))] text-white"
      role="dialog"
    >
      <button
        aria-label="背景を閉じる"
        className="absolute inset-0 z-0 cursor-default border-0 bg-transparent p-0"
        tabIndex={-1}
        type="button"
        onClick={onClose}
      />
      <div className="absolute right-4 top-[calc(1rem+env(safe-area-inset-top))] z-20 flex items-center gap-2">
        {hasMultipleImages ? (
          <span
            aria-live="polite"
            className="rounded-full bg-black/55 px-3 py-1 text-xs font-semibold text-white"
          >
            {index + 1} / {images.length}
          </span>
        ) : null}
        <Button
          aria-label="閉じる"
          className="rounded-full bg-brand-paper/95 text-brand-walnut shadow-pantry-sm hover:bg-brand-paper"
          isIconOnly
          variant="secondary"
          onPress={onClose}
        >
          <X size={20} weight="bold" />
        </Button>
      </div>

      {hasMultipleImages ? (
        <Button
          aria-label="前の画像"
          className="absolute left-3 top-1/2 z-20 -translate-y-1/2 rounded-full bg-brand-paper/95 text-brand-walnut shadow-pantry-sm hover:bg-brand-paper sm:left-6"
          isDisabled={!hasPreviousImage}
          isIconOnly
          variant="secondary"
          onPress={() => requestSlide(-1)}
        >
          <CaretLeft size={24} weight="bold" />
        </Button>
      ) : null}

      <div
        className="relative z-10 h-[86vh] w-[92vw] touch-pan-y overflow-hidden"
        ref={stageRef}
        onPointerCancel={handlePointerCancel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div
          className="absolute inset-0"
          style={{
            transform: `translateX(calc(${-index * 100}% + ${dragOffsetPx}px))`,
            transition: shouldTransitionTrack ? trackTransition : "none",
            willChange: isDragging || isAnimating ? "transform" : undefined,
          }}
          onTransitionEnd={handleTransitionEnd}
        >
          {images.map((slideImage, slideIndex) => (
            <button
              className="absolute inset-0 flex items-center justify-center border-0 bg-transparent p-0 text-white"
              key={slideImage.id}
              style={{ transform: `translateX(${slideIndex * 100}%)` }}
              tabIndex={-1}
              type="button"
              onClick={handleSlideClick}
            >
              <img
                alt={`${slideImage.alt} 拡大`}
                className="max-h-full max-w-full select-none rounded-[14px] object-contain shadow-pantry-lg"
                draggable={false}
                height={slideImage.height}
                src={slideImage.url}
                style={{ aspectRatio: `${slideImage.width} / ${slideImage.height}` }}
                width={slideImage.width}
              />
            </button>
          ))}
        </div>
      </div>

      {hasMultipleImages ? (
        <Button
          aria-label="次の画像"
          className="absolute right-3 top-1/2 z-20 -translate-y-1/2 rounded-full bg-brand-paper/95 text-brand-walnut shadow-pantry-sm hover:bg-brand-paper sm:right-6"
          isDisabled={!hasNextImage}
          isIconOnly
          variant="secondary"
          onPress={() => requestSlide(1)}
        >
          <CaretRight size={24} weight="bold" />
        </Button>
      ) : null}
    </div>
  );
};

export const RecipesIndexRoute = () => {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    try {
      return (localStorage.getItem("recipeViewMode") as "grid" | "list") || "grid";
    } catch {
      return "grid";
    }
  });
  const [loadedPages, setLoadedPages] = useState<ListRecipesResponse[]>([]);

  useEffect(() => {
    try {
      localStorage.setItem("recipeViewMode", viewMode);
    } catch {}
  }, [viewMode]);

  const { data, error, isFetching, refetch } = useQuery({
    queryKey: recipesQueryKeys.list(query, cursor),
    queryFn: () => listRecipes({ query, cursor }),
  });
  const deleteMutation = useMutation({
    mutationFn: (recipeId: string) => deleteRecipe(recipeId),
    onSuccess: async (_response, recipeId) => {
      removeRecipeDetail(queryClient, recipeId);
      await invalidateRecipeLists(queryClient);
    },
  });
  const activePages = cursor ? loadedPages.concat(data ? [data] : []) : data ? [data] : [];
  const recipes = activePages.flatMap((page) => page.items);
  const nextCursor = activePages.at(-1)?.nextCursor ?? null;
  const isInitialRecipesLoading = isFetching && recipes.length === 0 && !error;
  const recipeSkeletonKeys = viewMode === "grid" ? gridRecipeSkeletonKeys : listRecipeSkeletonKeys;

  const submitSearch = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    setLoadedPages([]);
    setCursor(null);
    setQuery(searchInput.trim());
  };

  const loadNextPage = () => {
    if (data?.nextCursor) {
      setLoadedPages((pages) => pages.concat(data));
      setCursor(data.nextCursor);
      return;
    }

    if (nextCursor) {
      void refetch();
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
    <section className="mx-auto w-full max-w-[1120px] px-4 py-3 sm:py-8 sm:px-6 lg:px-10">
      <form className="mt-2 flex min-w-0 items-end gap-3" onSubmit={submitSearch}>
        <div className="relative min-w-0 flex-1">
          <TextField className="min-w-0">
            <Label className="sr-only">検索</Label>
            <div className="relative min-w-0">
              <MagnifyingGlass
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-wheat"
                size={18}
                weight="bold"
              />
              <Input
                className="w-full min-w-0 pl-10"
                placeholder="レシピを検索..."
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </div>
          </TextField>
        </div>
        <Button
          className="shrink-0 rounded-full border border-brand-line bg-brand-paper-raised font-semibold text-brand-walnut hover:bg-brand-paper-muted"
          type="submit"
          variant="secondary"
        >
          検索
        </Button>
      </form>

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
          <ToggleButtonGroup
            aria-label="レシピ一覧の表示形式"
            disallowEmptySelection
            className="inline-flex shrink-0 p-1 rounded-full border border-brand-line-soft bg-brand-paper-raised"
            selectedKeys={[viewMode]}
            selectionMode="single"
            size="md"
            onSelectionChange={(keys) => {
              const [selectedKey] = keys;

              if (selectedKey === "grid" || selectedKey === "list") {
                setViewMode(selectedKey);
              }
            }}
          >
            <ToggleButton
              aria-label="グリッド表示"
              className="h-9 w-9 rounded-full text-brand-muted transition-all duration-200 data-[selected=true]:bg-brand-paper data-[selected=true]:shadow-pantry-sm data-[selected=true]:text-brand-ink hover:text-brand-ink sm:h-10 sm:w-10"
              id="grid"
              isIconOnly
              variant="ghost"
            >
              <SquaresFour size={18} weight={viewMode === "grid" ? "fill" : "bold"} />
            </ToggleButton>
            <ToggleButton
              aria-label="リスト表示"
              className="h-9 w-9 rounded-full text-brand-muted transition-all duration-200 data-[selected=true]:bg-brand-paper data-[selected=true]:shadow-pantry-sm data-[selected=true]:text-brand-ink hover:text-brand-ink sm:h-10 sm:w-10"
              id="list"
              isIconOnly
              variant="ghost"
            >
              <List size={18} weight="bold" />
            </ToggleButton>
          </ToggleButtonGroup>
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

      {nextCursor ? (
        <div className="mt-8 flex justify-center">
          <Button
            className="rounded-full bg-brand-paper-raised border border-brand-line text-brand-walnut font-semibold hover:bg-brand-paper-muted"
            isDisabled={isFetching}
            variant="secondary"
            onPress={loadNextPage}
          >
            もっと見る
          </Button>
        </div>
      ) : null}

      <AlertDialog.Backdrop
        isOpen={Boolean(deleteTargetId)}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setDeleteTargetId(null);
          }
        }}
      >
        <AlertDialog.Container placement="center" size="sm">
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>レシピを削除しますか？</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Footer>
              <Button
                isDisabled={deleteMutation.isPending}
                variant="tertiary"
                onPress={() => setDeleteTargetId(null)}
              >
                キャンセル
              </Button>
              <Button
                isDisabled={deleteMutation.isPending}
                variant="danger"
                onPress={confirmDelete}
              >
                削除
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </section>
  );
};

export const NewRecipeRoute = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: RecipeDraftFormValues) => {
    setSubmitError(null);

    try {
      const response = await createRecipe(formValuesToCreateRecipeRequest(values));
      await invalidateRecipeLists(queryClient);
      await navigate({ to: "/recipes/$recipeId", params: { recipeId: response.recipe.id } });
    } catch (error) {
      setSubmitError(recipeMutationErrorMessage(error, "レシピを保存できませんでした。"));
    }
  };

  return (
    <RecipeDraftForm
      defaultValues={createEmptyRecipeDraftFormValues()}
      submitError={submitError}
      submitLabel="保存"
      title="新しいレシピを追加"
      onClose={() => void navigate({ to: "/recipes" })}
      onSubmit={onSubmit}
    />
  );
};

export const RecipeDetailRoute = () => {
  const { recipeId } = useParams({ from: "/recipes/$recipeId" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const deleteMutation = useMutation({
    mutationFn: () => deleteRecipe(recipeId),
    onSuccess: async () => {
      removeRecipeDetail(queryClient, recipeId);
      await invalidateRecipeLists(queryClient);
      await navigate({ to: "/recipes" });
    },
  });
  const {
    data: recipe,
    error,
    isLoading,
  } = useQuery({
    queryKey: recipesQueryKeys.detail(recipeId),
    queryFn: () => getRecipe(recipeId),
  });
  const lightboxImages = useMemo<RecipeLightboxImage[]>(() => {
    if (!recipe || recipe.locked) {
      return [];
    }

    const images: RecipeLightboxImage[] = [];

    if (recipe.content.coverImage?.url) {
      images.push({
        alt: recipe.title,
        height: recipe.content.coverImage.height,
        id: `cover:${recipe.content.coverImage.objectKey}`,
        url: recipe.content.coverImage.url,
        width: recipe.content.coverImage.width,
      });
    }

    recipe.content.referenceImages?.forEach((image, imageIndex) => {
      if (!image.url) {
        return;
      }

      images.push({
        alt: `レシピ画像${imageIndex + 1}`,
        height: image.height,
        id: `reference:${image.objectKey}`,
        url: image.url,
        width: image.width,
      });
    });

    recipe.content.steps.forEach((step, stepIndex) => {
      step.images.forEach((image, imageIndex) => {
        if (!image.url) {
          return;
        }

        images.push({
          alt: `手順${stepIndex + 1}の画像${imageIndex + 1}`,
          height: image.height,
          id: `step:${image.objectKey}`,
          url: image.url,
          width: image.width,
        });
      });
    });

    return images;
  }, [recipe]);

  const confirmDelete = () => {
    setIsDeleteDialogOpen(false);
    deleteMutation.mutate();
  };
  const openLightbox = (imageId: string) => {
    const nextLightboxIndex = lightboxImages.findIndex((image) => image.id === imageId);

    if (nextLightboxIndex >= 0) {
      setLightboxIndex(nextLightboxIndex);
    }
  };

  useEffect(() => {
    if (lightboxIndex !== null && lightboxIndex >= lightboxImages.length) {
      setLightboxIndex(null);
    }
  }, [lightboxImages.length, lightboxIndex]);

  if (isLoading) {
    return <RecipeDetailSkeleton />;
  }

  if (error || !recipe) {
    return (
      <section className="mx-auto w-full max-w-[1120px] px-4 sm:px-6 lg:px-10 py-10">
        <h1 className="text-brand-ink font-bold text-2xl">レシピを表示できません</h1>
      </section>
    );
  }

  if (recipe.locked) {
    return (
      <article className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-10 py-10">
        <div className="flex items-center gap-2">
          <LockSimple size={20} className="text-brand-muted" weight="bold" />
          <h1 className="text-brand-ink font-bold text-2xl">ロック中のレシピ</h1>
        </div>
        <p className="mt-4 text-brand-muted">このレシピの詳細は現在表示できません。</p>
      </article>
    );
  }

  const referenceImages = recipe.content.referenceImages ?? [];
  const shouldShowIngredientsSection =
    Boolean(recipe.content.yieldText) || recipe.content.ingredientGroups.length > 0;
  const coverImageId = recipe.content.coverImage
    ? `cover:${recipe.content.coverImage.objectKey}`
    : null;
  const coverImageStyle = recipe.content.coverImage
    ? ({
        "--cover-aspect": recipe.content.coverImage.width / recipe.content.coverImage.height,
      } as CSSProperties)
    : undefined;

  return (
    <article className="mx-auto w-full max-w-4xl px-0 pb-10 sm:px-6 lg:px-10">
      <div className="sticky top-0 z-20 border-brand-line-soft border-b bg-brand-cream/95 px-3 py-2.5 backdrop-blur sm:top-3 sm:mt-3 sm:rounded-[20px] sm:border sm:px-5 sm:py-3 sm:shadow-pantry-sm">
        <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 sm:grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] sm:gap-3">
          <Button
            aria-label="レシピ一覧へ戻る"
            className="h-10 w-10 rounded-full border border-brand-line bg-brand-paper-raised text-brand-walnut hover:bg-brand-paper-muted sm:h-11 sm:w-11"
            isIconOnly
            variant="secondary"
            onPress={() => {
              void navigate({ to: "/recipes" });
            }}
          >
            <CaretLeft size={21} weight="bold" />
          </Button>
          <h1 className="min-w-0 truncate text-center font-bold text-brand-ink text-md leading-tight sm:text-xl">
            {recipe.title}
          </h1>
          <Dropdown>
            <Dropdown.Trigger
              aria-label="操作メニュー"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-brand-line bg-brand-paper-raised text-brand-walnut hover:bg-brand-paper-muted sm:h-11 sm:w-11"
            >
              <DotsThreeVertical size={20} weight="bold" />
            </Dropdown.Trigger>
            <Dropdown.Popover className="min-w-[140px] rounded-[20px] border border-brand-line-soft bg-brand-paper shadow-pantry">
              <Dropdown.Menu
                onAction={(key) => {
                  if (key === "edit") {
                    void navigate({ to: "/recipes/$recipeId/edit", params: { recipeId } });
                  } else if (key === "delete") {
                    setIsDeleteDialogOpen(true);
                  }
                }}
              >
                <Dropdown.Item id="edit" textValue="編集">
                  <div className="flex items-center gap-2 text-brand-walnut">
                    <PencilSimple size={16} weight="bold" />
                    <span className="text-sm font-semibold">編集</span>
                  </div>
                </Dropdown.Item>
                <Dropdown.Item id="delete" textValue="削除">
                  <div className="flex items-center gap-2 text-brand-danger">
                    <Trash size={16} weight="bold" />
                    <span className="text-sm font-semibold">削除</span>
                  </div>
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </div>

      <div className="px-3 pt-4 sm:px-0 sm:pt-6">
        {recipe.content.coverImage?.url ? (
          <RecipeImageZoomButton
            alt={recipe.title}
            className="relative mx-auto block w-fit max-w-[min(100%,640px,calc(30svh*var(--cover-aspect)))] overflow-hidden rounded-[16px] border border-brand-line-soft bg-brand-paper shadow-pantry-sm sm:max-w-[min(100%,640px,calc(360px*var(--cover-aspect)))] sm:rounded-[18px]"
            onOpen={() => {
              if (coverImageId) {
                openLightbox(coverImageId);
              }
            }}
            style={coverImageStyle}
          >
            <img
              alt={recipe.title}
              className="block h-auto max-h-[30svh] w-full rounded-[16px] object-contain sm:max-h-[360px] sm:rounded-[18px]"
              height={recipe.content.coverImage.height}
              src={recipe.content.coverImage.url}
              style={{
                aspectRatio: `${recipe.content.coverImage.width} / ${recipe.content.coverImage.height}`,
              }}
              width={recipe.content.coverImage.width}
              {...recipeDetailCoverImageProps}
            />
          </RecipeImageZoomButton>
        ) : null}
        <p className="mx-auto mt-5 max-w-3xl font-bold text-xl text-brand-ink leading-tight sm:mt-5 sm:text-2xl">
          {recipe.title}
        </p>
      </div>

      {deleteMutation.error ? (
        <div className="mx-4 mt-4 rounded-[14px] bg-brand-danger/5 border border-brand-danger/20 p-3 sm:mx-0">
          <p className="text-brand-danger text-sm" role="alert">
            レシピを削除できませんでした。
          </p>
        </div>
      ) : null}

      <AlertDialog.Backdrop isOpen={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialog.Container placement="center" size="sm">
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>レシピを削除しますか？</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Footer>
              <Button
                isDisabled={deleteMutation.isPending}
                variant="tertiary"
                onPress={() => setIsDeleteDialogOpen(false)}
              >
                キャンセル
              </Button>
              <Button
                isDisabled={deleteMutation.isPending}
                variant="danger"
                onPress={confirmDelete}
              >
                削除
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>

      {referenceImages.some((image) => image.url) ? (
        <section className="mx-4 mt-7 sm:mx-0">
          <h2 className="text-brand-walnut font-semibold text-sm sm:font-bold sm:text-base">
            レシピ画像
          </h2>
          <div className="mt-4 flex snap-x gap-3 overflow-x-auto pb-2">
            {referenceImages.map((image, imageIndex) =>
              image.url ? (
                <RecipeImageZoomButton
                  alt={`レシピ画像${imageIndex + 1}`}
                  className="grid aspect-[4/5] w-[min(40vw,160px)] shrink-0 snap-start place-items-center overflow-hidden rounded-[14px] bg-brand-paper-muted shadow-pantry-sm sm:w-[128px]"
                  key={image.objectKey}
                  onOpen={() => openLightbox(`reference:${image.objectKey}`)}
                >
                  <img
                    alt={`レシピ画像${imageIndex + 1}`}
                    className="h-full w-full object-contain"
                    height={image.height}
                    src={image.url}
                    width={image.width}
                    {...deferredRecipeContentImageProps}
                  />
                </RecipeImageZoomButton>
              ) : null,
            )}
          </div>
        </section>
      ) : null}

      {shouldShowIngredientsSection ? (
        <section className="mx-3 mt-6 overflow-hidden rounded-[16px] border border-brand-line-soft bg-brand-paper shadow-pantry-sm sm:mx-0 sm:mt-7 sm:rounded-[18px]">
          <div className="flex items-baseline justify-between gap-3 border-brand-line-soft border-b bg-brand-paper-muted/70 px-3.5 py-3 sm:gap-4 sm:px-5">
            <h2 className="text-brand-walnut font-semibold text-sm sm:font-bold sm:text-base">
              材料
            </h2>
            {recipe.content.yieldText ? (
              <p className="shrink-0 text-brand-ink text-sm font-medium sm:text-base">
                {recipe.content.yieldText}
              </p>
            ) : null}
          </div>
          <div className="px-3.5 py-3 sm:px-5">
            {recipe.content.ingredientGroups.map((group) => (
              <div
                className="mt-4 first:mt-0"
                key={
                  group.label ??
                  group.ingredients
                    .map((ingredient) => `${ingredient.name}:${ingredient.amount}`)
                    .join("|")
                }
              >
                {group.label ? (
                  <h3 className="font-medium text-brand-walnut text-sm">{group.label}</h3>
                ) : null}
                <ul className="mt-2 space-y-2">
                  {group.ingredients.map((ingredient) => (
                    <li
                      className="grid grid-cols-[minmax(0,1fr)_minmax(3rem,max-content)] items-end gap-2 text-sm sm:gap-3 sm:text-base"
                      key={`${ingredient.name}:${ingredient.amount}`}
                    >
                      <span className="flex min-w-0 items-baseline gap-3 text-brand-ink">
                        <span className="min-w-0">{ingredient.name}</span>
                        <span className="mb-1 h-px min-w-6 flex-1 border-brand-line-soft border-b border-dashed" />
                      </span>
                      <span className="text-right text-brand-ink font-medium">
                        {ingredient.amount || ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {recipe.content.steps.length > 0 ? (
        <section className="mx-3 mt-5 overflow-hidden rounded-[16px] border border-brand-line-soft bg-brand-paper shadow-pantry-sm sm:mx-0 sm:rounded-[18px]">
          <div className="border-brand-line-soft border-b bg-brand-paper-muted/70 px-3.5 py-3 sm:px-5">
            <h2 className="text-brand-walnut font-semibold text-sm sm:font-bold sm:text-base">
              手順
            </h2>
          </div>
          <ol className="divide-y divide-brand-line-soft px-3.5 sm:px-5">
            {recipe.content.steps.map((step, stepIndex) => (
              <li
                className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-2.5 py-3.5 sm:grid-cols-[3.5rem_minmax(0,1fr)] sm:gap-4 sm:py-4"
                key={step.images.map((image) => image.objectKey).join(":") || step.text}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-brand-orange-soft bg-brand-orange-soft/30 text-brand-orange text-sm font-bold sm:h-11 sm:w-11 sm:text-base">
                  {stepIndex + 1}
                </div>
                <div className="min-w-0 pt-1">
                  {step.text ? (
                    <p className="whitespace-pre-wrap text-brand-ink text-sm leading-6 sm:text-base">
                      {step.text}
                    </p>
                  ) : null}
                </div>
                {step.images.some((image) => image.url) ? (
                  <div className="col-span-2 flex snap-x gap-3 overflow-x-auto pb-2 pl-[calc(2.25rem+0.625rem)] sm:pl-[calc(3.5rem+1rem)]">
                    {step.images.map((image, imageIndex) =>
                      image.url ? (
                        <RecipeImageZoomButton
                          alt={`手順${stepIndex + 1}の画像${imageIndex + 1}`}
                          className="block w-[min(38vw,160px)] shrink-0 snap-start rounded-[14px] sm:w-[144px]"
                          key={image.objectKey}
                          onOpen={() => openLightbox(`step:${image.objectKey}`)}
                        >
                          <img
                            alt={`手順${stepIndex + 1}の画像${imageIndex + 1}`}
                            className="block max-h-[160px] w-full rounded-[14px] object-contain"
                            height={image.height}
                            src={image.url}
                            style={{ aspectRatio: `${image.width} / ${image.height}` }}
                            width={image.width}
                            {...deferredRecipeContentImageProps}
                          />
                        </RecipeImageZoomButton>
                      ) : null,
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {recipe.content.note ? (
        <section className="mx-4 mt-5 overflow-hidden rounded-[18px] border border-brand-line-soft bg-brand-paper shadow-pantry-sm sm:mx-0">
          <div className="border-brand-line-soft border-b bg-brand-paper-muted/70 px-4 py-3 sm:px-5">
            <h2 className="text-brand-walnut font-semibold text-sm sm:font-bold sm:text-base">
              メモ
            </h2>
          </div>
          <p className="whitespace-pre-wrap px-4 py-3 text-brand-ink text-sm leading-6 sm:px-5 sm:text-base">
            {recipe.content.note}
          </p>
        </section>
      ) : null}

      {recipe.source.sourceName || recipe.source.sourceUrl ? (
        <section className="mx-4 mt-7 sm:mx-0">
          <h2 className="text-brand-walnut font-semibold text-sm sm:font-bold sm:text-lg">出典</h2>
          <div className="mt-3 flex items-center gap-2">
            <Globe size={16} className="text-brand-wheat" weight="bold" />
            <div>
              {recipe.source.sourceName ? (
                <p className="text-brand-ink text-sm font-medium">{recipe.source.sourceName}</p>
              ) : null}
              {recipe.source.sourceUrl ? (
                <a
                  className="break-all text-brand-sage text-sm hover:text-brand-sage-dark transition-colors"
                  href={recipe.source.sourceUrl}
                >
                  {recipe.source.sourceUrl}
                </a>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {lightboxIndex !== null ? (
        <RecipeImageLightbox
          images={lightboxImages}
          index={lightboxIndex}
          onChangeIndex={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}
    </article>
  );
};

export const EditRecipeRoute = () => {
  const { recipeId } = useParams({ from: "/recipes/$recipeId/edit" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    data: recipe,
    error,
    isLoading,
  } = useQuery({
    queryKey: recipesQueryKeys.detail(recipeId),
    queryFn: () => getRecipe(recipeId),
  });

  const onSubmit = async (values: RecipeDraftFormValues) => {
    setSubmitError(null);

    let updatedRecipeId: string;
    try {
      const response = await updateRecipe(recipeId, formValuesToRecipeDraftContent(values));
      updatedRecipeId = response.recipe.id;
    } catch (error) {
      setSubmitError(recipeMutationErrorMessage(error, "レシピを更新できませんでした。"));
      return;
    }

    void invalidateRecipeLists(queryClient);
    removeRecipeDetail(queryClient, recipeId);
    await navigate({ to: "/recipes/$recipeId", params: { recipeId: updatedRecipeId } });
  };

  if (isLoading) {
    return <RecipeFormSkeleton />;
  }

  if (error || !recipe || recipe.locked) {
    return (
      <section className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-10 py-10">
        <h1 className="text-brand-ink font-bold text-2xl">レシピを編集できません</h1>
      </section>
    );
  }

  const referenceImages = recipe.content.referenceImages ?? [];

  return (
    <RecipeDraftForm
      key={recipe.id}
      coverImagePreviewUrl={recipe.content.coverImage?.url}
      defaultValues={recipeDetailToFormValues(recipe)}
      referenceImagePreviewUrls={referenceImages.map((image) => image.url ?? "")}
      submitError={submitError}
      submitLabel="更新"
      title="レシピを編集"
      stepImagePreviewUrls={recipe.content.steps.map((step) =>
        step.images.map((image) => image.url ?? ""),
      )}
      onClose={() => void navigate({ to: "/recipes/$recipeId", params: { recipeId } })}
      onSubmit={onSubmit}
    />
  );
};
