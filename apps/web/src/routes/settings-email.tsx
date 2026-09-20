import { EMAIL_CHANGE_LINK_EXPIRES_IN_HOURS } from "@recipestock/shared";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import {
  type FormEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ConnectionUnavailable } from "../components/connection-unavailable";
import { SettingsPageSkeleton } from "../components/loading";
import { SectionHeader } from "../components/section-header";
import { useLoginMethods } from "../features/settings/login-methods";
import {
  SettingsFormMessage,
  SettingsNotice,
  SettingsSubpageTopBar,
  settingsPageBodyClass,
  settingsPageClass,
} from "../features/settings/settings-page";
import { changeEmail, useAuthSession } from "../lib/auth";

const emailRouteApi = getRouteApi("/_protected/settings/email");

const changeDescription =
  "確認メールを送ります。メール内のリンクを開くまで、メールアドレスは今のままです。";

const googleDescription =
  "Googleアカウントのメールアドレスは変わりません。Googleでのログインは今までどおり使えます。";

type SettingsEmailSearch = ReturnType<typeof emailRouteApi.useSearch>;

/**
 * 確認メールのリンクから戻ったときに、どうなったかを伝える。
 * リンクを開けなかったときは何も変わっていないので、どの失敗でも今のままだと言う。
 */
const VerifyLinkNotice = ({ arrival }: { arrival: SettingsEmailSearch }) => {
  if (arrival.from !== "verify-link") {
    return null;
  }

  if (!arrival.error) {
    return (
      <SettingsNotice title="メールアドレスを変更しました" tone="success">
        次からは、このメールアドレスでログインしてください。
      </SettingsNotice>
    );
  }

  // エラーコードはbetter-authのもの。
  if (arrival.error === "TOKEN_EXPIRED") {
    return (
      <SettingsNotice title="確認リンクの有効期限が切れていました" tone="warning">
        メールアドレスは変わっていません。もう一度、確認メールを送ってください。
      </SettingsNotice>
    );
  }

  // リンクを送ったのとは別のアカウントで、このブラウザにログインしている。
  if (arrival.error === "INVALID_USER") {
    return (
      <SettingsNotice title="別のアカウントでログインしています" tone="warning">
        メールアドレスは変わっていません。変更したいアカウントでログインし直してから、リンクをもう一度開いてください。
      </SettingsNotice>
    );
  }

  return (
    <SettingsNotice title="確認リンクを使えませんでした" tone="warning">
      メールアドレスは変わっていません。もう一度、確認メールを送ってください。
    </SettingsNotice>
  );
};

const CurrentEmailSection = ({ children, email }: { children?: ReactNode; email: string }) => {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId}>
      <SectionHeader id={headingId} title="今のメールアドレス" />
      <p className="mt-4 break-all font-semibold text-brand-ink text-lg">{email}</p>
      {children}
    </section>
  );
};

/**
 * 送った先を大きく見せて、打ち間違いに気づけるようにする。
 * 送った先はサーバーに残らないので、開き直すとこの表示は消える。
 */
const SentNotice = ({
  address,
  headingRef,
  onResend,
}: {
  address: string;
  headingRef: Ref<HTMLHeadingElement>;
  onResend: () => void;
}) => (
  <div className="mt-4 grid gap-5">
    <div className="rounded-[14px] border border-brand-sage-soft bg-brand-sage-soft/30 p-4">
      <h3
        className="font-semibold text-brand-ink text-sm outline-none"
        ref={headingRef}
        tabIndex={-1}
      >
        確認メールを送りました
      </h3>
      <p className="mt-2 break-all font-semibold text-base text-brand-ink">{address}</p>
      <p className="mt-2 text-brand-walnut text-sm leading-6">
        {`${EMAIL_CHANGE_LINK_EXPIRES_IN_HOURS}時間以内に、メールのリンクを開いてください。`}
        <span className="block">それまでは、今のメールアドレスのままです。</span>
      </p>
    </div>

    <div>
      <p className="font-medium text-brand-ink text-sm">届かないとき</p>
      <ul className="mt-1 list-disc pl-5 text-brand-muted text-sm leading-6">
        <li>迷惑メールのフォルダも確認してください。</li>
        <li>アドレスが違っていたら、送り直してください。</li>
        {/* better-authは、ほかのアカウントのアドレスでも成功を返して送らない。持ち主を明かさないため。 */}
        <li>ほかのアカウントのアドレスには届きません。</li>
      </ul>
      <Button className="mt-4" type="button" variant="outline" onClick={onResend}>
        送り直す
      </Button>
    </div>
  </div>
);

