import { afterEach, describe, expect, it, vi } from "vitest";
import { createResendEmailSender, EmailSendError } from "./resend";

const params = {
  from: "noreply@example.com",
  to: "user@example.com",
  subject: "Recipe Stock verification code",
  text: "Your Recipe Stock code is 123456.",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Resend email sender", () => {
  it("Resend Email APIへ送信内容をPOSTする", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ id: "email-1" }));

    await expect(createResendEmailSender("test-key").send(params)).resolves.toEqual({
      id: "email-1",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body as string)).toEqual(params);
  });

  it("APIがエラーを返したらEmailSendErrorをthrowする", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ name: "validation_error", message: "Invalid `to` field." }, { status: 422 }),
    );

    const error = await createResendEmailSender("test-key")
      .send(params)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EmailSendError);
    expect((error as EmailSendError).status).toBe(422);
    expect((error as EmailSendError).message).toContain("validation_error");
    expect((error as EmailSendError).message).toContain("Invalid `to` field.");
  });

  it("requestが失敗したらEmailSendErrorをthrowする", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const error = await createResendEmailSender("test-key")
      .send(params)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EmailSendError);
    expect((error as EmailSendError).status).toBeNull();
    expect((error as EmailSendError).message).toContain("network down");
  });

  it("email idを含まない応答をエラーとして扱う", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}));

    await expect(createResendEmailSender("test-key").send(params)).rejects.toBeInstanceOf(
      EmailSendError,
    );
  });
});
