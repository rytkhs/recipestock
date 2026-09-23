import { type Breadcrumb, type ErrorEvent, withSentry } from "@sentry/cloudflare";
import { describe, expect, it } from "vitest";
import { createSentryOptions } from "./monitoring";

const { beforeBreadcrumb } = createSentryOptions();

describe("createSentryOptions", () => {
  // `dataCollection`の既定はSDKの解釈で決まるので、設定値でなくSDKが組み立てたeventを見る。
  it("requestの失敗を送るeventに利用者のIP・header・body・queryを載せない", async () => {
    const events: ErrorEvent[] = [];
    const pending: Promise<unknown>[] = [];
    const request = new Request(
      "https://app.example.com/api/ios-share/imports?q=%E5%91%B3%E5%99%8C#top",
      {
        method: "POST",
        headers: {
          authorization: "Bearer shortcut-token",
          "cf-connecting-ip": "203.0.113.7",
          "content-type": "application/json",
          cookie: "session=secret",
          "user-agent": "RecipeStock/1.0",
        },
        body: JSON.stringify({ url: "https://recipes.example.com/private" }),
      },
    ) as Request<unknown, IncomingRequestCfProperties>;

    const handler: ExportedHandler = {
      fetch: () => {
        throw new Error("boom");
      },
    };
    const worker = withSentry(
      () => ({
        ...createSentryOptions(),
        dsn: "https://public@o0.ingest.sentry.io/0",
        transport: () => ({
          send: async ([, items]) => {
            for (const [header, payload] of items) {
              if (header.type === "event") {
                events.push(payload as ErrorEvent);
              }
            }
            return {};
          },
          flush: async () => true,
        }),
      }),
      handler,
    );
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise);
      },
      passThroughOnException: () => undefined,
      props: {},
    } as unknown as ExecutionContext;

    await expect(worker.fetch?.(request, {}, ctx)).rejects.toThrow("boom");
    await Promise.all(pending);

    expect(events).toHaveLength(1);
    expect(events[0]?.user).toBeUndefined();
    expect(events[0]?.request).toEqual({
      method: "POST",
      url: "https://app.example.com/api/ios-share/imports",
    });
  });

  it("外部へのfetchのbreadcrumbはoriginだけを残す", () => {
    const breadcrumb = beforeBreadcrumb?.({
      category: "fetch",
      data: {
        method: "GET",
        status_code: 200,
        url: "https://recipes.example.com/private/recipe?token=secret",
      },
    } as Breadcrumb) as Breadcrumb;

    expect(breadcrumb.data).toEqual({
      method: "GET",
      status_code: 200,
      url: "https://recipes.example.com",
    });
  });

  it("fetch以外のbreadcrumbは変えない", () => {
    const breadcrumb: Breadcrumb = { category: "console", message: '{"event":"api_request"}' };

    expect(beforeBreadcrumb?.(breadcrumb)).toBe(breadcrumb);
  });
});
