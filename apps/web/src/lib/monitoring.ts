import * as Sentry from "@sentry/react";
import { type RootOptions } from "react-dom/client";

const stripQuery = (value: string) => value.split(/[?#]/, 1)[0];

const stripQueryOf = (value: unknown) => (typeof value === "string" ? stripQuery(value) : value);

/**
 * 一覧の絞り込みや取り込み元のURLはqueryに載るので、Sentryへ送るURLからは落とす（ADR 0021）。
 */
export const redactEvent = (event: Sentry.ErrorEvent): Sentry.ErrorEvent => {
  if (event.request?.url) {
    event.request.url = stripQuery(event.request.url);
  }

  if (event.request?.headers?.Referer) {
    event.request.headers.Referer = stripQuery(event.request.headers.Referer);
  }

  return event;
};

export const redactBreadcrumb = (breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb => {
  const { category, data } = breadcrumb;

  if (!data) {
    return breadcrumb;
  }

  if (category === "navigation") {
    return {
      ...breadcrumb,
      data: { ...data, from: stripQueryOf(data.from), to: stripQueryOf(data.to) },
    };
  }

  if (category === "fetch" || category === "xhr") {
    return { ...breadcrumb, data: { ...data, url: stripQueryOf(data.url) } };
  }

  return breadcrumb;
};

/**
 * 本番buildでDSNがあるときだけ初期化する。開発とmockでは何も送らず、Reactの既定のエラー出力も変えない。
 *
 * 送るのはブラウザで起きた予期しない例外だけにする。APIの失敗はTanStack Queryが画面で扱い、
 * 5xxはWorker側で送る。releaseはbuild時に`@sentry/vite-plugin`が埋め込む。
 */
export const initMonitoring = (): RootOptions => {
  const dsn = import.meta.env.VITE_SENTRY_DSN;

  if (!import.meta.env.PROD || !dsn) {
    return {};
  }

  Sentry.init({
    dsn,
    beforeSend: redactEvent,
    beforeBreadcrumb: redactBreadcrumb,
  });

  // TanStack Routerはroute内の描画エラーを自前のerror boundaryで受け止めるので、
  // window.onerrorには届かない。rootのhandlerで受け止めた分も送る。
  const handleError = Sentry.reactErrorHandler();

  return {
    onCaughtError: handleError,
    onRecoverableError: handleError,
    onUncaughtError: handleError,
  };
};

// 影響を受けた利用者の数を出すためにidだけを載せる。メールアドレスは送らない。
export const setMonitoringUser = (userId: string | null) => {
  Sentry.setUser(userId ? { id: userId } : null);
};
