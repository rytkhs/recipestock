import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./normalize-url";

describe("URL正規化", () => {
  it("フラグメントと代表的なトラッキングパラメータを削除する", () => {
    expect(normalizeUrl("https://example.com/recipe?utm_source=x&id=1#step")).toBe(
      "https://example.com/recipe?id=1",
    );
  });
});
