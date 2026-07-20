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

describe("Push notification worker", () => {
  it("成功payloadをgenericな通知として表示しprivate fieldを引き継がない", async () => {
    const worker = createWorkerScope();

    await worker.dispatch("push", {
      data: {
        json: () => ({
          outcome: "succeeded",
          recipeId: "recipe / 1",
          url: "https://private.example.com/recipe",
          title: "Private recipe title",
          sourceName: "Private source",
          error: "Private error detail",
        }),
      },
    });

    expect(worker.showNotification).toHaveBeenCalledWith("レシピの取り込みが完了しました", {
      body: "Recipe Stockで確認できます。",
      data: { outcome: "succeeded", recipeId: "recipe / 1" },
      icon: "/icons/icon-192.png",
    });
    expect(JSON.stringify(worker.showNotification.mock.calls)).not.toMatch(
      /private\.example|Private recipe|Private source|Private error/,
    );
  });

  it("失敗または不正なpayloadをgenericな失敗通知として表示する", async () => {
    for (const payload of [{ outcome: "failed" }, { outcome: "succeeded", recipeId: "" }]) {
      const worker = createWorkerScope();
      await worker.dispatch("push", { data: { json: () => payload } });

      expect(worker.showNotification).toHaveBeenCalledWith("レシピを取り込めませんでした", {
        body: "Recipe Stockを開いて結果を確認してください。",
        data: { outcome: "failed" },
        icon: "/icons/icon-192.png",
      });
    }
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
