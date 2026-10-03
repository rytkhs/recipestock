import {
  type IosShareShortcutImportReason,
  iosShareShortcutImportReasonSchema,
  iosShareShortcutImportResponseSchema,
} from "@recipestock/schemas";
import { describe, expect, it } from "vitest";
import { buildIosShareShortcutImportResult } from "./ios-share-notices";

const APP_ORIGIN = "https://app.example.com";

const buildResult = (reason: IosShareShortcutImportReason) =>
  buildIosShareShortcutImportResult({ reason, appOrigin: APP_ORIGIN });

const allReasons = iosShareShortcutImportReasonSchema.options;

const titleOnlyReasons: IosShareShortcutImportReason[] = [
  "created",
  "existing_active_job",
  "setup_verified",
  "no_url_in_input",
  "rate_limit_exceeded",
];

const openUrlByReason: Partial<Record<IosShareShortcutImportReason, string>> = {
  malformed_request: `${APP_ORIGIN}/settings/share?reason=malformed_request`,
  missing_credential: `${APP_ORIGIN}/settings/share?reason=missing_credential`,
  unusable_credential: `${APP_ORIGIN}/settings/share?reason=unusable_credential`,
  recipe_limit_exceeded: `${APP_ORIGIN}/settings/billing?upsell=recipe_limit&from=shortcut`,
  ai_usage_limit_exceeded: `${APP_ORIGIN}/settings/billing?upsell=ai_usage_limit&from=shortcut`,
};

describe("iOS Shortcut noticeのカタログ", () => {
  /**
   * bodyは空文字を許容するため、通知に必ず出る行はtitleだけになる。
   * titleを空にする変更はこのテストで落ちる。
   */
  it("すべてのreasonがcontractを満たし、titleが必ず非空である", () => {
    for (const reason of allReasons) {
      const result = buildResult(reason);

      expect(iosShareShortcutImportResponseSchema.safeParse(result).success).toBe(true);
      expect(result.reason).toBe(reason);
    }
  });

  it("行動を促さないreasonはtitleだけを返す", () => {
    for (const reason of titleOnlyReasons) {
      expect(buildResult(reason).notice.body).toBe("");
    }
  });

  it("次に取るべき行動があるreasonはbodyを持つ", () => {
    const actionableReasons = allReasons.filter((reason) => !titleOnlyReasons.includes(reason));

    for (const reason of actionableReasons) {
      expect(buildResult(reason).notice.body).not.toBe("");
    }
  });

  /**
   * Shortcutはopen URLの有無だけを分岐する（ADR 0004）。
   * 上限到達のopenUrlは、Shortcut面から課金へ繋げる唯一の導線である。
   * proのai_usage_quota_exhaustedにopenUrlが付いていたら、すでに払っている相手を
   * 課金画面へ送ることになるため、このテストで落とす。
   */
  it("openUrlはユーザーの操作が必要なreasonにだけ付く", () => {
    for (const reason of allReasons) {
      expect(buildResult(reason).notice.openUrl).toBe(openUrlByReason[reason] ?? null);
    }
  });

  /**
   * 確認は設定画面の上で起きる。Safariで設定画面を開き直すと、ホーム画面アプリで設定している人が
   * ログインもlocalStorageも別の入れ物へ移される。
   */
  it("設定の確認への応答は、どのreasonでもopenUrlを返さない", () => {
    for (const reason of allReasons) {
      expect(
        buildIosShareShortcutImportResult({ reason, appOrigin: APP_ORIGIN, isSetupCheck: true })
          .notice.openUrl,
      ).toBeNull();
    }
  });
});
