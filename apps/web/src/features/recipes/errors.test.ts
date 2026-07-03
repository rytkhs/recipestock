import { describe, expect, it } from "vitest";
import { ApiClientError } from "../../lib/api";
import { recipeMutationErrorMessage } from "./errors";

describe("recipeMutationErrorMessage", () => {
  it("recipe_limit_exceededを保存上限メッセージに変換する", () => {
    const error = new ApiClientError({
      code: "recipe_limit_exceeded",
      message: "Recipe limit exceeded.",
      status: 403,
    });

    expect(recipeMutationErrorMessage(error, "fallback")).toBe(
      "保存できるレシピ数の上限に達しています。",
    );
  });

  it("image_finalize_failedを画像保存メッセージに変換する", () => {
    const error = new ApiClientError({
      code: "image_finalize_failed",
      message: "Image finalize failed.",
      status: 500,
    });

    expect(recipeMutationErrorMessage(error, "fallback")).toBe(
      "画像を保存できませんでした。再度アップロードしてください。",
    );
  });

  it("未対応のerrorはfallbackを返す", () => {
    const error = new ApiClientError({
      code: "unexpected_response",
      message: "Unexpected API error response.",
      status: 500,
    });

    expect(recipeMutationErrorMessage(error, "fallback")).toBe("fallback");
    expect(recipeMutationErrorMessage(new Error("broken"), "fallback")).toBe("fallback");
  });
});
