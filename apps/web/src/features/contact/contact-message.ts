import { z } from "zod";

export const CONTACT_MESSAGE_MAX_LENGTH = 2000;

// 選んだ文言のまま通知メールに載る。
export const CONTACT_CATEGORIES = [
  "不具合",
  "プラン・支払い",
  "アカウント・ログイン",
  "その他",
] as const;

const characterCount = new Intl.NumberFormat("ja-JP");

export const contactMessageFormSchema = z.object({
  // 選ぶ前は空文字で持つ。
  category: z.string().pipe(z.enum(CONTACT_CATEGORIES, "種別を選んでください")),
  email: z.string().trim().pipe(z.email("メールアドレスを正しく入力してください")),
  message: z
    .string()
    .trim()
    .min(1, "内容を入力してください")
    .max(
      CONTACT_MESSAGE_MAX_LENGTH,
      `内容は${characterCount.format(CONTACT_MESSAGE_MAX_LENGTH)}文字までです。`,
    ),
});

export type ContactMessageFormValues = z.input<typeof contactMessageFormSchema>;
export type ContactMessage = z.output<typeof contactMessageFormSchema>;

/**
 * 問い合わせはSSGformへ送り、運営のメールに届けてもらう。返信はそのメールから行う。
 * SSGformは受け付けたときだけ200を返す。月の上限に達したときや、許可していないホストからの送信は受け付けない。
 */
export const sendContactMessage = async (
  message: ContactMessage,
  { userId }: { userId: string | undefined },
) => {
  const endpoint = import.meta.env.VITE_CONTACT_FORM_URL;

  if (!endpoint) {
    throw new Error("VITE_CONTACT_FORM_URL is not set.");
  }

  const body = new FormData();
  body.append("category", message.category);
  body.append("email", message.email);
  body.append("message", message.message);
  // 不具合を調べる手がかり。ログイン中なら、どのアカウントかも添える。
  if (userId) {
    body.append("userId", userId);
  }
  body.append("userAgent", navigator.userAgent);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "X-Requested-With": "XMLHttpRequest" },
    body,
  });

  if (!response.ok) {
    throw new Error(`SSGform responded with ${response.status}.`);
  }
};
