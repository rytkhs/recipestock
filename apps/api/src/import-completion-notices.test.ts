import { parseImportCompletionPushPayload } from "@recipestock/shared";
import { describe, expect, it } from "vitest";
import { buildImportCompletionPushPayload } from "./import-completion-notices";

describe("取り込み完了noticeのカタログ", () => {
  it("成功payloadに表示文言と遷移用のrecipeIdを載せる", () => {
    const payload = buildImportCompletionPushPayload({
      outcome: "succeeded",
      recipeId: "recipe_1",
    });

    expect(payload).toEqual({
      outcome: "succeeded",
      recipeId: "recipe_1",
      notice: { title: expect.any(String), body: expect.any(String) },
    });
    expect(parseImportCompletionPushPayload(payload)).toEqual(payload);
  });

  it("失敗payloadに表示文言だけを載せる", () => {
    const payload = buildImportCompletionPushPayload({ outcome: "failed" });

    expect(payload).toEqual({
      outcome: "failed",
      notice: { title: expect.any(String), body: expect.any(String) },
    });
    expect(parseImportCompletionPushPayload(payload)).toEqual(payload);
  });

  it("outcomeごとに異なる文言を返す", () => {
    const succeeded = buildImportCompletionPushPayload({
      outcome: "succeeded",
      recipeId: "recipe_1",
    });
    const failed = buildImportCompletionPushPayload({ outcome: "failed" });

    expect(succeeded.notice).not.toEqual(failed.notice);
  });
});
