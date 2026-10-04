import { ImageBroken, ImageSquare, Plus, X } from "@phosphor-icons/react";
import { useId, useState } from "react";
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

// 画像がまだないときは、画像の列ができる場所に点線の枠を1つ置き、欄の名前を添える。
export const DraftAddFirstImageButton = ({
  disabled = false,
  frameClassName,
  hint,
  label,
  title,
  onClick,
}: {
  disabled?: boolean;
  frameClassName: string;
  hint?: string;
  label: string;
  title: string;
  onClick: () => void;
}) => {
  const hintId = useId();

  return (
    <button
      aria-describedby={hint ? hintId : undefined}
      aria-label={label}
      className="group flex items-center gap-3 rounded-[12px] p-2 text-left outline-none transition-colors hover:bg-brand-paper-muted focus-visible:outline-2 focus-visible:outline-brand-orange disabled:opacity-50"
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid shrink-0 place-items-center rounded-[10px] border border-brand-line border-dashed text-brand-muted transition-colors group-hover:border-brand-sage group-hover:text-brand-sage-dark",
          frameClassName,
        )}
      >
        <Plus size={20} weight="bold" />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold text-brand-ink text-sm">{title}</span>
        {hint ? (
          <span className="block text-brand-muted text-sm" id={hintId}>
            {hint}
          </span>
        ) : null}
      </span>
    </button>
  );
};
