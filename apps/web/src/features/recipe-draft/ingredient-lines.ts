export type PastedIngredient = {
  name: string;
  amount: string;
};

// 行頭の記号や番号。「・鶏むね肉」「1. 卵」など。
const leadingMarkerPattern = /^(?:[・･●○◯◎◆◇■□★☆※•*＊\-－]+\s*|\d{1,2}[.．)）]\s+)/u;

// 名前と分量のあいだに置かれる、はっきりした区切り。「…」「：」、タブ、全角空白、2つ以上の空白。
const separatorPattern = /\s*(?:…+|‥+|・{2,}|\.{3,}|[:：])\s*|\t+|　+|\s{2,}/u;

// 半角空白1つで分けるのは、後ろが分量らしく始まるときだけ。「A しょうゆ 大さじ2」「鶏もも肉 1枚 (300g)」
const amountStartPattern =
  /^(?:[0-9０-９½⅓⅔¼¾]|大さじ|小さじ|大匙|小匙|カップ|少々|少量|適量|適宜|お好み|ひとつまみ|ひとかけ|半分|約|各)/u;

const splitIngredientLine = (line: string): PastedIngredient => {
  const separator = separatorPattern.exec(line);

  if (separator && separator.index > 0) {
    const amount = line.slice(separator.index + separator[0].length).trim();

    if (amount) {
      return { name: line.slice(0, separator.index).trim(), amount };
    }
  }

  for (const space of line.matchAll(/ +/gu)) {
    const amount = line.slice(space.index + space[0].length);

    if (amountStartPattern.test(amount)) {
      return { name: line.slice(0, space.index).trim(), amount: amount.trim() };
    }
  }

  return { name: line, amount: "" };
};

// 材料名の欄に複数行を貼り付けたとき、1行を1つの材料にする。分量は区切りが読み取れるときだけ分ける。
export const parsePastedIngredients = (text: string): PastedIngredient[] =>
  text
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(leadingMarkerPattern, "").trim())
    .filter((line) => line.length > 0)
    .map(splitIngredientLine);
