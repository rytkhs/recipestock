import { decodeHTML, decodeHTMLAttribute } from "entities/decode";

// 同じ内容を別マークアップから取った値どうしを比較するための正規化。
// タグが表す区切りは空白や改行として現れ方が揃わないため、空白を全て落として比べる。
export const normalizeTextForComparison = (value: string) => value.replace(/\s+/g, "");

// 全角スペースは作者が書いた文字なので文中のものは残し、行の両端のものは落とす。
export const normalizeSingleLineText = (value: string) =>
  value.replace(/[^\S\u3000]+/g, " ").trim();

export const normalizeMultilineText = (value: string) =>
  value
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n\u3000]+/g, " ")
    .replace(/[ \u3000]*\n[ \u3000]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// HTMLRewriterや正規表現で読んだ生の値の文字参照を、HTMLの仕様どおりに戻す（parse5と同じデコーダ）。
// 本文と属性値では規則が違う。属性値では`?a=1&copy=2`の`&copy`を戻さない。
// NULとサロゲートはU+FFFDになるので、戻した値はjsonbに保存できる。
export const decodeHtmlText = (value: string) => decodeHTML(value);

export const decodeHtmlAttribute = (value: string) => decodeHTMLAttribute(value);
