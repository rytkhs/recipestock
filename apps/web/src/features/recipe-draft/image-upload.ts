import {
  type CreateImageUploadUrlResponse,
  type DraftImageRef,
  MAX_IMAGE_UPLOAD_SIZE_BYTES,
} from "@recipestock/schemas";
import { parseApiResponse } from "../../lib/api";

export class RecipeImageUploadError extends Error {
  readonly code: "image_too_large" | "upload_failed";

  constructor(code: RecipeImageUploadError["code"]) {
    super(code);
    this.name = "RecipeImageUploadError";
    this.code = code;
  }
}

const browserCanResize = () =>
  typeof createImageBitmap === "function" &&
  typeof document.createElement("canvas").toBlob === "function";

const blobToFile = (blob: Blob, fileName: string) =>
  new File([blob], fileName, {
    type: blob.type,
    lastModified: Date.now(),
  });

const extensionFromContentType = (contentType: string) => {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "jpg";
  }
};

export const compressRecipeImage = async (file: File): Promise<File> => {
  if (!browserCanResize()) {
    return file;
  }

  const bitmap = await createImageBitmap(file);

  try {
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");

    if (!context) {
      return file;
    }

    context.drawImage(bitmap, 0, 0, width, height);
    const outputType = file.type === "image/png" ? "image/png" : "image/webp";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outputType, 0.82),
    );

    if (!blob) {
      const fallbackBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.82),
      );
      return fallbackBlob
        ? blobToFile(fallbackBlob, `${file.name.replace(/\.[^.]+$/, "")}.jpg`)
        : file;
    }

    return blobToFile(
      blob,
      `${file.name.replace(/\.[^.]+$/, "")}.${extensionFromContentType(blob.type)}`,
    );
  } finally {
    bitmap.close();
  }
};

const MAX_CONCURRENT_IMAGE_UPLOADS = 3;

let runningUploadCount = 0;
const waitingUploads: (() => void)[] = [];

// 圧縮は元の解像度のままデコードするので、同時に走らせるほどピークメモリが積み上がる。
// 12MPの写真1枚でおよそ47MB、レシピ画像は一度に20枚選べるため、絞らないとタブごと落ちる。
// 縮小と再エンコードはメインスレッドなので、同時数を増やして縮むのは通信の待ちだけ。
// 表紙・レシピ画像・手順画像はそれぞれ別に選べるので、上限はモジュールで共有する。
const withUploadSlot = async <T>(upload: () => Promise<T>): Promise<T> => {
  if (runningUploadCount < MAX_CONCURRENT_IMAGE_UPLOADS) {
    runningUploadCount += 1;
  } else {
    await new Promise<void>((resolve) => {
      waitingUploads.push(resolve);
    });
  }

  try {
    return await upload();
  } finally {
    const startNextUpload = waitingUploads.shift();

    // 空いた枠は数を戻さず、待っている次の1件へそのまま渡す。
    if (startNextUpload) {
      startNextUpload();
    } else {
      runningUploadCount -= 1;
    }
  }
};

export const uploadRecipeImage = (file: File): Promise<DraftImageRef> =>
  withUploadSlot(async () => {
    const compressedFile = await compressRecipeImage(file);

    if (compressedFile.size > MAX_IMAGE_UPLOAD_SIZE_BYTES) {
      throw new RecipeImageUploadError("image_too_large");
    }

    const upload = await parseApiResponse<CreateImageUploadUrlResponse>(
      fetch("/api/images/upload-url", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contentType: compressedFile.type,
          sizeBytes: compressedFile.size,
        }),
      }),
    );
    const putResponse = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: { "content-type": compressedFile.type },
      body: compressedFile,
    });

    if (!putResponse.ok) {
      throw new RecipeImageUploadError("upload_failed");
    }

    return { type: "tmpObjectKey", key: upload.objectKey };
  });
