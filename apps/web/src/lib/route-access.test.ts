import { describe, expect, it } from "vitest";
import { resolveAuthRedirect } from "./route-access";

describe("resolveAuthRedirect", () => {
  it("queryとhashを含む保護ルートを返す", () => {
    expect(
      resolveAuthRedirect("/import/url?url=https%3A%2F%2Fexample.com%2Frecipes%2Ftomato#content"),
    ).toBe("/import/url?url=https%3A%2F%2Fexample.com%2Frecipes%2Ftomato#content");
  });

  it.each([
    undefined,
    "",
    "/",
    "/login",
    "https://evil.example/recipes",
    "//evil.example/recipes",
  ])("不正または未許可の値 %s はレシピ一覧へ戻す", (value) => {
    expect(resolveAuthRedirect(value)).toBe("/recipes");
  });
});
