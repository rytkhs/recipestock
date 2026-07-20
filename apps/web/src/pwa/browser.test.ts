import { afterEach, describe, expect, it, vi } from "vitest";
import { getAppServiceWorkerRegistration, registerAppServiceWorker } from "./browser";

describe("App Service Worker browser interface", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("root scopeでHTTP cacheを使わずに/sw.jsを登録する", async () => {
    const registration = {} as ServiceWorkerRegistration;
    const register = vi.fn(async () => registration);
    vi.stubGlobal("navigator", {
      ...navigator,
      serviceWorker: { register },
    });

    await expect(registerAppServiceWorker()).resolves.toBe(registration);
    expect(register).toHaveBeenCalledWith("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
  });

  it("root scopeの既存registrationを取得する", async () => {
    const registration = {} as ServiceWorkerRegistration;
    const getRegistration = vi.fn(async () => registration);
    vi.stubGlobal("navigator", {
      ...navigator,
      serviceWorker: { getRegistration },
    });

    await expect(getAppServiceWorkerRegistration()).resolves.toBe(registration);
    expect(getRegistration).toHaveBeenCalledWith("/");
  });
});
