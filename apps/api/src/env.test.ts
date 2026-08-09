import { describe, expect, it } from "vitest";
import { type Bindings, collectBindingIssues, createBindingValidationGuard } from "./env";
import { createLogger, createMemoryLogSink } from "./logger";

const validEnv = {
  DATABASE_URL: "postgresql://example",
  BETTER_AUTH_URL: "https://app.example.com",
  BETTER_AUTH_SECRET: "secret",
  AUTH_EMAIL_FROM: "Recipe Stock <login@example.com>",
  RESEND_API_KEY: "re_test",
  STRIPE_SECRET_KEY: "sk_test",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  STRIPE_PRO_PRICE_ID: "price_pro",
  CLOUDFLARE_ACCOUNT_ID: "account",
  R2_BUCKET_NAME: "recipestock-images-test",
  R2_ACCESS_KEY_ID: "access-key",
  R2_SECRET_ACCESS_KEY: "secret-key",
  VAPID_PUBLIC_KEY: "public-key",
  VAPID_PRIVATE_KEY: "private-key",
  VAPID_SUBJECT: "https://github.com/rytkhs/recipestock",
} satisfies Partial<Bindings>;

const envWith = (overrides: Partial<Bindings>) => ({ ...validEnv, ...overrides });

const bindingsOf = (env: Partial<Bindings>) =>
  collectBindingIssues(env).map((issue) => issue.binding);

describe("環境bindingの検証", () => {
  /**
   * validEnvはオブジェクトbindingもAI関連の変数も持たない。それで違反ゼロになることが、
   * 必須集合をsecret運用の対象だけに絞っている確認でもある。
   */
  it("必須bindingが揃っていれば違反を返さない", () => {
    expect(collectBindingIssues(validEnv)).toEqual([]);
  });

  it("未設定・空文字・空白のみのbindingを不正として扱う", () => {
    expect(bindingsOf(envWith({ DATABASE_URL: undefined }))).toEqual(["DATABASE_URL"]);
    expect(bindingsOf(envWith({ DATABASE_URL: "" }))).toEqual(["DATABASE_URL"]);
    expect(bindingsOf(envWith({ DATABASE_URL: "   " }))).toEqual(["DATABASE_URL"]);
  });

  it("空文字のBETTER_AUTH_URLを未設定として報告する", () => {
    expect(collectBindingIssues(envWith({ BETTER_AUTH_URL: "" }))).toEqual([
      { binding: "BETTER_AUTH_URL", message: "must be set to a non-empty value" },
    ]);
  });

  it("絶対http(s) URLでないBETTER_AUTH_URLを不正として報告する", () => {
    for (const value of ["app.example.com", "/settings", "ftp://app.example.com"]) {
      expect(collectBindingIssues(envWith({ BETTER_AUTH_URL: value }))).toEqual([
        { binding: "BETTER_AUTH_URL", message: "must be an absolute http(s) URL" },
      ]);
    }
  });

  it("パスを含むBETTER_AUTH_URLは許容する", () => {
    expect(collectBindingIssues(envWith({ BETTER_AUTH_URL: "http://localhost:8787/" }))).toEqual(
      [],
    );
  });

  it("VAPID_SUBJECTはmailto:と絶対http(s) URLだけを許容する", () => {
    expect(collectBindingIssues(envWith({ VAPID_SUBJECT: "mailto:ops@example.com" }))).toEqual([]);
    expect(collectBindingIssues(envWith({ VAPID_SUBJECT: "example.com" }))).toEqual([
      {
        binding: "VAPID_SUBJECT",
        message: "must be a mailto: address or an absolute http(s) URL",
      },
    ]);
    expect(collectBindingIssues(envWith({ VAPID_SUBJECT: "mailto:" }))).toEqual([
      {
        binding: "VAPID_SUBJECT",
        message: "must be a mailto: address or an absolute http(s) URL",
      },
    ]);
  });

  it("違反を最初の1件で打ち切らずすべて返す", () => {
    expect(
      bindingsOf(envWith({ BETTER_AUTH_URL: "app.example.com", STRIPE_SECRET_KEY: "" })),
    ).toEqual(["BETTER_AUTH_URL", "STRIPE_SECRET_KEY"]);
  });
});

describe("起動時のbinding検証", () => {
  it("不正なbindingがあれば、どのbindingがなぜ不正かを示して失敗する", () => {
    const guard = createBindingValidationGuard();

    expect(() => guard(envWith({ BETTER_AUTH_URL: "app.example.com" }) as Bindings)).toThrowError(
      "Invalid environment bindings: BETTER_AUTH_URL must be an absolute http(s) URL",
    );
  });

  it("設定値ではなくbinding名だけをログに残す", () => {
    const sink = createMemoryLogSink();
    const guard = createBindingValidationGuard({
      loggerFactory: (baseFields) => createLogger(baseFields, { sink }),
    });

    expect(() => guard(envWith({ RESEND_API_KEY: "" }) as Bindings)).toThrowError();
    expect(sink.entries).toEqual([
      expect.objectContaining({
        bindings: ["RESEND_API_KEY"],
        event: "binding_validation_failed",
        level: "error",
      }),
    ]);
    expect(JSON.stringify(sink.entries)).not.toContain(validEnv.DATABASE_URL);
  });

  it("検証を通過した後は再検証しない", () => {
    const guard = createBindingValidationGuard();

    guard(validEnv as Bindings);

    expect(() => guard({} as Bindings)).not.toThrow();
  });
});
