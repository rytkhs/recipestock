import { type Breadcrumb, type ErrorEvent } from "@sentry/cloudflare";
import { describe, expect, it } from "vitest";
import { createSentryOptions } from "./monitoring";

const { beforeBreadcrumb, beforeSend, dataCollection } = createSentryOptions();

describe("createSentryOptions", () => {
  it("request bodyとcookieとqueryを送らない", () => {
    expect(dataCollection).toMatchObject({
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
    });
  });

  it("eventのrequest URLからqueryとhashを落とす", () => {
    const event = beforeSend?.(
      {
        type: undefined,
        request: { url: "https://app.example.com/api/recipes?q=%E5%91%B3%E5%99%8C#top" },
      } as ErrorEvent,
      {},
    ) as ErrorEvent;

    expect(event.request?.url).toBe("https://app.example.com/api/recipes");
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
