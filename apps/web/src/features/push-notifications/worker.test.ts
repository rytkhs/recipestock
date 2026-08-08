import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerPushNotificationHandlers } from "./worker";

type WorkerListener = (event: {
  data?: { json: () => unknown };
  notification?: { close: () => void; data: unknown };
  waitUntil: (promise: Promise<unknown>) => void;
}) => void;

const createWorkerScope = ({ windows = [] }: { windows?: WindowClient[] } = {}) => {
  const listeners = new Map<string, WorkerListener>();
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => null);
  const matchAll = vi.fn(async () => windows);
  const scope = {
    location: { origin: "https://app.example.com" },
    registration: { showNotification },
    clients: { matchAll, openWindow },
    addEventListener: (name: string, listener: WorkerListener) => listeners.set(name, listener),
  };

  registerPushNotificationHandlers(scope as unknown as ServiceWorkerGlobalScope);

  const dispatch = async (
    name: string,
    event: Omit<Parameters<WorkerListener>[0], "waitUntil">,
  ) => {
    let pending: Promise<unknown> | undefined;
    listeners.get(name)?.({
      ...event,
      waitUntil: (promise) => {
        pending = promise;
      },
    });
    await pending;
  };

  return { dispatch, matchAll, openWindow, showNotification };
};

beforeEach(() => {
  vi.restoreAllMocks();
});

const notice = { title: "レシピの取り込みが完了しました", body: "Recipe Stockで確認できます。" };

describe("Push notification worker", () => {
  it("サーバーが生成したnoticeをそのまま表示し、遷移先だけをdataに残す", async () => {
    const worker = createWorkerScope();

    await worker.dispatch("push", {
      data: {
        json: () => ({
          outcome: "succeeded",
          recipeId: "recipe / 1",
          notice: { title: "サーバーが決めた見出し", body: "サーバーが決めた本文。" },
          url: "https://private.example.com/recipe",
          title: "Private recipe title",
          sourceName: "Private source",
          error: "Private error detail",
        }),
      },
    });

    expect(worker.showNotification).toHaveBeenCalledWith("サーバーが決めた見出し", {
      body: "サーバーが決めた本文。",
      data: { outcome: "succeeded", recipeId: "recipe / 1" },
      icon: "/icons/icon-192.png",
    });
    expect(JSON.stringify(worker.showNotification.mock.calls)).not.toMatch(
      /private\.example|Private recipe|Private source|Private error/,
    );
  });

  it("失敗payloadのnoticeを表示し、recipeIdを持たない遷移先を残す", async () => {
    const worker = createWorkerScope();

    await worker.dispatch("push", {
      data: {
        json: () => ({
          outcome: "failed",
          notice: { title: "取り込めませんでした", body: "アプリで確認してください。" },
        }),
      },
    });

    expect(worker.showNotification).toHaveBeenCalledWith("取り込めませんでした", {
      body: "アプリで確認してください。",
      data: { outcome: "failed" },
      icon: "/icons/icon-192.png",
    });
  });

  it("契約に合わないpayloadでは最終手段の通知を表示する", async () => {
    const payloads: unknown[] = [
      { outcome: "failed", notice: { title: "", body: "" } },
      { outcome: "failed" },
      null,
    ];

    for (const payload of payloads) {
      const worker = createWorkerScope();
      await worker.dispatch("push", { data: { json: () => payload } });

      expect(worker.showNotification).toHaveBeenCalledWith("レシピの取り込み結果があります", {
        body: "Recipe Stockを開いて確認してください。",
        data: { outcome: "failed" },
        icon: "/icons/icon-192.png",
      });
    }
  });

  it("noticeが読めなくてもRecipeへの遷移先を失わない", async () => {
    const worker = createWorkerScope();

    await worker.dispatch("push", {
      data: { json: () => ({ outcome: "succeeded", recipeId: "recipe_1" }) },
    });

    expect(worker.showNotification).toHaveBeenCalledWith("レシピの取り込み結果があります", {
      body: "Recipe Stockを開いて確認してください。",
      data: { outcome: "succeeded", recipeId: "recipe_1" },
      icon: "/icons/icon-192.png",
    });
  });

  it("遷移先が読めなくてもサーバーのnoticeを表示する", async () => {
    const worker = createWorkerScope();

    await worker.dispatch("push", {
      data: { json: () => ({ outcome: "succeeded", recipeId: "", notice }) },
    });

    expect(worker.showNotification).toHaveBeenCalledWith(notice.title, {
      body: notice.body,
      data: { outcome: "failed" },
      icon: "/icons/icon-192.png",
    });
  });

  it("payloadを読めないときも最終手段の通知を表示する", async () => {
    const worker = createWorkerScope();

    await worker.dispatch("push", {
      data: {
        json: () => {
          throw new Error("invalid json");
        },
      },
    });

    expect(worker.showNotification).toHaveBeenCalledWith(
      "レシピの取り込み結果があります",
      expect.objectContaining({ data: { outcome: "failed" } }),
    );
  });

  it("既存windowをsame-originのRecipeへ遷移してfocusする", async () => {
    const windowClient = {
      navigate: vi.fn(async () => null),
      focus: vi.fn(async () => windowClient),
    } as unknown as WindowClient;
    const worker = createWorkerScope({ windows: [windowClient] });
    const close = vi.fn();

    await worker.dispatch("notificationclick", {
      notification: {
        close,
        data: {
          outcome: "succeeded",
          recipeId: "recipe / 1",
          url: "https://evil.example.com/steal",
        },
      },
    });

    expect(close).toHaveBeenCalled();
    expect(windowClient.navigate).toHaveBeenCalledWith(
      "https://app.example.com/recipes/recipe%20%2F%201",
    );
    expect(windowClient.focus).toHaveBeenCalled();
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  it("windowがなければ失敗通知からRecipe一覧を開く", async () => {
    const worker = createWorkerScope();

    await worker.dispatch("notificationclick", {
      notification: {
        close: vi.fn(),
        data: { outcome: "failed", url: "https://evil.example.com/steal" },
      },
    });

    expect(worker.matchAll).toHaveBeenCalledWith({
      includeUncontrolled: true,
      type: "window",
    });
    expect(worker.openWindow).toHaveBeenCalledWith("https://app.example.com/recipes");
  });
});
