const appServiceWorkerScriptUrl = "/sw.js";
const appServiceWorkerScope = "/";

export const registerAppServiceWorker = (): Promise<ServiceWorkerRegistration> =>
  navigator.serviceWorker.register(appServiceWorkerScriptUrl, {
    scope: appServiceWorkerScope,
    updateViaCache: "none",
  });

export const getAppServiceWorkerRegistration = (): Promise<ServiceWorkerRegistration | undefined> =>
  navigator.serviceWorker.getRegistration(appServiceWorkerScope);
