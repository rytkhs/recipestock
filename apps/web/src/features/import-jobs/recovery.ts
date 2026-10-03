import { type ImportErrorCode, type ImportJobSummary } from "@recipestock/schemas";
import { isStillResolvedByUpgrade, type PlanState } from "../billing/plan-state";

/**
 * 取り込めなかったjobから次にできること。
 * - `plan`: 上限で止まっていて、今もプランを変えなければ直らない
 * - `retry-url`: 同じURLでもう一度試す
 * - `edit-text`: 原文を直して送り直す
 * - `paste-text`: URLからは読めないので、ページの本文を貼って取り込む
 */
export type ImportJobRecovery = "plan" | "retry-url" | "edit-text" | "paste-text";

// ページや投稿の中身を読めなかったもの。同じURLで試し直しても変わらないが、本文を貼れば取り込める。
const unreadablePageErrorCodes = new Set<ImportErrorCode>([
  "unsupported_page",
  "extraction_failed",
  "private_or_login_required",
]);

export const getImportJobRecovery = (
  job: Pick<ImportJobSummary, "kind" | "status" | "errorCode">,
  planState: PlanState | undefined,
): ImportJobRecovery | null => {
  if (job.status !== "failed") {
    return null;
  }

  if (isStillResolvedByUpgrade(job.errorCode, planState)) {
    return "plan";
  }

  if (job.kind === "text") {
    return "edit-text";
  }

  if (job.errorCode === "invalid_url") {
    return null;
  }

  return job.errorCode && unreadablePageErrorCodes.has(job.errorCode) ? "paste-text" : "retry-url";
};
