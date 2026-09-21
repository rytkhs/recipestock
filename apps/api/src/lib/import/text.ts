// 同じ内容を別マークアップから取った値どうしを比較するための正規化。
// タグが表す区切りは空白や改行として現れ方が揃わないため、空白を全て落として比べる。
export const normalizeTextForComparison = (value: string) => value.replace(/\s+/g, "");

export const normalizeMultilineText = (value: string) =>
  value
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
