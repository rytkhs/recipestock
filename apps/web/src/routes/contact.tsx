import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { LoadingStatus } from "../components/loading";
import {
  CONTACT_CATEGORIES,
  contactMessageFormSchema,
  sendContactMessage,
} from "../features/contact/contact-message";
import { useAuthSession } from "../lib/auth";
import { useAuthState } from "../lib/auth-state";

/**
 * ログインしていなくても開ける。ログインできないという問い合わせも受けるため。
 * ログイン中は、アカウントのメールアドレスを返信先に入れておく。
 */
export const ContactRoute = () => {
  const { status } = useAuthState();
  const session = useAuthSession();

  // 返信先を入れておけるかは、ログインしているかを確かめ終わるまで分からない。
  if (status === "pending") {
    return <LoadingStatus />;
  }

  return (
    <ContactForm defaultEmail={session.data?.user.email ?? ""} userId={session.data?.user.id} />
  );
};

const ContactForm = ({ defaultEmail, userId }: { defaultEmail: string; userId?: string }) => {
  const { formState, handleSubmit, register } = useForm({
    resolver: zodResolver(contactMessageFormSchema),
    defaultValues: { category: "", email: defaultEmail, message: "" },
  });
  const { errors, isSubmitting } = formState;
  const categoryId = useId();
  const categoryErrorId = useId();
  const emailId = useId();
  const emailErrorId = useId();
  const messageId = useId();
  const messageErrorId = useId();
  const sentHeadingRef = useRef<HTMLHeadingElement>(null);
  // 返信先。入っているあいだは、フォームの代わりに送信済みの知らせを出す。
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const submit = handleSubmit(async (message) => {
    setSendError(null);

    try {
      await sendContactMessage(message, { userId });
      // フォームが消えるので、読み上げとキーボードの位置を送信済みの知らせへ移す。
      flushSync(() => setSentTo(message.email));
      sentHeadingRef.current?.focus();
    } catch {
      setSendError("送信できませんでした。時間をおいて再度お試しください。");
    }
  });

  return (
    <section className="mx-auto w-full max-w-xl px-4 py-10">
      <h1 className="font-bold text-2xl text-brand-ink">お問い合わせ</h1>

      {sentTo ? (
        <div className="mt-6 rounded-[20px] border border-brand-sage-soft bg-brand-sage-soft/30 p-5 sm:p-6">
          <h2
            className="font-semibold text-brand-ink outline-none"
            ref={sentHeadingRef}
            tabIndex={-1}
          >
            送信しました
          </h2>
          <p className="mt-2 text-brand-walnut text-sm leading-6">
            内容を確認し、必要に応じて次のメールアドレスへ返信します。
          </p>
          <p className="mt-2 break-all font-semibold text-brand-ink">{sentTo}</p>
        </div>
      ) : (
        <>
          <p className="mt-2 text-brand-muted text-sm leading-6">
            Recipe Stockへのご質問や不具合のご報告を受け付けています。
          </p>
          <div className="mt-6 min-w-0 rounded-[20px] border border-brand-line-soft bg-brand-paper p-5 shadow-pantry-sm sm:p-6">
            <form
              className="grid min-w-0 gap-4"
              noValidate
              onSubmit={(event) => void submit(event)}
            >
              <FieldGroup>
                <Field className="min-w-0" data-invalid={errors.category ? true : undefined}>
                  <FieldLabel htmlFor={categoryId}>種別</FieldLabel>
                  <NativeSelect
                    aria-describedby={errors.category ? categoryErrorId : undefined}
                    aria-invalid={errors.category ? true : undefined}
                    // 選択肢の文字が16pxより小さいと、iPhoneは選ぶときに画面を拡大する。入力欄と同じ大きさにそろえる。
                    className="w-full [&_select]:text-base md:[&_select]:text-sm"
                    id={categoryId}
                    {...register("category")}
                  >
                    <NativeSelectOption disabled value="">
                      選んでください
                    </NativeSelectOption>
                    {CONTACT_CATEGORIES.map((category) => (
                      <NativeSelectOption key={category} value={category}>
                        {category}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <FieldError errors={[errors.category]} id={categoryErrorId} />
                </Field>

                <Field className="min-w-0" data-invalid={errors.email ? true : undefined}>
                  <FieldLabel htmlFor={emailId}>返信先のメールアドレス</FieldLabel>
                  <Input
                    aria-describedby={errors.email ? emailErrorId : undefined}
                    aria-invalid={errors.email ? true : undefined}
                    autoComplete="email"
                    id={emailId}
                    inputMode="email"
                    type="email"
                    {...register("email")}
                  />
                  <FieldError errors={[errors.email]} id={emailErrorId} />
                </Field>

                <Field className="min-w-0" data-invalid={errors.message ? true : undefined}>
                  <FieldLabel htmlFor={messageId}>内容</FieldLabel>
                  <Textarea
                    aria-describedby={errors.message ? messageErrorId : undefined}
                    aria-invalid={errors.message ? true : undefined}
                    className="min-h-48"
                    id={messageId}
                    {...register("message")}
                  />
                  <FieldError errors={[errors.message]} id={messageErrorId} />
                </Field>
              </FieldGroup>

              <Button
                className="w-full sm:w-auto sm:justify-self-start"
                disabled={isSubmitting}
                size="lg"
                type="submit"
              >
                送信する
              </Button>
            </form>

            {sendError ? (
              <div className="mt-4 rounded-[14px] border border-brand-danger/20 bg-brand-danger/5 p-3">
                <p className="break-words text-brand-danger text-sm" role="alert">
                  {sendError}
                </p>
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
};
