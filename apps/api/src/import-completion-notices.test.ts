import { parseImportCompletionNotice, parseImportCompletionRoute } from "@recipestock/shared";
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
    expect(parseImportCompletionRoute(payload)).toEqual({
      outcome: "succeeded",
      recipeId: "recipe_1",
    });
    expect(parseImportCompletionNotice(payload)).toEqual(payload.notice);
  });

  it("失敗payloadに表示文言だけを載せる", () => {
    const payload = buildImportCompletionPushPayload({ outcome: "failed" });

    expect(payload).toEqual({
      outcome: "failed",
      notice: { title: expect.any(String), body: expect.any(String) },
    });
    expect(parseImportCompletionRoute(payload)).toEqual({ outcome: "failed" });
    expect(parseImportCompletionNotice(payload)).toEqual(payload.notice);
  });

  it("outcomeごとに異なる文言を返す", () => {
    const succeeded = buildImportCompletionPushPayload({
      outcome: "succeeded",
      recipeId: "recipe_1",
    });
    const failed = buildImportCompletionPushPayload({ outcome: "failed" });

    expect(succeeded.notice).not.toEqual(failed.notice);
  });

  /**
   * 通知はロック画面へ表示されるため、文言はoutcomeだけで決まりinputに依存しない（ADR 0009）。
   * カタログにレシピタイトルや取り込み元を入れる変更は、このテストで落ちる。
   */
  it("noticeがinputに依存せず、ユーザー固有の情報を含まない", () => {
    const notices = [
      buildImportCompletionPushPayload({ outcome: "succeeded", recipeId: "recipe_1" }).notice,
      buildImportCompletionPushPayload({
        outcome: "succeeded",
        recipeId: "https://private.example.com/鶏むね肉のやわらか唐揚げ",
      }).notice,
      buildImportCompletionPushPayload({ outcome: "failed" }).notice,
    ];

    expect(notices[0]).toEqual(notices[1]);
    for (const notice of notices) {
      const serialized = JSON.stringify(notice);
      expect(serialized).not.toMatch(/https?:\/\//);
      expect(serialized).not.toMatch(/recipe_1|private\.example|唐揚げ/);
      expect(serialized).not.toMatch(/\$\{|%s|\{\{/);
    }
  });
});
