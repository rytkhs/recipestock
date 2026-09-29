import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { detectSharePlatform, type IosDeviceName } from "../../pwa/platform";
import { isShortcutLinked, listShortcutCredentials, shortcutCredentialsQueryKey } from "./api";

// 一覧やメニューを開くたびに読み直さない。設定の画面は自分で読み直して、ここにも反映する。
const offerStaleTimeMs = 5 * 60 * 1000;

/**
 * 共有からの取り込みを設定するよう誘うか。`pending`は連携の状態をまだ読めていないとき。
 * 誘うかどうかで出すものが変わる場所は、その間どちらも出さない。
 */
export type ShortcutSetupOffer =
  | { status: "pending" }
  | { status: "none" }
  | { status: "offer"; deviceName: IosDeviceName };

/**
 * 誘うのはiPhoneとiPadで、アカウントにまだ使ったキーが1本もないときだけ。ショートカットはiCloudで
 * 同期されうるので、端末ごとには判定しない。連携の状態を読めるまでは誘わず、
 * 設定を済ませた人に一瞬だけ見せることをしない。
 */
export const useShortcutSetupOffer = (): ShortcutSetupOffer => {
  const [platform] = useState(detectSharePlatform);
  const isIos = platform.kind === "ios";
  const credentials = useQuery({
    queryKey: shortcutCredentialsQueryKey,
    queryFn: listShortcutCredentials,
    enabled: isIos,
    staleTime: offerStaleTimeMs,
  });

  if (platform.kind !== "ios" || credentials.isError) {
    return { status: "none" };
  }

  if (!credentials.data) {
    return { status: "pending" };
  }

  return isShortcutLinked(credentials.data.credentials)
    ? { status: "none" }
    : { status: "offer", deviceName: platform.deviceName };
};
