import { Button } from "@heroui/react";
import { Bell } from "@phosphor-icons/react";
import { type GetPushSubscriptionsResponse } from "@recipestock/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getPushSubscriptions, pushSubscriptionsQueryKey, registerPushSubscription } from "./api";
import { deactivatePushSubscription, supportsPushNotifications } from "./browser";

type NotificationState = "loading" | "disabled" | "enabled" | "denied" | "unsupported" | "error";

const decodeApplicationServerKey = (value: string) => {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(base64);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
};

const serializeSubscription = (subscription: PushSubscription) => {
  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    throw new Error("Push subscription is missing required values.");
  }

  return {
    endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: { p256dh, auth },
  };
};

const stateMessage = (state: NotificationState) => {
  if (state === "loading") return "通知の状態を確認しています。";
  if (state === "enabled") return "この端末では通知が有効です。";
  if (state === "disabled") return "この端末では通知が無効です。";
  if (state === "denied") return "通知が拒否されています。端末の設定から許可してください。";
  if (state === "unsupported") return "この環境はWeb Push通知に対応していません。";
  return "通知の状態を確認できませんでした。時間をおいて再度お試しください。";
};

export const PushNotificationSettingsCard = () => {
  const supported = supportsPushNotifications();
  const queryClient = useQueryClient();
  const pushSubscriptions = useQuery({
    queryKey: pushSubscriptionsQueryKey,
    queryFn: getPushSubscriptions,
    enabled: supported,
    retry: false,
  });
  const [state, setState] = useState<NotificationState>("loading");
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (!supported) {
      setState("unsupported");
      return () => {
        active = false;
      };
    }

    const load = async () => {
      if (pushSubscriptions.isError) {
        setState("error");
        return;
      }
      if (!pushSubscriptions.data) return;

      try {
        const registration = await navigator.serviceWorker.ready;
        const currentSubscription = await registration.pushManager.getSubscription();
        if (!active) return;

        setSubscription(currentSubscription);
        const isRegistered =
          currentSubscription &&
          pushSubscriptions.data.subscriptions.some(
            (item) => item.endpoint === currentSubscription.endpoint,
          );
        setState(
          Notification.permission === "denied" ? "denied" : isRegistered ? "enabled" : "disabled",
        );
      } catch {
        if (active) setState("error");
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [pushSubscriptions.data, pushSubscriptions.isError, supported]);

  const enable = async () => {
    setActionError(null);
    setActionMessage(null);
    setIsSubmitting(true);

    try {
      const permission = await Notification.requestPermission();
      if (permission === "denied") {
        setState("denied");
        return;
      }
      if (permission === "default") {
        setState("disabled");
        setActionError("通知の許可が選択されませんでした。もう一度お試しください。");
        return;
      }
      if (!pushSubscriptions.data?.applicationServerKey) {
        throw new Error("VAPID public key is unavailable.");
      }

      const registration = await navigator.serviceWorker.ready;
      const existingSubscription = await registration.pushManager.getSubscription();
      if (existingSubscription) {
        const unsubscribed = await existingSubscription.unsubscribe().catch(() => false);
        if (!unsubscribed) {
          throw new Error("Existing push subscription could not be deactivated.");
        }
      }
      const currentSubscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeApplicationServerKey(
          pushSubscriptions.data.applicationServerKey,
        ),
      });

      try {
        await registerPushSubscription(serializeSubscription(currentSubscription));
      } catch (error) {
        await currentSubscription.unsubscribe().catch(() => false);
        throw error;
      }

      setSubscription(currentSubscription);
      setState("enabled");
      setActionMessage("通知を有効にしました。");
      queryClient.setQueryData<GetPushSubscriptionsResponse>(
        pushSubscriptionsQueryKey,
        (current) =>
          current && {
            ...current,
            subscriptions: [
              ...current.subscriptions.filter(
                (item) => item.endpoint !== currentSubscription.endpoint,
              ),
              { endpoint: currentSubscription.endpoint, expirationTime: null },
            ],
          },
      );
    } catch {
      setActionError("通知を登録できませんでした。時間をおいて再度お試しください。");
    } finally {
      setIsSubmitting(false);
    }
  };

  const disable = async () => {
    if (!subscription) {
      setState("disabled");
      return;
    }

    setActionError(null);
    setActionMessage(null);
    setIsSubmitting(true);

    try {
      const { browserCleanupSucceeded, serverCleanupSucceeded } =
        await deactivatePushSubscription(subscription);
      if (!browserCleanupSucceeded && !serverCleanupSucceeded) {
        throw new Error("Push subscription could not be deactivated.");
      }

      setSubscription(null);
      setState("disabled");
      queryClient.setQueryData<GetPushSubscriptionsResponse>(
        pushSubscriptionsQueryKey,
        (current) =>
          current && {
            ...current,
            subscriptions: current.subscriptions.filter(
              (item) => item.endpoint !== subscription.endpoint,
            ),
          },
      );
      setActionMessage(
        browserCleanupSucceeded && serverCleanupSucceeded
          ? "通知を解除しました。"
          : browserCleanupSucceeded
            ? "通知は解除されましたが、登録情報の削除を確認できませんでした。"
            : "通知は解除されましたが、この端末の購読解除を確認できませんでした。",
      );
    } catch {
      setActionError("通知を解除できませんでした。時間をおいて再度お試しください。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-w-0 rounded-[20px] border border-brand-line-soft bg-brand-paper p-5 shadow-pantry-sm sm:p-6">
      <div className="mb-3 flex min-w-0 items-center gap-2">
        <Bell size={18} weight="bold" className="text-brand-walnut" />
        <h2 className="text-brand-walnut font-bold text-lg">完了通知</h2>
      </div>
      <p className="text-brand-muted text-sm">
        Shortcutから開始した取り込みの完了を、この端末へ通知します。通知を利用しなくてもShortcut連携は使えます。
      </p>
      <p className="mt-3 font-medium text-brand-walnut text-sm" role="status">
        {stateMessage(state)}
      </p>

      {state === "disabled" ? (
        <Button
          className="mt-4 rounded-full font-semibold"
          isDisabled={isSubmitting || !pushSubscriptions.data?.applicationServerKey}
          type="button"
          variant="secondary"
          onPress={() => void enable()}
        >
          通知を有効にする
        </Button>
      ) : null}
      {(state === "enabled" || state === "denied") && subscription ? (
        <Button
          className="mt-4 rounded-full font-semibold"
          isDisabled={isSubmitting}
          type="button"
          variant="secondary"
          onPress={() => void disable()}
        >
          通知を解除する
        </Button>
      ) : null}
      {state === "error" ? (
        <Button
          className="mt-4 rounded-full font-semibold"
          isDisabled={pushSubscriptions.isFetching}
          type="button"
          variant="secondary"
          onPress={() => void pushSubscriptions.refetch()}
        >
          状態を再確認する
        </Button>
      ) : null}

      {actionMessage ? (
        <p className="mt-3 text-brand-sage-dark text-sm" role="status">
          {actionMessage}
        </p>
      ) : null}
      {actionError ? (
        <p className="mt-3 text-brand-danger text-sm" role="alert">
          {actionError}
        </p>
      ) : null}
    </div>
  );
};
