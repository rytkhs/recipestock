/**
 * 連携キーの発行を待ってから書き込むと、Safariはタップによるコピーと見なさず断る。
 * 中身をPromiseのまま渡し、タップの処理の中でクリップボードへの書き込みを始める。
 * 設定の手順を出すのはiPhoneとiPadだけで、どちらのSafariも`ClipboardItem`を持つ。
 * 書けたかどうかを返す。書けなければ、画面にキーを出して選んでもらう。
 */
export const copyTextToClipboard = async (text: Promise<string> | string) => {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": Promise.resolve(text).then(
          (value) => new Blob([value], { type: "text/plain" }),
        ),
      }),
    ]);
    return true;
  } catch {
    return false;
  }
};
