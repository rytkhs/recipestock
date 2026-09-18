import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { viewerQueryKey } from "../../lib/viewer";
import { invalidateRecipeLists, recipesQueryKeys } from "../recipes";
import { billingStatusQueryKey, fetchBillingStatus } from "./api";

/**
 * Stripeの決済を終えて戻っても、webhookが届くまで手元の契約はFreeのままである。
 * - waiting: Proに変わるのを待っている
 * - timed_out: 待っても変わらなかった。手続きは受け付けているので、もう一度確かめられるようにする
 * - confirmed: Proに変わった
 */
export type CheckoutConfirmation = "idle" | "waiting" | "timed_out" | "confirmed";

const pollIntervalMs = 2000;
const timeoutMs = 30_000;

/**
 * 課金の状態を読み、決済から戻った直後はProに変わるまで読み直す。
 * 待っている間に「Proにする」をもう一度押されると二つ目の契約になるので、画面は待っている間それを出さない。
 */
export const useCheckoutConfirmation = ({ initiallyWaiting }: { initiallyWaiting: boolean }) => {
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState<CheckoutConfirmation>(
    initiallyWaiting ? "waiting" : "idle",
  );
  const billingStatus = useQuery({
    queryKey: billingStatusQueryKey,
    queryFn: fetchBillingStatus,
    retry: false,
    refetchInterval: confirmation === "waiting" ? pollIntervalMs : false,
  });
  const isPro = billingStatus.data?.plan === "pro";
  const isAwaitingPro = confirmation === "waiting" || confirmation === "timed_out";

  useEffect(() => {
    if (confirmation !== "waiting") return;

    const timer = window.setTimeout(() => setConfirmation("timed_out"), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [confirmation]);

  useEffect(() => {
    if (!isAwaitingPro || !isPro) return;

    setConfirmation("confirmed");
    // プラン名と保存件数の上限はviewerから、ロックは一覧と詳細から出しているので、あわせて読み直す。
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: viewerQueryKey }),
      invalidateRecipeLists(queryClient),
      queryClient.invalidateQueries({ queryKey: recipesQueryKeys.details() }),
    ]);
  }, [isAwaitingPro, isPro, queryClient]);

  const startWaiting = () => {
    setConfirmation("waiting");
    void billingStatus.refetch();
  };

  return { billingStatus, confirmation, startWaiting };
};
