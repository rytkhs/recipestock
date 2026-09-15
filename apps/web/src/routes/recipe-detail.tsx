import {
  ArrowUpRight,
  CaretLeft,
  DotsThreeVertical,
  LockSimple,
  PencilSimple,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { type RecipeDetail } from "@recipestock/schemas";
import { FREE_RECIPE_LIMIT } from "@recipestock/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import Lightbox from "yet-another-react-lightbox";
import Counter from "yet-another-react-lightbox/plugins/counter";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { RecipeDetailSkeleton } from "../components/loading";
import {
  ScreenTopBar,
  ScreenTopBarFrame,
  ScreenTopBarIconButton,
  screenTopBarIconButtonClass,
  screenTopBarTitleClass,
} from "../components/screen-top-bar";
import {
  deleteRecipe,
  getRecipe,
  recipesQueryKeys,
  syncDeletedRecipeCaches,
} from "../features/recipes";
import { KeepScreenOnToggle } from "../features/recipes/keep-screen-on";
import { readRecipeListFilters } from "../features/recipes/list-search";
import {
  type RecipeDetailImage,
  RecipeHero,
  RecipeImageStrip,
  RecipeSingleImage,
} from "../features/recipes/recipe-detail-image";
import {
  RecipeNote,
  RecipeSectionHeader,
  RecipeSource,
} from "../features/recipes/recipe-detail-section";
import { RecipeIngredients } from "../features/recipes/recipe-ingredients";
import { formatRecipeCreatedAt } from "../features/recipes/recipe-shelf";
import { RecipeSteps } from "../features/recipes/recipe-steps";
import { tagsQueryKeys } from "../features/tags";
import { RecipeTags } from "../features/tags/recipe-tags";

const detailPageClass = "mx-auto w-full max-w-5xl pb-12 sm:px-6 lg:px-10";

const recipeLightboxLabels = {
  Carousel: "画像ギャラリー",
  Close: "閉じる",
  Lightbox: "画像プレビュー",
  Next: "次の画像",
  "Photo gallery": "レシピ画像",
  Previous: "前の画像",
  Slide: "画像",
  "Zoom in": "拡大",
  "Zoom out": "縮小",
  "{index} of {total}": "{total}枚中{index}枚目",
} as const;

const recipeLightboxStyles = {
  root: {
    "--yarl__color_backdrop": "rgba(0, 0, 0, 0.85)",
    "--yarl__portal_zindex": "60",
    "--yarl__toolbar_padding": "calc(0.5rem + env(safe-area-inset-top)) 0.5rem 0.5rem",
  },
} as const;

type RecipeImages = {
  cover: RecipeDetailImage | null;
  references: RecipeDetailImage[];
  /** 手順ごとの画像。手順と同じ順に並ぶ。 */
  steps: RecipeDetailImage[][];
};

// 表示もライトボックスも、画像をobjectKeyで指す。URLのない画像は出さない。
// SNSの取り込みでは表紙とレシピ画像の1枚目が同じ画像なので、どこに出ていても1枚の画像として扱う。
const collectRecipeImages = ({ content, title }: RecipeDetail): RecipeImages => ({
  cover: content.coverImage?.url
    ? {
        alt: title,
        height: content.coverImage.height,
        id: content.coverImage.objectKey,
        src: content.coverImage.url,
        width: content.coverImage.width,
      }
    : null,
  references: (content.referenceImages ?? []).flatMap((image, imageIndex) =>
    image.url
      ? [
          {
            alt: `レシピ画像${imageIndex + 1}`,
            height: image.height,
            id: image.objectKey,
            src: image.url,
            width: image.width,
          },
        ]
      : [],
  ),
  steps: content.steps.map((step, stepIndex) =>
    step.images.flatMap((image, imageIndex) =>
      image.url
        ? [
            {
              alt: `手順${stepIndex + 1}の画像${imageIndex + 1}`,
              height: image.height,
              id: image.objectKey,
              src: image.url,
              width: image.width,
            },
          ]
        : [],
    ),
  ),
});

const readSourceHost = (sourceUrl: string | null | undefined) => {
  if (!sourceUrl) {
    return null;
  }

  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

// 本文のタイトルが上部バーの下に隠れたら、バーにタイトルを出す。
const useIsHiddenBehind = (
  targetRef: RefObject<HTMLElement | null>,
  barRef: RefObject<HTMLElement | null>,
) => {
  const [isHidden, setIsHidden] = useState(false);

  useEffect(() => {
    const update = () => {
      const target = targetRef.current;
      const bar = barRef.current;

      if (!target || !bar) {
        return;
      }

      setIsHidden(target.getBoundingClientRect().bottom <= bar.getBoundingClientRect().bottom);
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [barRef, targetRef]);

  return isHidden;
};

const RecipeDetailNotice = ({
  children,
  icon,
  message,
}: {
  children: ReactNode;
  icon: ReactNode;
  message: string;
}) => (
  <div className="mt-16 flex flex-col items-center px-4 text-center">
    <div className="flex size-16 items-center justify-center rounded-full bg-brand-paper-muted text-brand-walnut">
      {icon}
    </div>
    <p className="mt-5 max-w-xs text-balance text-brand-muted text-sm leading-relaxed">{message}</p>
    <div className="mt-6">{children}</div>
  </div>
);

export const RecipeDetailRoute = () => {
  const { recipeId } = useParams({ from: "/_protected/recipes/$recipeId" });
  const navigate = useNavigate();
  const {
    data: recipe,
    isFetching,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: recipesQueryKeys.detail(recipeId),
    queryFn: () => getRecipe(recipeId),
  });
  const backButton = (
    <ScreenTopBarIconButton
      aria-label="レシピ一覧へ戻る"
      onPress={() => {
        void navigate({ to: "/recipes", search: readRecipeListFilters() });
      }}
    >
      <CaretLeft size={21} weight="bold" />
    </ScreenTopBarIconButton>
  );

  if (isLoading) {
    return <RecipeDetailSkeleton />;
  }

  if (recipe?.locked) {
    return (
      <article className={detailPageClass}>
        <ScreenTopBar leading={backButton} title="ロック中のレシピ" />
        <RecipeDetailNotice
          icon={<LockSimple size={26} weight="bold" />}
          message={`フリープランで開けるのは、新しく保存した${FREE_RECIPE_LIMIT}件までです。`}
        >
          <Link className={cn(buttonVariants(), "no-underline")} to="/settings/billing">
            プランを見る
          </Link>
        </RecipeDetailNotice>
      </article>
    );
  }

  // 読み直しに失敗しても、手元にある内容は出したままにする。
  if (!recipe) {
    return (
      <article className={detailPageClass}>
        <ScreenTopBar leading={backButton} title="レシピを表示できません" />
        <RecipeDetailNotice
          icon={<WarningCircle size={26} weight="bold" />}
          message="レシピを読み込めませんでした。"
        >
          <Button disabled={isFetching} variant="outline" onClick={() => void refetch()}>
            再読み込み
          </Button>
        </RecipeDetailNotice>
      </article>
    );
  }

  return <RecipeDetailView backButton={backButton} recipe={recipe} />;
};

const RecipeDetailView = ({
  backButton,
  recipe,
}: {
  backButton: ReactNode;
  recipe: RecipeDetail;
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const barRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const referenceHeadingId = useId();
  const isTitleInBar = useIsHiddenBehind(titleRef, barRef);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [failedImageIds, setFailedImageIds] = useState<ReadonlySet<string>>(() => new Set());
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const deleteMutation = useMutation({
    mutationFn: () => deleteRecipe(recipe.id),
    // 付いていたタグの件数が減るので、タグ一覧も読み直させる。
    onSuccess: async () => {
      await Promise.all([
        syncDeletedRecipeCaches(queryClient, recipe.id),
        queryClient.invalidateQueries({ queryKey: tagsQueryKeys.all() }),
      ]);
      await navigate({ to: "/recipes", search: readRecipeListFilters() });
    },
  });
  const images = useMemo(() => collectRecipeImages(recipe), [recipe]);
  // ライトボックスは同じ画像を1回だけ並べる。表紙がレシピ画像にも入っていれば、投稿の順番のままその位置で開く。
  // 読み込めなかった画像はライトボックスにも出さない。
  const lightboxImages = useMemo(() => {
    const { cover, references, steps } = images;
    const isCoverInReferences = references.some((image) => image.id === cover?.id);
    const listedIds = new Set<string>();

    return [
      ...(cover && !isCoverInReferences ? [cover] : []),
      ...references,
      ...steps.flat(),
    ].filter((image) => {
      if (listedIds.has(image.id) || failedImageIds.has(image.id)) {
        return false;
      }

      listedIds.add(image.id);
      return true;
    });
  }, [failedImageIds, images]);
  const markImageFailed = useCallback((imageId: string) => {
    setFailedImageIds((current) =>
      current.has(imageId) ? current : new Set(current).add(imageId),
    );
  }, []);
  const openLightbox = (imageId: string) => {
    const index = lightboxImages.findIndex((image) => image.id === imageId);

    if (index >= 0) {
      setLightboxIndex(index);
    }
  };
  const confirmDelete = () => {
    setIsDeleteDialogOpen(false);
    deleteMutation.mutate();
  };

  useEffect(() => {
    if (lightboxIndex !== null && lightboxIndex >= lightboxImages.length) {
      setLightboxIndex(null);
    }
  }, [lightboxImages.length, lightboxIndex]);

  const { content, source } = recipe;
  const hasIngredients = Boolean(content.yieldText) || content.ingredientGroups.length > 0;
  const hasSteps = content.steps.length > 0;
  // レシピ画像が表紙と同じ画像だけなら、表紙を拡大すれば見られるので段を出さない。
  const hasReferenceImagesBesidesCover = images.references.some(
    (image) => image.id !== images.cover?.id,
  );
  const sourceHost = readSourceHost(source.sourceUrl);
  const sourceName = source.sourceName || sourceHost;
  const createdAtLabel = formatRecipeCreatedAt(recipe.createdAt);
  // 画面を消さないは、料理中に最初に見る段の見出しに1つだけ付ける。
  const keepScreenOn = <KeepScreenOnToggle />;

  const renderStepImages = (stepIndex: number) => {
    const stepImages = images.steps[stepIndex] ?? [];
    const onlyImage = stepImages.length === 1 ? stepImages[0] : undefined;

    if (onlyImage) {
      return (
        <RecipeSingleImage
          image={onlyImage}
          isFailed={failedImageIds.has(onlyImage.id)}
          sizeClassName="max-w-[min(100%,calc(22rem*var(--image-ratio)))]"
          onError={markImageFailed}
          onOpen={openLightbox}
        />
      );
    }

    return stepImages.length > 0 ? (
      <RecipeImageStrip
        failedImageIds={failedImageIds}
        images={stepImages}
        onError={markImageFailed}
        onOpen={openLightbox}
      />
    ) : null;
  };

  return (
    <article className={detailPageClass}>
      <ScreenTopBarFrame ref={barRef}>
        {backButton}
        {/* 本文の見出しと同じ名前なので、読み上げでは重ねない。 */}
        <p
          aria-hidden="true"
          className={cn(
            screenTopBarTitleClass,
            "transition-opacity duration-200",
            isTitleInBar ? "opacity-100" : "opacity-0",
          )}
        >
          {recipe.title}
        </p>
        <div className="flex items-center gap-2">
          <Link
            aria-label="編集"
            className={screenTopBarIconButtonClass}
            params={{ recipeId: recipe.id }}
            to="/recipes/$recipeId/edit"
          >
            <PencilSimple size={19} weight="bold" />
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="操作メニュー" className={screenTopBarIconButtonClass}>
              <DotsThreeVertical size={20} weight="bold" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-36">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => {
                    setIsDeleteDialogOpen(true);
                  }}
                >
                  <Trash weight="bold" />
                  <span>削除</span>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ScreenTopBarFrame>

      <header className="sm:pt-2 lg:grid lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-center lg:gap-12 lg:pt-4">
        <RecipeHero
          cover={images.cover}
          isCoverFailed={images.cover ? failedImageIds.has(images.cover.id) : false}
          recipeId={recipe.id}
          title={recipe.title}
          onError={markImageFailed}
          onOpen={openLightbox}
        />
        <div className="px-4 pt-5 sm:px-0 sm:pt-6 lg:pt-0">
          <h1
            className="font-bold text-[1.625rem] text-brand-ink leading-[1.35] sm:text-3xl"
            ref={titleRef}
          >
            {recipe.title}
          </h1>
          {sourceName || createdAtLabel ? (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-brand-muted text-sm">
              {sourceName && source.sourceUrl ? (
                <a
                  className="inline-flex items-center gap-0.5 font-medium text-brand-sage-dark underline-offset-4 hover:underline"
                  href={source.sourceUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {sourceName}
                  <ArrowUpRight aria-hidden="true" size={14} weight="bold" />
                  <span className="sr-only">（元のページを開く）</span>
                </a>
              ) : null}
              {sourceName && !source.sourceUrl ? <span>{sourceName}</span> : null}
              {sourceName && createdAtLabel ? <span aria-hidden="true">·</span> : null}
              {createdAtLabel ? <span>{createdAtLabel}に保存</span> : null}
            </p>
          ) : null}
          <RecipeTags recipeId={recipe.id} tags={recipe.tags} />
        </div>
      </header>

      {deleteMutation.error ? (
        <div className="mx-4 mt-6 rounded-[14px] border border-brand-danger/20 bg-brand-danger/5 p-3 sm:mx-0">
          <p className="text-brand-danger text-sm" role="alert">
            レシピを削除できませんでした。
          </p>
        </div>
      ) : null}

      <div
        className={cn(
          "mt-8 px-4 sm:mt-10 sm:px-0 lg:mt-14",
          hasIngredients &&
            "lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-x-14",
        )}
      >
        {hasIngredients ? (
          // 広い画面では材料を手順の横に残し、手順を読み進めても分量を見返せるようにする。
          <div className="lg:sticky lg:top-40 lg:max-h-[calc(100svh-11rem)] lg:overflow-y-auto lg:pr-2 lg:pb-6">
            <RecipeIngredients
              action={keepScreenOn}
              groups={content.ingredientGroups}
              key={recipe.updatedAt}
              yieldText={content.yieldText}
            />
          </div>
        ) : null}
        <div
          className={cn("flex flex-col gap-10", hasIngredients ? "mt-10 lg:mt-0" : "lg:max-w-3xl")}
        >
          {hasSteps ? (
            <RecipeSteps
              action={hasIngredients ? undefined : keepScreenOn}
              key={recipe.updatedAt}
              renderImages={renderStepImages}
              steps={content.steps}
            />
          ) : null}
          {content.note ? <RecipeNote note={content.note} /> : null}
          {hasReferenceImagesBesidesCover ? (
            <section aria-labelledby={referenceHeadingId}>
              <RecipeSectionHeader
                action={hasIngredients || hasSteps ? undefined : keepScreenOn}
                id={referenceHeadingId}
                meta={`${images.references.length}枚`}
                title="レシピ画像"
              />
              <RecipeImageStrip
                className="-mx-4 mt-4 scroll-px-4 px-4 sm:mx-0 sm:scroll-px-0 sm:px-0"
                failedImageIds={failedImageIds}
                images={images.references}
                onError={markImageFailed}
                onOpen={openLightbox}
              />
            </section>
          ) : null}
          {sourceName ? (
            <RecipeSource host={sourceHost} name={sourceName} url={source.sourceUrl ?? null} />
          ) : null}
        </div>
      </div>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
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

      <Lightbox
        animation={{ fade: 200, swipe: 220 }}
        carousel={{ finite: true, imageProps: { decoding: "async" } }}
        close={() => setLightboxIndex(null)}
        controller={{
          closeOnBackdropClick: true,
          closeOnPullDown: true,
        }}
        index={lightboxIndex ?? 0}
        labels={recipeLightboxLabels}
        on={{ view: ({ index }) => setLightboxIndex(index) }}
        open={lightboxIndex !== null}
        plugins={[Counter, Zoom]}
        slides={lightboxImages}
        styles={recipeLightboxStyles}
        zoom={{ maxZoomPixelRatio: 2 }}
      />
    </article>
  );
};
