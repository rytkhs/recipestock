/**
 * 連携キーの発行を待ってから書き込むと、Safariはタップによるコピーと見なさず断る。
 * 中身をPromiseのまま渡し、タップの処理の中でクリップボードへの書き込みを始める。
 * 設定の手順を出すのはiPhoneとiPadだけで、どちらのSafariも`ClipboardItem`を持つ。
 * 書けたかどうかを返す。書けなければ、画面にキーを出して選んでもらう。
 */
export const copyTextToClipboard = async (text: Promise<string> | string) => {
  const blob = Promise.resolve(text).then((value) => new Blob([value], { type: "text/plain" }));

  try {
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
    return true;
  } catch {
    // 書き込みを始める前に失敗したときは、発行の失敗を受け取る先がない。未処理の拒否にしない。
    blob.catch(() => {});
    return false;
  }
};
