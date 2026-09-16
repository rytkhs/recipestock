import { ImageBroken, ImageSquare, Plus, X } from "@phosphor-icons/react";
import { useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const tileFrameClass =
  "relative shrink-0 snap-start overflow-hidden rounded-[10px] bg-brand-paper-muted";

// 画像の上の×は小さく見せ、押せる範囲だけ周りに広げる。ホバーのないスマホでも常に出す。
// 読み込めなかった保存済みの画像も、消せるように×を残す。
export const DraftImageTile = ({
  className,
  disabled = false,
  label,
  src,
  onRemove,
}: {
  className: string;
  disabled?: boolean;
  label: string;
  src?: string;
  onRemove: () => void;
}) => {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  return (
    <div className={cn(tileFrameClass, className)}>
      {src && failedSrc !== src ? (
        <img
          alt={`${label}プレビュー`}
          className="block size-full object-cover"
          src={src}
          onError={() => setFailedSrc(src)}
        />
      ) : null}
      {src && failedSrc === src ? (
        <span
          aria-label={`${label}を表示できません`}
          className="flex size-full flex-col items-center justify-center gap-1 px-1 text-center text-brand-muted"
          role="img"
        >
          <ImageBroken aria-hidden="true" size={20} weight="bold" />
          <span aria-hidden="true" className="text-[11px] leading-tight">
            表示できません
          </span>
        </span>
      ) : null}
      {src ? null : (
        <span className="grid size-full place-items-center text-brand-muted">
          <ImageSquare aria-hidden="true" size={20} />
        </span>
      )}
      <button
        aria-label={`${label}を削除`}
        className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-brand-ink/65 text-white backdrop-blur-sm transition-colors after:absolute after:-inset-2 hover:bg-brand-ink/80 focus-visible:outline-2 focus-visible:outline-brand-orange disabled:opacity-40"
        disabled={disabled}
        type="button"
        onClick={onRemove}
      >
        <X size={12} weight="bold" />
      </button>
    </div>
  );
};

export const DraftPendingImageTile = ({
  className,
  label,
  previewUrl,
}: {
  className: string;
  label: string;
  previewUrl: string;
}) => (
  <div className={cn(tileFrameClass, className)}>
    <img alt="" className="block size-full object-cover opacity-50" src={previewUrl} />
    <span className="absolute inset-0 grid place-items-center text-brand-walnut">
      <Spinner aria-label={label} />
    </span>
  </div>
);

export const DraftAddImageButton = ({
  className,
  disabled = false,
  label,
  onClick,
}: {
  className: string;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) => (
  <button
    aria-label={label}
    className={cn(
      "grid shrink-0 snap-start place-items-center rounded-[10px] border border-brand-line border-dashed text-brand-muted outline-none transition-colors hover:border-brand-sage hover:bg-brand-paper-muted hover:text-brand-sage-dark focus-visible:outline-2 focus-visible:outline-brand-orange disabled:opacity-50",
      className,
    )}
    disabled={disabled}
    type="button"
    onClick={onClick}
  >
    <Plus size={20} weight="bold" />
  </button>
);

// 画像がまだないときは、枠を置かずに文字の導線だけにする。
export const DraftAddPhotoButton = ({
  disabled = false,
  label,
  onClick,
}: {
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) => (
  <button
    aria-label={label}
    className="inline-flex h-9 items-center gap-1.5 rounded-full px-2 text-brand-muted text-sm outline-none transition-colors hover:bg-brand-paper-muted hover:text-brand-walnut focus-visible:outline-2 focus-visible:outline-brand-orange disabled:opacity-50"
    disabled={disabled}
    type="button"
    onClick={onClick}
  >
    <ImageSquare aria-hidden="true" size={16} weight="bold" />
    写真を追加
  </button>
);
