import { type ErrorEvent } from "@sentry/react";
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
    } as ErrorEvent);

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
  it("本番build以外では初期化せず、Reactの既定のエラー出力を変えない", () => {
    expect(initMonitoring()).toEqual({});
  });
});
