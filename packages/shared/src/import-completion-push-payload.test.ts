import { describe, expect, it } from "vitest";
import {
  parseImportCompletionNotice,
  parseImportCompletionRoute,
} from "./import-completion-push-payload";

const notice = { title: "レシピの取り込みが完了しました", body: "Recipe Stockで確認できます。" };

describe("取り込み完了push payloadの遷移先", () => {
  it("成功payloadからrecipeIdを取り出す", () => {
    expect(
      parseImportCompletionRoute({ outcome: "succeeded", recipeId: "recipe_1", notice }),
    ).toEqual({ outcome: "succeeded", recipeId: "recipe_1" });
  });

  it("noticeが読めなくても遷移先を失わない", () => {
    expect(parseImportCompletionRoute({ outcome: "succeeded", recipeId: "recipe_1" })).toEqual({
      outcome: "succeeded",
      recipeId: "recipe_1",
    });
    expect(
      parseImportCompletionRoute({ outcome: "succeeded", recipeId: "recipe_1", notice: null }),
    ).toEqual({ outcome: "succeeded", recipeId: "recipe_1" });
  });

  it("解釈できない値はRecipe一覧へ着地するfailedとして扱う", () => {
    expect(parseImportCompletionRoute({ outcome: "failed", notice })).toEqual({
      outcome: "failed",
    });
    expect(parseImportCompletionRoute({ outcome: "succeeded", notice })).toEqual({
      outcome: "failed",
    });
    expect(parseImportCompletionRoute({ outcome: "succeeded", recipeId: "" })).toEqual({
      outcome: "failed",
    });
    expect(parseImportCompletionRoute({ outcome: "expired" })).toEqual({ outcome: "failed" });
    expect(parseImportCompletionRoute(null)).toEqual({ outcome: "failed" });
    expect(parseImportCompletionRoute("succeeded")).toEqual({ outcome: "failed" });
  });

  it("payload由来のURLを遷移先へ持ち出さない", () => {
    expect(
      parseImportCompletionRoute({
        outcome: "succeeded",
        recipeId: "recipe_1",
        url: "https://evil.example.com/steal",
      }),
    ).toEqual({ outcome: "succeeded", recipeId: "recipe_1" });
  });
});

describe("取り込み完了push payloadのnotice", () => {
  it("サーバーが確定した表示文字列だけを取り出す", () => {
    expect(
      parseImportCompletionNotice({
        outcome: "failed",
        notice: { ...notice, openUrl: "https://evil.example.com/steal" },
        errorCode: "private_or_login_required",
      }),
    ).toEqual(notice);
  });

  it("契約に合わないnoticeを拒否する", () => {
    expect(parseImportCompletionNotice({ outcome: "succeeded", recipeId: "recipe_1" })).toBe(null);
    expect(parseImportCompletionNotice({ outcome: "failed", notice: { title: "完了" } })).toBe(
      null,
    );
    expect(
      parseImportCompletionNotice({
        outcome: "failed",
        notice: { title: "", body: "確認できます。" },
      }),
    ).toBe(null);
    expect(parseImportCompletionNotice(null)).toBe(null);
  });
});
