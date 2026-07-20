import { type GetMeResponse as Viewer } from "@recipestock/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiClientError } from "./api";
import { useAuthState } from "./auth-state";
import { useAvailabilityRecovery } from "./availability-recovery";
import { clearUserScopedCache } from "./query-cache";
import { fetchViewer, useViewer, viewerQueryKey } from "./viewer";

export type ProtectedAccess =
  | { status: "pending" }
  | { status: "ready"; viewer: Viewer }
  | {
      status: "unavailable";
      reason: "session" | "viewer";
      retry: () => Promise<void>;
      isRetrying: boolean;
    }
  | { status: "unauthenticated" };

type UnauthorizedRecovery = "idle" | "checking" | "session-unavailable" | "viewer-unavailable";
type FreshViewerResult = "ready" | "unauthorized" | "unavailable";

const isUnauthorized = (error: unknown) => error instanceof ApiClientError && error.status === 401;

export const useProtectedAccess = (): ProtectedAccess => {
  const auth = useAuthState();
  const queryClient = useQueryClient();
  const [unauthorizedRecovery, setUnauthorizedRecovery] = useState<UnauthorizedRecovery>("idle");
  const viewer = useViewer({
    enabled: auth.status === "authenticated" && unauthorizedRecovery !== "checking",
  });

  const fetchFreshViewer = useCallback(async (): Promise<FreshViewerResult> => {
    try {
      await queryClient.fetchQuery({
        queryKey: viewerQueryKey,
        queryFn: fetchViewer,
      });
      return "ready";
    } catch (error) {
      return isUnauthorized(error) ? "unauthorized" : "unavailable";
    }
  }, [queryClient]);

  const recoverUnauthorizedViewer = useCallback(async () => {
    setUnauthorizedRecovery("checking");
    await queryClient.cancelQueries({ queryKey: viewerQueryKey });
    clearUserScopedCache(queryClient);

    const sessionResult = await auth.recheck();
    if (sessionResult === "unauthenticated") {
      setUnauthorizedRecovery("idle");
      return true;
    }
    if (sessionResult === "unavailable") {
      setUnauthorizedRecovery("session-unavailable");
      return false;
    }

    const viewerResult = await fetchFreshViewer();
    setUnauthorizedRecovery(viewerResult === "ready" ? "idle" : "viewer-unavailable");
    return viewerResult === "ready";
  }, [auth, fetchFreshViewer, queryClient]);

  useEffect(() => {
    if (
      auth.status !== "authenticated" ||
      unauthorizedRecovery !== "idle" ||
      !isUnauthorized(viewer.error)
    ) {
      return;
    }

    void recoverUnauthorizedViewer();
  }, [auth.status, recoverUnauthorizedViewer, unauthorizedRecovery, viewer.error]);

  const unavailableReason = useMemo<"session" | "viewer" | null>(() => {
    if (auth.status === "unavailable" || unauthorizedRecovery === "session-unavailable") {
      return "session";
    }
    if (unauthorizedRecovery === "viewer-unavailable") return "viewer";
    if (auth.status === "authenticated" && !viewer.data && !viewer.isFetching && viewer.isError) {
      return "viewer";
    }
    return null;
  }, [auth.status, unauthorizedRecovery, viewer.data, viewer.isError, viewer.isFetching]);

  const retryDependency = useCallback(async () => {
    if (unavailableReason === "session") {
      const result = await auth.recheck();
      if (result === "unavailable") return false;
      if (result === "unauthenticated") {
        setUnauthorizedRecovery("idle");
        return true;
      }

      if (unauthorizedRecovery === "session-unavailable") {
        const viewerResult = await fetchFreshViewer();
        setUnauthorizedRecovery(viewerResult === "ready" ? "idle" : "viewer-unavailable");
        return viewerResult === "ready";
      }

      return true;
    }

    if (unavailableReason === "viewer") {
      const viewerResult = await fetchFreshViewer();
      if (viewerResult === "unauthorized") return recoverUnauthorizedViewer();

      setUnauthorizedRecovery(viewerResult === "ready" ? "idle" : "viewer-unavailable");
      return viewerResult === "ready";
    }

    return true;
  }, [auth, fetchFreshViewer, recoverUnauthorizedViewer, unavailableReason, unauthorizedRecovery]);

  const recovery = useAvailabilityRecovery({
    active: unavailableReason !== null,
    retryDependency,
  });

  if (auth.status === "pending" || unauthorizedRecovery === "checking") {
    return { status: "pending" };
  }

  if (auth.status === "unauthenticated") {
    return { status: "unauthenticated" };
  }

  if (unavailableReason) {
    return {
      status: "unavailable",
      reason: unavailableReason,
      retry: recovery.retry,
      isRetrying: recovery.isRetrying || auth.isRechecking,
    };
  }

  if (auth.status === "authenticated") {
    if (isUnauthorized(viewer.error)) return { status: "pending" };
    if (viewer.data) return { status: "ready", viewer: viewer.data };
    if (viewer.isFetching || viewer.isPending) return { status: "pending" };
    return {
      status: "unavailable",
      reason: "viewer",
      retry: recovery.retry,
      isRetrying: recovery.isRetrying,
    };
  }

  return { status: "pending" };
};
