import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./normalize-url";

describe("normalizeUrl", () => {
  it("removes fragment and common tracking parameters", () => {
    expect(normalizeUrl("https://example.com/recipe?utm_source=x&id=1#step")).toBe(
      "https://example.com/recipe?id=1",
    );
  });
});
