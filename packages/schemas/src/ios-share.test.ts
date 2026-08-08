import { describe, expect, it } from "vitest";
import {
  IOS_SHARE_SHORTCUT_INPUT_MAX_LENGTH,
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
        outcome: "accepted",
        reason: "created",
        notice: {
          title: "取り込みを開始しました",
          body: "完了したらお知らせします。",
          openUrl: null,
        },
      }).success,
    ).toBe(true);
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
