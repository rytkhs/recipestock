/**
 * 上限を超えた文字列を末尾から落とす。長さの数え方はzodの`.max()`と同じUTF-16の単位にして、
 * 切り詰めた結果がschemaを通らない事態を避ける。サロゲートペアの片割れだけが残るときは、
 * 壊れた文字を残さずもう1つ落とす。
 */
export const truncateText = (value: string, maxLength: number) => {
  if (value.length <= maxLength) {
    return value;
  }

  const truncated = value.slice(0, maxLength);
  const lastCharCode = truncated.charCodeAt(maxLength - 1);

  return lastCharCode >= 0xd800 && lastCharCode <= 0xdbff ? truncated.slice(0, -1) : truncated;
};
