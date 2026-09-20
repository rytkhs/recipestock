// 語彙の並びは全体を作り直して送る。呼ぶ側は動かせる行だけ押せるようにしておく。
export const moveTagTo = <T>(tags: readonly T[], fromIndex: number, toIndex: number): T[] => {
  const rest = [...tags.slice(0, fromIndex), ...tags.slice(fromIndex + 1)];

  return [...rest.slice(0, toIndex), tags[fromIndex], ...rest.slice(toIndex)];
};
