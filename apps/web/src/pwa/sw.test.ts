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
      _routeHandler: unknown,
      _options: { denylist: RegExp[] },
    ) {}),
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
    expect(workbox.precacheAndRoute.mock.invocationCallOrder[0]).toBeLessThan(
      workbox.registerRoute.mock.invocationCallOrder[0] ?? 0,
    );
    expect(workbox.precacheAndRoute).toHaveBeenCalledWith(manifest);
  });

  it("APIを除外してindex.htmlへnavigation fallbackする", () => {
    expect(workbox.createHandlerBoundToURL).toHaveBeenCalledWith("/index.html");
    const options = workbox.NavigationRoute.mock.calls[0]?.[1];
    expect(options?.denylist[0]?.test("/api/me")).toBe(true);
    expect(options?.denylist[0]?.test("/recipes/recipe_123")).toBe(false);
  });
});
