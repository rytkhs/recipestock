import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { detectSharePlatform, type IosDeviceName } from "../../pwa/platform";
import { isShortcutLinked, listShortcutCredentials, shortcutCredentialsQueryKey } from "./api";

// 一覧やメニューを開くたびに読み直さない。設定の画面は自分で読み直して、ここにも反映する。
const offerStaleTimeMs = 5 * 60 * 1000;

// 画面と、一覧を開くときに先に取りに行くrouterのloaderで同じものを使う。
const shortcutSetupOfferQueryOptions = queryOptions({
  queryKey: shortcutCredentialsQueryKey,
  queryFn: listShortcutCredentials,
  staleTime: offerStaleTimeMs,
});

/**
 * 一覧を開くときに、レシピの一覧と並べて連携の状態を取り始める。画面が出てから取り始めると、
 * 空の一覧に始め方が出るのが遅れ、レシピがある一覧では誘いが遅れて差し込まれてカードを押し下げる。
 */
export const prefetchShortcutSetupOffer = (queryClient: QueryClient) => {
  if (detectSharePlatform().kind === "ios") {
    void queryClient.prefetchQuery(shortcutSetupOfferQueryOptions);
  }
};

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
  const credentials = useQuery({
    ...shortcutSetupOfferQueryOptions,
    enabled: platform.kind === "ios",
    // 共有はアプリの外で起きる。連携できたらすぐ誘いを消せるよう、連携するまではアプリへ戻るたびに読み直す。
    refetchOnWindowFocus: ({ state }) =>
      state.data && isShortcutLinked(state.data.credentials) ? true : "always",
  });

  if (platform.kind !== "ios") {
    return { status: "none" };
  }

  // 一度読めたあとは、読み直しに失敗しても読めた一覧で決める。出していた誘いや始め方を入れ替えない。
  if (credentials.data) {
    return isShortcutLinked(credentials.data.credentials)
      ? { status: "none" }
      : { status: "offer", deviceName: platform.deviceName };
  }

  // 読めなかったら誘わない。この画面を出してから一度そう決めたら、読み直している間も変えず、出した始め方を消さない。
  // 読み直しが始まるとstatusはpendingへ戻るので、isErrorでは見分けられない。画面を出す前の失敗
  // （ログイン前の先読みの401など）は引き継がず、読み直しの結果を待つ。
  return credentials.isFetchedAfterMount ? { status: "none" } : { status: "pending" };
};
