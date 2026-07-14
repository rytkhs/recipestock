import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceWorkerSource = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");

const loadServiceWorker = ({ windows = [] } = {}) => {
  const listeners = new Map();
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => undefined);
  const matchAll = vi.fn(async () => windows);
  const context = {
    URL,
    self: {
      location: { origin: "https://app.example.com" },
      registration: { showNotification },
      clients: {
        claim: vi.fn(async () => undefined),
        matchAll,
        openWindow,
      },
      addEventListener: (name, listener) => listeners.set(name, listener),
      skipWaiting: vi.fn(),
    },
  };
  vm.runInNewContext(serviceWorkerSource, context);

  const dispatch = async (name, event) => {
    let pending;
    listeners.get(name)({
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

describe("public Service Worker push events", () => {
  it("成功payloadをgenericな通知として表示しprivate fieldを引き継がない", async () => {
    const worker = loadServiceWorker();

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
      const worker = loadServiceWorker();
      await worker.dispatch("push", { data: { json: () => payload } });

      expect(worker.showNotification).toHaveBeenCalledWith("レシピを取り込めませんでした", {
        body: "Recipe Stockを開いて結果を確認してください。",
        data: { outcome: "failed" },
        icon: "/icons/icon-192.png",
      });
    }
  });
});

describe("Service Worker notification activation", () => {
  it("既存windowをsame-originのRecipeへ遷移してfocusする", async () => {
    const windowClient = {
      navigate: vi.fn(async () => undefined),
      focus: vi.fn(async () => undefined),
    };
    const worker = loadServiceWorker({ windows: [windowClient] });
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
    const worker = loadServiceWorker();

    await worker.dispatch("notificationclick", {
      notification: {
        close: vi.fn(),
        data: { outcome: "failed", url: "https://evil.example.com/steal" },
      },
    });

    expect(worker.matchAll).toHaveBeenCalledWith({ includeUncontrolled: true, type: "window" });
    expect(worker.openWindow).toHaveBeenCalledWith("https://app.example.com/recipes");
  });
});
