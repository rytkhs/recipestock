import { describe, expect, it } from "vitest";
import {
  IOS_SHARE_SHORTCUT_INPUT_MAX_LENGTH,
  iosShareShortcutImportReasonSchema,
  iosShareShortcutImportRequestSchema,
  iosShareShortcutImportResponseSchema,
} from "./ios-share";

describe("iOS Shortcut import schemas", () => {
  it("生の共有入力だけを受け付け、未知のfieldを除去する", () => {
    expect(
      iosShareShortcutImportRequestSchema.parse({
        input: "この唐揚げ美味しそう https://example.com/recipe #レシピ",
        url: "https://example.com/other",
      }),
    ).toEqual({
      input: "この唐揚げ美味しそう https://example.com/recipe #レシピ",
    });
  });

  it("入力の欠落、空文字、上限超過を拒否する", () => {
    expect(iosShareShortcutImportRequestSchema.safeParse({}).success).toBe(false);
    expect(iosShareShortcutImportRequestSchema.safeParse({ input: "" }).success).toBe(false);
    expect(
      iosShareShortcutImportRequestSchema.safeParse({
        input: "a".repeat(IOS_SHARE_SHORTCUT_INPUT_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("noticeを含むresponseを検証する", () => {
    expect(
      iosShareShortcutImportResponseSchema.safeParse({
        outcome: "rejected",
        reason: "invalid_url",
        notice: {
          title: "このリンクは取り込めません",
          body: "Webページのリンクを共有してください。",
          openUrl: null,
        },
      }).success,
    ).toBe(true);
  });

  /**
   * bodyは2行目を出す理由があるreasonにだけ載せる。空文字はShortcutのアクション列を
   * 分岐させずに1行通知を出すためのワイヤ表現であり、fieldごと欠落させることとは区別する。
   */
  it("空bodyのnoticeは受理し、body欠落のnoticeは拒否する", () => {
    expect(
      iosShareShortcutImportResponseSchema.safeParse({
        outcome: "accepted",
        reason: "created",
        notice: { title: "取り込みを開始しました", body: "", openUrl: null },
      }).success,
    ).toBe(true);
    expect(
      iosShareShortcutImportResponseSchema.safeParse({
        outcome: "accepted",
        reason: "created",
        notice: { title: "取り込みを開始しました", openUrl: null },
      }).success,
    ).toBe(false);
    expect(
      iosShareShortcutImportResponseSchema.safeParse({
        outcome: "accepted",
        reason: "created",
        notice: { title: "", body: "", openUrl: null },
      }).success,
    ).toBe(false);
  });

  /**
   * AI上限はプランで別のreasonに分ける。文言と遷移先だけでなく、reasonはHTTPステータスに
   * 代わる監視の軸でもあり、free到達とpro到達は運用上も別の事象である。
   */
  it("AI上限のreasonをプランごとに持つ", () => {
    expect(iosShareShortcutImportReasonSchema.options).toContain("ai_usage_limit_exceeded");
    expect(iosShareShortcutImportReasonSchema.options).toContain("ai_usage_quota_exhausted");
  });

  it("noticeのない、または未知のreasonを持つresponseを拒否する", () => {
    expect(
      iosShareShortcutImportResponseSchema.safeParse({
        outcome: "accepted",
        reason: "created",
      }).success,
    ).toBe(false);
    expect(
      iosShareShortcutImportResponseSchema.safeParse({
        outcome: "rejected",
        reason: "outdated_shortcut",
        notice: { title: "更新してください", body: "更新してください。", openUrl: null },
      }).success,
    ).toBe(false);
  });
});
