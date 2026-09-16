import { describe, expect, it } from "vitest";
import { truncateText } from "./truncate-text";

describe("truncateText", () => {
  it("上限以下の文字列はそのまま返す", () => {
    expect(truncateText("トマトパスタ", 6)).toBe("トマトパスタ");
  });

  it("上限を超えた分を末尾から落とす", () => {
    expect(truncateText("トマトパスタ", 3)).toBe("トマト");
  });

  it("サロゲートペアを途中で切らない", () => {
    // 🍅は2単位なので、3単位で切ると片割れだけが残る。
    expect(truncateText("a🍅b", 2)).toBe("a");
    expect(truncateText("a🍅b", 3)).toBe("a🍅");
  });
});
