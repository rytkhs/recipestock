import {
  type ImportJobStatus,
  type RecentImportJob,
  type RecentImportJobsResponse,
} from "@recipestock/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useViewer } from "../../lib/viewer";
import { derivePlanState } from "../billing/plan-state";
import { invalidateRecipeLists } from "../recipes";
import { cancelImportJob, dismissFinishedImportJob, fetchRecentImportJobs } from "./api";
import { markRecipeArrived } from "./arrivals";
import { removeRecentImportJob, showSubmittedImportJob } from "./cache";
import { useHighlightedImportJobId } from "./highlight";
import { deriveImportIslandView, hasImportIslandContent } from "./island-state";
import { importJobQueryKeys } from "./query-keys";
import { hasActiveImportJob, retryImportUrlJob } from "./workflow";

const pollIntervalMs = 2500;
// 保存できたことを見せておく長さ。アイランドに触れている間と一覧を開いている間は数えない。
const savedDisplayMs = 5000;
const noJobs: RecentImportJobsResponse["jobs"] = [];

const describeChanges = (saved: readonly RecentImportJob[], failedCount: number) =>
  [
    saved.length === 1 ? `「${saved[0]?.recipe?.title ?? "レシピ"}」を保存しました` : null,
    saved.length > 1 ? `${saved.length}件のレシピを保存しました` : null,
    failedCount > 0 ? `${failedCount}件取り込めませんでした` : null,
  ]
    .filter(Boolean)
    .join("。");

/**
 * 取り込み状況を読み続け、アイランドの表示と操作をまとめる。
 * フォームの画面ではアイランドを出さないが、状況は読み続けて、戻ったときに続きから見せる。
 */
export const useImportIsland = ({
  enabled,
  isShown,
  pathname,
}: {
  enabled: boolean;
  isShown: boolean;
  pathname: string;
}) => {
  const queryClient = useQueryClient();
  const viewer = useViewer({ enabled });
  const planState = viewer.data ? derivePlanState(viewer.data) : undefined;
  const { data } = useQuery({
    queryKey: importJobQueryKeys.recent(),
    queryFn: fetchRecentImportJobs,
    enabled,
    refetchInterval: (query) =>
      hasActiveImportJob(query.state.data?.jobs ?? []) ? pollIntervalMs : false,
  });
  const jobs = data?.jobs ?? noJobs;
  const view = useMemo(() => deriveImportIslandView(jobs), [jobs]);
  const isVisible = isShown && hasImportIslandContent(view);
  const highlightedJobId = useHighlightedImportJobId();
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isHeld, setIsHeld] = useState(false);
  const shownPathname = isVisible ? pathname : null;
  const [lastShownPathname, setLastShownPathname] = useState(shownPathname);

  // 一覧を開いたことと触れていることは、アイランドがその画面に出ている間だけのものにする。
  // 画面を移るかアイランドが消えたら忘れ、開いたレシピの上に一覧を重ねたり、戻ったときに開き直したりしない。
  // アイランドから開いてアイランドが消えたときは、pointerleaveもblurも届かないので、ここで解く。
  if (lastShownPathname !== shownPathname) {
    setLastShownPathname(shownPathname);
    setIsPanelOpen(false);
    setIsHeld(false);
  }

  // 同じ文でも、知らせるたびに読み上げの要素を差し替えて、続けて起きたことも読み上げさせる。
  const [announcement, setAnnouncement] = useState<{ id: number; message: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const observedStatusesRef = useRef(new Map<string, ImportJobStatus>());

  // 操作できなかったことは、その操作をした一覧の中でだけ知らせる。開き直したときに前の失敗を残さない。
  const setPanelOpen = useCallback((open: boolean) => {
    if (open) {
      setActionError(null);
    }

    setIsPanelOpen(open);
  }, []);

  // 読み直しの途中で消したjobが戻ってこないよう、進行中の取得を止めてから外す。
  const hideJob = useCallback(
    async (jobId: string) => {
      await queryClient.cancelQueries({ queryKey: importJobQueryKeys.recent() });
      removeRecentImportJob(queryClient, jobId);
    },
    [queryClient],
  );
  const refreshJobs = useCallback(
    () => queryClient.invalidateQueries({ queryKey: importJobQueryKeys.recent() }),
    [queryClient],
  );

  const { mutate: dismissJob } = useMutation({
    mutationFn: dismissFinishedImportJob,
    onMutate: hideJob,
    onSettled: refreshJobs,
  });
  // 取り消せたと分かってから外す。先に外すと、最後の1件ではアイランドごと一覧が閉じ、取り消せなかったことを知らせられない。
  const cancelMutation = useMutation({
    mutationFn: cancelImportJob,
    onMutate: () => setActionError(null),
    // 取り消す前に終わっていたら、その結果を出し直す。
    onSuccess: async ({ job }, jobId) => {
      if (job.status === "canceled") {
        await hideJob(jobId);
      } else {
        await refreshJobs();
      }
    },
    onError: () => setActionError("取り消せませんでした。"),
  });
  const retryMutation = useMutation({
    mutationFn: retryImportUrlJob,
    onMutate: () => setActionError(null),
    onSuccess: (response, job) => {
      removeRecentImportJob(queryClient, job.id);
      showSubmittedImportJob(queryClient, response);
    },
    onError: () => setActionError("再試行を開始できませんでした。"),
  });

  useEffect(() => {
    const saved: RecentImportJob[] = [];
    let failedCount = 0;

    for (const job of jobs) {
      if (observedStatusesRef.current.get(job.id) === job.status) {
        continue;
      }

      observedStatusesRef.current.set(job.id, job.status);

      if (job.status === "succeeded") {
        saved.push(job);

        if (job.recipeId) {
          markRecipeArrived(job.recipeId);
        }
      }

      if (job.status === "failed") {
        failedCount += 1;
      }
    }

    if (saved.length > 0) {
      void invalidateRecipeLists(queryClient);
    }

    const message = describeChanges(saved, failedCount);

    if (message) {
      setAnnouncement((current) => ({ id: (current?.id ?? 0) + 1, message }));
    }
  }, [jobs, queryClient]);

  const savedJobIds = view.saved.map((job) => job.id).join(" ");

  useEffect(() => {
    if (!savedJobIds || !isShown || isPanelOpen || isHeld) {
      return;
    }

    const timer = window.setTimeout(() => {
      for (const jobId of savedJobIds.split(" ")) {
        dismissJob(jobId);
      }
    }, savedDisplayMs);

    return () => window.clearTimeout(timer);
  }, [dismissJob, isHeld, isPanelOpen, isShown, savedJobIds]);

  return {
    view,
    jobs,
    planState,
    highlightedJobId,
    isVisible,
    isPanelOpen,
    setPanelOpen,
    setIsHeld,
    announcement,
    actionError,
    dismissJob,
    cancelJob: cancelMutation.mutate,
    cancelingJobId: cancelMutation.isPending ? cancelMutation.variables : undefined,
    retryUrlJob: retryMutation.mutate,
    isRetrying: retryMutation.isPending,
  };
};

export type ImportIsland = ReturnType<typeof useImportIsland>;
