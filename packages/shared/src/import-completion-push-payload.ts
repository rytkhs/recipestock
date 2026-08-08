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

export type ImportCompletionRoute =
  | { outcome: "succeeded"; recipeId: string }
  | { outcome: "failed" };

export type ImportCompletionPushPayload = ImportCompletionRoute & {
  notice: ImportCompletionNotice;
};

const asRecord = (value: unknown) =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

/**
 * 遷移先の導出は表示文言と独立させる。`notice`が読めないときでも
 * 保存されたRecipeへ遷移できるようにし、表示側の失敗を遷移まで波及させない。
 * 解釈できない値はRecipe一覧へ着地する`failed`として扱う。
 */
export const parseImportCompletionRoute = (value: unknown): ImportCompletionRoute => {
  const payload = asRecord(value);
  if (payload?.outcome !== "succeeded") return { outcome: "failed" };

  const { recipeId } = payload;
  return typeof recipeId === "string" && recipeId
    ? { outcome: "succeeded", recipeId }
    : { outcome: "failed" };
};

/**
 * 契約に合わない値はnullを返す。呼び出し側は表示できる文字列を持たないため、
 * Service Workerはそこで最終手段の通知に切り替える。
 */
export const parseImportCompletionNotice = (value: unknown): ImportCompletionNotice | null => {
  const notice = asRecord(asRecord(value)?.notice);
  if (!notice) return null;

  const { title, body } = notice;
  if (typeof title !== "string" || !title) return null;
  if (typeof body !== "string" || !body) return null;

  return { title, body };
};
