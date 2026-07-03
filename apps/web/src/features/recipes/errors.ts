import { ApiClientError } from "../../lib/api";

export const recipeMutationErrorMessage = (error: unknown, fallback: string) => {
  if (!(error instanceof ApiClientError)) {
    return fallback;
  }

  if (error.code === "recipe_limit_exceeded") {
    return "保存できるレシピ数の上限に達しています。";
  }

  if (error.code === "image_finalize_failed") {
    return "画像を保存できませんでした。再度アップロードしてください。";
  }

  return fallback;
};
