import { describe, expect, it } from "vitest";
import { countTagNameLength, normalizeTagName } from "./normalize-tag-name";

describe("タグ名の正規化", () => {
  it("先頭の#と前後の空白を外す", () => {
    expect(normalizeTagName("  #作り置き ")).toEqual({
      name: "作り置き",
      normalizedName: "作り置き",
    });
    expect(normalizeTagName("＃ お弁当")).toEqual({ name: "お弁当", normalizedName: "お弁当" });
  });

  it("全角の空白を含む連続した空白を1つにまとめる", () => {
    expect(normalizeTagName("鶏肉　 おかず")?.name).toBe("鶏肉 おかず");
  });

  it("全角英数と半角カナをNFKCで揃える", () => {
    expect(normalizeTagName("ＢＢＱ")?.name).toBe("BBQ");
    expect(normalizeTagName("ﾊﾟｽﾀ")?.name).toBe("パスタ");
  });

  it("大文字小文字は表示名に残し、判定キーでだけ揃える", () => {
    expect(normalizeTagName("BBQ")).toEqual({ name: "BBQ", normalizedName: "bbq" });
    expect(normalizeTagName("#bbq")?.normalizedName).toBe("bbq");
  });

  it("空白と#だけの名前はnullにする", () => {
    expect(normalizeTagName("   ")).toBeNull();
    expect(normalizeTagName("##")).toBeNull();
  });

  it("名前の長さをコードポイント数で数える", () => {
    expect(countTagNameLength("作り置き")).toBe(4);
    expect(countTagNameLength("🍳朝ごはん")).toBe(5);
  });
});
