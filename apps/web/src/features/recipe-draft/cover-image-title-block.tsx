import { Camera, ImageBroken, Trash } from "@phosphor-icons/react";
import { type DraftImageRef, MAX_RECIPE_TITLE_LENGTH } from "@recipestock/schemas";
import { useEffect, useId, useRef, useState } from "react";
import { useController } from "react-hook-form";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  createLocalPreviewUrl,
  draftInlineFieldClass,
  imageInputAccept,
  isAdvanceEnter,
  type RecipeDraftFormControl,
  revokeLocalPreviewUrl,
  toSingleLine,
} from "./form-internals";
import { RecipeImageUploadError } from "./image-upload";

type CoverImageTitleBlockProps = {
  control: RecipeDraftFormControl;
  coverImagePreviewUrl?: string;
  uploadImage: (file: File) => Promise<DraftImageRef>;
  onUploadStateChange(isUploading: boolean): void;
};

const heroFrameClass =
  "relative block w-full overflow-hidden bg-brand-paper-muted sm:rounded-[20px]";

const heroActionClass =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-brand-ink/60 px-3.5 font-semibold text-sm text-white outline-none backdrop-blur-md transition-colors hover:bg-brand-ink/75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50";

// 冒頭は詳細と同じく、表紙の写真を大きく置いてすぐ下にレシピ名を組む。見たままの場所で直せるようにする。
export const CoverImageTitleBlock = ({
  control,
  coverImagePreviewUrl,
  uploadImage,
  onUploadStateChange,
}: CoverImageTitleBlockProps) => {
  const { field: coverImageField } = useController({ control, name: "coverImage" });
  const { field: titleField, fieldState: titleState } = useController({
    control,
    name: "title",
  });

  const inputRef = useRef<HTMLInputElement | null>(null);
  const titleErrorId = useId();
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string | null>(null);

  const hasCover = Boolean(coverImageField.value);
  const currentPreviewUrl = localPreviewUrl ?? (hasCover ? coverImagePreviewUrl : undefined);
  const titleError = titleState.error?.message;
  const openPicker = () => inputRef.current?.click();

  useEffect(() => () => revokeLocalPreviewUrl(localPreviewUrl), [localPreviewUrl]);

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setError(null);
    const nextPreviewUrl = createLocalPreviewUrl(file);
    setIsUploading(true);
    onUploadStateChange(true);

    try {
      const uploadedImage = await uploadImage(file);
      setLocalPreviewUrl((currentUrl) => {
        revokeLocalPreviewUrl(currentUrl);
        return nextPreviewUrl;
      });
      coverImageField.onChange(uploadedImage);
    } catch (uploadError) {
      revokeLocalPreviewUrl(nextPreviewUrl);
      setError(
        uploadError instanceof RecipeImageUploadError && uploadError.code === "image_too_large"
          ? "画像は5MB以下にしてください。"
          : "画像をアップロードできませんでした。",
      );
    } finally {
      setIsUploading(false);
      onUploadStateChange(false);
    }
  };

  const handleRemove = () => {
    setError(null);
    setLocalPreviewUrl((currentUrl) => {
      revokeLocalPreviewUrl(currentUrl);
      return null;
    });
    coverImageField.onChange(undefined);
  };

  return (
    <header className="sm:pt-2 md:grid md:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] md:items-center md:gap-12 md:pt-4">
      <div className="relative">
        <input
          ref={inputRef}
          accept={imageInputAccept}
          aria-label="表紙の写真"
          className="sr-only"
          disabled={isUploading}
          type="file"
          onChange={(event) => void handleChange(event)}
        />

        {hasCover ? (
          <div className={cn(heroFrameClass, "aspect-[4/3]")}>
            {currentPreviewUrl && failedPreviewUrl !== currentPreviewUrl ? (
              <img
                alt="表紙の写真プレビュー"
                className="block size-full object-cover"
                src={currentPreviewUrl}
                onError={() => setFailedPreviewUrl(currentPreviewUrl)}
              />
            ) : (
              <span
                aria-label="表紙の写真を表示できません"
                className="flex size-full flex-col items-center justify-center gap-2 text-brand-muted"
                role="img"
              >
                <ImageBroken aria-hidden="true" size={28} weight="bold" />
                <span aria-hidden="true" className="text-sm">
                  写真を表示できません
                </span>
              </span>
            )}
            <div className="absolute right-3 bottom-3 flex gap-2">
              <button
                aria-label="表紙の写真を変更"
                className={heroActionClass}
                disabled={isUploading}
                type="button"
                onClick={openPicker}
              >
                <Camera aria-hidden="true" size={16} weight="bold" />
                写真を変更
              </button>
              <button
                aria-label="表紙の写真を外す"
                className={cn(heroActionClass, "w-10 px-0")}
                disabled={isUploading}
                type="button"
                onClick={handleRemove}
              >
                <Trash aria-hidden="true" size={16} weight="bold" />
              </button>
            </div>
          </div>
        ) : (
          <button
            className={cn(
              heroFrameClass,
              "flex aspect-[12/5] flex-col items-center justify-center gap-2 text-brand-muted outline-none transition-colors hover:bg-brand-paper-raised hover:text-brand-sage-dark focus-visible:outline-3 focus-visible:outline-brand-orange focus-visible:outline-offset-[-3px] md:aspect-[4/3]",
            )}
            disabled={isUploading}
            type="button"
            onClick={openPicker}
          >
            <Camera aria-hidden="true" size={28} weight="fill" />
            <span className="font-semibold text-sm">表紙の写真を追加</span>
          </button>
        )}

        {isUploading ? (
          <div className="absolute inset-0 grid place-items-center bg-black/30 text-primary-foreground sm:rounded-[20px]">
            <Spinner aria-label="表紙の写真をアップロード中" />
          </div>
        ) : null}
      </div>

      <div className="px-4 pt-5 sm:px-0 sm:pt-6 md:pt-0">
        <textarea
          aria-describedby={titleError ? titleErrorId : undefined}
          aria-invalid={titleError ? true : undefined}
          aria-label="レシピ名"
          className={cn(
            draftInlineFieldClass,
            "field-sizing-content -mx-2 w-[calc(100%+1rem)] py-1 font-bold text-[1.625rem] leading-[1.35] sm:text-3xl",
          )}
          enterKeyHint="done"
          maxLength={MAX_RECIPE_TITLE_LENGTH}
          name={titleField.name}
          placeholder="レシピ名"
          ref={titleField.ref}
          rows={1}
          value={titleField.value ?? ""}
          onBlur={titleField.onBlur}
          onChange={(event) => titleField.onChange(toSingleLine(event.target.value))}
          onKeyDown={(event) => {
            if (isAdvanceEnter(event)) {
              event.preventDefault();
            }
          }}
        />
        {titleError ? (
          <p className="mt-1 font-medium text-brand-danger text-sm" id={titleErrorId}>
            {titleError}
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 text-brand-danger text-sm" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </header>
  );
};
