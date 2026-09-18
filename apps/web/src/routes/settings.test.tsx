import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { viewerQueryKey } from "../lib/viewer";
import {
  billingStatusResponse,
  createSessionResponse,
  findFetchCall,
  getRequestPath,
  isGetSessionRequest,
  jsonResponse,
  mockFetch,
  renderApp,
  viewerResponse,
} from "../test/router-test-utils";
import { checkoutRedirect } from "./settings-billing";

describe("Settings routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const installPushBrowser = ({
    hasServiceWorkerRegistration = true,
    isServiceWorkerReady = true,
    permission = "default",
    requestPermission = "granted",
    subscription = null,
    newSubscription = subscription,
  }: {
    hasServiceWorkerRegistration?: boolean;
    isServiceWorkerReady?: boolean;
    permission?: NotificationPermission;
    requestPermission?: NotificationPermission;
    subscription?: PushSubscription | null;
    newSubscription?: PushSubscription | null;
  } = {}) => {
    const requestPermissionMock = vi.fn(async () => requestPermission);
    const subscribe = vi.fn(async () => newSubscription as PushSubscription);
    let getSubscriptionCalls = 0;
    const getSubscription = vi.fn(async () => {
      getSubscriptionCalls += 1;
      return getSubscriptionCalls <= 2 ? subscription : newSubscription;
    });
    const registration = {
      active: null,
      pushManager: { getSubscription, subscribe },
    };
    const getRegistration = vi.fn(async () =>
      hasServiceWorkerRegistration
        ? (registration as unknown as ServiceWorkerRegistration)
        : undefined,
    );
    const register = vi.fn(async () => registration as unknown as ServiceWorkerRegistration);
    const ready = isServiceWorkerReady
      ? Promise.resolve(registration)
      : new Promise<ServiceWorkerRegistration>(() => {});

    vi.stubGlobal("Notification", {
      permission,
      requestPermission: requestPermissionMock,
    });
    vi.stubGlobal("PushManager", class PushManager {});
    vi.stubGlobal("navigator", {
      ...navigator,
      serviceWorker: {
        getRegistration,
        ready,
        register,
      },
    });

    return {
      getRegistration,
      getSubscription,
      register,
      registration,
      requestPermissionMock,
      subscribe,
    };
  };

  const confirmSignOut = async () => {
    await userEvent.click(await screen.findByRole("button", { name: "ログアウト" }));
    const dialog = await screen.findByRole("alertdialog", { name: "ログアウトしますか？" });
    await userEvent.click(within(dialog).getByRole("button", { name: "ログアウト" }));
  };

  const createPushSubscription = ({
    endpoint = "https://push.example.com/subscription/device-1",
    unsubscribeResult = true,
  }: {
    endpoint?: string;
    unsubscribeResult?: boolean;
  } = {}) =>
    ({
      endpoint,
      expirationTime: null,
      unsubscribe: vi.fn(async () => unsubscribeResult),
      toJSON: () => ({
        endpoint,
        expirationTime: null,
        keys: { p256dh: "p256dh-key", auth: "auth-key" },
      }),
    }) as unknown as PushSubscription;

  it("別ユーザーの既存subscriptionを解除してから新しいsubscriptionを登録する", async () => {
    const existingSubscription = createPushSubscription();
    const newSubscription = createPushSubscription({
      endpoint: "https://push.example.com/subscription/device-2",
    });
    const browser = installPushBrowser({
      subscription: existingSubscription,
      newSubscription,
    });
    const fetchMock = mockFetch(
      async (input, init) => {
        const path = getRequestPath(input);
        if (path === "/api/push-subscriptions" && init?.method === "GET") {
          return jsonResponse({ applicationServerKey: "AQID", subscriptions: [] });
        }
        if (path === "/api/push-subscriptions" && init?.method === "POST") {
          return jsonResponse({
            subscription: { endpoint: newSubscription.endpoint, expirationTime: null },
          });
        }
        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/settings/share");

    await expect(screen.findByText("この端末では通知が無効です。")).resolves.toBeInTheDocument();
    expect(browser.requestPermissionMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "通知を有効にする" }));

    await expect(screen.findByText("この端末では通知が有効です。")).resolves.toBeInTheDocument();
    expect(browser.requestPermissionMock).toHaveBeenCalledTimes(1);
    expect(existingSubscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(browser.subscribe).toHaveBeenCalledTimes(1);
    const registerCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        getRequestPath(input) === "/api/push-subscriptions" && init?.method === "POST",
    );
    expect(JSON.parse(String(registerCall?.[1]?.body))).toMatchObject({
      endpoint: newSubscription.endpoint,
    });
  });

  it("既存subscriptionを解除できない場合は新しいsubscriptionを登録しない", async () => {
    const existingSubscription = createPushSubscription({ unsubscribeResult: false });
    const newSubscription = createPushSubscription({
      endpoint: "https://push.example.com/subscription/device-2",
    });
    const browser = installPushBrowser({
      subscription: existingSubscription,
      newSubscription,
    });
    const fetchMock = mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/push-subscriptions" && init?.method === "GET") {
          return jsonResponse({ applicationServerKey: "AQID", subscriptions: [] });
        }
        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/settings/share");
    await userEvent.click(await screen.findByRole("button", { name: "通知を有効にする" }));

    await expect(
      screen.findByText("通知を登録できませんでした。時間をおいて再度お試しください。"),
    ).resolves.toBeInTheDocument();
    expect(existingSubscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          getRequestPath(input) === "/api/push-subscriptions" && init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("Service Workerのreadyを待たずに通知を有効化する", async () => {
    const subscription = createPushSubscription();
    installPushBrowser({ subscription: null, newSubscription: subscription });
    vi.stubGlobal("navigator", {
      ...navigator,
      serviceWorker: {
        ...navigator.serviceWorker,
        ready: new Promise<ServiceWorkerRegistration>(() => {}),
      },
    });
    mockFetch(
      async (input, init) => {
        const path = getRequestPath(input);
        if (path === "/api/push-subscriptions" && init?.method === "GET") {
          return jsonResponse({ applicationServerKey: "AQID", subscriptions: [] });
        }
        if (path === "/api/push-subscriptions" && init?.method === "POST") {
          return jsonResponse({
            subscription: { endpoint: subscription.endpoint, expirationTime: null },
          });
        }
        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/settings/share");
    await userEvent.click(await screen.findByRole("button", { name: "通知を有効にする" }));

    await expect(screen.findByText("この端末では通知が有効です。")).resolves.toBeInTheDocument();
  });

  it("Service Worker登録に失敗した場合は通知有効化を再試行できる", async () => {
    const browser = installPushBrowser({ subscription: null });
    browser.register.mockRejectedValue(new Error("Service Worker registration failed."));
    mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/push-subscriptions" && init?.method === "GET") {
          return jsonResponse({ applicationServerKey: "AQID", subscriptions: [] });
        }
        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/settings/share");
    await userEvent.click(await screen.findByRole("button", { name: "通知を有効にする" }));

    await expect(
      screen.findByText("通知を登録できませんでした。時間をおいて再度お試しください。"),
    ).resolves.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "通知を有効にする" })).toBeEnabled();
  });

  it("同じユーザーが再ログインした後に通知を再度有効化できる", async () => {
    let authenticated = true;
    let currentSubscription: PushSubscription | null = null;
    const serverEndpoints = new Set<string>();
    const firstSubscription = createPushSubscription({
      endpoint: "https://push.example.com/subscription/device-1",
    });
    const secondSubscription = createPushSubscription({
      endpoint: "https://push.example.com/subscription/device-2",
    });
    const pendingSubscriptions = [firstSubscription, secondSubscription];
    vi.mocked(firstSubscription.unsubscribe).mockImplementation(async () => {
      currentSubscription = null;
      return true;
    });
    vi.mocked(secondSubscription.unsubscribe).mockImplementation(async () => {
      currentSubscription = null;
      return true;
    });
    const registration = {
      pushManager: {
        getSubscription: vi.fn(async () => currentSubscription),
        subscribe: vi.fn(async () => {
          const subscription = pendingSubscriptions.shift();
          if (!subscription) throw new Error("No push subscription is available.");
          currentSubscription = subscription;
          return subscription;
        }),
      },
    };
    vi.stubGlobal("Notification", {
      permission: "granted",
      requestPermission: vi.fn(async () => "granted"),
    });
    vi.stubGlobal("PushManager", class PushManager {});
    vi.stubGlobal("navigator", {
      ...navigator,
      serviceWorker: {
        getRegistration: vi.fn(async () => registration as unknown as ServiceWorkerRegistration),
        ready: Promise.resolve(registration),
        register: vi.fn(async () => registration as unknown as ServiceWorkerRegistration),
      },
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = getRequestPath(input);

      if (path.endsWith("/get-session")) {
        return createSessionResponse(authenticated);
      }
      if (path === "/api/auth/sign-out" && init?.method === "POST") {
        authenticated = false;
        return jsonResponse({ success: true });
      }
      if (path === "/api/auth/sign-in/email" && init?.method === "POST") {
        authenticated = true;
        return jsonResponse({ token: "session_token" });
      }
      if (path === "/api/me" && authenticated) {
        return jsonResponse(viewerResponse);
      }
      if (path === "/api/recipes?limit=20") {
        return jsonResponse({ items: [], nextCursor: null });
      }
      if (path === "/api/push-subscriptions" && init?.method === "GET") {
        return jsonResponse({
          applicationServerKey: "AQID",
          subscriptions: [...serverEndpoints].map((endpoint) => ({
            endpoint,
            expirationTime: null,
          })),
        });
      }
      if (path === "/api/push-subscriptions" && init?.method === "POST") {
        const request = JSON.parse(String(init.body)) as { endpoint: string };
        serverEndpoints.add(request.endpoint);
        return jsonResponse({
          subscription: { endpoint: request.endpoint, expirationTime: null },
        });
      }
      if (path === "/api/push-subscriptions" && init?.method === "DELETE") {
        const request = JSON.parse(String(init.body)) as { endpoint: string };
        serverEndpoints.delete(request.endpoint);
        return jsonResponse({ revoked: true });
      }

      return new Response(null, { status: 404 });
    });

    await renderApp("/settings/share");
    await userEvent.click(await screen.findByRole("button", { name: "通知を有効にする" }));
    await expect(screen.findByText("この端末では通知が有効です。")).resolves.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "設定へ戻る" }));
    await confirmSignOut();
    await userEvent.type(await screen.findByLabelText("メールアドレス"), "chef@example.com");
    await userEvent.type(screen.getByLabelText("パスワード"), "password123");
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));
    await userEvent.click((await screen.findAllByRole("link", { name: "設定" }))[0]);
    await userEvent.click(await screen.findByRole("link", { name: /共有から取り込む/ }));

    await userEvent.click(await screen.findByRole("button", { name: "通知を有効にする" }));
    await expect(screen.findByText("この端末では通知が有効です。")).resolves.toBeInTheDocument();
  });

  it("通知拒否を説明し、共有の連携は利用可能なままにする", async () => {
    const browser = installPushBrowser({ requestPermission: "denied" });
    mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/push-subscriptions" && init?.method === "GET") {
          return jsonResponse({ applicationServerKey: "AQID", subscriptions: [] });
        }
        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/settings/share");
    await userEvent.click(await screen.findByRole("button", { name: "通知を有効にする" }));

    await expect(
      screen.findByText("通知が拒否されています。端末の設定から許可してください。"),
    ).resolves.toBeInTheDocument();
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "連携キーを発行" })).toBeInTheDocument();
  });

  it("通知権限dialogを閉じた場合は拒否扱いにせず再試行できる", async () => {
    installPushBrowser({ requestPermission: "default" });
    mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/push-subscriptions" && init?.method === "GET") {
          return jsonResponse({ applicationServerKey: "AQID", subscriptions: [] });
        }
        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/settings/share");
    await userEvent.click(await screen.findByRole("button", { name: "通知を有効にする" }));

    await expect(
      screen.findByText("通知の許可が選択されませんでした。もう一度お試しください。"),
    ).resolves.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "通知を有効にする" })).toBeEnabled();
  });

  it("subscription登録失敗を説明し、新しく作ったブラウザ購読を解除する", async () => {
    const subscription = createPushSubscription();
    installPushBrowser({ subscription: null, newSubscription: subscription });
    mockFetch(
      async (input, init) => {
        const path = getRequestPath(input);
        if (path === "/api/push-subscriptions" && init?.method === "GET") {
          return jsonResponse({ applicationServerKey: "AQID", subscriptions: [] });
        }
        if (path === "/api/push-subscriptions" && init?.method === "POST") {
          return jsonResponse(
            { error: { code: "unknown", message: "Unexpected error occurred." } },
            { status: 500 },
          );
        }
        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/settings/share");
    await userEvent.click(await screen.findByRole("button", { name: "通知を有効にする" }));

    await expect(
      screen.findByText("通知を登録できませんでした。時間をおいて再度お試しください。"),
    ).resolves.toBeInTheDocument();
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("ホーム画面から開いていない未対応環境には、追加すれば通知を使えることを伝える", async () => {
    vi.stubGlobal("Notification", undefined);
    vi.stubGlobal("PushManager", undefined);
    mockFetch(async () => new Response(null, { status: 404 }), { authenticated: true });

    await renderApp("/settings/share");

    await expect(
      screen.findByText(
        "通知を受け取るには、Recipe Stockをホーム画面に追加して、そこから開いてください。",
      ),
    ).resolves.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "通知を有効にする" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "連携キーを発行" })).toBeInTheDocument();
  });

  it("ホーム画面から開いていても未対応なら、通知権限を要求せず未対応と伝える", async () => {
    vi.stubGlobal("Notification", undefined);
    vi.stubGlobal("PushManager", undefined);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    mockFetch(async () => new Response(null, { status: 404 }), { authenticated: true });

    await renderApp("/settings/share");

    await expect(
      screen.findByText("この環境は通知に対応していません。"),
    ).resolves.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "通知を有効にする" })).not.toBeInTheDocument();
  });

  it("Service Worker登録がなければ通知無効として表示する", async () => {
    installPushBrowser({
      hasServiceWorkerRegistration: false,
      isServiceWorkerReady: false,
    });
    mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/push-subscriptions" && init?.method === "GET") {
          return jsonResponse({ applicationServerKey: "AQID", subscriptions: [] });
        }
        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/settings/share");

    await expect(screen.findByText("この端末では通知が無効です。")).resolves.toBeInTheDocument();
  });

  it("有効な通知を設定画面から解除する", async () => {
    const subscription = createPushSubscription();
    installPushBrowser({ permission: "granted", subscription });
    const fetchMock = mockFetch(
      async (input, init) => {
        const path = getRequestPath(input);
        if (path === "/api/push-subscriptions" && init?.method === "GET") {
          return jsonResponse({
            applicationServerKey: "AQID",
            subscriptions: [{ endpoint: subscription.endpoint, expirationTime: null }],
          });
        }
        if (path === "/api/push-subscriptions" && init?.method === "DELETE") {
          return jsonResponse({ revoked: true });
        }
        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/settings/share");
    await userEvent.click(await screen.findByRole("button", { name: "通知を解除する" }));

    await expect(screen.findByText("この端末では通知が無効です。")).resolves.toBeInTheDocument();
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          getRequestPath(input) === "/api/push-subscriptions" && init?.method === "DELETE",
      ),
    ).toBe(true);
  });

  it.each([
    {
      expectedMessage: "通知は解除されましたが、この端末の購読解除を確認できませんでした。",
      serverCleanupSucceeds: true,
      unsubscribeResult: false,
    },
    {
      expectedMessage: "通知は解除されましたが、登録情報の削除を確認できませんでした。",
      serverCleanupSucceeds: false,
      unsubscribeResult: true,
    },
  ])("通知解除の片側だけが成功した場合は無効状態にする", async ({
    expectedMessage,
    serverCleanupSucceeds,
    unsubscribeResult,
  }) => {
    const subscription = createPushSubscription({ unsubscribeResult });
    installPushBrowser({ permission: "granted", subscription, newSubscription: null });
    mockFetch(
      async (input, init) => {
        const path = getRequestPath(input);
        if (path === "/api/push-subscriptions" && init?.method === "GET") {
          return jsonResponse({
            applicationServerKey: "AQID",
            subscriptions: [{ endpoint: subscription.endpoint, expirationTime: null }],
          });
        }
        if (path === "/api/push-subscriptions" && init?.method === "DELETE") {
          return serverCleanupSucceeds
            ? jsonResponse({ revoked: true })
            : jsonResponse(
                { error: { code: "unknown", message: "Unexpected error occurred." } },
                { status: 500 },
              );
        }
        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/settings/share");
    await userEvent.click(await screen.findByRole("button", { name: "通知を解除する" }));

    await expect(screen.findByText(expectedMessage)).resolves.toBeInTheDocument();
    expect(screen.getByText("この端末では通知が無効です。")).toBeInTheDocument();
  });

  it("DBとブラウザの通知解除が両方失敗した場合は有効状態を維持する", async () => {
    const subscription = createPushSubscription({ unsubscribeResult: false });
    installPushBrowser({ permission: "granted", subscription });
    mockFetch(
      async (input, init) => {
        const path = getRequestPath(input);
        if (path === "/api/push-subscriptions" && init?.method === "GET") {
          return jsonResponse({
            applicationServerKey: "AQID",
            subscriptions: [{ endpoint: subscription.endpoint, expirationTime: null }],
          });
        }
        if (path === "/api/push-subscriptions" && init?.method === "DELETE") {
          return jsonResponse(
            { error: { code: "unknown", message: "Unexpected error occurred." } },
            { status: 500 },
          );
        }
        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/settings/share");
    await userEvent.click(await screen.findByRole("button", { name: "通知を解除する" }));

    await expect(
      screen.findByText("通知を解除できませんでした。時間をおいて再度お試しください。"),
    ).resolves.toBeInTheDocument();
    expect(screen.getByText("この端末では通知が有効です。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "通知を解除する" })).toBeEnabled();
  });

  it("ログアウト前に現在端末のsubscriptionをDBとブラウザから解除する", async () => {
    const subscription = createPushSubscription();
    installPushBrowser({ permission: "granted", subscription });
    let authenticated = true;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = getRequestPath(input);

      if (path.endsWith("/get-session")) {
        return createSessionResponse(authenticated);
      }
      if (path === "/api/me") {
        return jsonResponse(viewerResponse);
      }
      if (path === "/api/push-subscriptions" && init?.method === "GET") {
        return jsonResponse({
          applicationServerKey: "AQID",
          subscriptions: [{ endpoint: subscription.endpoint, expirationTime: null }],
        });
      }
      if (path === "/api/push-subscriptions" && init?.method === "DELETE") {
        return jsonResponse({ revoked: true });
      }
      if (path === "/api/auth/sign-out" && init?.method === "POST") {
        authenticated = false;
        return jsonResponse({ success: true });
      }

      return new Response(null, { status: 404 });
    });

    await renderApp("/settings");
    await confirmSignOut();

    await expect(screen.findByRole("heading", { name: "ログイン" })).resolves.toBeInTheDocument();
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    const deleteIndex = fetchMock.mock.calls.findIndex(
      ([input, init]) =>
        getRequestPath(input) === "/api/push-subscriptions" && init?.method === "DELETE",
    );
    const signOutIndex = fetchMock.mock.calls.findIndex(
      ([input, init]) => getRequestPath(input) === "/api/auth/sign-out" && init?.method === "POST",
    );
    expect(deleteIndex).toBeGreaterThanOrEqual(0);
    expect(signOutIndex).toBeGreaterThan(deleteIndex);
  });

  it("Service Worker登録がなくてもログアウトできる", async () => {
    installPushBrowser({
      hasServiceWorkerRegistration: false,
      isServiceWorkerReady: false,
    });
    let authenticated = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = getRequestPath(input);

      if (path.endsWith("/get-session")) {
        return createSessionResponse(authenticated);
      }
      if (path === "/api/me") {
        return jsonResponse(viewerResponse);
      }
      if (path === "/api/push-subscriptions" && init?.method === "GET") {
        return jsonResponse({ applicationServerKey: "AQID", subscriptions: [] });
      }
      if (path === "/api/auth/sign-out" && init?.method === "POST") {
        authenticated = false;
        return jsonResponse({ success: true });
      }

      return new Response(null, { status: 404 });
    });

    await renderApp("/settings");
    await confirmSignOut();

    await expect(screen.findByRole("heading", { name: "ログイン" })).resolves.toBeInTheDocument();
  });

  it("Service Worker登録を確認できない場合はログアウトを中止して再試行できる", async () => {
    const browser = installPushBrowser();
    browser.getRegistration.mockRejectedValue(new Error("Service Worker lookup failed."));
    mockFetch(async () => new Response(null, { status: 404 }), { authenticated: true });

    const { appRouter } = await renderApp("/settings");
    await confirmSignOut();

    await expect(
      screen.findByText(
        "通知を解除できなかったため、ログアウトを中止しました。時間をおいて再度お試しください。",
      ),
    ).resolves.toBeInTheDocument();
    expect(
      within(screen.getByRole("alertdialog", { name: "ログアウトしますか？" })).getByRole(
        "button",
        { name: "ログアウト" },
      ),
    ).toBeEnabled();
    expect(appRouter.state.location.pathname).toBe("/settings");
  });

  it.each([
    {
      name: "DB解除だけが成功",
      serverCleanupSucceeds: true,
      unsubscribeResult: false,
    },
    {
      name: "ブラウザ解除だけが成功",
      serverCleanupSucceeds: false,
      unsubscribeResult: true,
    },
  ])("$nameならログアウトを続ける", async ({ serverCleanupSucceeds, unsubscribeResult }) => {
    const subscription = createPushSubscription({ unsubscribeResult });
    installPushBrowser({ permission: "granted", subscription });
    let authenticated = true;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = getRequestPath(input);

      if (path.endsWith("/get-session")) {
        return createSessionResponse(authenticated);
      }
      if (path === "/api/me") {
        return jsonResponse(viewerResponse);
      }
      if (path === "/api/push-subscriptions" && init?.method === "GET") {
        return jsonResponse({
          applicationServerKey: "AQID",
          subscriptions: [{ endpoint: subscription.endpoint, expirationTime: null }],
        });
      }
      if (path === "/api/push-subscriptions" && init?.method === "DELETE") {
        return serverCleanupSucceeds
          ? jsonResponse({ revoked: true })
          : jsonResponse(
              { error: { code: "unknown", message: "Unexpected error occurred." } },
              { status: 500 },
            );
      }
      if (path === "/api/auth/sign-out" && init?.method === "POST") {
        authenticated = false;
        return jsonResponse({ success: true });
      }

      return new Response(null, { status: 404 });
    });

    await renderApp("/settings");
    await confirmSignOut();

    await expect(screen.findByRole("heading", { name: "ログイン" })).resolves.toBeInTheDocument();
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          getRequestPath(input) === "/api/auth/sign-out" && init?.method === "POST",
      ),
    ).toBe(true);
  });

  it("DBとブラウザのsubscription解除が両方失敗した場合はログアウトを止める", async () => {
    const subscription = createPushSubscription({ unsubscribeResult: false });
    installPushBrowser({ permission: "granted", subscription });
    const fetchMock = mockFetch(
      async (input, init) => {
        const path = getRequestPath(input);
        if (path === "/api/push-subscriptions" && init?.method === "GET") {
          return jsonResponse({
            applicationServerKey: "AQID",
            subscriptions: [{ endpoint: subscription.endpoint, expirationTime: null }],
          });
        }
        if (path === "/api/push-subscriptions" && init?.method === "DELETE") {
          return jsonResponse(
            { error: { code: "unknown", message: "Unexpected error occurred." } },
            { status: 500 },
          );
        }
        if (path === "/api/auth/sign-out" && init?.method === "POST") {
          return jsonResponse({ success: true });
        }
        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/settings");
    await confirmSignOut();

    await expect(
      screen.findByText(
        "通知を解除できなかったため、ログアウトを中止しました。時間をおいて再度お試しください。",
      ),
    ).resolves.toBeInTheDocument();
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          getRequestPath(input) === "/api/auth/sign-out" && init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("別ユーザーのDB subscriptionが残りブラウザ解除も失敗した場合はログアウトを止める", async () => {
    const subscription = createPushSubscription({ unsubscribeResult: false });
    installPushBrowser({ permission: "granted", subscription });
    let authenticated = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = getRequestPath(input);

      if (path.endsWith("/get-session")) {
        return createSessionResponse(authenticated);
      }
      if (path === "/api/me") {
        return jsonResponse(viewerResponse);
      }
      if (path === "/api/push-subscriptions" && init?.method === "GET") {
        return jsonResponse({ applicationServerKey: "AQID", subscriptions: [] });
      }
      if (path === "/api/push-subscriptions" && init?.method === "DELETE") {
        return jsonResponse({ revoked: true });
      }
      if (path === "/api/auth/sign-out" && init?.method === "POST") {
        authenticated = false;
        return jsonResponse({ success: true });
      }

      return new Response(null, { status: 404 });
    });

    const { appRouter } = await renderApp("/settings");
    await confirmSignOut();

    await expect(
      screen.findByText(
        "通知を解除できなかったため、ログアウトを中止しました。時間をおいて再度お試しください。",
      ),
    ).resolves.toBeInTheDocument();
    expect(appRouter.state.location.pathname).toBe("/settings");
  });

  it("ホーム画面に追加していなくても連携キーを発行してショートカットの追加へ進める", async () => {
    vi.stubEnv("VITE_IOS_SHARE_SHORTCUT_URL", "https://www.icloud.com/shortcuts/recipe-stock-test");
    const fetchMock = mockFetch(
      async (input, init) => {
        const path = getRequestPath(input);
        if (path === "/api/shortcut-credentials" && init?.method === "GET") {
          return jsonResponse({ credentials: [] });
        }
        if (path === "/api/shortcut-credentials" && init?.method === "POST") {
          return jsonResponse(
            {
              credential: {
                id: "credential_1",
                name: "iPhone",
                tokenSuffix: "aaaa",
                createdAt: "2026-07-11T00:00:00.000Z",
              },
              token: `rssc_${"a".repeat(25)}`,
            },
            { status: 201 },
          );
        }
        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

    await renderApp("/settings/share");
    await userEvent.click(await screen.findByRole("button", { name: "連携キーを発行" }));

    await expect(screen.findByLabelText("連携キー")).resolves.toHaveValue(`rssc_${"a".repeat(25)}`);
    expect(screen.getByRole("link", { name: "ショートカットを追加" })).toHaveAttribute(
      "href",
      "https://www.icloud.com/shortcuts/recipe-stock-test",
    );
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          getRequestPath(input) === "/api/shortcut-credentials" && init?.method === "POST",
      ),
    ).toBe(true);
  });

  it("メールアドレスのページから変更確認メールを送信できる", async () => {
    const fetchMock = mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/auth/change-email" && init?.method === "POST") {
          return jsonResponse({ status: true });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );
    await renderApp("/settings/email");

    await expect(screen.findByText("chef@example.com")).resolves.toBeInTheDocument();
    await userEvent.type(await screen.findByLabelText("新しいメールアドレス"), "new@example.com");
    await userEvent.click(screen.getByRole("button", { name: "確認メールを送信" }));

    const changeEmailCall = findFetchCall(fetchMock, "/api/auth/change-email");
    expect(changeEmailCall).toEqual([
      "/api/auth/change-email",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    ]);
    expect(JSON.parse(String(changeEmailCall?.[1]?.body))).toEqual({
      newEmail: "new@example.com",
      callbackURL: "/settings",
    });
    await expect(screen.findByText("確認メールを送信しました。")).resolves.toBeInTheDocument();
    expect(screen.getByLabelText("新しいメールアドレス")).toHaveValue("");
  });

  it("パスワードのページから変更できる", async () => {
    const fetchMock = mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/auth/change-password" && init?.method === "POST") {
          return jsonResponse({ status: true });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );
    await renderApp("/settings/password");

    await userEvent.type(await screen.findByLabelText("現在のパスワード"), "password123");
    await userEvent.type(screen.getByLabelText("新しいパスワード"), "newpassword123");
    await userEvent.click(screen.getByRole("button", { name: "パスワードを変更" }));

    const changePasswordCall = findFetchCall(fetchMock, "/api/auth/change-password");
    expect(changePasswordCall).toEqual([
      "/api/auth/change-password",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    ]);
    expect(JSON.parse(String(changePasswordCall?.[1]?.body))).toEqual({
      currentPassword: "password123",
      newPassword: "newpassword123",
      revokeOtherSessions: true,
    });
    await expect(screen.findByText("パスワードを変更しました。")).resolves.toBeInTheDocument();
    expect(screen.getByLabelText("現在のパスワード")).toHaveValue("");
    expect(screen.getByLabelText("新しいパスワード")).toHaveValue("");
  });

  const mockFailingAccountChanges = () =>
    mockFetch(
      async (input, init) => {
        const path = getRequestPath(input);

        if (
          (path === "/api/auth/change-email" || path === "/api/auth/change-password") &&
          init?.method === "POST"
        ) {
          return jsonResponse({ message: "Auth request failed." }, { status: 400 });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );

  it("メールアドレスの変更に失敗した場合は固定文言を表示する", async () => {
    mockFailingAccountChanges();
    await renderApp("/settings/email");

    await userEvent.type(await screen.findByLabelText("新しいメールアドレス"), "new@example.com");
    await userEvent.click(screen.getByRole("button", { name: "確認メールを送信" }));

    await expect(
      screen.findByText("メールアドレスを変更できませんでした。時間をおいて再度お試しください。"),
    ).resolves.toBeInTheDocument();
  });

  it("パスワードの変更に失敗した場合は固定文言を表示する", async () => {
    mockFailingAccountChanges();
    await renderApp("/settings/password");

    await userEvent.type(await screen.findByLabelText("現在のパスワード"), "password123");
    await userEvent.type(screen.getByLabelText("新しいパスワード"), "newpassword123");
    await userEvent.click(screen.getByRole("button", { name: "パスワードを変更" }));

    await expect(
      screen.findByText("パスワードを変更できませんでした。入力内容を確認してください。"),
    ).resolves.toBeInTheDocument();
  });

  it("FreeユーザーはプランのページからCheckoutを開始できる", async () => {
    const fetchMock = mockFetch(
      async (input, init) => {
        if (getRequestPath(input) === "/api/billing/checkout" && init?.method === "POST") {
          return jsonResponse({ url: "https://checkout.stripe.com/session_123" });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );
    const assign = vi.spyOn(checkoutRedirect, "assign").mockImplementation(() => {});
    await renderApp("/settings/billing");

    await userEvent.click(await screen.findByRole("button", { name: "Proにアップグレード" }));

    await waitFor(() => {
      expect(findFetchCall(fetchMock, "/api/billing/checkout")).toEqual([
        "/api/billing/checkout",
        expect.objectContaining({
          credentials: "include",
          method: "POST",
        }),
      ]);
    });
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/session_123");
    expect(screen.queryByRole("button", { name: "請求管理" })).not.toBeInTheDocument();
  });

  it("プランのページでviewer取得に失敗しても設定へ戻れる", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = getRequestPath(input);

      if (path.endsWith("/get-session")) {
        return createSessionResponse(true);
      }

      if (path === "/api/me") {
        return jsonResponse(
          {
            error: {
              code: "temporarily_unavailable",
              message: "Please retry later.",
            },
          },
          { status: 503 },
        );
      }

      return new Response(null, { status: 404 });
    });

    const { appRouter } = await renderApp("/settings/billing");

    await expect(
      screen.findByRole("heading", { name: "接続を確認できません" }),
    ).resolves.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "設定へ戻る" }));
    expect(appRouter.state.location.pathname).toBe("/settings");
  });

  it("ProユーザーにはPro契約ボタンを表示しない", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = getRequestPath(input);

      if (path.endsWith("/get-session")) {
        return createSessionResponse(true);
      }

      if (path === "/api/me") {
        return jsonResponse({
          ...viewerResponse,
          plan: "pro",
          recipeLimit: null,
          aiUsage: {
            ...viewerResponse.aiUsage,
            limit: 300,
          },
        });
      }

      if (path === "/api/billing/status") {
        return jsonResponse({
          plan: "pro",
          subscription: {
            status: "active",
            cancelAtPeriodEnd: false,
            currentPeriodEnd: "2026-07-04T00:00:00.000Z",
            cancelAt: null,
          },
        });
      }

      return new Response(null, { status: 404 });
    });

    await renderApp("/settings/billing");

    await expect(screen.findByText("Pro契約中です。")).resolves.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pro契約" })).not.toBeInTheDocument();
  });

  it("ProユーザーはCustomer Portalを開ける", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = getRequestPath(input);

      if (path.endsWith("/get-session")) {
        return createSessionResponse(true);
      }

      if (path === "/api/me") {
        return jsonResponse({
          ...viewerResponse,
          plan: "pro",
          recipeLimit: null,
        });
      }

      if (path === "/api/billing/status") {
        return jsonResponse({
          plan: "pro",
          subscription: {
            status: "active",
            cancelAtPeriodEnd: false,
            currentPeriodEnd: "2026-07-04T00:00:00.000Z",
            cancelAt: null,
          },
        });
      }

      if (path === "/api/billing/portal" && init?.method === "POST") {
        return jsonResponse({ url: "https://billing.stripe.com/session_123" });
      }

      return new Response(null, { status: 404 });
    });
    const assign = vi.spyOn(checkoutRedirect, "assign").mockImplementation(() => {});

    await renderApp("/settings/billing");
    await userEvent.click(await screen.findByRole("button", { name: "請求管理" }));

    await waitFor(() => {
      expect(findFetchCall(fetchMock, "/api/billing/portal")).toEqual([
        "/api/billing/portal",
        expect.objectContaining({
          credentials: "include",
          method: "POST",
        }),
      ]);
    });
    expect(assign).toHaveBeenCalledWith("https://billing.stripe.com/session_123");
  });

  it("Portal作成に失敗した場合は案内を表示する", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = getRequestPath(input);

      if (path.endsWith("/get-session")) {
        return createSessionResponse(true);
      }

      if (path === "/api/me") {
        return jsonResponse({
          ...viewerResponse,
          plan: "pro",
          recipeLimit: null,
        });
      }

      if (path === "/api/billing/status") {
        return jsonResponse({
          plan: "pro",
          subscription: {
            status: "active",
            cancelAtPeriodEnd: false,
            currentPeriodEnd: "2026-07-04T00:00:00.000Z",
            cancelAt: null,
          },
        });
      }

      if (path === "/api/billing/portal" && init?.method === "POST") {
        return jsonResponse(
          {
            error: {
              code: "unknown",
              message: "Unexpected error occurred.",
            },
          },
          { status: 500 },
        );
      }

      return new Response(null, { status: 404 });
    });

    await renderApp("/settings/billing");
    await userEvent.click(await screen.findByRole("button", { name: "請求管理" }));

    await expect(
      screen.findByText("請求管理を開けませんでした。時間をおいて再度お試しください。"),
    ).resolves.toBeInTheDocument();
  });

  it("already_subscribedの場合は案内を表示してviewerを再取得する", async () => {
    let meCalls = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = getRequestPath(input);

      if (path.endsWith("/get-session")) {
        return createSessionResponse(true);
      }

      if (path === "/api/me") {
        meCalls += 1;
        return jsonResponse(viewerResponse);
      }

      if (path === "/api/billing/status") {
        return jsonResponse(billingStatusResponse);
      }

      if (path === "/api/billing/checkout" && init?.method === "POST") {
        return jsonResponse(
          {
            error: {
              code: "already_subscribed",
              message: "User already has an active Pro subscription.",
            },
          },
          { status: 409 },
        );
      }

      return new Response(null, { status: 404 });
    });
    await renderApp("/settings/billing");

    await userEvent.click(await screen.findByRole("button", { name: "Proにアップグレード" }));

    await expect(
      screen.findByText("既にPro契約があります。表示を更新してください。"),
    ).resolves.toBeInTheDocument();
    expect(findFetchCall(fetchMock, "/api/billing/checkout")).toBeDefined();
    await waitFor(() => {
      expect(meCalls).toBeGreaterThan(1);
    });
  });

  const linkedCredential = (id: string, name: string) => ({
    id,
    name,
    tokenSuffix: id.slice(-4),
    createdAt: new Date().toISOString(),
  });

  const mockSettingsFetch = ({
    credentials = [],
    tags = [],
    viewer = viewerResponse,
  }: {
    credentials?: ReturnType<typeof linkedCredential>[];
    tags?: { id: string; name: string; recipeCount: number }[];
    viewer?: typeof viewerResponse | null;
  } = {}) =>
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = getRequestPath(input);

      if (isGetSessionRequest(input)) {
        return createSessionResponse(true);
      }
      if (path === "/api/me") {
        return viewer
          ? jsonResponse(viewer)
          : jsonResponse(
              { error: { code: "temporarily_unavailable", message: "Please retry later." } },
              { status: 503 },
            );
      }
      if (path === "/api/tags") {
        return jsonResponse({ tags });
      }
      if (path === "/api/shortcut-credentials") {
        return jsonResponse({ credentials });
      }

      return new Response(null, { status: 404 });
    });

  it("目次の各行に今の状態を出し、上限に達したプランを目立たせる", async () => {
    mockSettingsFetch({
      viewer: { ...viewerResponse, recipeCount: 5, recipeLimit: 5, isRecipeLimitReached: true },
      credentials: [
        linkedCredential("credential_0001", "iPhone"),
        linkedCredential("credential_0002", "iPad"),
      ],
      tags: [
        { id: "tag_1", name: "鶏肉", recipeCount: 2 },
        { id: "tag_2", name: "作り置き", recipeCount: 1 },
        { id: "tag_3", name: "お菓子", recipeCount: 0 },
      ],
    });

    await renderApp("/settings");

    await expect(
      screen.findByRole("link", { name: /プラン.*Free · 5\/5件/ }),
    ).resolves.toHaveAttribute("href", "/settings/billing");
    expect(screen.getByText("Free · 5/5件")).toHaveClass("text-brand-orange-dark");
    await expect(
      screen.findByRole("link", { name: /共有から取り込む.*2台と連携中/ }),
    ).resolves.toHaveAttribute("href", "/settings/share");
    await expect(screen.findByRole("link", { name: /タグ.*3個/ })).resolves.toHaveAttribute(
      "href",
      "/tags",
    );
    expect(screen.getByRole("link", { name: /メールアドレス.*chef@example\.com/ })).toHaveAttribute(
      "href",
      "/settings/email",
    );
    expect(screen.getByRole("link", { name: "パスワード" })).toHaveAttribute(
      "href",
      "/settings/password",
    );
  });

  it("Proで連携もタグもなければ、そのとおりに出す", async () => {
    mockSettingsFetch({ viewer: { ...viewerResponse, plan: "pro", recipeLimit: null } });

    await renderApp("/settings");

    await expect(screen.findByRole("link", { name: /プラン.*Pro/ })).resolves.toBeInTheDocument();
    await expect(
      screen.findByRole("link", { name: /共有から取り込む.*未設定/ }),
    ).resolves.toBeInTheDocument();
    await expect(screen.findByRole("link", { name: /タグ.*なし/ })).resolves.toBeInTheDocument();
  });

  it("viewerを読めないときはプランを既定値で描かない", async () => {
    mockSettingsFetch({ viewer: null });

    const { queryClient } = await renderApp("/settings");

    await waitFor(() => {
      expect(queryClient.getQueryState(viewerQueryKey)?.status).toBe("error");
    });
    expect(screen.getByRole("link", { name: /プラン/ })).toHaveTextContent(/^プラン$/);
  });

  it("目次から各ページへ進み、設定へ戻れる", async () => {
    mockSettingsFetch();

    const { appRouter } = await renderApp("/settings");

    await userEvent.click(await screen.findByRole("link", { name: /共有から取り込む/ }));
    await expect(
      screen.findByRole("heading", { name: "共有から取り込む" }),
    ).resolves.toBeInTheDocument();
    expect(appRouter.state.location.pathname).toBe("/settings/share");

    await userEvent.click(screen.getByRole("button", { name: "設定へ戻る" }));
    await userEvent.click(await screen.findByRole("link", { name: /メールアドレス/ }));
    await expect(
      screen.findByRole("heading", { name: "メールアドレス" }),
    ).resolves.toBeInTheDocument();
    expect(appRouter.state.location.pathname).toBe("/settings/email");
  });

  it("ログアウトの確認をキャンセルするとログアウトしない", async () => {
    const fetchMock = mockSettingsFetch();

    await renderApp("/settings");
    await userEvent.click(await screen.findByRole("button", { name: "ログアウト" }));
    const dialog = await screen.findByRole("alertdialog", { name: "ログアウトしますか？" });
    await userEvent.click(within(dialog).getByRole("button", { name: "キャンセル" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(findFetchCall(fetchMock, "/api/auth/sign-out")).toBeUndefined();
  });

  const mockLinkedDevicesFetch = ({ revokeSucceeds = true }: { revokeSucceeds?: boolean } = {}) => {
    let credentials = [
      linkedCredential("credential_0001", "iPhone"),
      linkedCredential("credential_0002", "iPad"),
    ];

    return mockFetch(
      async (input, init) => {
        const path = getRequestPath(input);

        if (path === "/api/shortcut-credentials" && init?.method === "GET") {
          return jsonResponse({ credentials });
        }
        if (path.startsWith("/api/shortcut-credentials/") && init?.method === "DELETE") {
          if (!revokeSucceeds) {
            return jsonResponse(
              { error: { code: "unknown", message: "Unexpected error occurred." } },
              { status: 500 },
            );
          }
          const credentialId = path.split("/").at(-1);
          credentials = credentials.filter(({ id }) => id !== credentialId);
          return jsonResponse({ revoked: true });
        }

        return new Response(null, { status: 404 });
      },
      { authenticated: true },
    );
  };

  it("ホーム画面から開いていなくても、連携している端末を確認して解除できる", async () => {
    const fetchMock = mockLinkedDevicesFetch();

    await renderApp("/settings/share");

    const list = await screen.findByRole("list", { name: "連携している端末" });
    expect(within(list).getByText("iPhone")).toBeInTheDocument();
    expect(within(list).getByText(/末尾 0001/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "「iPhone」の連携を解除" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "「iPhone」の連携を解除しますか？",
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "解除" }));

    await waitFor(() => {
      expect(within(list).queryByText("iPhone")).not.toBeInTheDocument();
    });
    expect(within(list).getByText("iPad")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          getRequestPath(input) === "/api/shortcut-credentials/credential_0001" &&
          init?.method === "DELETE",
      ),
    ).toBe(true);
  });

  it("連携の解除をキャンセルすると解除しない", async () => {
    const fetchMock = mockLinkedDevicesFetch();

    await renderApp("/settings/share");
    await userEvent.click(await screen.findByRole("button", { name: "「iPhone」の連携を解除" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "「iPhone」の連携を解除しますか？",
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "キャンセル" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(screen.getByText("iPhone")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("連携を解除できなかったら知らせ、端末を一覧に残す", async () => {
    mockLinkedDevicesFetch({ revokeSucceeds: false });

    await renderApp("/settings/share");
    await userEvent.click(await screen.findByRole("button", { name: "「iPhone」の連携を解除" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "「iPhone」の連携を解除しますか？",
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "解除" }));

    await expect(
      screen.findByText("連携を解除できませんでした。時間をおいて再度お試しください。"),
    ).resolves.toBeInTheDocument();
    expect(screen.getByText("iPhone")).toBeInTheDocument();
  });
});
