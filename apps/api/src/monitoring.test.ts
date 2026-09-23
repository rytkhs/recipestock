import { NeonDbError } from "@neondatabase/serverless";
import { type Breadcrumb, type ErrorEvent, withSentry } from "@sentry/cloudflare";
import { DrizzleQueryError } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createSentryOptions } from "./monitoring";

const { beforeBreadcrumb } = createSentryOptions();

// SDKはisolateで最初に初期化したときのfetchを1度だけ包み、nativeでないfetchは包まない
// （@sentry/core 10.75.1の`supportsNativeFetch`）。初期化より先にnativeに見せたfetchへ差し替え、
// SDKが外部へのfetchに付けたheaderをここで受け取る。
const outgoingRequests: Request[] = [];

beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    Object.assign(
      async (...args: ConstructorParameters<typeof Request>) => {
        outgoingRequests.push(new Request(...args));
        return new Response(null);
      },
      { toString: () => "function fetch() { [native code] }" },
    ),
  );
});

const createTestWorker = (handler: ExportedHandler, events: ErrorEvent[]) =>
  withSentry(
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

const createTestContext = (pending: Promise<unknown>[]) =>
  ({
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
    passThroughOnException: () => undefined,
    props: {},
  }) as unknown as ExecutionContext;

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
    const worker = createTestWorker(handler, events);

    await expect(worker.fetch?.(request, {}, createTestContext(pending))).rejects.toThrow("boom");
    await Promise.all(pending);

    expect(events).toHaveLength(1);
    expect(events[0]?.user).toBeUndefined();
    expect(events[0]?.request).toEqual({
      method: "POST",
      url: "https://app.example.com/api/ios-share/imports",
    });
  });

  it("失敗したqueryの引数を送らず、Neonに届かない障害は1つのissueにまとめる", async () => {
    const events: ErrorEvent[] = [];
    const pending: Promise<unknown>[] = [];
    const request = new Request("https://app.example.com/api/tags") as Request<
      unknown,
      IncomingRequestCfProperties
    >;
    const handler: ExportedHandler = {
      fetch: () => {
        throw new DrizzleQueryError(
          "select id from shortcut_credentials where token_hash = $1",
          ["token-hash"],
          new NeonDbError("Server error (HTTP status 520): error code: 520"),
        );
      },
    };
    const worker = createTestWorker(handler, events);

    await expect(worker.fetch?.(request, {}, createTestContext(pending))).rejects.toThrow(
      "Failed query",
    );
    await Promise.all(pending);

    expect(events).toHaveLength(1);
    expect(events[0]?.exception?.values?.map((exception) => exception.value)).toEqual([
      "Server error (HTTP status 520): error code: 520",
      "Failed query: select id from shortcut_credentials where token_hash = $1",
    ]);
    expect(JSON.stringify(events[0])).not.toContain("token-hash");
    expect(events[0]?.fingerprint).toEqual(["database-unavailable"]);
  });

  it("SQLの誤りは呼び出した場所ごとのissueのままにする", async () => {
    const events: ErrorEvent[] = [];
    const pending: Promise<unknown>[] = [];
    const request = new Request("https://app.example.com/api/tags") as Request<
      unknown,
      IncomingRequestCfProperties
    >;
    const handler: ExportedHandler = {
      fetch: () => {
        throw new DrizzleQueryError(
          "select missing from tags",
          [],
          new NeonDbError("column does not exist"),
        );
      },
    };
    const worker = createTestWorker(handler, events);

    await expect(worker.fetch?.(request, {}, createTestContext(pending))).rejects.toThrow(
      "Failed query",
    );
    await Promise.all(pending);

    expect(events[0]?.fingerprint).toBeUndefined();
  });

  it("外部へのfetchにtraceのheaderを付けない", async () => {
    const events: ErrorEvent[] = [];
    const pending: Promise<unknown>[] = [];
    const request = new Request("https://app.example.com/api/import/url", {
      method: "POST",
    }) as Request<unknown, IncomingRequestCfProperties>;

    const handler: ExportedHandler = {
      fetch: async () => {
        await fetch("https://recipes.example.com/recipe");
        throw new Error("boom");
      },
    };
    const worker = createTestWorker(handler, events);
    outgoingRequests.length = 0;

    await expect(worker.fetch?.(request, {}, createTestContext(pending))).rejects.toThrow("boom");
    await Promise.all(pending);

    // breadcrumbが残っていれば、SDKがこのfetchを包んだうえで通したことになる。
    expect(events[0]?.breadcrumbs).toContainEqual(
      expect.objectContaining({
        category: "fetch",
        data: expect.objectContaining({ url: "https://recipes.example.com" }),
      }),
    );
    expect(outgoingRequests).toHaveLength(1);
    expect(outgoingRequests[0]?.headers.has("sentry-trace")).toBe(false);
    expect(outgoingRequests[0]?.headers.has("baggage")).toBe(false);
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
