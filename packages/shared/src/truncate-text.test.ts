import { describe, expect, it } from "vitest";
import { truncateText } from "./truncate-text";

describe("truncateText", () => {
  it("上限以下は保持し、超えた文字はサロゲートペアを壊さずに落とす", () => {
    expect(truncateText("トマトパスタ", 6)).toBe("トマトパスタ");
    expect(truncateText("トマトパスタ", 3)).toBe("トマト");
    expect(truncateText("a🍅b", 2)).toBe("a");
    expect(truncateText("a🍅b", 3)).toBe("a🍅");
  });
});
