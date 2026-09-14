import { ImageBroken } from "@phosphor-icons/react";
import { type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { RecipeTitlePlate } from "./recipe-cover";

export type RecipeDetailImage = {
  alt: string;
  height: number;
  id: string;
  src: string;
  width: number;
};

type RecipeImageHandlers = {
  onError: (imageId: string) => void;
  onOpen: (imageId: string) => void;
};

const deferredImageProps = {
  decoding: "async",
  loading: "lazy",
} as const;

const aspectRatioOf = (image: RecipeDetailImage) => `${image.width} / ${image.height}`;

const clampRatio = (ratio: number, min: number, max: number) => Math.min(Math.max(ratio, min), max);

// 画像はスクロールの帯の中にも置くので、枠の外に出るoutlineは切れる。内側に引いて見えるようにする。
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
    className={cn(
      "block cursor-zoom-in overflow-hidden p-0 text-left outline-none focus-visible:outline-3 focus-visible:outline-brand-orange focus-visible:outline-offset-[-3px]",
      className,
    )}
    style={style}
    type="button"
    onClick={onOpen}
  >
    {children}
  </button>
);

const RecipeImageUnavailable = ({
  className,
  label,
  style,
}: {
  className: string;
  label: string;
  style?: CSSProperties;
}) => (
  <span
    aria-label={label}
    className={cn(
      "flex flex-col items-center justify-center gap-1.5 bg-brand-paper-muted px-3 text-center text-brand-muted",
      className,
    )}
    role="img"
    style={style}
  >
    <ImageBroken aria-hidden="true" size={22} weight="bold" />
    <span aria-hidden="true" className="text-balance text-xs">
      画像を表示できません
    </span>
  </span>
);

const heroFrameClass =
  "relative block w-full overflow-hidden bg-brand-paper-muted sm:rounded-[20px]";

const RecipeHeroPlate = ({ recipeId, title }: { recipeId: string; title: string }) => (
  <span
    className={cn(heroFrameClass, "@container-size aspect-[12/5] sm:aspect-[4/1] lg:aspect-[4/3]")}
  >
    <RecipeTitlePlate
      initialSizeClassName="text-[length:60cqh]"
      paddingClassName="p-[12cqh]"
      recipeId={recipeId}
      title={title}
    />
  </span>
);

// 表紙は写真を大きく見せる。縦長や極端な横長は枠の比率に収めて切り、拡大すれば全体を見られる。
// 表紙がない・読み込めないときは、一覧の題簽と同じ地色と一文字の帯にして、一覧から開いたときに同じレシピだと分かるようにする。
export const RecipeHero = ({
  cover,
  isCoverFailed,
  onError,
  onOpen,
  recipeId,
  title,
}: RecipeImageHandlers & {
  cover: RecipeDetailImage | null;
  isCoverFailed: boolean;
  recipeId: string;
  title: string;
}) => {
  if (!cover) {
    return <RecipeHeroPlate recipeId={recipeId} title={title} />;
  }

  if (isCoverFailed) {
    return (
      <span aria-label={`${title}の画像を読み込めませんでした`} className="block" role="img">
        <RecipeHeroPlate recipeId={recipeId} title={title} />
      </span>
    );
  }

  const ratio = cover.width / cover.height;

  return (
    <RecipeImageZoomButton
      alt={title}
      className={cn(
        heroFrameClass,
        "aspect-(--hero-ratio) sm:aspect-(--hero-ratio-sm) lg:aspect-(--hero-ratio-lg)",
      )}
      style={
        {
          "--hero-ratio": clampRatio(ratio, 1, 2),
          "--hero-ratio-sm": clampRatio(ratio, 1.6, 2.4),
          "--hero-ratio-lg": clampRatio(ratio, 1, 1.6),
        } as CSSProperties
      }
      onOpen={() => onOpen(cover.id)}
    >
      <img
        alt={title}
        className="block size-full object-cover"
        decoding="async"
        fetchPriority="high"
        height={cover.height}
        src={cover.src}
        width={cover.width}
        onError={() => onError(cover.id)}
      />
    </RecipeImageZoomButton>
  );
};

// 1枚の画像は縦横比のまま出す。高さの上限は、--image-ratio を掛けた幅の上限として呼び出し側が渡す。
export const RecipeSingleImage = ({
  image,
  isFailed,
  onError,
  onOpen,
  sizeClassName,
}: RecipeImageHandlers & {
  image: RecipeDetailImage;
  isFailed: boolean;
  sizeClassName: string;
}) => {
  const ratioStyle = { "--image-ratio": image.width / image.height } as CSSProperties;

  if (isFailed) {
    return (
      <RecipeImageUnavailable
        className={cn("w-full rounded-[12px]", sizeClassName)}
        label={`${image.alt}を読み込めませんでした`}
        style={{ ...ratioStyle, aspectRatio: aspectRatioOf(image) }}
      />
    );
  }

  return (
    <RecipeImageZoomButton
      alt={image.alt}
      className={cn("w-full rounded-[12px] bg-brand-paper-muted", sizeClassName)}
      style={ratioStyle}
      onOpen={() => onOpen(image.id)}
    >
      <img
        alt={image.alt}
        className="block h-auto w-full"
        height={image.height}
        src={image.src}
        style={{ aspectRatio: aspectRatioOf(image) }}
        width={image.width}
        onError={() => onError(image.id)}
        {...deferredImageProps}
      />
    </RecipeImageZoomButton>
  );
};

// 複数の画像は高さをそろえた横の帯にする。縦横比は保つので、切らずに並ぶ。
export const RecipeImageStrip = ({
  className,
  failedImageIds,
  images,
  onError,
  onOpen,
}: RecipeImageHandlers & {
  className?: string;
  failedImageIds: ReadonlySet<string>;
  images: readonly RecipeDetailImage[];
}) => (
  <div className={cn("flex snap-x gap-2.5 overflow-x-auto pb-1", className)}>
    {images.map((image) => {
      const frameClass = "h-44 max-w-[80vw] shrink-0 snap-start rounded-[12px] sm:h-52";
      const style = { aspectRatio: aspectRatioOf(image) };

      return failedImageIds.has(image.id) ? (
        <RecipeImageUnavailable
          className={frameClass}
          key={image.id}
          label={`${image.alt}を読み込めませんでした`}
          style={style}
        />
      ) : (
        <RecipeImageZoomButton
          alt={image.alt}
          className={cn(frameClass, "bg-brand-paper-muted")}
          key={image.id}
          style={style}
          onOpen={() => onOpen(image.id)}
        >
          <img
            alt={image.alt}
            className="block size-full object-cover"
            height={image.height}
            src={image.src}
            width={image.width}
            onError={() => onError(image.id)}
            {...deferredImageProps}
          />
        </RecipeImageZoomButton>
      );
    })}
  </div>
);
