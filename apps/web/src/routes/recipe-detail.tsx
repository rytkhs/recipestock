import {
  CaretLeft,
  DotsThreeVertical,
  Globe,
  LockSimple,
  PencilSimple,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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
  src: string;
  width: number;
};

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

export const RecipeDetailRoute = () => {
  const { recipeId } = useParams({ from: "/_protected/recipes/$recipeId" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
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
        src: recipe.content.coverImage.url,
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
        src: image.url,
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
          src: image.url,
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
      setIsLightboxOpen(true);
    }
  };

  useEffect(() => {
    if (isLightboxOpen && lightboxIndex >= lightboxImages.length) {
      setIsLightboxOpen(false);
    }
  }, [isLightboxOpen, lightboxImages.length, lightboxIndex]);

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
              render={<Button size="icon" variant="outline" />}
            >
              <DotsThreeVertical weight="bold" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-36">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => {
                    void navigate({ to: "/recipes/$recipeId/edit", params: { recipeId } });
                  }}
                >
                  <PencilSimple weight="bold" />
                  <span>編集</span>
                </DropdownMenuItem>
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

      <Lightbox
        animation={{ fade: 200, swipe: 220 }}
        carousel={{ finite: true, imageProps: { decoding: "async" } }}
        close={() => setIsLightboxOpen(false)}
        controller={{ closeOnBackdropClick: true, closeOnPullDown: true }}
        index={lightboxIndex}
        labels={recipeLightboxLabels}
        on={{ view: ({ index }) => setLightboxIndex(index) }}
        open={isLightboxOpen}
        plugins={[Counter, Zoom]}
        slides={lightboxImages}
        styles={recipeLightboxStyles}
        zoom={{ maxZoomPixelRatio: 2 }}
      />
    </article>
  );
};
