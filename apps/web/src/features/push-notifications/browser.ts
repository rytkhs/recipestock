import { getPushSubscriptions, revokePushSubscription } from "./api";

const pushServiceWorkerScriptUrl = "/sw.js";
const pushServiceWorkerScope = "/";

export type PushSubscriptionDeactivationResult = {
  browserCleanupSucceeded: boolean;
  serverCleanupSucceeded: boolean;
};

export const supportsPushNotifications = () =>
  typeof Notification !== "undefined" &&
  typeof PushManager !== "undefined" &&
  "serviceWorker" in navigator;

export const registerPushServiceWorker = () =>
  navigator.serviceWorker.register(pushServiceWorkerScriptUrl, {
    scope: pushServiceWorkerScope,
  });

export const getCurrentPushSubscription = async () => {
  const registration = await navigator.serviceWorker.getRegistration(pushServiceWorkerScope);
  return registration?.pushManager.getSubscription() ?? null;
};

export const deactivatePushSubscription = async (
  subscription: PushSubscription,
): Promise<PushSubscriptionDeactivationResult> => {
  const [serverSubscriptions, browserCleanup] = await Promise.allSettled([
    getPushSubscriptions(),
    subscription.unsubscribe(),
  ]);
  const isOwnedByCurrentUser =
    serverSubscriptions.status === "fulfilled" &&
    serverSubscriptions.value.subscriptions.some(
      ({ endpoint }) => endpoint === subscription.endpoint,
    );
  const serverCleanup = isOwnedByCurrentUser
    ? await Promise.allSettled([revokePushSubscription(subscription.endpoint)])
    : [];

  return {
    serverCleanupSucceeded: serverCleanup[0]?.status === "fulfilled",
    browserCleanupSucceeded: browserCleanup.status === "fulfilled" && browserCleanup.value,
  };
};
