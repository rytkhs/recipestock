import { describe, expect, it } from "vitest";
import { extractFirstUrl } from "./extract-first-url";

describe("共有入力からのURL抽出", () => {
  it("先頭のHTTP URLだけを取り出す", () => {
    expect(extractFirstUrl("https://example.com/recipe https://example.com/other")).toBe(
      "https://example.com/recipe",
    );
  });

  it("共有テキストに埋め込まれたURLを取り出す", () => {
    expect(extractFirstUrl("この唐揚げ美味しそう https://example.com/recipe #レシピ")).toBe(
      "https://example.com/recipe",
    );
  });

  it("末尾の句読点や閉じ括弧を取り除く", () => {
    expect(extractFirstUrl("レシピはこちら→https://example.com/recipe。")).toBe(
      "https://example.com/recipe",
    );
    expect(extractFirstUrl("「https://example.com/recipe」")).toBe("https://example.com/recipe");
  });

  it("URLの一部として釣り合っている括弧は残す", () => {
    expect(extractFirstUrl("https://example.com/recipe_(2026)")).toBe(
      "https://example.com/recipe_(2026)",
    );
  });

  it("URLを含まない入力では空文字を返す", () => {
    expect(extractFirstUrl("レシピのスクリーンショットです")).toBe("");
    expect(extractFirstUrl("")).toBe("");
  });
});
