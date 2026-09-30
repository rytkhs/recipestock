/** ショートカットで共有から取り込める端末。連携キーを発行した場所として、キーの名前にも使う。 */
export type IosDeviceName = "iPhone" | "iPad";

/**
 * 共有から取り込む方法は端末で変わる。iPhoneとiPadはショートカット、Androidはホーム画面に追加した
 * Webアプリの共有先、それ以外（PC）には共有の入口がない。
 */
export type SharePlatform =
  | { kind: "ios"; deviceName: IosDeviceName }
  | { kind: "android" }
  | { kind: "other" };

export const detectSharePlatform = (): SharePlatform => {
  const { maxTouchPoints, userAgent } = navigator;

  if (/iPhone|iPod/.test(userAgent)) {
    return { kind: "ios", deviceName: "iPhone" };
  }

  // iPadのSafariは既定でMacと同じUser-Agentを名乗る。タッチできるMacはないので、それで見分ける。
  if (/iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) {
    return { kind: "ios", deviceName: "iPad" };
  }

  if (/Android/.test(userAgent)) {
    return { kind: "android" };
  }

  return { kind: "other" };
};