export const SettingsEmailRoute = () => {
  const navigate = useNavigate();
  const search = emailRouteApi.useSearch();
  // 戻った理由は開いたときに一度だけ読んで持ち、URLからは消す。再読み込みで古いお知らせを出さない。
  const [arrival] = useState(search);
  const hasArrivalParams = Boolean(search.from || search.error);
  const session = useAuthSession();
  const loginMethods = useLoginMethods();
  const currentEmail = session.data?.user.email ?? "";
  const [newEmail, setNewEmail] = useState("");
  const changeHeadingId = useId();
  const newEmailId = useId();
  const newEmailDescriptionId = useId();
  const newEmailErrorId = useId();
  const newEmailRef = useRef<HTMLInputElement>(null);
  const sentHeadingRef = useRef<HTMLHeadingElement>(null);
  // 送った先。入っているあいだは、フォームの代わりに確認待ちを出す。
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (hasArrivalParams) {
      void navigate({ to: "/settings/email", search: {}, replace: true });
    }
  }, [hasArrivalParams, navigate]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFieldError(null);
    setFormError(null);

    const requestedEmail = newEmail.trim();

    // 同じアドレスはサーバでも断られるが、理由が返らない。ここで止めて、何が起きたかを伝える。
    if (requestedEmail.toLowerCase() === currentEmail.toLowerCase()) {
      setFieldError("今のメールアドレスと同じです。");
      return;
    }

    setIsSubmitting(true);

    try {
      await changeEmail(requestedEmail);
      // フォームが消えるので、読み上げとキーボードの位置を確認待ちへ移す。
      flushSync(() => setSentTo(requestedEmail));
      sentHeadingRef.current?.focus();
    } catch {
      setFormError("メールアドレスを変更できませんでした。時間をおいて再度お試しください。");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 送った先を入れたままフォームに戻す。直して送るのも、そのまま送り直すのも同じ操作で済む。
  const returnToForm = () => {
    flushSync(() => setSentTo(null));
    newEmailRef.current?.focus();
  };

  const topBar = <SettingsSubpageTopBar title="メールアドレス" />;

  // パスワードを持つ人かどうかで出すものが変わるので、この画面はログイン方法を待つ。
  if (loginMethods.isPending) {
    return <SettingsPageSkeleton />;
  }

  if (!loginMethods.data) {
    return (
      <section className={settingsPageClass}>
        {topBar}
        <ConnectionUnavailable
          isRetrying={loginMethods.isFetching}
          onRetry={async () => {
            await loginMethods.refetch();
          }}
        />
      </section>
    );
  }

  // Googleだけの人はメールアドレスをログインに使わない。Googleから写したアドレスが、
  // どのGoogleアカウントで入ったかの手がかりになるので、変えるフォームは出さない。
  if (!loginMethods.data.hasPassword) {
    return (
      <section className={settingsPageClass}>
        {topBar}
        <div className={`${settingsPageBodyClass} grid gap-10`}>
          <CurrentEmailSection email={currentEmail}>
            <p className="mt-3 text-brand-muted text-sm leading-6">
              このアカウントはGoogleでログインしています。メールアドレスはGoogleアカウントのものを使うため、ここでは変更できません。
            </p>
          </CurrentEmailSection>
        </div>
      </section>
    );
  }

  return (
    <section className={settingsPageClass}>
      {topBar}

      <div className={`${settingsPageBodyClass} grid gap-10`}>
        <VerifyLinkNotice arrival={arrival} />

        <CurrentEmailSection email={currentEmail} />

        <section aria-labelledby={changeHeadingId}>
          <SectionHeader id={changeHeadingId} title="変更する" />
          {sentTo ? (
            <SentNotice address={sentTo} headingRef={sentHeadingRef} onResend={returnToForm} />
          ) : (
            <form className="mt-4 grid min-w-0 gap-4" onSubmit={handleSubmit}>
              <FieldGroup>
                <Field className="min-w-0" data-invalid={fieldError ? true : undefined}>
                  <FieldLabel htmlFor={newEmailId}>新しいメールアドレス</FieldLabel>
                  <Input
                    aria-describedby={
                      fieldError
                        ? `${newEmailErrorId} ${newEmailDescriptionId}`
                        : newEmailDescriptionId
                    }
                    aria-invalid={fieldError ? true : undefined}
                    autoComplete="email"
                    id={newEmailId}
                    inputMode="email"
                    ref={newEmailRef}
                    required
                    type="email"
                    value={newEmail}
                    onChange={(event) => {
                      setNewEmail(event.target.value);
                      setFieldError(null);
                    }}
                  />
                  {fieldError ? <FieldError id={newEmailErrorId}>{fieldError}</FieldError> : null}
                  <FieldDescription id={newEmailDescriptionId}>
                    {changeDescription}
                    {loginMethods.data.hasGoogle ? (
                      <span className="mt-1 block">{googleDescription}</span>
                    ) : null}
                  </FieldDescription>
                </Field>
              </FieldGroup>
              <Button
                className="w-full sm:w-auto sm:justify-self-start"
                disabled={isSubmitting}
                size="lg"
                type="submit"
              >
                確認メールを送信
              </Button>
              {formError ? (
                <SettingsFormMessage tone="error">{formError}</SettingsFormMessage>
              ) : null}
            </form>
          )}
        </section>
      </div>
    </section>
  );
};
