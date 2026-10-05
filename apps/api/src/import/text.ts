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

// 名前付きの文字参照は、ここにある6種類だけを戻す。すべてを仕様どおりに戻す方法は #177 で決める。
const NAMED_HTML_ENTITIES = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["nbsp", " "],
  ["quot", '"'],
]);

// NULとサロゲートはjsonbに保存できないので、数値参照のまま残す。
const isStorableCodePoint = (codePoint: number) =>
  codePoint > 0 && codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff);

export const decodeHtmlEntities = (value: string) =>
  value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (!body.startsWith("#")) return NAMED_HTML_ENTITIES.get(body) ?? entity;

    const codePoint =
      body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
    return isStorableCodePoint(codePoint) ? String.fromCodePoint(codePoint) : entity;
  });
