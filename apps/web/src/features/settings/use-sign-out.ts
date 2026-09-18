import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { signOut, useAuthSession } from "../../lib/auth";
import { clearUserScopedCache } from "../../lib/query-cache";
import {
  deactivatePushSubscription,
  getCurrentPushSubscription,
  supportsPushNotifications,
} from "../push-notifications/browser";

/**
 * この端末の通知の登録を解いてからログアウトする。解けないままログアウトすると、
 * もう本人の端末ではないところに取り込み完了の通知が届き続ける。
 *
 * 目次のログアウトと、パスワードのページの「パスワードを忘れた場合」が同じ手順を踏む。
 */
export const useSignOut = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useAuthSession();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const signOutAndGoToLogin = async (search: { mode?: "reset" } = {}) => {
    setIsSigningOut(true);
    setSignOutError(null);
    let pushCleanupCompleted = false;

    try {
      if (supportsPushNotifications()) {
        const subscription = await getCurrentPushSubscription();
        if (subscription) {
          const { browserCleanupSucceeded, serverCleanupSucceeded } =
            await deactivatePushSubscription(subscription);
          if (!browserCleanupSucceeded && !serverCleanupSucceeded) {
            throw new Error("push_subscription_cleanup_failed");
          }
        }
      }
      pushCleanupCompleted = true;

      await signOut();
      clearUserScopedCache(queryClient);
      await session.refetch();
      await navigate({ to: "/login", search });
    } catch {
      setSignOutError(
        pushCleanupCompleted
          ? "ログアウトできませんでした。時間をおいて再度お試しください。"
          : "通知を解除できなかったため、ログアウトを中止しました。時間をおいて再度お試しください。",
      );
    } finally {
      setIsSigningOut(false);
    }
  };

  return {
    clearSignOutError: () => setSignOutError(null),
    isSigningOut,
    signOutAndGoToLogin,
    signOutError,
  };
};
