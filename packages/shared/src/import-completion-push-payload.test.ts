import { describe, expect, it } from "vitest";
import { parseImportCompletionPushPayload } from "./import-completion-push-payload";

const notice = { title: "レシピの取り込みが完了しました", body: "Recipe Stockで確認できます。" };

describe("取り込み完了push payloadの解釈", () => {
  it("成功payloadから遷移先とnoticeを取り出す", () => {
    expect(
      parseImportCompletionPushPayload({ outcome: "succeeded", recipeId: "recipe_1", notice }),
    ).toEqual({ outcome: "succeeded", recipeId: "recipe_1", notice });
  });

  it("失敗payloadはrecipeIdを持たない", () => {
    expect(parseImportCompletionPushPayload({ outcome: "failed", notice })).toEqual({
      outcome: "failed",
      notice,
    });
  });

  it("未知のfieldを除去する", () => {
    expect(
      parseImportCompletionPushPayload({
        outcome: "failed",
        notice: { ...notice, openUrl: "https://evil.example.com/steal" },
        url: "https://private.example.com/recipe",
        errorCode: "private_or_login_required",
      }),
    ).toEqual({ outcome: "failed", notice });
  });

  it("noticeを欠くpayloadを拒否する", () => {
    expect(parseImportCompletionPushPayload({ outcome: "succeeded", recipeId: "recipe_1" })).toBe(
      null,
    );
    expect(
      parseImportCompletionPushPayload({
        outcome: "failed",
        notice: { title: "", body: "Recipe Stockで確認できます。" },
      }),
    ).toBe(null);
    expect(parseImportCompletionPushPayload({ outcome: "failed", notice: { title: "完了" } })).toBe(
      null,
    );
  });

  it("成功payloadにrecipeIdがなければ拒否する", () => {
    expect(parseImportCompletionPushPayload({ outcome: "succeeded", notice })).toBe(null);
    expect(parseImportCompletionPushPayload({ outcome: "succeeded", recipeId: "", notice })).toBe(
      null,
    );
  });

  it("未知のoutcomeやオブジェクト以外を拒否する", () => {
    expect(parseImportCompletionPushPayload({ outcome: "running", notice })).toBe(null);
    expect(parseImportCompletionPushPayload(null)).toBe(null);
    expect(parseImportCompletionPushPayload("succeeded")).toBe(null);
  });
});
