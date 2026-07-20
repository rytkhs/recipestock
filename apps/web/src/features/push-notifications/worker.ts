/// <reference lib="webworker" />

type PushNotificationPayload = { outcome: "succeeded"; recipeId: string } | { outcome: "failed" };

const failedNotificationPayload = { outcome: "failed" } as const;

const validateNotificationPayload = (value: unknown): PushNotificationPayload => {
  if (!value || typeof value !== "object") return failedNotificationPayload;

  const payload = value as { outcome?: unknown; recipeId?: unknown };
  if (payload.outcome === "succeeded" && typeof payload.recipeId === "string" && payload.recipeId) {
    return { outcome: "succeeded", recipeId: payload.recipeId };
  }

  return failedNotificationPayload;
};

const readPushPayload = (event: PushEvent): PushNotificationPayload => {
  try {
    return validateNotificationPayload(event.data?.json());
  } catch {
    return failedNotificationPayload;
  }
};

const notificationFor = (
  payload: PushNotificationPayload,
): { title: string; options: NotificationOptions } =>
  payload.outcome === "succeeded"
    ? {
        title: "レシピの取り込みが完了しました",
        options: {
          body: "Recipe Stockで確認できます。",
          data: payload,
          icon: "/icons/icon-192.png",
        },
      }
    : {
        title: "レシピを取り込めませんでした",
        options: {
          body: "Recipe Stockを開いて結果を確認してください。",
          data: failedNotificationPayload,
          icon: "/icons/icon-192.png",
        },
      };

const destinationFor = (scope: ServiceWorkerGlobalScope, value: unknown) => {
  const payload = validateNotificationPayload(value);
  const path =
    payload.outcome === "succeeded"
      ? `/recipes/${encodeURIComponent(payload.recipeId)}`
      : "/recipes";

  return new URL(path, scope.location.origin).href;
};

export const registerPushNotificationHandlers = (scope: ServiceWorkerGlobalScope): void => {
  scope.addEventListener("push", (event) => {
    const notification = notificationFor(readPushPayload(event));
    event.waitUntil(scope.registration.showNotification(notification.title, notification.options));
  });

  scope.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(
      (async () => {
        const destination = destinationFor(scope, event.notification.data);
        const windows = await scope.clients.matchAll({
          includeUncontrolled: true,
          type: "window",
        });
        const existingWindow = windows[0];

        if (existingWindow) {
          await existingWindow.navigate(destination);
          await existingWindow.focus();
          return;
        }

        await scope.clients.openWindow(destination);
      })(),
    );
  });
};
