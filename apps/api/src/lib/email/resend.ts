const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";

export type SendEmailParams = {
  from: string;
  to: string;
  subject: string;
  text: string;
};

export type EmailSender = {
  send(params: SendEmailParams): Promise<{ id: string }>;
};

export class EmailSendError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "EmailSendError";
    this.status = status;
  }
}

const describeFailure = async (response: Response) => {
  const body = await response.text().catch(() => "");

  if (!body) {
    return `Resend responded with ${response.status}.`;
  }

  try {
    const parsed = JSON.parse(body) as { name?: unknown; message?: unknown };
    const name = typeof parsed.name === "string" ? parsed.name : "unknown_error";
    const message = typeof parsed.message === "string" ? parsed.message : body;
    return `Resend responded with ${response.status} ${name}: ${message}`;
  } catch {
    return `Resend responded with ${response.status}: ${body}`;
  }
};

/**
 * Resend Email APIの送信だけを行うclient。SDKは送信以外にwebhook検証と受信mail解析を
 * 抱えており、Workerのbundleにその分がそのまま乗るため使わない。
 *
 * SDKは送信失敗を`{ data, error }`で返すが、このclientは失敗をthrowする。
 * 呼び出し側のBetter Authはmail送信の失敗をrequestの失敗として扱えるようになる。
 */
export const createResendEmailSender = (apiKey: string): EmailSender => ({
  async send({ from, to, subject, text }) {
    let response: Response;

    try {
      response = await fetch(RESEND_EMAILS_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ from, to, subject, text }),
      });
    } catch (error) {
      throw new EmailSendError(
        `Resend request failed: ${error instanceof Error ? error.message : "unknown error"}`,
        null,
      );
    }

    if (!response.ok) {
      throw new EmailSendError(await describeFailure(response), response.status);
    }

    const payload = (await response.json()) as { id?: unknown };

    if (typeof payload.id !== "string") {
      throw new EmailSendError("Resend returned a response without an email id.", response.status);
    }

    return { id: payload.id };
  },
});
