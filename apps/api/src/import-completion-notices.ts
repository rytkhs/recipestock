import { type ImportCompletionNotice, type ImportCompletionPushPayload } from "@recipestock/shared";

type ImportCompletionOutcome = ImportCompletionPushPayload["outcome"];

/**
 * Service Workerは表示文言を組み立てない。`skipWaiting()`を使わず更新導線も持たないため、
 * 一度配布したService Workerは長く生き続ける。ユーザーへ見せる文字列はこのカタログが決める。
 *
 * payloadはロック画面に表示され、ユーザー固有の情報は載せない。文言はoutcomeだけで引く。
 */
const importCompletionNoticeTemplates: Record<ImportCompletionOutcome, ImportCompletionNotice> = {
  succeeded: {
    title: "レシピの取り込みが完了しました",
    body: "Recipe Stockで確認できます。",
  },
  failed: {
    title: "レシピを取り込めませんでした",
    body: "Recipe Stockを開いて結果を確認してください。",
  },
};

export const buildImportCompletionPushPayload = (
  input: { outcome: "succeeded"; recipeId: string } | { outcome: "failed" },
): ImportCompletionPushPayload =>
  input.outcome === "succeeded"
    ? {
        outcome: "succeeded",
        recipeId: input.recipeId,
        notice: importCompletionNoticeTemplates.succeeded,
      }
    : { outcome: "failed", notice: importCompletionNoticeTemplates.failed };
