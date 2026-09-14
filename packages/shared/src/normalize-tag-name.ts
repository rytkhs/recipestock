export type NormalizedTagName = {
  name: string;
  normalizedName: string;
};

// タグ名の表示と照合を揃える。全角半角（NFKC）、前後と連続する空白、SNSの癖で付く先頭の#を吸収する。
// 大文字小文字は表示では残し、同じタグかを判定するnormalizedNameでだけ吸収する。
export const normalizeTagName = (input: string): NormalizedTagName | null => {
  const name = input
    .normalize("NFKC")
    .replace(/^[\s#]+/u, "")
    .replace(/\s+/gu, " ")
    .trim();

  if (!name) {
    return null;
  }

  return { name, normalizedName: name.toLowerCase() };
};

// 長さの上限は表示名のコードポイント数で数える。
export const countTagNameLength = (name: string) => [...name].length;
