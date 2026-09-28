import { type RecentImportJob } from "@recipestock/schemas";
import { isActiveImportJob } from "./workflow";

/**
 * 終わるまで出し続ける取り込みの状況。取り込み中と取り込めなかったjobから作る。
 */
export type ImportIslandStatus =
  | { mode: "single"; job: RecentImportJob }
  | { mode: "multiple"; jobs: RecentImportJob[]; activeCount: number; failedCount: number };

/**
 * アイランドに出すもの。
 * - `status`: 取り込み中と取り込めなかったもの。終わるまで出し続け、アイランドの主にする
 * - `saved`: 保存できたもの。一度知らせれば済むので、`status`があれば押しのけずに添える
 *
 * 保存できたjobは見せたあとで閉じるので、`saved`に残っているのはまだ見せていないものである。
 */
export type ImportIslandView = {
  status: ImportIslandStatus | null;
  saved: RecentImportJob[];
};

const deriveImportIslandStatus = (jobs: readonly RecentImportJob[]): ImportIslandStatus | null => {
  const active = jobs.filter(isActiveImportJob);
  const failed = jobs.filter((job) => job.status === "failed");
  const [onlyJob, ...otherJobs] = [...active, ...failed];

  if (!onlyJob) {
    return null;
  }

  if (otherJobs.length === 0) {
    return { mode: "single", job: onlyJob };
  }

  return {
    mode: "multiple",
    jobs: [onlyJob, ...otherJobs],
    activeCount: active.length,
    failedCount: failed.length,
  };
};

export const deriveImportIslandView = (jobs: readonly RecentImportJob[]): ImportIslandView => ({
  status: deriveImportIslandStatus(jobs),
  saved: jobs.filter((job) => job.status === "succeeded"),
});

export const hasImportIslandContent = ({ status, saved }: ImportIslandView): boolean =>
  status !== null || saved.length > 0;
