/// <reference types="@cloudflare/workers-types" />

import { createLogger, type LoggerFactory } from "./logger";
import { type YtDlpMetadataContainer } from "./ytdlp-metadata-container";

export type BrowserRunBinding = {
  quickAction(
    action: "content",
    options: {
      url: string;
      gotoOptions: {
        timeout: number;
        waitUntil: "networkidle2";
      };
      userAgent: string;
    },
  ): Promise<Response>;
};

export type Bindings = {
  AI: Ai;
  APP_ENV: "development" | "staging" | "production";
  ASSETS: Fetcher;
  BROWSER: BrowserRunBinding;
  IMPORT_QUEUE: Queue<{ jobId: string }>;
  SHORTCUT_CLIENT_RATE_LIMITER: RateLimit;
  SHORTCUT_RATE_LIMITER: RateLimit;
  YTDLP_METADATA_CONTAINER: DurableObjectNamespace<YtDlpMetadataContainer>;
  DATABASE_URL: string;
  BETTER_AUTH_URL: string;
  RECIPE_IMAGES: R2Bucket;
  BETTER_AUTH_SECRET: string;
  AUTH_EMAIL_FROM: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRO_PRICE_ID: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  AI_GATEWAY_NAME: string;
  CF_AIG_TOKEN?: string;
  AI_TEXT_MODEL: string;
  AI_VISION_MODEL: string;
  IMPORT_FETCH_MODE?: string;
  IMPORT_AI_PROVIDER?: string;
  GROQ_API_KEY?: string;
  GROQ_TEXT_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_TEXT_MODEL?: string;
  YOUTUBE_DATA_API_KEY?: string;
  FREE_AI_MONTHLY_LIMIT?: string;
  PRO_AI_MONTHLY_LIMIT?: string;
  IMPORT_TIMEOUT_MS: string;
  IMPORT_JOB_TIMEOUT_MS?: string;
  IMPORT_MAX_HTML_BYTES: string;
  IMPORT_AI_TIMEOUT_MS: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
};

type StringBindingName = {
  [Name in keyof Bindings]-?: string extends Bindings[Name] ? Name : never;
}[keyof Bindings];

export type BindingIssue = {
  binding: StringBindingName;
  message: string;
};

type RequiredBinding = {
  name: StringBindingName;
  format?: {
    isValid: (value: string) => boolean;
    requirement: string;
  };
};

const isAbsoluteHttpUrl = (value: string) => {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const isWebPushSubject = (value: string) =>
  value.startsWith("mailto:")
    ? value.slice("mailto:".length).trim() !== ""
    : isAbsoluteHttpUrl(value);

/**
 * runtimeが形式を前提にしているbindingと、欠けていれば機能が成立しないbindingを列挙する。
 *
 * オブジェクトbinding（R2、Queue、AI等）は`wrangler.jsonc`が真実の源であり、欠落は
 * プラットフォーム側の起動失敗になるためここでは扱わない。AI関連の変数も、必要な組が
 * `IMPORT_AI_PROVIDER`で変わり、未設定はimport jobの失敗として扱われる設計なので、
 * ここで必須化してAPI全体の停止に格上げしない。
 */
const requiredBindings: readonly RequiredBinding[] = [
  { name: "DATABASE_URL" },
  /**
   * 空文字が最も危険な値である。better-authは空文字をfalsyとして扱いリクエストURLへ
   * フォールバックするため認証は動き続ける一方、`new URL(path, "")`は例外を投げる。
   * 空文字と絶対URLの両方を見ないと、この非対称な壊れ方を捕まえられない。
   */
  {
    name: "BETTER_AUTH_URL",
    format: {
      isValid: isAbsoluteHttpUrl,
      requirement: "must be an absolute http(s) URL",
    },
  },
  { name: "BETTER_AUTH_SECRET" },
  { name: "AUTH_EMAIL_FROM" },
  { name: "RESEND_API_KEY" },
  { name: "STRIPE_SECRET_KEY" },
  { name: "STRIPE_WEBHOOK_SECRET" },
  { name: "STRIPE_PRO_PRICE_ID" },
  { name: "CLOUDFLARE_ACCOUNT_ID" },
  { name: "R2_BUCKET_NAME" },
  { name: "R2_ACCESS_KEY_ID" },
  { name: "R2_SECRET_ACCESS_KEY" },
  { name: "VAPID_PUBLIC_KEY" },
  { name: "VAPID_PRIVATE_KEY" },
  /**
   * web-pushはsubjectが`mailto:`かhttp(s) URLであることを要求する。送信はbest-effortで
   * 握られるため、不正な値は「通知だけが静かに届かない」形で現れる。
   */
  {
    name: "VAPID_SUBJECT",
    format: {
      isValid: isWebPushSubject,
      requirement: "must be a mailto: address or an absolute http(s) URL",
    },
  },
];

/**
 * 最初の1件で打ち切らない。設定ミスは複数同時に起きるため、1回の失敗で全件を示す。
 */
export const collectBindingIssues = (env: Partial<Bindings>): BindingIssue[] =>
  requiredBindings.flatMap(({ name, format }) => {
    const value = env[name];

    if (typeof value !== "string" || value.trim() === "") {
      return [{ binding: name, message: "must be set to a non-empty value" }];
    }

    if (format && !format.isValid(value.trim())) {
      return [{ binding: name, message: format.requirement }];
    }

    return [];
  });

/**
 * Workersにはアプリケーションの起動フックがないため、workerのエントリで最初に
 * 到達したリクエストが検証を担い、以降はisolateが生きている間くり返さない。
 *
 * ログとエラーにはbinding名と違反したルールだけを載せる。設定値そのものは出さない。
 */
export const createBindingValidationGuard = ({
  loggerFactory = createLogger,
}: {
  loggerFactory?: LoggerFactory;
} = {}) => {
  let validated = false;

  return (env: Bindings) => {
    if (validated) {
      return;
    }

    const issues = collectBindingIssues(env);

    if (issues.length > 0) {
      loggerFactory().error("binding_validation_failed", { issues });

      throw new Error(
        `Invalid environment bindings: ${issues
          .map((issue) => `${issue.binding} ${issue.message}`)
          .join("; ")}`,
      );
    }

    validated = true;
  };
};
