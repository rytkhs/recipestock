import { type NavigateOptions, useRouter } from "@tanstack/react-router";

/**
 * 画面の戻る・閉じるで、来た画面へ履歴を戻す。
 * 開いた時点で戻る先がない（URLを直接開いた、通知・Shortcut・決済から来た）ときは、親の画面に置き換える。
 * 読み込んだ最初の履歴は`canGoBack()`がfalseになるので、アプリの外や読み込み前の画面へは戻らない。
 */
export const useGoBack = (parent: NavigateOptions) => {
  const router = useRouter();

  return () => {
    if (router.history.canGoBack()) {
      router.history.back();
      return;
    }

    void router.navigate({ ...parent, replace: true });
  };
};
