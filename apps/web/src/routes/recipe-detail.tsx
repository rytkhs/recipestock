import {
  CaretLeft,
  CaretRight,
  DotsThreeVertical,
  Globe,
  LockSimple,
  PencilSimple,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type TransitionEvent as ReactTransitionEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { RecipeDetailSkeleton } from "../components/loading";
import { ScreenTopBar, ScreenTopBarIconButton } from "../components/screen-top-bar";
import {
  deleteRecipe,
  getRecipe,
  recipesQueryKeys,
  syncDeletedRecipeCaches,
} from "../features/recipes";

const recipeDetailCoverImageProps = {
  decoding: "async",
  fetchPriority: "high",
} as const;
const deferredRecipeContentImageProps = {
  decoding: "async",
  loading: "lazy",
} as const;

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
          size="icon"
          variant="secondary"
          onClick={onClose}
        >
          <X size={20} weight="bold" />
        </Button>
      </div>

      {hasMultipleImages ? (
        <Button
          aria-label="前の画像"
          className="absolute left-3 top-1/2 z-20 -translate-y-1/2 rounded-full bg-brand-paper/95 text-brand-walnut shadow-pantry-sm hover:bg-brand-paper sm:left-6"
          disabled={!hasPreviousImage}
          size="icon"
          variant="secondary"
          onClick={() => requestSlide(-1)}
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
          disabled={!hasNextImage}
          size="icon"
          variant="secondary"
          onClick={() => requestSlide(1)}
        >
          <CaretRight size={24} weight="bold" />
        </Button>
      ) : null}
    </div>
  );
};

export const RecipeDetailRoute = () => {
  const { recipeId } = useParams({ from: "/_protected/recipes/$recipeId" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const deleteMutation = useMutation({
    mutationFn: () => deleteRecipe(recipeId),
    onSuccess: async () => {
      await syncDeletedRecipeCaches(queryClient, recipeId);
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

  if (error || !recipe || recipe.locked) {
    const isLocked = Boolean(recipe?.locked);

    return (
      <article className="mx-auto w-full max-w-4xl px-0 pb-10 sm:px-6 lg:px-10">
        <ScreenTopBar
          leading={
            <ScreenTopBarIconButton
              aria-label="レシピ一覧へ戻る"
              onPress={() => {
                void navigate({ to: "/recipes" });
              }}
            >
              <CaretLeft size={21} weight="bold" />
            </ScreenTopBarIconButton>
          }
          title={isLocked ? "ロック中のレシピ" : "レシピを表示できません"}
        />
        <div className="px-4 pt-6 sm:px-0">
          {isLocked ? (
            <div className="flex items-start gap-2 text-brand-muted">
              <LockSimple className="mt-0.5 shrink-0" size={20} weight="bold" />
              <p>このレシピの詳細は現在表示できません。</p>
            </div>
          ) : (
            <p className="text-brand-muted">レシピの取得に失敗しました。</p>
          )}
        </div>
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
      <ScreenTopBar
        leading={
          <ScreenTopBarIconButton
            aria-label="レシピ一覧へ戻る"
            onPress={() => {
              void navigate({ to: "/recipes" });
            }}
          >
            <CaretLeft size={21} weight="bold" />
          </ScreenTopBarIconButton>
        }
        title={recipe.title}
        trailing={
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="操作メニュー"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-brand-line bg-brand-paper-raised text-brand-walnut hover:bg-brand-paper-muted sm:h-11 sm:w-11"
            >
              <DotsThreeVertical size={20} weight="bold" />
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
              <DropdownMenuItem
                onClick={() => {
                  setIsDeleteDialogOpen(true);
                }}
              >
                <div className="flex items-center gap-2 text-brand-danger">
                  <Trash size={16} weight="bold" />
                  <span className="text-sm font-semibold">削除</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

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

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
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
              onClick={() => setIsDeleteDialogOpen(false)}
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
