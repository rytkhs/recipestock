// 内容から作ったキーに、同じ内容が何番目に出てきたかを足す。
// 材料や手順は同じ行が並ぶことがあるので、Reactのkeyを区別するのに使う。
export const withOccurrenceKeys = <T>(items: readonly T[], toBaseKey: (item: T) => string) => {
  const seen = new Map<string, number>();

  return items.map((item) => {
    const baseKey = toBaseKey(item);
    const occurrence = seen.get(baseKey) ?? 0;

    seen.set(baseKey, occurrence + 1);
    return { item, key: `${baseKey}#${occurrence}` };
  });
};
