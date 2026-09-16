import { type DraftImageRef } from "@recipestock/schemas";
import { useEffect, useRef, useState } from "react";
import { useController } from "react-hook-form";
import {
  createLocalPreviewUrl,
  type ImagePreviewUrlsByImageId,
  imageRefId,
  type RecipeDraftFormControl,
  type RecipeDraftImageArrayFieldPath,
  revokeLocalPreviewUrl,
} from "./form-internals";
import { RecipeImageUploadError } from "./image-upload";

export type PendingDraftImage = {
  id: string;
  previewUrl: string;
};

type UploadResult =
  | { image: DraftImageRef; previewUrl: string }
  | { error: unknown; previewUrl: string };

const uploadErrorMessage = ({
  failures,
  skippedCount,
}: {
  failures: unknown[];
  skippedCount: number;
}) => {
  const messages: string[] = [];

  if (
    failures.some(
      (failure) => failure instanceof RecipeImageUploadError && failure.code === "image_too_large",
    )
  ) {
    messages.push("画像は5MB以下にしてください。");
  } else if (failures.length > 1) {
    messages.push(`${failures.length}枚の画像をアップロードできませんでした。`);
  } else if (failures.length === 1) {
    messages.push("画像をアップロードできませんでした。");
  }

  if (skippedCount > 0) {
    messages.push(`上限を超える${skippedCount}枚は追加していません。`);
  }

  return messages.length > 0 ? messages.join("") : null;
};

let pendingImageSequence = 0;

// レシピ画像と手順画像に共通の、複数枚の追加・削除とプレビューの持ち方。
// 選んだ画像はアップロードの間も手元のプレビューで並べ、終わった順ではなく選んだ順で足す。
export const useDraftImageList = ({
  control,
  maxAddable,
  name,
  onUploadStateChange,
  previewUrlsByImageId,
  uploadImage,
}: {
  control: RecipeDraftFormControl;
  maxAddable: number;
  name: RecipeDraftImageArrayFieldPath;
  onUploadStateChange(isUploading: boolean): void;
  previewUrlsByImageId?: ImagePreviewUrlsByImageId;
  uploadImage: (file: File) => Promise<DraftImageRef>;
}) => {
  const { field } = useController({ control, name });
  const [error, setError] = useState<string | null>(null);
  const [pendingImages, setPendingImages] = useState<PendingDraftImage[]>([]);
  const [localPreviewUrlsByImageId, setLocalPreviewUrlsByImageId] =
    useState<ImagePreviewUrlsByImageId>({});
  const localPreviewUrlsByImageIdRef = useRef(localPreviewUrlsByImageId);
  const images = field.value ?? [];

  localPreviewUrlsByImageIdRef.current = localPreviewUrlsByImageId;

  useEffect(
    () => () => {
      Object.values(localPreviewUrlsByImageIdRef.current).forEach(revokeLocalPreviewUrl);
    },
    [],
  );

  const addFiles = async (files: File[]) => {
    const acceptedFiles = files.slice(0, Math.max(0, maxAddable));
    const skippedCount = files.length - acceptedFiles.length;

    setError(null);

    if (acceptedFiles.length === 0) {
      setError(uploadErrorMessage({ failures: [], skippedCount }));
      return;
    }

    const uploads = acceptedFiles.map((file) => {
      pendingImageSequence += 1;
      return {
        file,
        id: `pending-${pendingImageSequence}`,
        previewUrl: createLocalPreviewUrl(file),
      };
    });
    setPendingImages(uploads.map(({ id, previewUrl }) => ({ id, previewUrl })));
    onUploadStateChange(true);

    try {
      const results = await Promise.all(
        uploads.map(async ({ file, previewUrl }): Promise<UploadResult> => {
          try {
            return { image: await uploadImage(file), previewUrl };
          } catch (uploadError) {
            return { error: uploadError, previewUrl };
          }
        }),
      );
      const uploadedImages: DraftImageRef[] = [];
      const uploadedPreviewUrls: ImagePreviewUrlsByImageId = {};
      const failures: unknown[] = [];

      for (const result of results) {
        if ("image" in result) {
          uploadedImages.push(result.image);
          uploadedPreviewUrls[imageRefId(result.image)] = result.previewUrl;
        } else {
          revokeLocalPreviewUrl(result.previewUrl);
          failures.push(result.error);
        }
      }

      setLocalPreviewUrlsByImageId((currentUrls) => ({ ...currentUrls, ...uploadedPreviewUrls }));
      // アップロード中は削除も並べ替えもできないので、選んだときの並びに足せばよい。
      field.onChange([...images, ...uploadedImages]);
      setError(uploadErrorMessage({ failures, skippedCount }));
    } finally {
      // ここを通りそこねるとアップロード中のままになり、保存も離脱の確認も戻らなくなる。
      setPendingImages([]);
      onUploadStateChange(false);
    }
  };

  const removeImage = (imageIndex: number) => {
    const image = images[imageIndex];

    if (!image) {
      return;
    }

    const removedImageId = imageRefId(image);
    setLocalPreviewUrlsByImageId((currentUrls) => {
      const nextUrls = { ...currentUrls };
      revokeLocalPreviewUrl(nextUrls[removedImageId]);
      delete nextUrls[removedImageId];
      return nextUrls;
    });
    field.onChange(images.filter((_, currentIndex) => currentIndex !== imageIndex));
  };

  const previewUrlFor = (image: DraftImageRef) => {
    const imageId = imageRefId(image);
    return localPreviewUrlsByImageId[imageId] ?? previewUrlsByImageId?.[imageId];
  };

  return {
    addFiles,
    error,
    images,
    isUploading: pendingImages.length > 0,
    pendingImages,
    previewUrlFor,
    removeImage,
  };
};
