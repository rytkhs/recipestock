/// <reference lib="webworker" />

import { parseImportCompletionNotice, parseImportCompletionRoute } from "@recipestock/shared";

/**
 * payloadが契約に合わないときに表示する最終手段。`userVisibleOnly`のため
 * pushを受け取った以上は必ず何か表示しなければならず、他に出せる文字列がない。
 * 通常運用では到達しない。表示文言はサーバーが決める（ADR 0009）。
 */
const lastResortNotification = {
  title: "レシピの取り込み結果があります",
  body: "Recipe Stockを開いて確認してください。",
};

const notificationIcon = "/icons/icon-192.png";

/** 遷移先はpayload由来のURLではなく、常にこのScope配下でoutcomeから導出する。 */
const destinationFor = (scope: ServiceWorkerGlobalScope, value: unknown) => {
  const route = parseImportCompletionRoute(value);
  const path =
    route.outcome === "succeeded" ? `/recipes/${encodeURIComponent(route.recipeId)}` : "/recipes";

  return new URL(path, scope.location.origin).href;
};

const readPushPayload = (event: PushEvent): unknown => {
  try {
    return event.data?.json();
  } catch {
    return null;
  }
};

export const registerPushNotificationHandlers = (scope: ServiceWorkerGlobalScope): void => {
  scope.addEventListener("push", (event) => {
    const payload = readPushPayload(event);
    const notice = parseImportCompletionNotice(payload) ?? lastResortNotification;

    event.waitUntil(
      scope.registration.showNotification(notice.title, {
        body: notice.body,
        data: parseImportCompletionRoute(payload),
        icon: notificationIcon,
      }),
    );
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
