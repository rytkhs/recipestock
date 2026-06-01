import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./normalize-url";

describe("URL正規化", () => {
  it("フラグメントと代表的なトラッキングパラメータを削除する", () => {
    expect(normalizeUrl("https://example.com/recipe?utm_source=x&id=1#step")).toBe(
      "https://example.com/recipe?id=1",
    );
  });

  it("httpとhttps以外のURLは拒否する", () => {
    expect(() => normalizeUrl("ftp://example.com/recipe")).toThrow(TypeError);
  });

  it("デフォルトポートを削除する", () => {
    expect(normalizeUrl("https://example.com:443/recipe")).toBe("https://example.com/recipe");
    expect(normalizeUrl("http://example.com:80/recipe")).toBe("http://example.com/recipe");
  });
});
