/**
 * 取り込み完了のWeb Push payload。APIとService Workerの唯一の契約であり、
 * zodに依存させないことでService Workerのbundleを小さく保つ。
 *
 * `notice`はサーバーが確定した表示文字列で、Service Workerは文言を組み立てない。
 * `outcome`と`recipeId`は表示用ではなく、Service Workerが遷移先を導出するためだけに存在する。
 */
export type ImportCompletionNotice = {
  title: string;
  body: string;
};

export type ImportCompletionPushPayload =
  | { outcome: "succeeded"; recipeId: string; notice: ImportCompletionNotice }
  | { outcome: "failed"; notice: ImportCompletionNotice };

const parseNotice = (value: unknown): ImportCompletionNotice | null => {
  if (!value || typeof value !== "object") return null;

  const { title, body } = value as { title?: unknown; body?: unknown };
  if (typeof title !== "string" || !title) return null;
  if (typeof body !== "string" || !body) return null;

  return { title, body };
};

/**
 * 契約に合わない値はnullを返す。呼び出し側は表示できる文字列を持たないため、
 * Service Workerはそこで最終手段の通知に切り替える。
 */
export const parseImportCompletionPushPayload = (
  value: unknown,
): ImportCompletionPushPayload | null => {
  if (!value || typeof value !== "object") return null;

  const { outcome, recipeId, notice } = value as {
    outcome?: unknown;
    recipeId?: unknown;
    notice?: unknown;
  };
  const parsedNotice = parseNotice(notice);
  if (!parsedNotice) return null;

  if (outcome === "succeeded") {
    return typeof recipeId === "string" && recipeId
      ? { outcome, recipeId, notice: parsedNotice }
      : null;
  }

  if (outcome === "failed") {
    return { outcome, notice: parsedNotice };
  }

  return null;
};
