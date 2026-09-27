import { type RecentImportJob } from "@recipestock/schemas";
import { isActiveImportJob } from "./workflow";

export type ImportIslandView =
  | { mode: "hidden" }
  | { mode: "saved"; jobs: RecentImportJob[] }
  | { mode: "single"; job: RecentImportJob }
  | { mode: "multiple"; jobs: RecentImportJob[]; activeCount: number; failedCount: number };

/**
 * アイランドに出すものを決める。保存できたものは見逃さないよう、取り込み中や失敗より先に出す。
 * 保存できたjobは見せたあとで閉じるので、残っているのはまだ見せていないものである。
 */
export const deriveImportIslandView = (jobs: readonly RecentImportJob[]): ImportIslandView => {
  const saved = jobs.filter((job) => job.status === "succeeded");

  if (saved.length > 0) {
    return { mode: "saved", jobs: saved };
  }

  const active = jobs.filter(isActiveImportJob);
  const failed = jobs.filter((job) => job.status === "failed");
  const [onlyJob, ...otherJobs] = [...active, ...failed];

  if (!onlyJob) {
    return { mode: "hidden" };
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
