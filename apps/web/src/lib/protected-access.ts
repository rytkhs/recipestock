import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { ApiClientError } from "./api";
import { useAuthState } from "./auth-state";
import { useAvailabilityRecovery } from "./availability-recovery";
import { clearUserScopedCache } from "./query-cache";
import { fetchViewer, useViewer, viewerQueryKey } from "./viewer";

export type ProtectedAccess =
  | { status: "pending" }
  | { status: "ready" }
  | { status: "unauthenticated" }
  | { status: "unavailable"; retry: () => Promise<void>; isRetrying: boolean };

// viewerの401は「sessionは通ったのにAPIが認証を拒否した」合図。
// 回復は1周だけ試し、それでも401ならexhaustedで打ち切ってloopを防ぐ。
type UnauthorizedRecovery = "idle" | "running" | "exhausted";

const isUnauthorized = (error: unknown) => error instanceof ApiClientError && error.status === 401;

export const useProtectedAccess = (): ProtectedAccess => {
  const auth = useAuthState();
  const queryClient = useQueryClient();
  const [unauthorizedRecovery, setUnauthorizedRecovery] = useState<UnauthorizedRecovery>("idle");
  const viewer = useViewer({ enabled: auth.status === "authenticated" });

  const recoverUnauthorizedViewer = useCallback(async () => {
    setUnauthorizedRecovery("running");
    // settingsが張る2つ目のviewer observerと競合しうるので、取り直す前に止める。
    await queryClient.cancelQueries({ queryKey: viewerQueryKey });

    const sessionResult = await auth.recheck("fresh");
    if (sessionResult !== "authenticated") {
      // 直後にProtectedLayoutがloginへ送る。unmount前に前ユーザーのcacheを落とす。
      if (sessionResult === "unauthenticated") {
        clearUserScopedCache(queryClient);
      }
      setUnauthorizedRecovery("idle");
      return;
    }

    try {
      await queryClient.fetchQuery({ queryKey: viewerQueryKey, queryFn: fetchViewer });
      setUnauthorizedRecovery("idle");
    } catch (error) {
      setUnauthorizedRecovery(isUnauthorized(error) ? "exhausted" : "idle");
    }
  }, [auth, queryClient]);

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

  const recheckSession = useCallback(async () => (await auth.recheck()) !== "unavailable", [auth]);
  const recovery = useAvailabilityRecovery({
    active: auth.status === "unavailable",
    retryDependency: recheckSession,
  });

  if (auth.status === "unavailable") {
    return {
      status: "unavailable",
      retry: recovery.retry,
      isRetrying: recovery.isRetrying || auth.isRechecking,
    };
  }

  if (auth.status === "unauthenticated") {
    return { status: "unauthenticated" };
  }

  if (auth.status === "authenticated") {
    return { status: "ready" };
  }

  return { status: "pending" };
};
