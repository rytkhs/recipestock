import * as Sentry from "@sentry/react";
import { initMonitoring, redactBreadcrumb, redactEvent } from "./monitoring";

describe("redactEvent", () => {
  it("request URLとRefererからqueryとhashを落とす", () => {
    const event = redactEvent({
      type: undefined,
      request: {
        url: "https://app.example.com/recipes?q=%E5%91%B3%E5%99%8C&tag=soup#list",
        headers: {
          Referer: "https://www.instagram.com/p/abc/?igsh=secret",
          "User-Agent": "test-agent",
        },
      },
    } as Sentry.ErrorEvent);

    expect(event.request).toEqual({
      url: "https://app.example.com/recipes",
      headers: {
        Referer: "https://www.instagram.com/p/abc/",
        "User-Agent": "test-agent",
      },
    });
  });
});

describe("redactBreadcrumb", () => {
  it("画面遷移の前後のURLからqueryを落とす", () => {
    expect(
      redactBreadcrumb({
        category: "navigation",
        data: { from: "/recipes?q=miso", to: "/import?url=https%3A%2F%2Frecipes.example.com%2F1" },
      }),
    ).toEqual({ category: "navigation", data: { from: "/recipes", to: "/import" } });
  });

  it.each(["fetch", "xhr"])("%sのURLからqueryを落とす", (category) => {
    expect(
      redactBreadcrumb({
        category,
        data: { method: "GET", status_code: 200, url: "/api/recipes?q=miso&cursor=abc" },
      }),
    ).toEqual({
      category,
      data: { method: "GET", status_code: 200, url: "/api/recipes" },
    });
  });

  it("URLを持たないbreadcrumbは変えない", () => {
    const breadcrumb = { category: "ui.click", message: "button.save" };

    expect(redactBreadcrumb(breadcrumb)).toBe(breadcrumb);
  });
});

describe("initMonitoring", () => {
  afterEach(async () => {
    await Sentry.getClient()?.close();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("本番build以外では初期化せず、Reactの既定のエラー出力を変えない", () => {
    expect(initMonitoring()).toEqual({});
  });

  // `dataCollection`の既定はSDKの解釈で決まるので、設定値でなくSDKが組み立てたenvelopeを見る。
  it("本番buildでは、eventとsessionの送信元IPをSentryに推定させない", async () => {
    vi.stubEnv("PROD", true);
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@o0.ingest.sentry.io/0");
    // releaseの無いsessionはSDKが捨てる。本番では`@sentry/vite-plugin`がここに埋め込む。
    vi.stubGlobal("SENTRY_RELEASE", { id: "test-release" });
    vi.stubGlobal("fetch", async () => new Response(null));

    initMonitoring();

    const events: Sentry.ErrorEvent[] = [];
    const sessions: { attrs?: { ip_address?: string } }[] = [];
    Sentry.getClient()?.on("beforeEnvelope", ([, items]) => {
      for (const [header, payload] of items) {
        if (header.type === "event") {
          events.push(payload as Sentry.ErrorEvent);
        }
        if (header.type === "session") {
          sessions.push(payload as (typeof sessions)[number]);
        }
      }
    });

    // 例外で、eventと、errorを数えたsessionの更新が送られる。
    Sentry.captureException(new Error("boom"));
    await Sentry.flush();

    expect(events).toHaveLength(1);
    expect(events[0]?.sdk?.settings).toEqual({ infer_ip: "never" });
    expect(sessions).not.toHaveLength(0);
    for (const session of sessions) {
      expect(session.attrs?.ip_address).toBeUndefined();
    }
  });
});
