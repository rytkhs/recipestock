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
  /**
   * AI上限へ到達する人口はプランで非対称である。保存上限がfreeの投稿を先に止めるため、
   * freeがAI枠へ到達するのは例外的で、実際に到達するのは主にProである。
   * Proへ「Proにすると」と案内しても意味がないため、プランでreasonを分ける。
   */
  ai_usage_limit_exceeded: {
    outcome: "rejected",
    title: "今月のAI取り込み上限に達しました",
    body: "Proにすると月300回まで取り込めます。",
    path: "/settings/billing?upsell=ai_usage_limit&from=shortcut",
  },
  /**
   * リセットはJST月初固定であり「毎月1日」は常に真である。日付を補間する必要はなく、
   * このカタログは静的なまま保てる。Proに残された行動は待つことだけなのでopenUrlは持たせない。
   */
  ai_usage_quota_exhausted: {
    outcome: "rejected",
    title: "今月のAI取り込み上限に達しました",
    body: "毎月1日にリセットされます。",
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
