import { Plus } from "@phosphor-icons/react";
import { type DraftImageRef } from "@recipestock/schemas";
import { useId, useRef } from "react";
import { DraftAddImageButton, DraftImageTile, DraftPendingImageTile } from "./draft-image-tile";
import {
  type ImagePreviewUrlsByImageId,
  imageInputAccept,
  imageRefId,
  type RecipeDraftFormControl,
} from "./form-internals";
import { useDraftImageList } from "./use-draft-image-list";

type ReferenceImagesSectionProps = {
  control: RecipeDraftFormControl;
  maxAddable: number;
  onUploadStateChange(isUploading: boolean): void;
  previewUrlsByImageId?: ImagePreviewUrlsByImageId;
  uploadImage: (file: File) => Promise<DraftImageRef>;
};

const referenceTileClass = "aspect-[4/5] w-28 sm:w-32";

// レシピ画像は元の投稿や本のページの写し。詳細と同じく、表紙の下に見出しを付けずに列で置く。
// まだ1枚もないときは、画像の列ができる場所に点線の枠を1つ置き、欄の名前と何を残すかを添える。
export const ReferenceImagesSection = ({
  control,
  maxAddable,
  onUploadStateChange,
  previewUrlsByImageId,
  uploadImage,
}: ReferenceImagesSectionProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const emptyHintId = useId();
  const { addFiles, error, images, isUploading, pendingImages, previewUrlFor, removeImage } =
    useDraftImageList({
      control,
      maxAddable,
      name: "referenceImages",
      onUploadStateChange,
      previewUrlsByImageId,
      uploadImage,
    });
  const isAddDisabled = maxAddable <= 0;
  const openPicker = () => inputRef.current?.click();

  return (
    <section aria-label="レシピ画像" className="pt-3">
      <input
        ref={inputRef}
        accept={imageInputAccept}
        aria-label="レシピ画像を追加"
        className="sr-only"
        disabled={isUploading || isAddDisabled}
        multiple
        type="file"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void addFiles(files);
        }}
      />

      {images.length > 0 || pendingImages.length > 0 ? (
        <div className="flex snap-x scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-1 sm:scroll-px-0 sm:px-0">
          {images.map((image, imageIndex) => (
            <DraftImageTile
              className={referenceTileClass}
              disabled={isUploading}
              key={imageRefId(image)}
              label={`レシピ画像${imageIndex + 1}`}
              src={previewUrlFor(image)}
              onRemove={() => removeImage(imageIndex)}
            />
          ))}
          {pendingImages.map((pendingImage) => (
            <DraftPendingImageTile
              className={referenceTileClass}
              key={pendingImage.id}
              label="レシピ画像をアップロード中"
              previewUrl={pendingImage.previewUrl}
            />
          ))}
          {isAddDisabled ? null : (
            <DraftAddImageButton
              className={referenceTileClass}
              disabled={isUploading}
              label="レシピ画像に写真を追加"
              onClick={openPicker}
            />
          )}
        </div>
      ) : isAddDisabled ? null : (
        <button
          aria-describedby={emptyHintId}
          aria-label="レシピ画像を追加"
          className="group mx-2 flex items-center gap-3 rounded-[12px] p-2 text-left outline-none transition-colors hover:bg-brand-paper-muted focus-visible:outline-2 focus-visible:outline-brand-orange disabled:opacity-50 sm:-mx-2"
          disabled={isUploading}
          type="button"
          onClick={openPicker}
        >
          <span
            aria-hidden="true"
            className="grid size-14 shrink-0 place-items-center rounded-[10px] border border-brand-line border-dashed text-brand-muted transition-colors group-hover:border-brand-sage group-hover:text-brand-sage-dark"
          >
            <Plus size={20} weight="bold" />
          </span>
          <span className="min-w-0">
            <span className="block font-semibold text-brand-ink text-sm">レシピ画像</span>
            <span className="block text-brand-muted text-sm" id={emptyHintId}>
              元の投稿やレシピの画像を残せます
            </span>
          </span>
        </button>
      )}

      {isAddDisabled ? (
        <p className="mt-2 px-4 text-brand-muted text-sm sm:px-0">レシピ画像は上限に達しました</p>
      ) : null}
      {error ? (
        <p className="mt-2 px-4 text-brand-danger text-sm sm:px-0" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};
