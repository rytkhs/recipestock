import {
  type IosShareShortcutImportOutcome,
  type IosShareShortcutImportReason,
  type IosShareShortcutImportResponse,
} from "@recipestock/schemas";

type IosShareNoticeTemplate = {
  outcome: IosShareShortcutImportOutcome;
  title: string;
  body?: string;
  path?: string;
};

/**
 * Shortcutは表示文言を組み立てない。配布後のShortcutは更新できないため、
 * ユーザーへ見せる文字列と遷移先はすべてこのカタログが決める。
 *
 * バナーは一瞥されるだけの表示であり、2行目は次に取るべき行動があるreasonにだけ置く。
 * bodyのないreasonは空文字で返す。nullにすると、Shortcutが通知アクションを2本に
 * 分岐させるか、ShortcutsのJSON null解釈へ依存するかを永久に固定することになる。
 */
const iosShareNoticeTemplates: Record<IosShareShortcutImportReason, IosShareNoticeTemplate> = {
  created: {
    outcome: "accepted",
    title: "取り込みを開始しました",
  },
  existing_active_job: {
    outcome: "accepted",
    title: "すでに取り込み中です",
  },
  no_url_in_input: {
    outcome: "rejected",
    title: "リンクが見つかりませんでした",
  },
  invalid_url: {
    outcome: "rejected",
    title: "このリンクは取り込めません",
    body: "Webページのリンクを共有してください。",
  },
  malformed_request: {
    outcome: "rejected",
    title: "共有できませんでした",
    body: "設定画面からShortcutを追加し直してください。",
    path: "/settings",
  },
  recipe_limit_exceeded: {
    outcome: "rejected",
    title: "保存できる上限に達しました",
    body: "Proにすると上限なく保存できます。",
    path: "/settings/billing?upsell=recipe_limit&from=shortcut",
  },
  rate_limit_exceeded: {
    outcome: "rejected",
    title: "少し時間をおいてください",
  },
  temporarily_unavailable: {
    outcome: "rejected",
    title: "いま取り込めませんでした",
    body: "時間をおいて共有し直してください。",
  },
  unauthorized: {
    outcome: "rejected",
    title: "連携が無効になっています",
    body: "設定画面からShortcutを再連携してください。",
    path: "/settings",
  },
};

export const buildIosShareShortcutImportResult = ({
  reason,
  appOrigin,
}: {
  reason: IosShareShortcutImportReason;
  appOrigin: string;
}): IosShareShortcutImportResponse => {
  const template = iosShareNoticeTemplates[reason];

  return {
    outcome: template.outcome,
    reason,
    notice: {
      title: template.title,
      body: template.body ?? "",
      openUrl: template.path ? new URL(template.path, appOrigin).toString() : null,
    },
  };
};
