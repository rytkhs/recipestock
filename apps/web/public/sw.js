self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

const failedNotificationPayload = { outcome: "failed" };

const validateNotificationPayload = (value) => {
  if (!value || typeof value !== "object") return failedNotificationPayload;
  if (value.outcome === "succeeded" && typeof value.recipeId === "string" && value.recipeId) {
    return { outcome: "succeeded", recipeId: value.recipeId };
  }
  return failedNotificationPayload;
};

const readPushPayload = (event) => {
  try {
    return validateNotificationPayload(event.data?.json());
  } catch {
    return failedNotificationPayload;
  }
};

const notificationFor = (payload) =>
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

self.addEventListener("push", (event) => {
  const notification = notificationFor(readPushPayload(event));
  event.waitUntil(self.registration.showNotification(notification.title, notification.options));
});

const destinationFor = (value) => {
  const payload = validateNotificationPayload(value);
  const path =
    payload.outcome === "succeeded"
      ? `/recipes/${encodeURIComponent(payload.recipeId)}`
      : "/recipes";
  return new URL(path, self.location.origin).href;
};

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const destination = destinationFor(event.notification.data);
      const windows = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
      const existingWindow = windows[0];
      if (existingWindow) {
        await existingWindow.navigate(destination);
        await existingWindow.focus();
        return;
      }
      await self.clients.openWindow(destination);
    })(),
  );
});
