import { beforeAll, describe, expect, it, vi } from "vitest";

const workbox = vi.hoisted(() => {
  const calls: string[] = [];
  const handler = vi.fn();

  return {
    calls,
    handler,
    clientsClaim: vi.fn(() => calls.push("clientsClaim")),
    cleanupOutdatedCaches: vi.fn(() => calls.push("cleanupOutdatedCaches")),
    createHandlerBoundToURL: vi.fn(() => handler),
    precacheAndRoute: vi.fn(() => calls.push("precacheAndRoute")),
    registerRoute: vi.fn(() => calls.push("registerRoute")),
    NavigationRoute: vi.fn(function NavigationRoute(
      this: { handler: unknown; options: unknown },
      routeHandler,
      options,
    ) {
      this.handler = routeHandler;
      this.options = options;
    }),
    registerPushNotificationHandlers: vi.fn(() => calls.push("registerPushNotificationHandlers")),
  };
});

vi.mock("workbox-core", () => ({ clientsClaim: workbox.clientsClaim }));
vi.mock("workbox-precaching", () => ({
  cleanupOutdatedCaches: workbox.cleanupOutdatedCaches,
  createHandlerBoundToURL: workbox.createHandlerBoundToURL,
  precacheAndRoute: workbox.precacheAndRoute,
}));
vi.mock("workbox-routing", () => ({
  NavigationRoute: workbox.NavigationRoute,
  registerRoute: workbox.registerRoute,
}));
vi.mock("../features/push-notifications/worker", () => ({
  registerPushNotificationHandlers: workbox.registerPushNotificationHandlers,
}));

const manifest = [{ url: "index.html", revision: "revision" }];

beforeAll(async () => {
  Object.assign(self, { __WB_MANIFEST: manifest });
  await import("./sw");
});

describe("App Shell Service Worker", () => {
  it("precacheを他のrouteより先に登録する", () => {
    expect(workbox.calls).toEqual([
      "cleanupOutdatedCaches",
      "precacheAndRoute",
      "registerRoute",
      "clientsClaim",
      "registerPushNotificationHandlers",
    ]);
    expect(workbox.precacheAndRoute).toHaveBeenCalledWith(manifest);
  });

  it("APIを除外してindex.htmlへnavigation fallbackする", () => {
    expect(workbox.createHandlerBoundToURL).toHaveBeenCalledWith("/index.html");
    const route = workbox.NavigationRoute.mock.instances[0] as unknown as {
      handler: unknown;
      options: { denylist: RegExp[] };
    };
    expect(route.handler).toBe(workbox.handler);
    expect(route.options.denylist[0]?.test("/api/me")).toBe(true);
    expect(route.options.denylist[0]?.test("/recipes/recipe_123")).toBe(false);
  });

  it("skipWaitingを呼ばない", () => {
    expect(workbox.calls).not.toContain("skipWaiting");
  });
});
