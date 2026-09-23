import { isDatabaseUnavailableError, withoutQueryParams } from "@recipestock/db";
import * as Sentry from "@sentry/cloudflare";

type ErrorReportContext = {
  tags?: Record<string, string | number | undefined>;
  userId?: string;
};

/**
 * 利用者に失敗として見え、コードを直す必要がある例外の送り先。
 * 入力の誤り・上限・認証などの想定内の失敗はログだけに残し、ここへは渡さない。
 */
export type ErrorReporter = {
  report: (error: unknown, context?: ErrorReportContext) => void;
};

export const sentryErrorReporter: ErrorReporter = {
  report: (error, { tags = {}, userId } = {}) => {
    Sentry.withScope((scope) => {
      for (const [key, value] of Object.entries(tags)) {
        if (value !== undefined) {
          scope.setTag(key, value);
        }
      }

      if (userId) {
        scope.setUser({ id: userId });
      }

      Sentry.captureException(error);
    });
  },
};

export type CheckInReporter = (status: "ok" | "error") => void;

/**
 * cronの実行ごとに1回だけcheck-inする。届かなければSentry側でmissedになるので、
 * 実行が止まったこともこのmonitorで分かる。scheduleはWorkerに届いたcron式をそのまま使い、
 * `wrangler.jsonc`の`triggers.crons`と食い違わないようにする。
 */
export const createSentryCheckInReporter =
  ({ monitorSlug, cron }: { monitorSlug: string; cron: string }): CheckInReporter =>
  (status) => {
    Sentry.captureCheckIn(
      { monitorSlug, status },
      {
        schedule: { type: "crontab", value: cron },
        checkinMargin: 5,
        maxRuntime: 1,
        failureIssueThreshold: 1,
        recoveryThreshold: 1,
        timezone: "UTC",
      },
    );
  };

const withoutQuery = (value: string) => {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
};

const originOf = (value: string) => {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
};

/**
 * DSN・release・environmentはSDKがenvの`SENTRY_DSN`・`SENTRY_RELEASE`・`SENTRY_ENVIRONMENT`
 * から読む。DSNが無い環境（開発・テスト）では何も送らない。
 *
 * 送る内容はログと同じ線に揃える。request bodyはレシピ本文やStripeのpayloadを含み、
 * queryは検索語を含むので送らない。外部へのfetchは取り込み元のURLや署名付きURLを含むため、
 * breadcrumbにはoriginだけを残す（ログの`sourceHost`と同じ扱い）。
 * 失敗したqueryのメッセージには引数（利用者の入力やtokenのハッシュ）が入るので、例外のメッセージから除く。
 *
 * `dataCollection`は書かなかった項目を送る側の既定にするので、IPを送らない`userInfo: false`も明示する。
 * request headerは`Authorization`（iOS共有のtoken）を含むので送らない。
 * eventへのheaderの付与は`allow`で絞れず、`false`にするしかない。
 *
 * SDKはtracingを使わなくても、外部へのfetchすべてに`sentry-trace`・`baggage`を付ける。
 * `baggage`にはrelease・environment・DSNの公開鍵が入り、取り込み元のサイトにも渡る。
 * 宛先にSentryで受ける相手はいないので、どこにも付けない。
 */
export const createSentryOptions = (): Sentry.CloudflareOptions => ({
  dataCollection: {
    cookies: false,
    httpBodies: [],
    httpHeaders: false,
    urlQueryParams: false,
    userInfo: false,
  },
  tracePropagationTargets: [],
  beforeSend: (event, hint) => {
    if (event.request?.url) {
      event.request.url = withoutQuery(event.request.url);
    }

    for (const exception of event.exception?.values ?? []) {
      if (exception.value) {
        exception.value = withoutQueryParams(exception.value);
      }
    }

    // Neonに届かない障害はqueryごとに別のissueへ分かれるので、どこで起きても1つにまとめる。
    if (isDatabaseUnavailableError(hint.originalException)) {
      event.fingerprint = ["database-unavailable"];
    }

    return event;
  },
  beforeBreadcrumb: (breadcrumb) => {
    if (breadcrumb.category === "fetch" && typeof breadcrumb.data?.url === "string") {
      return { ...breadcrumb, data: { ...breadcrumb.data, url: originOf(breadcrumb.data.url) } };
    }

    return breadcrumb;
  },
});
